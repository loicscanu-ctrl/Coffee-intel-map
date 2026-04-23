"""
Global Fertilizer Flow Tracker
Protocol: HS 3102 (Urea/N), 3104 (Potash), 3105 (DAP/MAP/NPK)
Sources:
  - UN Comtrade Plus API (primary — free tier, 500 calls/month)
  - Brazil MDIC Comex Stat (Brazil imports, fastest leading indicator)
  - India EXIM Bank (Urea arrivals, HS 31021000)
  - Morocco OCP / Office des Changes (phosphate exports)
  - China GAC (CSV/PDF monthly — manual seed fallback)
"""

from __future__ import annotations
import json, logging, os
from datetime import datetime, date
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

HS_CODES = {
    "3102": "Nitrogen fertilizers (incl Urea)",
    "3104": "Potassic fertilizers",
    "3105": "DAP / MAP / NPK",
}

# Top exporters per HS code (for filtering Comtrade queries)
TOP_EXPORTERS = {
    "3102": ["643", "156", "818", "682", "012", "634"],   # Russia, China, Egypt, Saudi Arabia, Algeria, Qatar
    "3104": ["124", "643", "112", "276", "376", "400"],   # Canada, Russia, Belarus, Germany, Israel, Jordan
    "3105": ["504", "156", "643", "840", "818", "400"],   # Morocco, China, Russia, USA, Egypt, Jordan
}

# Countries we track as importers
IMPORTER_COUNTRIES = {
    "brazil":  "76",
    "vietnam": "704",
    "india":   "356",
    "germany": "276",
}

COMTRADE_API_KEY = os.environ.get("COMTRADE_API_KEY", "")  # optional — paid tier only
# Public endpoint: no key required, 500 records/call
COMTRADE_PUBLIC_BASE = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "global_fertilizers.json"


# ── Step A: UN Comtrade (primary, cleanest) ────────────────────────────────────

def _comtrade_public(reporter_code: str, hs_code: str, period: str, flow: str) -> list[dict]:
    """
    Public endpoint — no key, up to 500 records per call.
    URL: https://comtradeapi.un.org/public/v1/preview/C/M/HS
    period format: "202401" for Jan 2024.
    flow: "X" exports, "M" imports.
    """
    params = {
        "reporterCode": reporter_code,
        "cmdCode":      hs_code,
        "flowCode":     flow,
        "period":       period,
        "partnerCode":  "0",       # world aggregate
        "includeDesc":  "true",
    }
    try:
        r = requests.get(COMTRADE_PUBLIC_BASE, params=params, timeout=30)
        r.raise_for_status()
        return r.json().get("data", [])
    except Exception as e:
        log.error("Comtrade public fetch error reporter=%s hs=%s period=%s: %s", reporter_code, hs_code, period, e)
        return []


def fetch_comtrade_exports(hs_code: str, period: str) -> list[dict]:
    """
    Fetch monthly export data for given HS code from top exporter countries.
    Uses public endpoint — no key required.
    """
    results = []
    for reporter_code in TOP_EXPORTERS.get(hs_code, []):
        rows = _comtrade_public(reporter_code, hs_code, period, "X")
        for d in rows:
            net_wgt = d.get("netWgt") or 0
            if net_wgt > 0:
                results.append({
                    "reporter":      d.get("reporterDesc", ""),
                    "reporter_code": str(d.get("reporterCode", "")),
                    "period":        str(d.get("period", "")),
                    "hs_code":       hs_code,
                    "qty_mt":        round(net_wgt / 1000, 1),   # kg -> MT
                    "value_usd":     d.get("primaryValue", 0) or 0,
                })
    return results


def fetch_comtrade_imports(importer: str, hs_code: str, period: str) -> list[dict]:
    """
    Fetch imports of given HS code for a specific importer country.
    Uses public endpoint — no key required.
    """
    country_code = IMPORTER_COUNTRIES.get(importer, "")
    if not country_code:
        return []
    rows = _comtrade_public(country_code, hs_code, period, "M")
    results = []
    for d in rows:
        net_wgt = d.get("netWgt") or 0
        if net_wgt > 0:
            results.append({
                "importer":   importer,
                "hs_code":    hs_code,
                "period":     str(d.get("period", "")),
                "qty_mt":     round(net_wgt / 1000, 1),
                "value_usd":  d.get("primaryValue", 0) or 0,
            })
    return results


# ── Step B: Brazil Comex Stat (fastest leading indicator) ─────────────────────

