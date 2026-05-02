from datetime import date
from models import CotPosition, CotWeekly


def test_cot_weekly_create(db):
    """CotWeekly is now a marker table with market-level scalars only."""
    row = CotWeekly(
        date=date(2026, 3, 11),
        market="ny",
        oi_total=150_000,
        price_ny=304.10,
        structure_ny=-1.5,
    )
    db.add(row)
    db.commit()
    result = db.query(CotWeekly).first()
    assert result.market       == "ny"
    assert result.oi_total     == 150_000
    assert result.price_ny     == 304.10
    assert result.structure_ny == -1.5


def test_cot_weekly_unique_constraint(db):
    """Inserting duplicate (date, market) should raise IntegrityError."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    db.add(CotWeekly(date=date(2026, 3, 11), market="ny", oi_total=150_000))
    db.commit()
    db.add(CotWeekly(date=date(2026, 3, 11), market="ny", oi_total=999))
    with pytest.raises(IntegrityError):
        db.commit()


def test_upsert_routes_position_fields_to_cot_position(scraper_db):
    """Position fields land in CotPosition; only scalars go to CotWeekly."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ny", date(2026, 3, 11), {
        "oi_total": 150_000,
        "price_ny": 304.10,
        "mm_long":   25_000,        # → CotPosition
        "mm_short":  12_000,        # → CotPosition
        "t_mm_long":     30,        # → CotPosition
    })
    db = get_session()
    try:
        weekly = db.query(CotWeekly).filter_by(market="ny").first()
        assert weekly.oi_total == 150_000
        assert weekly.price_ny == 304.10

        positions = db.query(CotPosition).filter_by(market="ny", category="mm").all()
        by_side   = {p.side: p for p in positions}
        assert by_side["long"].oi      == 25_000
        assert by_side["long"].traders == 30
        assert by_side["short"].oi     == 12_000
    finally:
        db.close()


def test_upsert_cot_weekly_update_scalar(scraper_db):
    """upsert_cot_weekly updates existing scalar on duplicate (date, market)."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 150_000})
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 999_999})
    db = get_session()
    try:
        rows = db.query(CotWeekly).filter_by(market="ny").all()
        assert len(rows) == 1
        assert rows[0].oi_total == 999_999
    finally:
        db.close()


def test_upsert_creates_weekly_row_even_with_only_position_fields(scraper_db):
    """A caller passing only position fields still gets a CotWeekly row so
    routes/exports that filter on (date, market) keep working."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ny", date(2026, 3, 11), {"mm_long": 25_000})
    db = get_session()
    try:
        weekly = db.query(CotWeekly).filter_by(date=date(2026, 3, 11), market="ny").first()
        assert weekly is not None
        assert weekly.oi_total is None    # scalar wasn't passed
        # Position landed in the narrow table
        pos = db.query(CotPosition).filter_by(
            date=date(2026, 3, 11), market="ny",
            crop="all", category="mm", side="long",
        ).first()
        assert pos is not None and pos.oi == 25_000
    finally:
        db.close()
