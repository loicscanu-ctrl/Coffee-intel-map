import pytest
from unittest.mock import MagicMock, call
from datetime import date

# We test the upsert logic by passing a mock db session
def test_upsert_commodity_cot_insert():
    """New row is added when no existing row found."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.db_macro import upsert_commodity_cot

    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = None

    upsert_commodity_cot(db, "arabica", date(2025, 1, 7), {"mm_long": 100, "mm_short": 50, "mm_spread": 10, "oi_total": 200})

    db.add.assert_called_once()
    db.commit.assert_called_once()


def test_upsert_commodity_cot_update():
    """Existing row is updated, not duplicated."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.db_macro import upsert_commodity_cot

    existing = MagicMock()
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = existing

    upsert_commodity_cot(db, "arabica", date(2025, 1, 7), {"mm_long": 200, "mm_short": 60, "mm_spread": 5, "oi_total": 300})

    assert existing.mm_long == 200
    db.add.assert_not_called()
    db.commit.assert_called_once()


def test_upsert_commodity_price_insert():
    """New price row is added when absent."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.db_macro import upsert_commodity_price

    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = None

    upsert_commodity_price(db, "arabica", date(2025, 1, 7), 320.5)

    db.add.assert_called_once()
    db.commit.assert_called_once()
