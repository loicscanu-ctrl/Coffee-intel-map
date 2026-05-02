#!/usr/bin/env python3
# backend/scraper/run_prices.py
# Fetch closing prices for all commodities and upsert into commodity_prices table.
# Runs on Tuesday (= CFTC COT report snapshot date) after all markets close.
#
# Usage:
#   cd backend
#   DATABASE_URL=postgresql://... python -m scraper.run_prices

import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from models import CotWeekly
from scraper.db import get_session
from scraper.db_macro import upsert_commodity_price
from scraper.sources.macro_cot import (
    COMMODITY_SPECS,
    _fetch_gbpusd_rates,
    _fetch_yfinance_prices,
)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="Override target date (YYYY-MM-DD). Defaults to today.")
    args = parser.parse_args()
    today = date.fromisoformat(args.date) if args.date else date.today()
    print(f"Fetching commodity prices for {today}")

    # Build (sym, date) pairs for all direct yfinance symbols.
    # Proxy source symbols (lsgo, cocoa_ldn, white_sugar, feeder_cattle) rely on
    # their proxy symbol being in this list — those proxy symbols themselves have
    # price_source = "yfinance", so they are included automatically.
    yfinance_pairs = [
        (sym, today)
        for sym, spec in COMMODITY_SPECS.items()
        if spec["price_source"] in ("yfinance", "yfinance_gbp")
    ]
    print(f"Fetching prices for {len(yfinance_pairs)} yfinance symbols...")
    price_cache = _fetch_yfinance_prices(yfinance_pairs)

    # GBP/USD rates (needed for yfinance_gbp symbols, e.g. white_sugar on LIFFE)
    needs_gbp = any(
        spec["price_source"] == "yfinance_gbp"
        for spec in COMMODITY_SPECS.values()
    )
    gbpusd_cache = _fetch_gbpusd_rates({today}) if needs_gbp else {}

    db = get_session()
    try:
        inserted = 0
        for sym, spec in COMMODITY_SPECS.items():
            src = spec["price_source"]

            if src == "yfinance":
                price = price_cache.get((sym, today))
                if price is None:
                    print(f"  WARNING: no yfinance price for {sym} on {today}", file=sys.stderr)
                    continue
                upsert_commodity_price(db, sym, today, price)
                inserted += 1

            elif src == "yfinance_gbp":
                price_gbp = price_cache.get((sym, today))
                gbpusd    = gbpusd_cache.get(today)
                if price_gbp is None or gbpusd is None:
                    print(f"  WARNING: missing price or GBPUSD rate for {sym}", file=sys.stderr)
                    continue
                upsert_commodity_price(db, sym, today, price_gbp * gbpusd)
                inserted += 1

            elif src == "proxy":
                proxy_sym   = spec["price_proxy"]
                proxy_price = price_cache.get((proxy_sym, today))
                if proxy_price is None:
                    print(f"  WARNING: no proxy price for {sym} (proxy={proxy_sym})", file=sys.stderr)
                    continue
                upsert_commodity_price(db, sym, today, proxy_price * spec["proxy_to_usd_per_mt_factor"])
                inserted += 1

            elif src == "cot_weekly":
                # Robusta: price lives in cot_weekly table, populated by the weekly cot scraper
                row = db.query(CotWeekly).filter_by(market="ldn", date=today).first()
                if row and row.price_ldn:
                    upsert_commodity_price(db, sym, today, float(row.price_ldn))
                    inserted += 1
                else:
                    print(f"  WARNING: no cot_weekly price_ldn for {sym} on {today}", file=sys.stderr)

        print(f"Done. {inserted} prices upserted.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
