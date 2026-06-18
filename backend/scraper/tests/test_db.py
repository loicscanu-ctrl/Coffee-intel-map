import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from unittest.mock import MagicMock

from scraper.db import extract_physical_price, upsert_news_item


def make_db():
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = None
    return db

def test_upsert_inserts_new_item():
    db = make_db()
    upsert_news_item(db, {
        "title": "ICE Arabica – 2026-03-09",
        "body": "Settlement: 220.50 USc/lb",
        "source": "Barchart",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": ["futures", "arabica"],
    })
    db.add.assert_called_once()
    db.commit.assert_called_once()

def test_upsert_skips_duplicate():
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = MagicMock()  # exists
    upsert_news_item(db, {
        "title": "ICE Arabica – 2026-03-09",
        "body": "Settlement: 220.50 USc/lb",
        "source": "Barchart",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": ["futures", "arabica"],
    })
    db.add.assert_not_called()
    db.commit.assert_not_called()


def test_upsert_rolls_back_on_commit_error():
    db = make_db()
    db.commit.side_effect = Exception("DB error")
    upsert_news_item(db, {
        "title": "ICE Arabica – 2026-03-09",
        "body": "test",
        "source": "Barchart",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": [],
    })
    db.rollback.assert_called_once()


def test_upsert_replace_branch_is_single_transaction():
    """In the replace branch (tags=price+futures), DELETE+INSERT must be a
    single transaction. The pre-fix shape committed the DELETE first, then
    attempted the INSERT — a failed INSERT permanently lost the deleted row.
    The new shape queues both halves and commits once, so rollback reverts
    both. Locks the contract in via call_count."""
    db = make_db()
    db.commit.side_effect = Exception("DB error on commit")
    upsert_news_item(db, {
        "title": "ICE Arabica – 2026-03-09",
        "body": "Settlement: 220.50 USc/lb",
        "source": "Barchart",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": ["futures", "price"],   # triggers the replace branch
    })
    # Exactly one commit attempt — not the pre-fix pattern of two commits with
    # the first one (the DELETE) succeeding before the second one (the INSERT)
    # blew up.
    assert db.commit.call_count == 1
    db.rollback.assert_called_once()


# ── extract_physical_price: structured price_data (Phase 1) ───────────────────

def test_extract_prefers_structured_price_data():
    """price_data wins over body — and a wrong body would NOT be re-parsed."""
    pp = extract_physical_price({
        "tags": ["price", "vietnam"],
        "body": "Vietnam Robusta price: 10.000 VND/kg",  # deliberately wrong
        "source": "Giacaphe",
        "price_data": {"symbol": "VN_FAQ", "price": 115200.0,
                       "currency": "VND", "unit": "per_kg"},
    })
    assert pp["symbol"] == "VN_FAQ"
    assert pp["price"] == 115200.0          # from price_data, not the 10.000 body
    assert pp["currency"] == "VND" and pp["unit"] == "per_kg"
    assert pp["source"] == "Giacaphe"


def test_extract_falls_back_to_regex_without_price_data():
    """Un-migrated items (no price_data) still parse via the body regex."""
    pp = extract_physical_price({
        "tags": ["price", "uganda"],
        "body": "Uganda Fine Robusta Screen 15 price: 245.50 US¢/lb",
        "source": "UCDA",
    })
    assert pp["symbol"] == "UGA_S15"
    assert pp["price"] == 245.50


def test_extract_malformed_price_data_falls_through():
    """A non-numeric price_data must not crash — it falls back to regex."""
    pp = extract_physical_price({
        "tags": ["price", "uganda"],
        "body": "Uganda Fine Robusta Screen 15 price: 245.50 US¢/lb",
        "source": "UCDA",
        "price_data": {"symbol": "UGA_S15", "price": "not-a-number"},
    })
    assert pp["symbol"] == "UGA_S15"
    assert pp["price"] == 245.50            # regex fallback kicked in
