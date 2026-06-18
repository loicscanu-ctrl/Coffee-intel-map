"""
origin_prices_history.py
Accumulates daily local farmgate prices per coffee origin into a single
JSON file. Each export run appends today's row if not already present.

Brazil (Arabica + Conilon) bootstraps from BCB SGS — Brazilian Central
Bank's Sistema Gerenciador de Séries, which mirrors CEPEA/ESALQ daily
indicators back to ~1996. Vietnam and Uganda accumulate forward from the
day this module first runs; backfill for those origins is deferred to a
follow-up (UCDA bulletins for UG; user-supplied file for VN).

This module reads-then-writes so it MUST NOT run before the upstream
files it depends on (vn_physical_prices.json, uganda_supply.json, Cooabriel
NewsItem) are themselves up-to-date for the day.
"""

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT     = Path(__file__).resolve().parents[3]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "origin_prices_history.json"

# BCB SGS series codes — daily CEPEA/ESALQ mirror, R$/saca de 60kg.
SGS_ARABICA = 4332  # Café Arábica — São Paulo SP indicator (Cooxupé / Garça basis)
SGS_CONILON = 4333  # Café Conilon  — Vitória ES indicator
BACKFILL_YEARS = 2

# Some Brazilian government endpoints reject bare-Python user agents (egress
# from GH Actions runners has hit 403 with no UA). A standard browser UA
# gets us through.
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.7",
}

ORIGINS = {
    "vietnam": {
        "name":      "Vietnam Robusta FAQ Grade 2 (Dak Lak)",
        "source":    "Giacaphe.com",
        "currency":  "VND",
        "unit":      "per_kg",
        "color":     "#06b6d4",
        "commodity": "robusta",
    },
    "brazil_conilon": {
        "name":      "Brazil Conilon Tipo 7 (CEPEA/ESALQ)",
        "source":    "BCB SGS 4333 (CEPEA daily mirror)",
        "currency":  "BRL",
        "unit":      "per_saca_60kg",
        "color":     "#10b981",
        "commodity": "robusta",
    },
    "uganda": {
        "name":      "Uganda Robusta Screen 15 (UCDA)",
        "source":    "Uganda Coffee Development Authority",
        "currency":  "USD",
        "unit":      "per_cwt",
        "color":     "#f59e0b",
        "commodity": "robusta",
    },
    "brazil_arabica": {
        "name":      "Brazil Arabica (CEPEA/ESALQ)",
        "source":    "BCB SGS 4332 (CEPEA daily mirror)",
        "currency":  "BRL",
        "unit":      "per_saca_60kg",
        "color":     "#a855f7",
        "commodity": "arabica",
    },
    "uganda_drugar": {
        "name":      "Uganda Drugar (UCDA)",
        "source":    "Uganda Coffee Development Authority",
        "currency":  "USD",
        "unit":      "per_kg",
        "color":     "#ec4899",
        "commodity": "arabica",
    },
    "uganda_wugar": {
        "name":      "Uganda Wugar (UCDA)",
        "source":    "Uganda Coffee Development Authority",
        "currency":  "USD",
        "unit":      "per_kg",
        "color":     "#14b8a6",
        "commodity": "arabica",
    },
}


def _load_existing() -> dict:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[origin_prices_history] failed to parse {OUT_PATH}: {e} — starting from empty",
                  file=sys.stderr, flush=True)
            return {}
    return {}


