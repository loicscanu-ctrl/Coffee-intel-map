"""
run_cot_coffee.py
Lightweight Friday runner: fetch CFTC + ICE COT for Coffee C / Robusta
and upsert into cot_weekly.  No Playwright required — pure urllib.

Called by scraper-cot.yml after run_cot (macro positions).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import create_cot_position_table, migrate_drop_cot_weekly_position_columns
from scraper.sources.futures import _fetch_cftc_cot, _fetch_ice_robusta_cot, _make_cot_item, _make_ice_cot_item


def main():
    create_cot_position_table()
    migrate_drop_cot_weekly_position_columns()

    # CFTC – NY Arabica Coffee C
    cot_row = _fetch_cftc_cot()
    if cot_row:
        _make_cot_item(
            cot_row,
            title="CFTC COT Coffee C (NY Arabica)",
            source="CFTC",
            tags=["futures", "cot", "arabica"],
        )
        print(f"[cot] NY upserted: {cot_row['Report_Date_as_YYYY-MM-DD']}")
    else:
        print("[cot] NY: no data returned from CFTC")

    # ICE – London Robusta
    ice_result = _fetch_ice_robusta_cot()
    if ice_result:
        latest, prev = ice_result
        _make_ice_cot_item(latest, prev)
        print("[cot] LDN upserted")
    else:
        print("[cot] LDN: no data returned from ICE")


if __name__ == "__main__":
    main()
