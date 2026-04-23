# backend/scraper/run_daily.py
# Single-run entrypoint for the daily scraper suite — called by GitHub Actions.
# Runs all 10 news sources + macro_cot once, then exits.
import asyncio
from scraper.db import migrate_cot_weekly_columns, create_farmer_economics_tables, create_physical_prices_table
from scraper.main import run_all_scrapers

if __name__ == "__main__":
    migrate_cot_weekly_columns()
    create_farmer_economics_tables()
    create_physical_prices_table()
    asyncio.run(run_all_scrapers())
