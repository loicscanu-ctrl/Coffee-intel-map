# backend/scraper/run_daily.py
# Single-run entrypoint for the daily scraper suite — called by GitHub Actions.
# Runs the news sources + the daily side-channel scrapers (farmer_economics,
# dry_bulk, psd_coffee, weather, etc.) once, then exits. COT positions are
# owned by the weekly scraper-cot.yml workflow — CFTC publishes once a week,
# so daily COT scraping was a guaranteed no-op (see commit message for the
# move).
import asyncio

from scraper.db import (
    create_farmer_economics_tables,
    create_physical_prices_table,
)
from scraper.main import run_all_scrapers

if __name__ == "__main__":
    create_farmer_economics_tables()
    create_physical_prices_table()
    asyncio.run(run_all_scrapers())
