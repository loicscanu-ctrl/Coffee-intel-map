import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

import pytest
from unittest.mock import MagicMock, patch
from scraper.db import upsert_news_item

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
