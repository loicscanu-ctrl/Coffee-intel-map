"""Tests for the vn_physical_prices dual-read helpers (Phase 1/2 migration)."""
import os
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from scraper.export_static_json import _vn_faq_from_physical


def _pp(symbol, price, scraped_at):
    return SimpleNamespace(symbol=symbol, price=price, scraped_at=scraped_at)


def _db_returning(vn_row, fx_row):
    """Mock db: the helper queries VN_FAQ first, then USD_VND — return in order."""
    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.first.side_effect = [vn_row, fx_row]
    return db


def test_vn_physical_fresh_ok():
    now = datetime.utcnow()
    db = _db_returning(_pp("VN_FAQ", 115200.0, now), _pp("USD_VND", 25400.0, now))
    vnd, usd, status = _vn_faq_from_physical(db, 48)
    assert status == "ok"
    assert vnd == 115200 and usd == 25400.0


def test_vn_physical_stale_rejected():
    old = datetime.utcnow() - timedelta(hours=72)
    db = _db_returning(_pp("VN_FAQ", 115200.0, old), _pp("USD_VND", 25400.0, old))
    _, _, status = _vn_faq_from_physical(db, 48)
    assert status == "stale"


def test_vn_physical_missing_when_no_rows():
    db = _db_returning(None, None)
    _, _, status = _vn_faq_from_physical(db, 48)
    assert status == "missing"