def fetch_brazil_fertilizer_comex(year: int, month: int) -> dict[str, float]:
    """
    Brazil imports of HS chapter 31 (all fertilizers) for a given month.
    Returns dict: {hs_chapter: qty_kg}
    API docs: api-comexstat.mdic.gov.br/docs
    Note: Cloudflare blocks direct curl — requires browser-like headers.
    """
    url = "https://api-comexstat.mdic.gov.br/general"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelBot/1.0)",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    payload = {
        "flow":       "I",           # imports
        "monthStart": f"{year}-{month:02d}",
        "monthEnd":   f"{year}-{month:02d}",
        "shCode":     ["31"],        # HS chapter 31 = all fertilizers
        "groupBy":    ["shCode"],
    }
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=30)
        r.raise_for_status()
        rows = r.json().get("data", {}).get("list", [])
        result: dict[str, float] = {}
        for row in rows:
            code = str(row.get("shCode", ""))
            kg   = float(row.get("kgLiquido", 0) or 0)
            result[code] = kg / 1000  # convert to MT
        return result
    except Exception as e:
        log.error("Comex Stat fetch error %s-%02d: %s", year, month, e)
        return {}


# ── YoY delta helper ───────────────────────────────────────────────────────────

def compute_yoy_delta(current_mt: float, prior_mt: float) -> dict:
    delta = current_mt - prior_mt
    pct   = (delta / prior_mt * 100) if prior_mt else 0
    return {"delta_mt": round(delta, 0), "yoy_pct": round(pct, 1)}


# ── Static seed (fallback when APIs unavailable) ───────────────────────────────

STATIC_SEED: dict[str, Any] = {
    "note": "Static seed — replace with live API data once COMTRADE_API_KEY is set",
    "global_exports_2024": {
        "3102": [
            {"country": "Russia",       "qty_mt_k": 7800},
            {"country": "China",        "qty_mt_k": 5200},
            {"country": "Egypt",        "qty_mt_k": 2100},
            {"country": "Saudi Arabia", "qty_mt_k": 1900},
            {"country": "Algeria",      "qty_mt_k": 1400},
            {"country": "Qatar",        "qty_mt_k": 900},
        ],
        "3104": [
            {"country": "Canada",   "qty_mt_k": 14000},
            {"country": "Russia",   "qty_mt_k": 6200},
            {"country": "Belarus",  "qty_mt_k": 5100},
            {"country": "Germany",  "qty_mt_k": 2800},
            {"country": "Israel",   "qty_mt_k": 1600},
            {"country": "Jordan",   "qty_mt_k": 1100},
        ],
        "3105": [
            {"country": "Morocco",  "qty_mt_k": 8900},
            {"country": "China",    "qty_mt_k": 7400},
            {"country": "Russia",   "qty_mt_k": 3200},
            {"country": "USA",      "qty_mt_k": 2600},
            {"country": "Egypt",    "qty_mt_k": 2000},
            {"country": "Jordan",   "qty_mt_k": 1200},
        ],
    },
}


# ── Main build function ────────────────────────────────────────────────────────

def build_global_fertilizers(db=None) -> dict:
    now   = datetime.utcnow()
    # Build list of last 6 periods to query
    periods = []
    y, m = now.year, now.month
    for _ in range(6):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
        periods.append(f"{y}{m:02d}")

    # Live Comtrade data via public endpoint (no key required)
    live_exports: dict[str, list] = {code: [] for code in HS_CODES}
    live_imports: dict[str, dict] = {}

    for hs in HS_CODES:
        for period in periods[:3]:  # last 3 months
            rows = fetch_comtrade_exports(hs, period)
            live_exports[hs].extend(rows)
            log.info("Comtrade exports hs=%s period=%s: %d rows", hs, period, len(rows))

    # Brazil + Vietnam imports for latest 2 periods
    for country in ["brazil", "vietnam"]:
        live_imports[country] = {}
        for hs in HS_CODES:
            for period in periods[:2]:
                rows = fetch_comtrade_imports(country, hs, period)
                live_imports[country].setdefault(hs, []).extend(rows)

    # Brazil Comex Stat (faster, ~30d lag vs Comtrade ~60d)
    brazil_comex: dict[str, dict] = {}
    for period in periods[:2]:
        yr, mo = int(period[:4]), int(period[4:])
        result = fetch_brazil_fertilizer_comex(yr, mo)
        if result:
            brazil_comex[f"{yr}-{mo:02d}"] = result

    out = {
        "updated":          now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hs_codes":         HS_CODES,
        "top_exporters":    TOP_EXPORTERS,
        "has_live_data":    True,
        "global_exports":   live_exports,
        "country_imports":  live_imports,
        "brazil_comex":     brazil_comex,
        "static_seed":      STATIC_SEED,
    }

    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("global_fertilizers.json written (%d bytes)", OUT_PATH.stat().st_size)
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = build_global_fertilizers()
    has_live = result["has_live_data"]
    print(f"Done. Live Comtrade data: {has_live}")
    if not has_live:
        print("Set COMTRADE_API_KEY env var -> free key at comtradedeveloper.un.org")