def _fetch_bcb_sgs(series_code: int, lookback_years: int = BACKFILL_YEARS) -> list[dict]:
    """Fetch a daily series from BCB SGS as [{date: YYYY-MM-DD, value: float}].

    Loud error logging — when this returns empty we want to know why on the
    next CI run rather than silently shipping a 1-row Brazil history again
    (PR #44 hit exactly that failure mode and produced no diagnostic output).
    """
    today = date.today()
    start = today - timedelta(days=lookback_years * 365)
    url = (
        f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{series_code}/dados"
        f"?formato=json"
        f"&dataInicial={start.strftime('%d/%m/%Y')}"
        f"&dataFinal={today.strftime('%d/%m/%Y')}"
    )
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            status = resp.status
            body   = resp.read().decode("utf-8", errors="replace")
        if status != 200:
            print(f"  BCB SGS {series_code} → HTTP {status} (body len={len(body)})")
            return []
        try:
            raw = json.loads(body)
        except json.JSONDecodeError as e:
            snippet = body[:200].replace("\n", " ")
            print(f"  BCB SGS {series_code} → JSON parse FAILED: {e}; body[:200]={snippet!r}")
            return []
        if not isinstance(raw, list) or not raw:
            print(f"  BCB SGS {series_code} → unexpected payload shape (len={len(raw) if hasattr(raw,'__len__') else '?'})")
            return []
        out: list[dict] = []
        for r in raw:
            try:
                iso = datetime.strptime(r["data"], "%d/%m/%Y").date().isoformat()
                v   = float(str(r["valor"]).replace(",", "."))
                out.append({"date": iso, "value": v})
            except Exception as e:
                print(f"  BCB SGS {series_code} → row parse skip ({e}): {r!r}")
                continue
        print(f"  BCB SGS {series_code} → {len(out)} rows over {lookback_years}y")
        return out
    except urllib.error.HTTPError as e:
        print(f"  BCB SGS {series_code} → HTTPError {e.code}: {e.reason}")
        return []
    except urllib.error.URLError as e:
        print(f"  BCB SGS {series_code} → URLError: {e.reason}")
        return []
    except Exception as e:
        print(f"  BCB SGS {series_code} → FAILED ({type(e).__name__}): {e}")
        return []


def _backfill_from_sgs(history: list[dict], series_code: int, label: str) -> list[dict]:
    """If we have fewer than 30 days, pull the full BCB SGS series."""
    if len(history) >= 30:
        return history
    print(f"  {label} → backfilling from BCB SGS {series_code} ({BACKFILL_YEARS}y)...")
    fetched = _fetch_bcb_sgs(series_code)
    if not fetched:
        return history
    by_date = {h["date"]: h for h in history}
    for row in fetched:
        if row["date"] not in by_date:
            by_date[row["date"]] = {"date": row["date"], "price": row["value"]}
    merged = sorted(by_date.values(), key=lambda r: r["date"])
    print(f"  {label} → {len(merged)} rows after backfill")
    return merged


def _today_vn_price() -> float | None:
    p = ROOT / "frontend" / "public" / "data" / "vn_physical_prices.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        v = d.get("vn_faq", {}).get("vnd_per_kg")
        return float(v) if v else None
    except Exception as e:
        print(f"[origin_prices_history] vn_price unavailable from {p}: {e}",
              file=sys.stderr, flush=True)
        return None


def _today_brazil_conilon_price(db) -> float | None:
    """Read today's Conilon Tipo 7 price from the latest Cooabriel NewsItem."""
    try:
        from models import NewsItem
        item = (db.query(NewsItem)
                  .filter(NewsItem.source == "Cooabriel")
                  .order_by(NewsItem.pub_date.desc()).first())
        if not item:
            return None
        m = re.search(r"R\$\s*([\d.]+,\d{2})", item.body or "")
        if not m:
            return None
        return float(m.group(1).replace(".", "").replace(",", "."))
    except Exception as e:
        print(f"[origin_prices_history] brazil_conilon_price unavailable from Cooabriel NewsItem: {e}",
              file=sys.stderr, flush=True)
        return None


def _today_brazil_arabica_price(db) -> float | None:
    """Read today's Arabica price from the latest CEPEA/ESALQ NewsItem.

    The CEPEA scraper writes two items per run — title pattern
    'CEPEA Arabica – YYYY-MM-DD' and 'CEPEA Conilon (Robusta) – ...'. We
    filter to the Arabica title so we don't accidentally read the Conilon
    price. Body format: 'CEPEA Arabica price: R$ 1.234,50/sack (DD/MM/YYYY)'.

    This complements the BCB SGS 4332 backfill — when 4332 returns empty
    (the failure mode that produced an empty brazil_arabica history in
    origin_prices_history.json), the CEPEA daily price is the live source.
    """
    try:
        from models import NewsItem
        item = (db.query(NewsItem)
                  .filter(NewsItem.source == "CEPEA/ESALQ")
                  .filter(NewsItem.title.like("CEPEA Arabica%"))
                  .order_by(NewsItem.pub_date.desc()).first())
        if not item:
            return None
        m = re.search(r"R\$\s*([\d.]+,\d{2})", item.body or "")
        if not m:
            return None
        return float(m.group(1).replace(".", "").replace(",", "."))
    except Exception as e:
        print(f"[origin_prices_history] brazil_arabica_price unavailable from CEPEA/ESALQ NewsItem: {e}",
              file=sys.stderr, flush=True)
        return None


