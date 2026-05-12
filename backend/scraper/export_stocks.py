"""
export_stocks.py
Reads DB + scraper caches and writes frontend/public/data/demand_stocks.json.

Sections:
  ecf    — ECF European port stocks (monthly), via NewsItem source="ECF"
  ice    — ICE Coffee 'C' certified stocks (daily), from cache file
  japan  — USDA FAS PSD annual coffee figures for Japan, from cache file
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem
from scraper.sources import ice_certified, psd_japan

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


def _build_ice() -> dict | None:
    try:
        data = ice_certified.fetch_latest()
        if not data or not data.get("series"):
            return None
        latest = data["series"][-1]
        return {
            "source":       data.get("source", "ICE"),
            "source_url":   data.get("source_url"),
            "last_updated": latest["as_of"],
            "series":       data["series"],
            "latest": {
                "total_bags": latest["total_bags"],
                "eu_bags":    latest["eu_bags"],
                "us_bags":    latest["us_bags"],
                "other_bags": latest["other_bags"],
            },
            "by_port": (data.get("latest") or {}).get("by_port") or {},
        }
    except Exception as e:
        print(f"  [stocks] ICE section error: {e}")
        return None


def _build_japan() -> dict | None:
    try:
        data = psd_japan.fetch_latest()
        if not data:
            return None
        return {
            "source":                "USDA FAS PSD",
            "last_updated":          data.get("last_updated"),
            "annual":                data.get("annual", []),
            "latest_year":           data.get("latest_year"),
            "latest_imports_mt":     data.get("latest_imports_mt"),
            "latest_consumption_mt": data.get("latest_consumption_mt"),
            "latest_stocks_mt":      data.get("latest_stocks_mt"),
        }
    except Exception as e:
        print(f"  [stocks] Japan section error: {e}")
        return None


def export_stocks(db) -> None:
    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "ecf":   _build_ecf(db),
        "ice":   _build_ice(),
        "japan": _build_japan(),
    }
    path = OUT_DIR / "demand_stocks.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"  demand_stocks.json -> "
        f"ecf:{result['ecf'] is not None} "
        f"ice:{result['ice'] is not None} "
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
