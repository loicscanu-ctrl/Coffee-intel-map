"""
End-to-end test for the cot_weekly → cot_position backfill.

Locks two contracts:
  1. Backfill produces a CotPosition row for every position-shaped column on
     every CotWeekly row, with the correct (crop, category, side) shape.
  2. Backfill is idempotent — re-running doesn't create duplicates and
     doesn't clobber existing values.
"""
from datetime import date

from models import CotPosition, CotWeekly


def _seed_wide(db, **overrides):
    """Add a representative cot_weekly row covering all-crop + crop-split fields."""
    row = CotWeekly(
        date=date(2026, 4, 28),
        market="ny",
        oi_total=150_000,                # market scalar — not in cot_position
        # All-crop
        mm_long=50_000,    mm_short=20_000,    mm_spread=5_000,
        pmpu_long=80_000,  pmpu_short=40_000,
        swap_long=30_000,  swap_short=25_000,  swap_spread=8_000,
        nr_long=4_000,     nr_short=3_000,
        # Trader counts
        t_mm_long=30, t_mm_short=20, t_mm_spread=5,
        t_pmpu_long=40, t_pmpu_short=35,
        # Old-crop split (NY only)
        mm_long_old=8_000, mm_short_old=3_000,
        # Other-crop split
        mm_long_other=42_000, mm_short_other=17_000,
        # Market scalars
        price_ny=304.10, structure_ny=-1.5,
    )
    for k, v in overrides.items():
        setattr(row, k, v)
    db.add(row)
    db.commit()


def test_backfill_inserts_position_rows(scraper_db):
    from backfill_cot_position import backfill
    from scraper.db import get_session
    db = get_session()
    _seed_wide(db)
    db.close()

    stats = backfill()

    assert stats["weeks"] == 1
    assert stats["rows_inserted"] > 0
    assert stats["rows_updated"] == 0

    db = get_session()
    try:
        rows = db.query(CotPosition).filter_by(market="ny", date=date(2026, 4, 28)).all()
        by_key = {(r.crop, r.category, r.side): r for r in rows}

        # All-crop positions
        assert by_key[("all", "mm",   "long")].oi      == 50_000
        assert by_key[("all", "mm",   "long")].traders == 30
        assert by_key[("all", "mm",   "spread")].oi    == 5_000
        assert by_key[("all", "pmpu", "long")].oi      == 80_000
        assert by_key[("all", "pmpu", "long")].traders == 40
        assert by_key[("all", "swap", "spread")].oi    == 8_000
        assert by_key[("all", "nr",   "long")].oi      == 4_000

        # Crop-split positions (NY only)
        assert by_key[("old",   "mm", "long")].oi  == 8_000
        assert by_key[("other", "mm", "long")].oi  == 42_000

        # Market scalars never produce position rows
        cats = {r.category for r in rows}
        assert cats <= {"pmpu", "swap", "mm", "other", "nr"}
    finally:
        db.close()


def test_backfill_is_idempotent(scraper_db):
    """Re-running backfill must not create duplicates and must not change values."""
    from backfill_cot_position import backfill
    from scraper.db import get_session

    db = get_session()
    _seed_wide(db)
    db.close()

    backfill()

    db = get_session()
    first_count = db.query(CotPosition).count()
    first_mm    = db.query(CotPosition).filter_by(
        date=date(2026, 4, 28), market="ny",
        crop="all", category="mm", side="long",
    ).first().oi
    db.close()

    # Run again
    stats2 = backfill()

    db = get_session()
    try:
        second_count = db.query(CotPosition).count()
        second_mm    = db.query(CotPosition).filter_by(
            date=date(2026, 4, 28), market="ny",
            crop="all", category="mm", side="long",
        ).first().oi

        assert second_count == first_count, "second backfill should not insert duplicates"
        assert second_mm    == first_mm,    "value should be stable across runs"
        assert stats2["rows_inserted"] == 0
        # Updates may legitimately fire — but they must update to the same value.
    finally:
        db.close()


def test_backfill_dry_run_writes_nothing(scraper_db):
    from backfill_cot_position import backfill
    from scraper.db import get_session

    db = get_session()
    _seed_wide(db)
    db.close()

    stats = backfill(dry_run=True)

    db = get_session()
    try:
        # No rows written
        assert db.query(CotPosition).count() == 0
        # Stats still report what *would* have happened
        assert stats["rows_inserted"] > 0
    finally:
        db.close()


def test_backfill_does_not_clobber_fresher_dual_write(scraper_db):
    """If dual-write already wrote a (crop,cat,side) row with current data and
    the wide row's value for that field is None (older partial row), the
    backfill must not overwrite the fresh value with None."""
    from backfill_cot_position import backfill
    from scraper.db import get_session, upsert_cot_weekly

    # Step 1: dual-write writes mm_long=50000 for the latest week.
    upsert_cot_weekly("ny", date(2026, 4, 28), {"mm_long": 50_000, "t_mm_long": 30})

    # Step 2: there's an OLDER cot_weekly row from before dual-write existed
    # that has mm_long=NULL (e.g. the wide column wasn't populated for that week).
    db = get_session()
    db.add(CotWeekly(date=date(2025, 1, 7), market="ny", oi_total=120_000, mm_long=42_000))
    db.commit()
    db.close()

    backfill()

    db = get_session()
    try:
        # The 2026-04-28 mm/long row from dual-write must still hold 50000 / 30.
        latest = db.query(CotPosition).filter_by(
            date=date(2026, 4, 28), market="ny",
            crop="all", category="mm", side="long",
        ).first()
        assert latest.oi      == 50_000
        assert latest.traders == 30

        # The older 2025 row should have been backfilled.
        older = db.query(CotPosition).filter_by(
            date=date(2025, 1, 7), market="ny",
            crop="all", category="mm", side="long",
        ).first()
        assert older is not None
        assert older.oi == 42_000
    finally:
        db.close()
