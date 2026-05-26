# backend/scraper/run_monthly.py
"""Monthly source runner.

Run a single source per invocation:

    python -m scraper.run_monthly <source>

where <source> is one of: conab, comex, vn_fertilizer, vn_export, ucda.
With no argument, runs every source (legacy behaviour; failures are logged
but do not abort the others).

Each source has its own GitHub workflow (3.3.1–3.3.5) that invokes exactly one
source, so every source gets an independent schedule and failure isolation.
"""
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

# key -> (label, run-coroutine, needs_browser)
SOURCES = {
    "conab":         ("conab_supply",     conab_supply.run,     True),
    "comex":         ("comex_fertilizer", comex_fertilizer.run, True),
    "vn_fertilizer": ("vn_fertilizer",    vn_fertilizer.run,    True),
    "vn_export":     ("vn_coffee_export", vn_coffee_export.run, True),
    "ucda":          ("ucda_reports",     ucda_reports.run,     False),
}


async def _run(fn, needs_browser, db):
    if not needs_browser:
        # UCDA fetches PDFs over plain HTTP (requests) — no browser needed.
        await fn(None, db)
        return
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            await fn(page, db)
        finally:
            await browser.close()


async def run_source(key: str) -> None:
    label, fn, needs_browser = SOURCES[key]
    print(f"[scraper-monthly] Running source: {label}")
    create_farmer_economics_tables()
    db = get_session()
    try:
        await _run(fn, needs_browser, db)
    finally:
        db.close()
    print(f"[scraper-monthly] {label}: OK")


async def run_all() -> None:
    """Legacy: run every source, logging failures without aborting the rest."""
    print("[scraper-monthly] Running ALL sources...")
    create_farmer_economics_tables()
    db = get_session()
    try:
        for _key, (label, fn, needs_browser) in SOURCES.items():
            try:
                await _run(fn, needs_browser, db)
                print(f"[scraper-monthly] {label}: OK")
            except Exception as e:
                print(f"[scraper-monthly] {label} failed: {e}")
    finally:
        db.close()
    print("[scraper-monthly] Done.")


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg is None:
        asyncio.run(run_all())
    elif arg in SOURCES:
        asyncio.run(run_source(arg))  # exceptions propagate → non-zero exit
    else:
        print(f"Unknown source '{arg}'. Choices: {', '.join(SOURCES)}")
        sys.exit(2)
