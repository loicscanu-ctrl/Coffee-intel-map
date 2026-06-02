"""
export_stocks.py
Reads DB + scraper caches and writes frontend/public/data/demand_stocks.json.

Sections:
  eu     — USDA FAS PSD annual EU green-coffee figures, from cache
  japan  — USDA FAS PSD annual Japan green-coffee figures, from cache

NB: ECF is a separate, self-contained flow ('3.4 – ECF stocks' →
ecf_history.json, read directly by the front-end) and is deliberately not part
of demand_stocks.json anymore.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem
from scraper.sources import ajca, population, psd_coffee, un_wpp_age

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

def _psd_section(market_key: str, db_data: dict | None) -> dict | None:
    if not db_data:
        return None
    market = db_data.get("markets", {}).get(market_key)
    if not market:
        return None
    return {
        "source":                db_data.get("source", "USDA FAS PSD"),
        "last_updated":          db_data.get("last_updated"),
        "annual":                market.get("annual", []),
        "latest_year":           market.get("latest_year"),
        "latest_imports_mt":     market.get("latest_imports_mt"),
        "latest_consumption_mt": market.get("latest_consumption_mt"),
        "latest_stocks_mt":      market.get("latest_stocks_mt"),
    }


def _build_ajca(db=None) -> dict | None:
    try:
        data = ajca.fetch_latest()
    except Exception as e:
        print(f"  [stocks] AJCA fetch error: {e}")
        data = None
    if not data and db is not None:
        # Cache file missing (export runs on a fresh runner) — fall back to DB
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "AJCA")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                data = json.loads(item.meta)
                print("  [stocks] AJCA: loaded from DB fallback")
            except Exception:
                pass
    if not data:
        return None
    return {
        "source":                 data.get("source", "AJCA"),
        "source_url":             data.get("source_url"),
        "last_updated":           data.get("last_updated"),
        "latest_year":            data.get("latest_year"),
        "latest_imports_mt":      data.get("latest_imports_mt"),
        "latest_consumption_mt":  data.get("latest_consumption_mt"),
        "monthly_imports_pdf":    data.get("monthly_imports_pdf"),
        "monthly_exports_pdf":    data.get("monthly_exports_pdf"),
        "supply_demand_pdf":      data.get("supply_demand_pdf"),
        "yearly_imports_pdf":     data.get("yearly_imports_pdf"),
        "latest_origin_breakdown": data.get("latest_origin_breakdown"),
        "latest_origin_pdf":       data.get("latest_origin_pdf"),
    }


def _psd_producers(psd_data: dict | None) -> dict | None:
    """Return {country: {latest_year, production_mt, exports_mt, ...}} summary."""
    if not psd_data:
        return None
    producers = psd_data.get("producers")
    if not producers:
        return None
    out: dict[str, dict] = {}
    for country, d in producers.items():
        out[country] = {
            "latest_year":            d.get("latest_year"),
            "latest_production_mt":   d.get("latest_production_mt"),
            "latest_exports_mt":      d.get("latest_exports_mt"),
            "latest_consumption_mt":  d.get("latest_consumption_mt"),
            "latest_stocks_mt":       d.get("latest_stocks_mt"),
            "annual":                 d.get("annual", []),
        }
    return out or None


# Countries surfaced in the Growth Markets panel — emerging consumer markets
# plus producer countries with meaningful domestic consumption. Each entry's
# source block is whichever of psd_data["markets"] or psd_data["producers"]
# carries it (the PSD scraper parses both with the same shape).
_GROWTH_MARKETS = [
    ("china",       "China",         "markets"),
    ("india",       "India",         "producers"),
    ("brazil",      "Brazil",        "producers"),
    ("indonesia",   "Indonesia",     "producers"),
    ("vietnam",     "Vietnam",       "producers"),
    ("russia",      "Russia",        "markets"),
    ("mexico",      "Mexico",        "producers"),
    ("turkey",      "Turkey",        "markets"),
    ("philippines", "Philippines",   "markets"),
    ("egypt",       "Egypt",         "markets"),
    ("korea",       "South Korea",   "markets"),
    ("ethiopia",    "Ethiopia",      "producers"),
]


def _growth_markets(psd_data: dict | None, pop_data: dict | None) -> list[dict] | None:
    """Return ranked consumption + per-capita series for the 12 growth markets."""
    if not psd_data:
        return None

    markets   = psd_data.get("markets", {}) or {}
    producers = psd_data.get("producers", {}) or {}
    pop_countries = (pop_data or {}).get("countries", {}) or {}

    out: list[dict] = []
    for short, name, block in _GROWTH_MARKETS:
        src = (markets if block == "markets" else producers).get(short)
        if not src or not src.get("latest_consumption_mt"):
            continue

        consumption_mt = src["latest_consumption_mt"]
        pop_entry = pop_countries.get(short)
        latest_pop = pop_entry.get("latest_population") if pop_entry else None

        # Per-capita in kg/year (consumption_mt * 1000 kg per MT) / population.
        per_capita_kg = None
        if latest_pop and latest_pop > 0:
            per_capita_kg = round(consumption_mt * 1000.0 / latest_pop, 2)

        out.append({
            "short":            short,
            "name":             name,
            "latest_year":      src.get("latest_year"),
            "consumption_mt":   consumption_mt,
            "population":       latest_pop,
            "per_capita_kg":    per_capita_kg,
            "annual":           src.get("annual", []),
        })

    out.sort(key=lambda r: -(r["consumption_mt"] or 0))
    return out or None


def _age_cohort(wpp_data: dict | None) -> dict | None:
    """Slim 18+ cohort payload for the AgeCohortPanel."""
    if not wpp_data:
        return None
    countries = wpp_data.get("countries", {}) or {}
    if not countries:
        return None
    return {
        "source":        wpp_data.get("source"),
        "last_updated":  wpp_data.get("last_updated"),
        "age_threshold": wpp_data.get("age_threshold", 18),
        "countries":     {
            short: {
                "name":         d.get("name"),
                "location_id":  d.get("location_id"),
                "annual":       d.get("annual", []),
                "latest_year":  d.get("latest_year"),
                "latest_pop":   d.get("latest_pop"),
            }
            for short, d in countries.items()
        },
    }


def _world_consumption(psd_data: dict | None) -> dict | None:
    """Aggregate USDA PSD consumption across all tracked markets + producers,
    plus a manually-maintained ICO reference number for the most recent
    marketing year. The frontend renders a coverage % so the user can see
    how much of the world we're actually summing.

    ICO reference is updated by editing this dict when ICO publishes their
    annual statistics (typically May/June for the prior marketing year).
    """
    if not psd_data:
        return None
    markets   = psd_data.get("markets", {}) or {}
    producers = psd_data.get("producers", {}) or {}

    total_tracked_mt = 0
    latest_year      = None
    countries_count  = 0
    for d in {**markets, **producers}.values():
        c = d.get("latest_consumption_mt")
        if c is None:
            continue
        total_tracked_mt += c
        countries_count  += 1
        y = d.get("latest_year")
        if y and (latest_year is None or y > latest_year):
            latest_year = y

    if total_tracked_mt <= 0:
        return None

    # ICO published "Total World Consumption" — marketing year 2023/24,
    # from the ICO Coffee Market Report 2024. Update annually.
    ico_reference = {
        "marketing_year":         "2023/24",
        "world_consumption_mt":   10_620_000,   # ≈ 177M 60-kg bags
        "source":                 "ICO Coffee Market Report",
        "source_url":             "https://www.ico.org/coffee-market-report.asp",
        "note":                   "Manually updated when ICO publishes annual statistics.",
    }

    coverage_pct = round(total_tracked_mt / ico_reference["world_consumption_mt"] * 100.0, 1)

    return {
        "tracked_consumption_mt": total_tracked_mt,
        "tracked_countries":      countries_count,
        "tracked_latest_year":    latest_year,
        "ico_reference":          ico_reference,
        "tracked_vs_ico_pct":     coverage_pct,
    }


def _populations(pop_data: dict | None) -> dict | None:
    """Slim population payload — only what the frontend needs."""
    if not pop_data:
        return None
    countries = pop_data.get("countries", {})
    if not countries:
        return None
    return {
        "source":       pop_data.get("source"),
        "last_updated": pop_data.get("last_updated"),
        "countries":    {
            short: {
                "name":              d.get("name"),
                "iso3":              d.get("iso3"),
                "latest_year":       d.get("latest_year"),
                "latest_population": d.get("latest_population"),
            }
            for short, d in countries.items()
        },
    }


def export_stocks(db) -> None:
    try:
        psd_data = psd_coffee.fetch_latest()
    except Exception as e:
        print(f"  [stocks] PSD fetch error: {e}")
        psd_data = None
    if not psd_data:
        # Cache file missing (export on fresh runner) — fall back to DB
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "PSD Coffee")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                psd_data = json.loads(item.meta)
                print("  [stocks] PSD Coffee: loaded from DB fallback")
            except Exception:
                pass

    try:
        pop_data = population.fetch_latest()
    except Exception as e:
        print(f"  [stocks] population fetch error: {e}")
        pop_data = None
    if not pop_data:
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "World Bank")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                pop_data = json.loads(item.meta)
                print("  [stocks] population: loaded from DB fallback")
            except Exception:
                pass

    try:
        wpp_data = un_wpp_age.fetch_latest()
    except Exception as e:
        print(f"  [stocks] UN WPP fetch error: {e}")
        wpp_data = None
    if not wpp_data:
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "UN WPP")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if item and item.meta:
            try:
                wpp_data = json.loads(item.meta)
                print("  [stocks] UN WPP: loaded from DB fallback")
            except Exception:
                pass

    # NB: ECF is intentionally NOT here. It is a self-contained flow owned by
    # the '3.4 – ECF stocks' scraper, which writes frontend/public/data/
    # ecf_history.json (read directly by the front-end). Do not re-add an "ecf"
    # key — that would resurrect the duplicate the dismantling removed.
    result = {
        "generated_at":   datetime.utcnow().isoformat() + "Z",
        "eu":             _psd_section("eu",    psd_data),
        "japan":          _psd_section("japan", psd_data),
        "usa":            _psd_section("usa",   psd_data),
        "ajca":           _build_ajca(db),
        "producers":      _psd_producers(psd_data),
        "growth_markets": _growth_markets(psd_data, pop_data),
        "populations":    _populations(pop_data),
        "age_cohort_18plus": _age_cohort(wpp_data),
        "world_consumption": _world_consumption(psd_data),
    }
    path = OUT_DIR / "demand_stocks.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    prod_count = len(result["producers"] or {})
    growth_count = len(result["growth_markets"] or [])
    print(
        f"  demand_stocks.json -> "
        f"ecf:{result['ecf'] is not None} "
        f"eu:{result['eu'] is not None} "
        f"japan:{result['japan'] is not None} "
        f"usa:{result['usa'] is not None} "
        f"ajca:{result['ajca'] is not None} "
        f"producers:{prod_count} "
        f"growth_markets:{growth_count} "
        f"populations:{(result['populations'] or {}).get('countries', {}) and len((result['populations'] or {}).get('countries', {}))}"
    )


def main():
    print("Exporting demand stocks JSON...")
    db = SessionLocal()
    try:
        export_stocks(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
