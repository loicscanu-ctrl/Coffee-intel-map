#!/usr/bin/env python3
# backend/scraper/run_cot.py
# Download CFTC + ICE COT positions and upsert into commodity_cot table only.
# Prices are handled separately by run_prices.py (Tuesdays).
#
# Usage:
#   cd backend
#   DATABASE_URL=postgresql://... python -m scraper.run_cot

import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session
from scraper.db_macro import upsert_commodity_cot
from scraper.sources.macro_cot import (
    _download_cftc_df, _download_ice_df, _parse_cftc, _parse_ice,
)


def main():
    today = date.today()
    year  = today.year

    print("Downloading CFTC...")
    try:
        cftc_df = _download_cftc_df(year)
        if len(cftc_df) == 0:
            raise ValueError("empty")
        print(f"  CFTC {year}: {len(cftc_df)} rows")
    except Exception as e:
        print(f"  CFTC {year} unavailable ({e}), falling back to {year - 1}", file=sys.stderr)
        cftc_df = _download_cftc_df(year - 1)
        print(f"  CFTC {year - 1}: {len(cftc_df)} rows")

    print("Downloading ICE Europe...")
    try:
        ice_df = _download_ice_df(year)
        if len(ice_df) == 0:
            raise ValueError("empty")
        print(f"  ICE {year}: {len(ice_df)} rows")
    except Exception as e:
        print(f"  ICE {year} unavailable ({e}), falling back to {year - 1}", file=sys.stderr)
        ice_df = _download_ice_df(year - 1)
        print(f"  ICE {year - 1}: {len(ice_df)} rows")

    cot_data = {}
    cot_data.update(_parse_cftc(cftc_df))
    cot_data.update(_parse_ice(ice_df))
    print(f"Parsed {len(cot_data)} COT symbols")

    db = get_session()
    try:
        for sym, (report_date, fields) in cot_data.items():
            upsert_commodity_cot(db, sym, report_date, fields)
        print(f"Done. {len(cot_data)} COT rows upserted.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
