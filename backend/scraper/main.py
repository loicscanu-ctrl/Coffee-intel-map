# backend/scraper/main.py
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import UTC

from playwright.async_api import async_playwright

from scraper.db import extract_physical_price, get_session, upsert_news_item, upsert_physical_price
from scraper.errors import CriticalSourceError
from scraper.sources import ajca as _ajca
from scraper.sources import (
    b3,
    b3_icf,
    barchart,
    brazil,
    cepea,
    demand,
    freightos,
    futures,
    origins,
    rss,
    technicals,
    uganda,
    vietnam,
)
from scraper.sources import colombia as _colombia
from scraper.sources import colombia_weather as _colombia_weather
from scraper.sources import dry_bulk as _dry_bulk
from scraper.sources import ecf_stocks as _ecf_stocks
from scraper.sources import ethiopia as _ethiopia
from scraper.sources import ethiopia_weather as _ethiopia_weather
from scraper.sources import farmer_economics as _farmer_economics
from scraper.sources import honduras as _honduras
from scraper.sources import honduras_weather as _honduras_weather
from scraper.sources import indonesia as _indonesia
from scraper.sources import indonesia_weather as _indonesia_weather
from scraper.sources import macro_cot as _macro_cot
from scraper.sources import psd_coffee as _psd_coffee
from scraper.sources import ucda_reports as _ucda_reports
from scraper.sources import uganda_weather as _uganda_weather

ALL_SOURCES = [barchart, b3, brazil, vietnam, origins, demand, technicals, futures, uganda, freightos, cepea, rss, b3_icf, _colombia, _honduras, _indonesia, _ethiopia, _ecf_stocks]
SCHEDULED_HOUR_UTC = 1   # Run daily at 01:00 UTC
CONCURRENCY       = 3    # Max parallel Playwright pages
SCRAPER_TIMEOUT   = 180  # Seconds before a single scraper is killed


async def _run_one(source, browser, semaphore, db) -> int:
    """Run one news source with its own page, under the concurrency semaphore."""
    name = source.__name__.split(".")[-1]
    async with semaphore:
        page = await browser.new_page()
        try:
            items = await asyncio.wait_for(source.run(page), timeout=SCRAPER_TIMEOUT)
            count = 0
            for item in items:
                upsert_news_item(db, item)
                pp = extract_physical_price(item)
                if pp:
                    upsert_physical_price(db, **pp)
                count += 1
            print(f"[scraper] {name}: {count} items")
            return count
        except TimeoutError:
            print(f"[scraper] {name}: TIMEOUT after {SCRAPER_TIMEOUT}s — skipped")
            return 0
        except CriticalSourceError as e:
            # Opt-out from the swallow-all default — this source signaled
            # a total outage that should fail the workflow.
            print(f"[scraper] {name} CRITICAL: {e}")
            raise
        except Exception as e:
            print(f"[scraper] {name} failed: {e}")
            return 0
        finally:
            await page.close()


async def _run_side_channel(name, coro_fn, browser, timeout: int = SCRAPER_TIMEOUT) -> None:
    """Run a side-channel scraper (no news items returned) with its own page.
    timeout: per-source override. macro_cot in particular needs more headroom
    than the news scrapers because it does ~25 sequential yfinance.download()
    calls plus CFTC + ICE + stooq downloads.
    """
    page = await browser.new_page()
    try:
        await asyncio.wait_for(coro_fn(page), timeout=timeout)
        print(f"[scraper] {name}: OK")
    except TimeoutError:
        print(f"[scraper] {name}: TIMEOUT after {timeout}s — skipped")
    except Exception as e:
        print(f"[scraper] {name} failed: {e}")
    finally:
        await page.close()


async def run_all_scrapers():
    print("[scraper] Starting daily scrape run...")
    db = get_session()
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            semaphore = asyncio.Semaphore(CONCURRENCY)

            # Phase 1: all news sources in parallel (capped at CONCURRENCY pages)
            # return_exceptions=True prevents one failing source from cancelling siblings.
            # CriticalSourceError is collected and re-raised after all tasks complete.
            tasks = [_run_one(source, browser, semaphore, db) for source in ALL_SOURCES]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            critical_errors = [r for r in results if isinstance(r, BaseException) and not isinstance(r, int)]
            total = sum(r for r in results if isinstance(r, int))

            # Phase 2: side-channel scrapers — run sequentially (they write to
            # their own tables and don't return news items). Per-source timeout
            # overrides: macro_cot does ~25 yfinance downloads + CFTC + ICE
            # which routinely takes 3–5 minutes.
            db_ref = db
            for name, coro_fn, timeout in [
                ("macro_cot",         lambda p: _macro_cot.run(p),                               420),
                ("farmer_economics",  lambda p: _farmer_economics.run(p, db_ref),                SCRAPER_TIMEOUT),
                ("dry_bulk",          lambda p: _dry_bulk.run(p, db_ref),                        SCRAPER_TIMEOUT),
                ("psd_coffee",        lambda p: _psd_coffee.run(p, db_ref),                      SCRAPER_TIMEOUT),
                ("ajca",              lambda p: _ajca.run(p, db_ref),                            SCRAPER_TIMEOUT),
                ("colombia_weather",  lambda p: _colombia_weather.run(p, db_ref),                60),
                ("honduras_weather",  lambda p: _honduras_weather.run(p, db_ref),                60),
                ("indonesia_weather", lambda p: _indonesia_weather.run(p, db_ref),               60),
                ("uganda_weather",    lambda p: _uganda_weather.run(p, db_ref),                  60),
                ("ethiopia_weather",  lambda p: _ethiopia_weather.run(p, db_ref),                60),
                ("ucda_reports",      lambda p: _ucda_reports.run(p, db_ref, start_id=1319, scan_back=30), SCRAPER_TIMEOUT),
            ]:
                await _run_side_channel(name, coro_fn, browser, timeout=timeout)

            await browser.close()
    finally:
        db.close()
    print(f"[scraper] Done. {total} items inserted.")
    if critical_errors:
        raise critical_errors[0]


def seconds_until_next_run():
    from datetime import datetime, timedelta
    now = datetime.now(UTC)
    next_run = now.replace(hour=SCHEDULED_HOUR_UTC, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    delta = (next_run - now).total_seconds()
    print(f"[scraper] Next run scheduled at {next_run.strftime('%Y-%m-%d %H:%M UTC')} ({delta/3600:.1f}h from now)")
    return delta


def main():
    asyncio.run(run_all_scrapers())
    while True:
        time.sleep(seconds_until_next_run())
        asyncio.run(run_all_scrapers())


if __name__ == "__main__":
    main()
