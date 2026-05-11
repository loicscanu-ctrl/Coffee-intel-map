"""
bootstrap_supply_json.py
One-time script to seed Colombia / Honduras / Indonesia ICO export data
into the DB and write the supply JSONs — no Playwright required.

Weather, FNC, IHCAFE, ENSO sections will be null until their scrapers run.

Run from the backend directory:
    cd backend
    python -m scraper.bootstrap_supply_json
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from database import SessionLocal
from scraper.db import upsert_news_item
from scraper.sources.colombia import _fetch_ico_exports as _co_exports
from scraper.sources.honduras import _fetch_ico_exports as _hnd_exports
from scraper.sources.indonesia import _fetch_ico_exports as _idn_exports

import json
from datetime import datetime, date


def _today():
    return date.today().isoformat()


def seed_ico(db):
    jobs = [
        (
            "colombia",
            _co_exports,
            {"lat": 4.571, "lng": -74.297},
            ["exports", "colombia", "ico"],
        ),
        (
            "honduras",
            _hnd_exports,
            {"lat": 14.84, "lng": -87.20},
            ["exports", "honduras", "ico"],
        ),
        (
            "indonesia",
            _idn_exports,
            {"lat": -2.5, "lng": 118.0},
            ["exports", "indonesia", "ico"],
        ),
    ]

    for country, fetch_fn, coords, tags in jobs:
        print(f"  [{country}] fetching ICO CSV...", end=" ", flush=True)
        monthly = fetch_fn()
        if not monthly:
            print("FAILED — no data returned")
            continue

        last = monthly[-1]
        item = {
            "title":    f"{country.title()} Coffee Exports (ICO) – {last['month']}",
            "body":     (
                f"{country.title()} green coffee exports: {last['total_k_bags']:,}k bags in {last['month']}."
                + (f" YoY: {last['yoy_pct']:+.1f}%" if last.get("yoy_pct") is not None else "")
            ),
            "source":   "ICO",
            "category": "supply",
            "tags":     tags,
            "meta":     json.dumps({
                "monthly":      monthly,
                "last_updated": last["month"],
                "unit":         "thousand 60-kg bags",
            }),
            **coords,
        }
        upsert_news_item(db, item)
        print(f"OK — {len(monthly)} months, latest {last['month']}")


def main():
    print("Bootstrap: seeding ICO export data to DB...")
    db = SessionLocal()
    try:
        seed_ico(db)
    finally:
        db.close()

    print("\nExporting supply JSONs...")
    db2 = SessionLocal()
    try:
        from scraper.export_colombia import export_colombia
        from scraper.export_honduras import export_honduras
        from scraper.export_indonesia import export_indonesia

        export_colombia(db2)
        export_honduras(db2)
        export_indonesia(db2)
    finally:
        db2.close()

    print("\nDone.")


if __name__ == "__main__":
    main()
