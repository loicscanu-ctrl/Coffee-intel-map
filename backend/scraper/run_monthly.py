# backend/scraper/run_monthly.py
# Monthly runner: CONAB supply, Comex Stat + Vietnam fertilizer, Vietnam coffee
# exports, and UCDA (Uganda) monthly reports.
# Called by scraper-monthly.yml on the 12th of each month.
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import create_farmer_economics_tables, get_session
from scraper.sources import (
    comex_fertilizer,
    conab_supply,
    ucda_reports,
    vn_coffee_export,
    vn_fertilizer,
)


async def run_monthly_scrapers():
    print("[scraper-monthly] Starting monthly scrape run...")
    create_farmer_economics_tables()
    db = get_session()
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            page    = await browser.new_page()
            try:
                await conab_supply.run(page, db)
                print("[scraper-monthly] conab_supply: OK")
            except Exception as e:
                print(f"[scraper-monthly] conab_supply failed: {e}")
            try:
                await comex_fertilizer.run(page, db)
                print("[scraper-monthly] comex_fertilizer: OK")
            except Exception as e:
                print(f"[scraper-monthly] comex_fertilizer failed: {e}")
            try:
                await vn_fertilizer.run(page, db)
                print("[scraper-monthly] vn_fertilizer: OK")
            except Exception as e:
                print(f"[scraper-monthly] vn_fertilizer failed: {e}")
            try:
                await vn_coffee_export.run(page, db)
                print("[scraper-monthly] vn_coffee_export: OK")
            except Exception as e:
                print(f"[scraper-monthly] vn_coffee_export failed: {e}")
            try:
                await ucda_reports.run(page, db)
                print("[scraper-monthly] ucda_reports: OK")
            except Exception as e:
                print(f"[scraper-monthly] ucda_reports failed: {e}")
            await browser.close()
    finally:
        db.close()
    print("[scraper-monthly] Done.")


if __name__ == "__main__":
    asyncio.run(run_monthly_scrapers())
