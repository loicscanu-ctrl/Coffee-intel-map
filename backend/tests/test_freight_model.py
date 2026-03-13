import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

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
