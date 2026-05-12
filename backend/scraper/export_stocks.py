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
from scraper.sources import psd_coffee

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
        latest_bags = meta.get("latest_bags", 0)
        return {
            "source":        "ECF",
            "last_updated":  meta.get("as_of", str(item.pub_date)[:10]),
            "monthly":       meta.get("monthly", []),
            "latest_bags":   latest_bags,
            "latest_m_bags": round(latest_bags / 1_000_000, 2) if latest_bags else None,
            "source_url":    meta.get("source_url"),
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


def export_stocks(db) -> None:
    try:
        psd_data = psd_coffee.fetch_latest()
    except Exception as e:
        print(f"  [stocks] PSD fetch error: {e}")
        psd_data = None

    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "ecf":   _build_ecf(db),
        "eu":    _psd_section("eu",    psd_data),
        "japan": _psd_section("japan", psd_data),
    }
    path = OUT_DIR / "demand_stocks.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"  demand_stocks.json -> "
        f"ecf:{result['ecf'] is not None} "
        f"eu:{result['eu'] is not None} "
        f"japan:{result['japan'] is not None}"
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
