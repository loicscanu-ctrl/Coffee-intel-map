"""
monthly_scraper.py — Runs monthly data sources that don't have their own flow.

Sources:
  psd_coffee       — USDA FAS PSD CSV (monthly release, ~mid-month)
  usda_gain_pdf    — USDA GAIN Coffee Annual PDFs (forward-year forecasts
                     USDA only publishes in the narrative reports, never in
                     the CSV). Merged on top of psd_coffee in export_stocks.

NB on what is NOT run here (to avoid duplicate scrapes):
  • ECF port stocks → '3.4 – ECF stocks' (scraper/backfill_ecf_history.py).
  • ajca (Japan)    → '3.5 – AJCA (Japan)'  (scraper/backfill_japan_stocks.py).
  • ucda_reports    → '3.3.5 – Uganda UCDA' (scraper.run_monthly ucda).
  • un_wpp_age      → annual cadence → scraper/annual_scraper.py.

Called by .github/workflows/scraper-slow-data.yml (~12th of each month, after
the USDA PSD release).
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session, upsert_news_item
from scraper.sources import psd_coffee as _psd_coffee
from scraper.sources import usda_gain_pdf as _usda_gain_pdf

TIMEOUT = 300  # 5 min per source


async def _run(name: str, coro, db=None) -> None:
    try:
        result = await asyncio.wait_for(coro, timeout=TIMEOUT)
        if isinstance(result, list):
            for item in result:
                upsert_news_item(db, item)
            print(f"[monthly] {name}: {len(result)} items")
        else:
            print(f"[monthly] {name}: OK")
    except TimeoutError:
        print(f"[monthly] {name}: TIMEOUT after {TIMEOUT}s")
    except Exception as e:
        print(f"[monthly] {name} failed: {e}")


async def run_monthly() -> None:
    from playwright.async_api import async_playwright

    db = get_session()
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)

            for name, coro_fn in [
                ("psd_coffee",    lambda p: _psd_coffee.run(p, db)),
                ("usda_gain_pdf", lambda p: _usda_gain_pdf.run(p, db)),
            ]:
                page = await browser.new_page()
                try:
                    await _run(name, coro_fn(page), db=db)
                finally:
                    await page.close()

            await browser.close()
    finally:
        db.close()
    print("[monthly] Done.")


def main() -> None:
    asyncio.run(run_monthly())


if __name__ == "__main__":
    main()
