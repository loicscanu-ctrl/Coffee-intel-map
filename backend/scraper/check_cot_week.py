#!/usr/bin/env python3
# backend/scraper/check_cot_week.py
# Diagnostic: show commodity_cot and commodity_prices for the latest 2 weeks.
#
# Usage:
#   cd backend
#   DATABASE_URL=postgresql://... python -m scraper.check_cot_week

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session
from models import CommodityCot, CommodityPrice


def main():
    db = get_session()
    try:
        # Latest 2 distinct COT dates
        from sqlalchemy import distinct
        dates = (
            db.query(distinct(CommodityCot.date))
            .order_by(CommodityCot.date.desc())
            .limit(2)
            .all()
        )
        dates = sorted([d[0] for d in dates])

        if not dates:
            print("No commodity_cot rows found.")
            return

        print(f"\nChecking dates: {[str(d) for d in dates]}\n")

        for dt in dates:
            cot_rows = db.query(CommodityCot).filter(CommodityCot.date == dt).all()
            price_rows = db.query(CommodityPrice).filter(CommodityPrice.date == dt).all()
            price_map = {p.symbol: p.close_price for p in price_rows}

            missing_prices = [r.symbol for r in cot_rows if r.symbol not in price_map]
            present_prices = [r.symbol for r in cot_rows if r.symbol in price_map]

            print(f"── {dt} ─────────────────────────────────")
            print(f"  commodity_cot rows : {len(cot_rows)}")
            print(f"  commodity_prices   : {len(price_rows)}")
            print(f"  symbols with price : {len(present_prices)}")
            if missing_prices:
                print(f"  MISSING prices for : {missing_prices}")
            else:
                print(f"  All prices present ✓")

            # Show OI totals
            total_oi = sum(r.oi_total or 0 for r in cot_rows)
            print(f"  Total OI (all syms): {total_oi:,}")

            # Sample: arabica + robusta
            for sym in ("arabica", "robusta"):
                cot = next((r for r in cot_rows if r.symbol == sym), None)
                price = price_map.get(sym)
                if cot:
                    print(f"  {sym}: mm_long={cot.mm_long}, mm_short={cot.mm_short}, "
                          f"oi={cot.oi_total}, price={price}")
                else:
                    print(f"  {sym}: NOT FOUND in commodity_cot")
            print()

    finally:
        db.close()


if __name__ == "__main__":
    main()
