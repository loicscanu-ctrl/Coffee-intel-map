#!/usr/bin/env python3
# backend/scraper/run_cot.py
# Download CFTC + ICE COT positions AND prices, upsert into commodity_cot + commodity_prices.
# Replaces the old positions-only approach so a single Friday run keeps everything in sync.
#
# Usage:
#   cd backend
#   DATABASE_URL=postgresql://... python -m scraper.run_cot

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session
from scraper.sources.macro_cot import _fetch_and_upsert


def main():
    db = get_session()
    try:
        _fetch_and_upsert(db)
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
