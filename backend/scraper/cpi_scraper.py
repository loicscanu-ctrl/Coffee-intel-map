"""
cpi_scraper.py — Consumer-Price-Index sources (monthly cadence).

Runs the CPI fetchers that publish monthly, so they no longer ride the daily
news scraper (they were re-fetching unchanged numbers every day):

  us_cpi     — US BLS CPI-U headline (all items / core / food / energy)
  retail_cpi — retail coffee CPI (US BLS + EU Eurostat + Brazil BCB) + KC ref

Neither source needs a browser — both are plain HTTP/JSON APIs — so no
Playwright page is launched. The sources' ``run(page, db)`` signature exists
only for parity with the browser-based scrapers; ``page`` is ignored, so we
pass ``None``.

Called by .github/workflows/scraper-cpi.yml on a mid-month schedule that
tracks the releases (US BLS ~10th–18th, BCB IPCA ~10th, Eurostat HICP
mid-month), with a 1st-of-month backstop.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session
from scraper.sources import retail_cpi as _retail_cpi
from scraper.sources import us_cpi as _us_cpi

TIMEOUT = 180  # seconds per source


async def _run(name: str, coro_fn, db) -> None:
    try:
        await asyncio.wait_for(coro_fn(None), timeout=TIMEOUT)
        print(f"[cpi] {name}: OK")
    except TimeoutError:
        print(f"[cpi] {name}: TIMEOUT after {TIMEOUT}s")
    except Exception as e:
        print(f"[cpi] {name} failed: {e}")


async def run_cpi() -> None:
    with get_session() as db:
        for name, coro_fn in [
            ("us_cpi",     lambda p: _us_cpi.run(p, db)),
            ("retail_cpi", lambda p: _retail_cpi.run(p, db)),
        ]:
            await _run(name, coro_fn, db)
    print("[cpi] Done.")


def main() -> None:
    asyncio.run(run_cpi())


if __name__ == "__main__":
    main()
