"""
retail_cpi.py — Retail coffee CPI scraper for the demand-tab cost-pass-through view.

Three free public sources:
  US     — Bureau of Labor Statistics, series CUSR0000SEFP02
           (Roasted coffee, U.S. city average, all urban consumers, SA)
  EU     — Eurostat HICP, COICOP CP01211 ("Coffee"), area EU27_2020
  Brazil — Banco Central do Brasil SGS series 1635
           (IPCA — sub-item Café moído, monthly index)

Each is a monthly index. We compute YoY % so the three are comparable
and can be overlaid against a coffee-futures YoY proxy on the frontend.

Cache shape:
  {
    "source":       "BLS + Eurostat + BCB SGS",
    "last_updated": "2026-05-14",
    "series": {
      "us":     {"name": "...", "source_url": "...", "monthly": [{"period": "YYYY-MM", "index": float, "yoy_pct": float|null}]},
      "eu":     {...},
      "brazil": {...}
    }
  }

API access is anonymous (BLS API key optional — no key works for 25
queries/day, more than enough for one series). On any single-source
failure the cache is retained so the demand tab continues rendering.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "retail_cpi.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

_BLS_SERIES = "CUSR0000SEFP02"
_EUROSTAT_DATAFLOW = "prc_hicp_midx"
_BCB_SGS = 1635

_PERIOD_TO_MONTH = {f"M{i:02d}": f"{i:02d}" for i in range(1, 13)}


def _yoy_series(rows: list[dict]) -> list[dict]:
    """Compute YoY % from prior-year same month. Input rows have 'period' YYYY-MM and 'index'."""
    by_period = {r["period"]: r["index"] for r in rows if r.get("index") is not None}
    out: list[dict] = []
    for r in rows:
        if r.get("index") is None:
            continue
        y, m = r["period"].split("-")
        prev = f"{int(y) - 1}-{m}"
        prev_idx = by_period.get(prev)
        yoy = round(((r["index"] / prev_idx) - 1.0) * 100.0, 2) if prev_idx else None
        out.append({"period": r["period"], "index": r["index"], "yoy_pct": yoy})
    return out


def _fetch_bls() -> dict | None:
    """BLS public API — request 15 years to give a 14yr YoY series."""
    end_year = datetime.utcnow().year
    start_year = end_year - 15
    url = f"https://api.bls.gov/publicAPI/v2/timeseries/data/{_BLS_SERIES}"
    payload = {
        "seriesid": [_BLS_SERIES],
        "startyear": str(start_year),
        "endyear":   str(end_year),
    }
    try:
        r = requests.post(url, headers=_HEADERS, json=payload, timeout=30)
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning(f"[retail_cpi] BLS fetch failed: {e}")
        return None

    if body.get("status") != "REQUEST_SUCCEEDED":
        logger.warning(f"[retail_cpi] BLS status {body.get('status')}: {body.get('message')}")
        return None
    series = (body.get("Results", {}).get("series") or [{}])[0].get("data", [])
    rows: list[dict] = []
    for s in series:
        period = s.get("period", "")
        if period not in _PERIOD_TO_MONTH:
            continue
        try:
            idx = float(s["value"])
        except (KeyError, TypeError, ValueError):
            continue
        rows.append({"period": f"{s['year']}-{_PERIOD_TO_MONTH[period]}", "index": idx})
    rows.sort(key=lambda r: r["period"])
    return {
        "name":       "US — Roasted coffee (BLS CPI, SA)",
        "source_url": f"https://data.bls.gov/timeseries/{_BLS_SERIES}",
        "monthly":    _yoy_series(rows),
    }


def _fetch_eurostat() -> dict | None:
    """Eurostat HICP monthly index for coffee (CP01211) across EU27."""
    url = (
        "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
        f"{_EUROSTAT_DATAFLOW}"
        "?format=JSON&lang=EN&unit=I15&coicop=CP01211&geo=EU27_2020"
    )
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning(f"[retail_cpi] Eurostat fetch failed: {e}")
        return None

    # Eurostat JSON-stat: dimension.time.category.index maps period → ordinal,
    # value (dict or list) maps that ordinal → measurement.
    try:
        time_cat = body["dimension"]["time"]["category"]
        time_idx = time_cat["index"]
        values   = body["value"]
    except (KeyError, TypeError):
        logger.warning("[retail_cpi] Eurostat: unexpected JSON-stat shape")
        return None

    # time_idx can be a dict (period→ordinal) or a list of periods
    if isinstance(time_idx, dict):
        periods = sorted(time_idx.keys(), key=lambda p: time_idx[p])
    elif isinstance(time_idx, list):
        periods = list(time_idx)
    else:
        return None

    rows: list[dict] = []
    for i, period in enumerate(periods):
        # period format is "2024-01"; values keyed either by str(i) or i
        raw = values.get(str(i)) if isinstance(values, dict) else values[i] if i < len(values) else None
        if raw is None:
            continue
        try:
            rows.append({"period": period, "index": float(raw)})
        except (TypeError, ValueError):
            continue
    rows.sort(key=lambda r: r["period"])
    if not rows:
        return None
    return {
        "name":       "EU — Coffee HICP (Eurostat CP01211, EU27)",
        "source_url": "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_midx",
        "monthly":    _yoy_series(rows),
    }


def _fetch_kc_futures() -> dict | None:
    """KC=F monthly closes from Stooq — free CSV, no auth.

    Used as the cost-pass-through reference: when KC YoY rises faster
    than the retail CPI YoYs, the trade is absorbing the spike rather
    than passing it through. When they diverge for too long, retail
    pressure eventually catches up.
    """
    url = "https://stooq.com/q/d/l/?s=kc.f&i=m"
    try:
        r = requests.get(url, headers=_HEADERS, timeout=20)
        r.raise_for_status()
        text = r.text
    except Exception as e:
        logger.warning(f"[retail_cpi] Stooq KC fetch failed: {e}")
        return None

    # CSV header: Date,Open,High,Low,Close,Volume
    lines = text.strip().splitlines()
    if len(lines) < 2:
        return None
    rows: list[dict] = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        d, close = parts[0], parts[4]
        try:
            y, m, _ = d.split("-")
            rows.append({"period": f"{y}-{m}", "index": float(close)})
        except ValueError:
            continue
    rows.sort(key=lambda r: r["period"])
    # Trim to last 15 years so the chart range matches the CPI series
    cutoff = f"{datetime.utcnow().year - 15}-01"
    rows = [r for r in rows if r["period"] >= cutoff]
    if not rows:
        return None
    return {
        "name":       "ICE KC (Arabica front-month, monthly close)",
        "source_url": "https://stooq.com/q/?s=kc.f",
        "monthly":    _yoy_series(rows),
    }


def _fetch_bcb() -> dict | None:
    """BCB SGS series 1635 — IPCA sub-item Café moído (monthly index level)."""
    url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{_BCB_SGS}/dados?formato=json"
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        rows_raw = r.json()
    except Exception as e:
        logger.warning(f"[retail_cpi] BCB SGS fetch failed: {e}")
        return None

    # rows_raw: [{"data": "01/01/2000", "valor": "..."}]
    # BCB returns the percentage change MoM, not an index. To get a level we
    # cumulate from a base of 100.
    parsed: list[tuple[str, float]] = []
    for r_ in rows_raw:
        try:
            d = r_["data"]
            day, month, year = d.split("/")
            period = f"{year}-{month}"
            pct = float(str(r_["valor"]).replace(",", "."))
        except (KeyError, ValueError):
            continue
        parsed.append((period, pct))
    parsed.sort()
    if not parsed:
        return None

    level = 100.0
    rows: list[dict] = []
    for period, pct in parsed:
        level *= 1.0 + pct / 100.0
        rows.append({"period": period, "index": round(level, 4)})

    # Trim to last 15 years for consistency with BLS/Eurostat panel range
    cutoff = f"{datetime.utcnow().year - 15}-01"
    rows = [r for r in rows if r["period"] >= cutoff]
    return {
        "name":       "Brazil — Café moído (IPCA, BCB SGS 1635)",
        "source_url": f"https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarValores&seriesEscolhidas={_BCB_SGS}",
        "monthly":    _yoy_series(rows),
    }


def _build_payload() -> dict | None:
    series: dict[str, dict] = {}
    fetchers = [("us", _fetch_bls), ("eu", _fetch_eurostat), ("brazil", _fetch_bcb), ("kc_futures", _fetch_kc_futures)]
    for key, fn in fetchers:
        try:
            s = fn()
        except Exception as e:
            logger.warning(f"[retail_cpi] {key} unhandled error: {e}")
            s = None
        if s:
            series[key] = s

    if not series:
        return None
    return {
        "source":       "BLS + Eurostat + BCB SGS",
        "last_updated": datetime.utcnow().date().isoformat(),
        "series":       series,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        payload = _build_payload()
        if not payload:
            print("[retail_cpi] all 3 sources failed — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        n = len(payload["series"])
        names = ", ".join(payload["series"].keys())
        print(f"[retail_cpi] OK: {n}/4 series ({names}), last_updated={payload['last_updated']}")

        if db is not None:
            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"Retail Coffee CPI – {payload['last_updated']}",
                "body":     f"Retail coffee CPI series fetched: {names}",
                "source":   "Retail CPI",
                "category": "demand",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["cpi", "retail", "demand"],
                "meta":     json.dumps(payload),
            })
    except Exception as e:
        print(f"[retail_cpi] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[retail_cpi] cache read failed: {e}")
        return None
