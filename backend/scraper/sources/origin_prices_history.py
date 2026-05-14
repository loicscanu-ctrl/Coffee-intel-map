"""
origin_prices_history.py
Accumulates daily local farmgate prices per coffee origin into a single
JSON file. Each export run appends today's row if not already present.

Brazil bootstraps from BCB SGS (Brazilian Central Bank — Sistema Gerenciador
de Séries), which mirrors CEPEA/ESALQ daily indicators back to ~1996.
Vietnam and Uganda accumulate forward from the day this module first runs;
backfill for those origins is deferred to a follow-up.

This module reads-then-writes so it MUST NOT run before the upstream
files it depends on (vn_physical_prices.json, uganda_supply.json, Cooabriel
NewsItem) are themselves up-to-date for the day.
"""

import json
import re
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT     = Path(__file__).resolve().parents[3]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "origin_prices_history.json"

# BCB SGS series codes — daily CEPEA/ESALQ mirror, R$/saca de 60kg.
SGS_CONILON = 4333  # Café Conilon (robusta) — Vitória ES indicator
SGS_ARABICA = 4332  # Café Arábica — São Paulo SP indicator (reserved for later)
BACKFILL_YEARS = 2

ORIGINS = {
    "vietnam": {
        "name":     "Vietnam Robusta FAQ Grade 2 (Dak Lak)",
        "source":   "Giacaphe.com",
        "currency": "VND",
        "unit":     "per_kg",
        "color":    "#06b6d4",
    },
    "brazil": {
        "name":     "Brazil Conilon Tipo 7 (CEPEA/ESALQ)",
        "source":   "BCB SGS 4333 (CEPEA daily mirror)",
        "currency": "BRL",
        "unit":     "per_saca_60kg",
        "color":    "#10b981",
    },
    "uganda": {
        "name":     "Uganda Robusta Screen 15 (UCDA)",
        "source":   "Uganda Coffee Development Authority",
        "currency": "USD",
        "unit":     "per_cwt",
        "color":    "#f59e0b",
    },
}


def _load_existing() -> dict:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _fetch_bcb_sgs(series_code: int, lookback_years: int = BACKFILL_YEARS) -> list[dict]:
    """Fetch a daily series from BCB SGS as [{date: YYYY-MM-DD, value: float}]."""
    today = date.today()
    start = today - timedelta(days=lookback_years * 365)
    url = (
        f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{series_code}/dados"
        f"?formato=json"
        f"&dataInicial={start.strftime('%d/%m/%Y')}"
        f"&dataFinal={today.strftime('%d/%m/%Y')}"
    )
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        out: list[dict] = []
        for r in raw:
            iso = datetime.strptime(r["data"], "%d/%m/%Y").date().isoformat()
            v   = float(str(r["valor"]).replace(",", "."))
            out.append({"date": iso, "value": v})
        return out
    except Exception as e:
        print(f"  BCB SGS {series_code} → FAILED: {e}")
        return []


def _backfill_brazil(history: list[dict]) -> list[dict]:
    """If we have fewer than 30 days of Brazil history, pull BCB SGS Conilon."""
    if len(history) >= 30:
        return history
    print(f"  brazil → backfilling from BCB SGS {SGS_CONILON} ({BACKFILL_YEARS}y)...")
    fetched = _fetch_bcb_sgs(SGS_CONILON)
    if not fetched:
        return history
    by_date = {h["date"]: h for h in history}
    for row in fetched:
        if row["date"] not in by_date:
            by_date[row["date"]] = {"date": row["date"], "price": row["value"]}
    merged = sorted(by_date.values(), key=lambda r: r["date"])
    print(f"  brazil → {len(merged)} rows after backfill")
    return merged


def _today_vn_price() -> float | None:
    p = ROOT / "frontend" / "public" / "data" / "vn_physical_prices.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        v = d.get("vn_faq", {}).get("vnd_per_kg")
        return float(v) if v else None
    except Exception:
        return None


def _today_brazil_price(db) -> float | None:
    """Read today's Conilon Tipo 7 price from the latest Cooabriel NewsItem."""
    try:
        from models import NewsItem
        item = (db.query(NewsItem)
                  .filter(NewsItem.source == "Cooabriel")
                  .order_by(NewsItem.pub_date.desc()).first())
        if not item:
            return None
        # Body shape: "Conilon Tipo 7 price: R$ 615,50/saca"
        m = re.search(r"R\$\s*([\d.]+,\d{2})", item.body or "")
        if not m:
            return None
        return float(m.group(1).replace(".", "").replace(",", "."))
    except Exception:
        return None


def _today_uganda_price() -> float | None:
    """Read today's UCDA Screen 15 farmgate price from uganda_supply.json."""
    p = ROOT / "frontend" / "public" / "data" / "uganda_supply.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        v = d.get("ucda_price", {}).get("usd_cwt")
        return float(v) if v else None
    except Exception:
        return None


def _append_today(history: list[dict], today_iso: str, price: float | None) -> list[dict]:
    if price is None:
        return history
    if any(h["date"] == today_iso for h in history):
        return history
    history.append({"date": today_iso, "price": price})
    return sorted(history, key=lambda r: r["date"])


def export_origin_prices_history(db) -> None:
    """Build/update origin_prices_history.json — backfill Brazil, accumulate VN/UG."""
    existing = _load_existing()
    origins  = existing.get("origins") or {}
    today    = date.today().isoformat()

    # Seed origin slots with their static metadata; preserve existing history.
    for key, cfg in ORIGINS.items():
        slot = origins.get(key) or {}
        slot["name"]     = cfg["name"]
        slot["source"]   = cfg["source"]
        slot["currency"] = cfg["currency"]
        slot["unit"]     = cfg["unit"]
        slot["color"]    = cfg["color"]
        slot["history"]  = slot.get("history") or []
        origins[key] = slot

    # Vietnam — append today's snapshot.
    origins["vietnam"]["history"] = _append_today(
        origins["vietnam"]["history"], today, _today_vn_price()
    )

    # Brazil — append today's Cooabriel, then backfill from CEPEA on first run.
    origins["brazil"]["history"] = _append_today(
        origins["brazil"]["history"], today, _today_brazil_price(db)
    )
    origins["brazil"]["history"] = _backfill_brazil(origins["brazil"]["history"])

    # Uganda — append today's UCDA Screen 15.
    origins["uganda"]["history"] = _append_today(
        origins["uganda"]["history"], today, _today_uganda_price()
    )

    payload = {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "origins":    origins,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(v.get("history", [])) for v in origins.values())
    print(f"  origin_prices_history.json → {total} total rows across {len(origins)} origins")
