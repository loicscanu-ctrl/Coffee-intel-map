"""Wording test for Kaffeesteuer → news-feed commentary.

Exercises the pure `_compute_commentary` helper so the wording stays pinned
without HTTP / PDF parsing. The DB-upsert wrapper (`_emit_news`) is a
no-op when DATABASE_URL is unset.
"""
from scraper.fetch_kaffeesteuer import _compute_commentary


def test_kaffeesteuer_renders_mom_and_yoy():
    history = {
        "2025-02": 70_000,  # YoY reference
        "2026-01": 80_000,  # MoM reference
        "2026-02": 76_000,  # latest
    }
    text = _compute_commentary("2026-02", 76_000, history)
    assert text is not None
    assert "German Kaffeesteuer revenue for 2026-02" in text
    assert "76,000 Tsd. EUR" in text
    # MoM = (76 - 80) / 80 = -5.0%
    assert "-5.0%" in text
    # YoY = (76 - 70) / 70 = +8.571…% → rounded to 1dp = +8.6%
    assert "+8.6%" in text


def test_kaffeesteuer_january_rollover():
    """Prior-month lookup for January 2026 must reach back to December 2025."""
    history = {
        "2025-01": 60_000,
        "2025-12": 90_000,
        "2026-01": 95_000,
    }
    text = _compute_commentary("2026-01", 95_000, history)
    assert text is not None
    # MoM = (95 - 90) / 90 = +5.555…% → +5.6%
    assert "+5.6%" in text
    # YoY = (95 - 60) / 60 = +58.333…% → +58.3%
    assert "+58.3%" in text


def test_kaffeesteuer_missing_history_returns_none():
    """First print ever — no MoM/YoY references, return None instead of
    fabricating misleading numbers."""
    assert _compute_commentary("2026-02", 76_000, {"2026-02": 76_000}) is None


def test_kaffeesteuer_zero_reference_returns_none():
    """Guard against division-by-zero if a prior month somehow recorded 0."""
    history = {"2025-02": 70_000, "2026-01": 0, "2026-02": 76_000}
    assert _compute_commentary("2026-02", 76_000, history) is None