def _today_uganda_price() -> float | None:
    """Read today's UCDA Screen 15 farmgate price from uganda_supply.json."""
    p = ROOT / "frontend" / "public" / "data" / "uganda_supply.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        v = d.get("ucda_price", {}).get("usd_cwt")
        return float(v) if v else None
    except Exception as e:
        print(f"[origin_prices_history] uganda_price unavailable from {p}: {e}",
              file=sys.stderr, flush=True)
        return None


def _today_uganda_arabica_price(grade_names: list[str]) -> float | None:
    """Read a UCDA arabica grade farmgate price (USD/kg) from uganda_supply.json
    → ucda_detail.grades. Used for Drugar / Wugar. Returns None when the grade
    isn't in the latest monthly table (UCDA reports arabica grades seasonally)."""
    p = ROOT / "frontend" / "public" / "data" / "uganda_supply.json"
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        grades = (d.get("ucda_detail") or {}).get("grades") or []
        wanted = {g.lower() for g in grade_names}
        for g in grades:
            if str(g.get("grade", "")).lower() in wanted:
                v = g.get("price_usd_kg")
                return float(v) if v else None
        return None
    except Exception as e:
        print(f"[origin_prices_history] uganda arabica price unavailable from {p}: {e}",
              file=sys.stderr, flush=True)
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

    # Migrate legacy "brazil" key (Conilon only) from PR #44 → brazil_conilon.
    if "brazil" in origins and "brazil_conilon" not in origins:
        origins["brazil_conilon"] = origins.pop("brazil")

    # Seed origin slots with their static metadata; preserve existing history.
    for key, cfg in ORIGINS.items():
        slot = origins.get(key) or {}
        slot["name"]      = cfg["name"]
        slot["source"]    = cfg["source"]
        slot["currency"]  = cfg["currency"]
        slot["unit"]      = cfg["unit"]
        slot["color"]     = cfg["color"]
        slot["commodity"] = cfg["commodity"]
        slot["history"]   = slot.get("history") or []
        origins[key] = slot

    # Drop any obsolete keys (e.g. the migrated-away "brazil") to keep file clean.
    for key in list(origins.keys()):
        if key not in ORIGINS:
            del origins[key]

    # Vietnam — append today's snapshot.
    origins["vietnam"]["history"] = _append_today(
        origins["vietnam"]["history"], today, _today_vn_price()
    )

    # Brazil Conilon — append today's Cooabriel + backfill from SGS 4333 on first run.
    origins["brazil_conilon"]["history"] = _append_today(
        origins["brazil_conilon"]["history"], today, _today_brazil_conilon_price(db)
    )
    origins["brazil_conilon"]["history"] = _backfill_from_sgs(
        origins["brazil_conilon"]["history"], SGS_CONILON, "brazil_conilon"
    )

    # Brazil Arabica — append today's CEPEA/ESALQ price (when the cepea
    # scraper has run today) and backfill from BCB SGS 4332 on first run.
    # The backfill went stale in production (SGS 4332 has been returning
    # empty since at least the 18 May 2026 daily run — visible in
    # origin_prices_history.json where brazil_arabica.history was []),
    # so the daily CEPEA news item is now the primary source.
    origins["brazil_arabica"]["history"] = _append_today(
        origins["brazil_arabica"]["history"], today, _today_brazil_arabica_price(db)
    )
    origins["brazil_arabica"]["history"] = _backfill_from_sgs(
        origins["brazil_arabica"]["history"], SGS_ARABICA, "brazil_arabica"
    )

    # Uganda — append today's UCDA Screen 15 (robusta) + Drugar / Wugar (arabica).
    origins["uganda"]["history"] = _append_today(
        origins["uganda"]["history"], today, _today_uganda_price()
    )
    origins["uganda_drugar"]["history"] = _append_today(
        origins["uganda_drugar"]["history"], today, _today_uganda_arabica_price(["Drugar"])
    )
    origins["uganda_wugar"]["history"] = _append_today(
        origins["uganda_wugar"]["history"], today, _today_uganda_arabica_price(["Wugar"])
    )

    payload = {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "origins":    origins,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(v.get("history", [])) for v in origins.values())
    print(f"  origin_prices_history.json → {total} total rows across {len(origins)} origins")
