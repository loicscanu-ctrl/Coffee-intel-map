"""
export_stocks.py
Reads DB + scraper caches and writes frontend/public/data/demand_stocks.json.

Sections:
  ecf    — ECF European port stocks (monthly), via NewsItem source="ECF"
  eu     — USDA FAS PSD annual EU green-coffee figures, from cache
  japan  — USDA FAS PSD annual Japan green-coffee figures, from cache
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem
from scraper.sources import ajca, psd_coffee

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _build_ecf(db) -> dict | None:
    try:
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "ECF")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if not item:
            return None
        meta = json.loads(item.meta or "{}")
        latest_bags = meta.get("latest_bags") or 0
        return {
            "source":        "ECF",
            "last_updated":  meta.get("as_of", str(item.pub_date)[:10]),
            "monthly":       meta.get("monthly", []),
            "latest_bags":   latest_bags,
            "latest_m_bags": round(latest_bags / 1_000_000, 2) if latest_bags else None,
            "source_url":    meta.get("source_url"),
            "latest_post":   meta.get("latest_post"),
            "latest_pdf":    meta.get("latest_pdf"),
            "yearly_pdfs":   meta.get("yearly_pdfs", []),
        }
    except Exception as e:
        print(f"  [stocks] ECF section error: {e}")
        return None


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

    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "ecf":      _build_ecf(db),
        "eu":       _psd_section("eu",    psd_data),
        "japan":    _psd_section("japan", psd_data),
        "usa":      _psd_section("usa",   psd_data),
        "ajca":     _build_ajca(db),
        "producers": _psd_producers(psd_data),
    }
    path = OUT_DIR / "demand_stocks.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    prod_count = len(result["producers"] or {})
    print(
        f"  demand_stocks.json -> "
        f"ecf:{result['ecf'] is not None} "
        f"eu:{result['eu'] is not None} "
        f"japan:{result['japan'] is not None} "
        f"usa:{result['usa'] is not None} "
        f"ajca:{result['ajca'] is not None} "
        f"producers:{prod_count}"
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
