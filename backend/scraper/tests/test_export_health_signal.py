"""Phase-3 signal: export_health surfaces a `warnings` entry when the price
exporters fell back to NewsItem regex parsing. Uses a real in-memory SQLite DB
(empty) so the many health queries resolve cleanly without brittle mocks."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import scraper.exporters.base as base
import scraper.exporters.health as health


def _empty_db():
    import models  # noqa: F401 — registers tables on Base
    from database import Base
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_health_flags_regex_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", True)
    health.export_health(_empty_db())
    data = json.loads((tmp_path / "health.json").read_text())
    assert data.get("warnings") == ["latest_prices_used_regex_fallback"]


def test_health_no_warning_when_clean(tmp_path, monkeypatch):
    monkeypatch.setattr(health, "OUT_DIR", tmp_path)
    monkeypatch.setattr(base, "LATEST_PRICES_FALLBACK", False)
    health.export_health(_empty_db())
    data = json.loads((tmp_path / "health.json").read_text())
    assert "warnings" not in data
    assert "scrapers" in data
