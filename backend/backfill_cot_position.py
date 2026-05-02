"""
backfill_cot_position.py — one-shot migration from CotWeekly (wide) to
CotPosition (narrow). Walks every existing cot_weekly row and emits
matching cot_position rows.

Idempotent: re-running won't produce duplicates. The unique index on
(date, market, crop, category, side) means each existing row gets
updated in place rather than re-inserted.

Usage:
    python -m backend.backfill_cot_position           # full backfill
    python -m backend.backfill_cot_position --dry-run # report only

Run from the backend/ directory:
    cd backend && python backfill_cot_position.py
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict


def _ensure_path() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)


def backfill(dry_run: bool = False) -> dict:
    _ensure_path()

    from cot_schema import cot_weekly_to_position_rows
    from database import SessionLocal
    from models import CotPosition, CotWeekly
    from scraper.db import create_cot_position_table

    create_cot_position_table()

    stats = {"weeks": 0, "rows_inserted": 0, "rows_updated": 0, "rows_skipped": 0}
    db = SessionLocal()
    try:
        wide_rows = (
            db.query(CotWeekly)
            .order_by(CotWeekly.date.asc(), CotWeekly.market.asc())
            .all()
        )
        print(f"[backfill] found {len(wide_rows)} cot_weekly rows", flush=True)

        # Pre-load existing cot_position keys so we don't issue one SELECT
        # per (week, market, crop, cat, side). Cheap for the dataset size.
        existing_keys: set[tuple] = set()
        if not dry_run:
            for r in db.query(
                CotPosition.date, CotPosition.market, CotPosition.crop,
                CotPosition.category, CotPosition.side,
            ).all():
                existing_keys.add(tuple(r))

        for i, wide in enumerate(wide_rows, start=1):
            stats["weeks"] += 1
            positions = cot_weekly_to_position_rows(wide)

            for pos in positions:
                key = (wide.date, wide.market, pos["crop"], pos["category"], pos["side"])
                if dry_run:
                    if key in existing_keys:
                        stats["rows_skipped"] += 1
                    else:
                        stats["rows_inserted"] += 1
                    continue

                if key in existing_keys:
                    # UPDATE only the columns we actually have values for, so
                    # a partial-coverage older week doesn't clobber a fresher
                    # value already written by the dual-write path.
                    row = (
                        db.query(CotPosition)
                        .filter_by(date=wide.date, market=wide.market,
                                   crop=pos["crop"], category=pos["category"],
                                   side=pos["side"])
                        .first()
                    )
                    if row:
                        if pos["oi"]      is not None: row.oi      = pos["oi"]
                        if pos["traders"] is not None: row.traders = pos["traders"]
                        stats["rows_updated"] += 1
                else:
                    db.add(CotPosition(
                        date=wide.date, market=wide.market,
                        crop=pos["crop"], category=pos["category"],
                        side=pos["side"],
                        oi=pos["oi"], traders=pos["traders"],
                    ))
                    existing_keys.add(key)
                    stats["rows_inserted"] += 1

            # Commit every 50 weeks to keep transactions small.
            if not dry_run and i % 50 == 0:
                db.commit()
                print(f"[backfill] {i}/{len(wide_rows)} weeks · "
                      f"+{stats['rows_inserted']} / ↺{stats['rows_updated']}",
                      flush=True)

        if not dry_run:
            db.commit()
    except Exception:
        if not dry_run:
            db.rollback()
        raise
    finally:
        db.close()

    print(f"\n[backfill] {'DRY-RUN ' if dry_run else ''}DONE")
    print(f"  weeks processed: {stats['weeks']:,}")
    print(f"  rows inserted:   {stats['rows_inserted']:,}")
    print(f"  rows updated:    {stats['rows_updated']:,}")
    if dry_run:
        print(f"  rows skipped:    {stats['rows_skipped']:,}  (already present)")
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would change without writing.")
    args = parser.parse_args()
    backfill(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
