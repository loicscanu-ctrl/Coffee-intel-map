from datetime import date
from models import FreightRate

def test_freight_rate_create(db):
    row = FreightRate(index_code="FBX11", date=date(2026, 3, 14), rate=2850.0)
    db.add(row)
    db.commit()
    result = db.query(FreightRate).first()
    assert result.index_code == "FBX11"
    assert result.rate == 2850.0

def test_freight_rate_unique_constraint(db):
    """Inserting duplicate (index_code, date) should raise."""
    from sqlalchemy.exc import IntegrityError
    import pytest
    db.add(FreightRate(index_code="FBX11", date=date(2026, 3, 14), rate=2850.0))
    db.commit()
    db.add(FreightRate(index_code="FBX11", date=date(2026, 3, 14), rate=9999.0))
    with pytest.raises(IntegrityError):
        db.commit()

def test_upsert_freight_rate_insert(scraper_db):
    """upsert_freight_rate inserts a new record when none exists."""
    from scraper.db import upsert_freight_rate, get_session
    upsert_freight_rate("FBX11", date(2026, 3, 14), 2850.0)
    db = get_session()
    try:
        result = db.query(FreightRate).filter_by(index_code="FBX11").first()
        assert result is not None
        assert result.rate == 2850.0
    finally:
        db.close()

def test_upsert_freight_rate_update(scraper_db):
    """upsert_freight_rate updates an existing record on duplicate (index_code, date)."""
    from scraper.db import upsert_freight_rate, get_session
    upsert_freight_rate("FBX11", date(2026, 3, 14), 2850.0)
    upsert_freight_rate("FBX11", date(2026, 3, 14), 3000.0)
    db = get_session()
    try:
        rows = db.query(FreightRate).filter_by(index_code="FBX11").all()
        assert len(rows) == 1
        assert rows[0].rate == 3000.0
    finally:
        db.close()
