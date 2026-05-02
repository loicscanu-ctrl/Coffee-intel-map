"""
Integration tests for the cot_position dual-write inside upsert_cot_weekly.

Lock the contract: every position field written to cot_weekly produces a
matching row in cot_position with the right (crop, category, side) and
the same value. Wide CotWeekly behavior is unchanged — verified by the
existing tests in test_cot_model.py and test_cot_route.py.
"""
from datetime import date

from models import CotPosition


def test_dual_write_creates_position_rows(scraper_db):
    from scraper.db import get_session, upsert_cot_weekly

    upsert_cot_weekly("ny", date(2026, 4, 28), {
        "oi_total":   150_000,           # market scalar — should NOT appear
        "mm_long":     50_000, "mm_short": 20_000, "mm_spread": 5_000,
        "pmpu_long":   80_000, "pmpu_short": 40_000,
        "swap_long":   30_000, "swap_short": 25_000, "swap_spread": 8_000,
        "t_mm_long":       30, "t_mm_short":      20, "t_mm_spread":      5,
        "price_ny":      304.10,         # market scalar — should NOT appear
    })
    db = get_session()
    try:
        rows = db.query(CotPosition).filter_by(market="ny", date=date(2026, 4, 28)).all()
        by_key = {(r.crop, r.category, r.side): r for r in rows}

        # 6 distinct (crop, cat, side) tuples expected
        assert set(by_key.keys()) == {
            ("all", "mm",   "long"),  ("all", "mm",   "short"),  ("all", "mm",   "spread"),
            ("all", "pmpu", "long"),  ("all", "pmpu", "short"),
            ("all", "swap", "long"),  ("all", "swap", "short"),  ("all", "swap", "spread"),
        }
        # MM long carries both oi and traders
        mm_long = by_key[("all", "mm", "long")]
        assert mm_long.oi      == 50_000
        assert mm_long.traders == 30
        # PMPU has no trader fields in this input
        pmpu_long = by_key[("all", "pmpu", "long")]
        assert pmpu_long.oi      == 80_000
        assert pmpu_long.traders is None
    finally:
        db.close()


def test_dual_write_handles_crop_split(scraper_db):
    """NY (Arabica) old/other crop fields land in cot_position with the right crop."""
    from scraper.db import get_session, upsert_cot_weekly

    upsert_cot_weekly("ny", date(2026, 4, 28), {
        "mm_long":          50_000,
        "mm_long_old":       8_000,
        "mm_long_other":    42_000,
        "swap_spread_old":   1_500,
    })
    db = get_session()
    try:
        rows = db.query(CotPosition).filter_by(market="ny", date=date(2026, 4, 28)).all()
        by_key = {(r.crop, r.category, r.side): r.oi for r in rows}
        assert by_key[("all",   "mm",   "long")]   == 50_000
        assert by_key[("old",   "mm",   "long")]   ==  8_000
        assert by_key[("other", "mm",   "long")]   == 42_000
        assert by_key[("old",   "swap", "spread")] ==  1_500
    finally:
        db.close()


def test_dual_write_partial_update_does_not_clobber_traders(scraper_db):
    """A second upsert with only oi (no t_) must leave the existing traders count alone."""
    from scraper.db import get_session, upsert_cot_weekly

    # First write: both oi and traders
    upsert_cot_weekly("ny", date(2026, 4, 28), {"mm_long": 50_000, "t_mm_long": 30})
    # Second write: only oi
    upsert_cot_weekly("ny", date(2026, 4, 28), {"mm_long": 55_000})

    db = get_session()
    try:
        row = db.query(CotPosition).filter_by(
            market="ny", date=date(2026, 4, 28),
            crop="all", category="mm", side="long",
        ).first()
        assert row is not None
        assert row.oi      == 55_000   # updated
        assert row.traders == 30       # preserved
    finally:
        db.close()


def test_dual_write_skips_market_scalars(scraper_db):
    """price_ny / structure_ny / oi_total etc. live only in cot_weekly,
    never produce cot_position rows."""
    from scraper.db import get_session, upsert_cot_weekly

    upsert_cot_weekly("ny", date(2026, 4, 28), {
        "oi_total":      150_000,
        "price_ny":       304.10,
        "structure_ny":    -1.5,
        "exch_oi_ny":     90_000,
        "vol_ny":         12_000,
        "efp_ny":           500,
        "spread_vol_ny":   200.0,
    })
    db = get_session()
    try:
        rows = db.query(CotPosition).filter_by(market="ny", date=date(2026, 4, 28)).all()
        assert rows == []
    finally:
        db.close()


def test_dual_write_ny_and_ldn_separated(scraper_db):
    """Same date, different markets — rows should not collide."""
    from scraper.db import get_session, upsert_cot_weekly

    upsert_cot_weekly("ny",  date(2026, 4, 28), {"mm_long": 50_000})
    upsert_cot_weekly("ldn", date(2026, 4, 28), {"mm_long": 30_000})
    db = get_session()
    try:
        ny  = db.query(CotPosition).filter_by(market="ny",  category="mm", side="long").first()
        ldn = db.query(CotPosition).filter_by(market="ldn", category="mm", side="long").first()
        assert ny.oi  == 50_000
        assert ldn.oi == 30_000
    finally:
        db.close()
