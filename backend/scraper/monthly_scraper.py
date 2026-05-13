"""
monthly_scraper.py — Runs data sources that publish monthly or less frequently.

Sources:
  ecf_stocks   — ECF European port stocks (bi-monthly publications)
  psd_coffee   — USDA FAS PSD (monthly release)
  ajca         — Japan coffee imports/stats (monthly)
  ucda_reports — Uganda UCDA monthly PDF reports

Called by .github/workflows/scraper-monthly.yml on the 1st of each month.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session, upsert_news_item
from scraper.sources import ajca as _ajca
from scraper.sources import ecf_stocks as _ecf_stocks
from scraper.sources import psd_coffee as _psd_coffee
from scraper.sources import ucda_reports as _ucda_reports

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
                ("ecf_stocks",   lambda p: _ecf_stocks.run(p)),
                ("psd_coffee",   lambda p: _psd_coffee.run(p, db)),
                ("ajca",         lambda p: _ajca.run(p, db)),
                ("ucda_reports", lambda p: _ucda_reports.run(p, db, start_id=1319, scan_back=30)),
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
