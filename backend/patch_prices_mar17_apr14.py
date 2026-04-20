"""
Backfill correct Tuesday settlement prices for the 5 COT weeks
where price_ny was missing and price_ldn was captured at wrong time.

Prices sourced from actual front-month settlement data (user-verified).
Run from repo root:  python backend/patch_prices_mar17_apr14.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scraper.db import upsert_cot_weekly

PRICES = {
    "2026-03-17": {"price_ny": 302.05, "price_ldn": 3641.0},
    "2026-03-24": {"price_ny": 317.85, "price_ldn": 3776.0},
    "2026-03-31": {"price_ny": 298.35, "price_ldn": 3493.0},
    "2026-04-07": {"price_ny": 286.10, "price_ldn": 3315.0},
    "2026-04-14": {"price_ny": 302.65, "price_ldn": 3458.0},
}

def main():
    for date, fields in PRICES.items():
        upsert_cot_weekly("ny",  date, {"price_ny":  fields["price_ny"]})
        upsert_cot_weekly("ldn", date, {"price_ldn": fields["price_ldn"]})
        print(f"  {date}  NY={fields['price_ny']}¢  LDN=${fields['price_ldn']}")
    print("Done. Re-run export_static_json to refresh cot.json from DB.")

if __name__ == "__main__":
    main()
