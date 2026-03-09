# backend/scraper/main.py
import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from playwright.async_api import async_playwright
from scraper.db import get_session, upsert_news_item
from scraper.sources import barchart, b3, brazil, vietnam, origins, demand, technicals

ALL_SOURCES = [barchart, b3, brazil, vietnam, origins, demand, technicals]
INTERVAL_HOURS = 24

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
            await browser.close()
    finally:
        db.close()
    print(f"[scraper] Done. {total} items inserted.")

def main():
    while True:
        asyncio.run(run_all_scrapers())
        print(f"[scraper] Sleeping {INTERVAL_HOURS}h until next run...")
        time.sleep(INTERVAL_HOURS * 3600)

if __name__ == "__main__":
    main()
