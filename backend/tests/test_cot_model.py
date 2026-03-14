from datetime import date
from models import CotWeekly


def test_cot_weekly_create(db):
    row = CotWeekly(
        date=date(2026, 3, 11),
        market="ny",
        oi_total=150000,
        mm_long=25000,
        mm_short=12000,
    )
    db.add(row)
    db.commit()
    result = db.query(CotWeekly).first()
    assert result.market == "ny"
    assert result.oi_total == 150000
    assert result.mm_long == 25000


def test_cot_weekly_unique_constraint(db):
    """Inserting duplicate (date, market) should raise IntegrityError."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    db.add(CotWeekly(date=date(2026, 3, 11), market="ny", oi_total=150000))
    db.commit()
    db.add(CotWeekly(date=date(2026, 3, 11), market="ny", oi_total=999))
    with pytest.raises(IntegrityError):
        db.commit()


def test_cot_weekly_ldn_nr_nullable(db):
    """LDN rows have t_nr_long and t_nr_short as None."""
    row = CotWeekly(
        date=date(2026, 3, 11),
        market="ldn",
        oi_total=80000,
        t_nr_long=None,
        t_nr_short=None,
    )
    db.add(row)
    db.commit()
    result = db.query(CotWeekly).filter_by(market="ldn").first()
    assert result.t_nr_long is None
    assert result.t_nr_short is None


def test_upsert_cot_weekly_insert(scraper_db):
    """upsert_cot_weekly inserts a new record when none exists."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 150000, "mm_long": 25000})
    db = get_session()
    try:
        result = db.query(CotWeekly).filter_by(market="ny").first()
        assert result is not None
        assert result.oi_total == 150000
        assert result.mm_long == 25000
    finally:
        db.close()


def test_upsert_cot_weekly_update(scraper_db):
    """upsert_cot_weekly updates existing record on duplicate (date, market)."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 150000})
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 999999})
    db = get_session()
    try:
        rows = db.query(CotWeekly).filter_by(market="ny").all()
        assert len(rows) == 1
        assert rows[0].oi_total == 999999
    finally:
        db.close()


def test_upsert_cot_weekly_ldn_nr_none(scraper_db):
    """LDN upsert with t_nr_long=None stores None, not 0."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ldn", date(2026, 3, 11), {
        "oi_total": 80000,
        "t_nr_long": None,
        "t_nr_short": None,
    })
    db = get_session()
    try:
        result = db.query(CotWeekly).filter_by(market="ldn").first()
        assert result.t_nr_long is None
    finally:
        db.close()
