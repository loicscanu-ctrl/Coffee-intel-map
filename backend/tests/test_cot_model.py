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
