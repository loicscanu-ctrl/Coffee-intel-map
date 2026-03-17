# backend/scraper/main.py
import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from playwright.async_api import async_playwright
from scraper.db import get_session, upsert_news_item
from scraper.sources import barchart, b3, brazil, vietnam, origins, demand, technicals, futures, uganda, freightos
from scraper.sources import macro_cot as _macro_cot

ALL_SOURCES = [barchart, b3, brazil, vietnam, origins, demand, technicals, futures, uganda, freightos]
SCHEDULED_HOUR_UTC = 1  # Run daily at 01:00 UTC

async def run_all_scrapers():
    print("[scraper] Starting daily scrape run...")
    db = get_session()
    total = 0
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            page = await browser.new_page()
            for source in ALL_SOURCES:
                name = source.__name__.split(".")[-1]
                try:
                    items = await source.run(page)
                    for item in items:
                        upsert_news_item(db, item)
                        total += 1
                    print(f"[scraper] {name}: {len(items)} items")
                except Exception as e:
                    print(f"[scraper] {name} failed: {e}")
            # Side-channel scraper: updates commodity_cot + commodity_prices tables
            # (does not yield news items — called separately from ALL_SOURCES loop)
            try:
                await _macro_cot.run(page)
                print("[scraper] macro_cot: OK")
            except Exception as e:
                print(f"[scraper] macro_cot failed: {e}")

            await browser.close()
    finally:
        db.close()
    print(f"[scraper] Done. {total} items inserted.")

def seconds_until_next_run():
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    next_run = now.replace(hour=SCHEDULED_HOUR_UTC, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    delta = (next_run - now).total_seconds()
    print(f"[scraper] Next run scheduled at {next_run.strftime('%Y-%m-%d %H:%M UTC')} ({delta/3600:.1f}h from now)")
    return delta

def main():
    # Run immediately on startup
    asyncio.run(run_all_scrapers())
    # Then run daily at 07:00 UTC
    while True:
        time.sleep(seconds_until_next_run())
        asyncio.run(run_all_scrapers())

if __name__ == "__main__":
    main()
