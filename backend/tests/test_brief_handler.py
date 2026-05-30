"""Tests for the morning brief handler — upcoming events section (issue #132 Body-4)."""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from telegram.handlers import brief


# ── Fixtures ─────────────────────────────────────────────────────────────────

# "Now" — picking a fixed date so the test isn't time-dependent. May 30 is
# matched by today's events; May 31 is matched by tomorrow's.
NOW = datetime(2026, 5, 30, 8, 0, tzinfo=UTC)


def _events(*entries: dict) -> dict:
    """Wrap a list of event dicts in the events.json envelope shape."""
    return {"_schema": "test", "events": list(entries)}


# ── Happy path: today + tomorrow render ──────────────────────────────────────

def test_renders_today_and_tomorrow(monkeypatch):
    doc = _events(
        {"date": "2026-05-30", "category": "wasde", "title": "WASDE Crop Production Report"},
        {"date": "2026-05-31", "category": "fnd",   "title": "KCN26 First Notice Day"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert "Coming up · next 24h" in out
    assert "Today" in out
    assert "Tomorrow" in out
    assert "[WASDE] WASDE Crop Production Report" in out
    assert "[FND] KCN26 First Notice Day" in out


def test_today_listed_before_tomorrow(monkeypatch):
    """Chronological sort: today rows must come before tomorrow rows."""
    doc = _events(
        {"date": "2026-05-31", "category": "fnd",   "title": "Tomorrow Event"},
        {"date": "2026-05-30", "category": "wasde", "title": "Today Event"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    today_pos = out.index("Today Event")
    tomorrow_pos = out.index("Tomorrow Event")
    assert today_pos < tomorrow_pos


# ── Filtering: only today + tomorrow get through ─────────────────────────────

def test_skips_past_and_future_events(monkeypatch):
    doc = _events(
        {"date": "2026-05-29", "category": "ico",   "title": "Yesterday Event"},  # past
        {"date": "2026-05-30", "category": "wasde", "title": "Today Event"},
        {"date": "2026-05-31", "category": "fnd",   "title": "Tomorrow Event"},
        {"date": "2026-06-01", "category": "cecafe","title": "Day-after Event"},  # future
        {"date": "2026-12-31", "category": "ico",   "title": "Year-end Event"},   # future
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert "Yesterday Event" not in out
    assert "Day-after Event" not in out
    assert "Year-end Event" not in out
    assert "Today Event" in out
    assert "Tomorrow Event" in out


# ── Graceful degradation ─────────────────────────────────────────────────────

def test_returns_none_when_events_json_missing(monkeypatch):
    monkeypatch.setattr(brief, "load", lambda name: None)
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_events_list_empty(monkeypatch):
    monkeypatch.setattr(brief, "load",
                        lambda name: {"_schema": "test", "events": []})
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_no_matching_dates(monkeypatch):
    """events.json may be populated, but none of its rows hit today/tomorrow.
    Currently the case on live data — no upcoming events in 2026-05-30..31."""
    doc = _events(
        {"date": "2025-12-26", "category": "fnd", "title": "Past Event"},
        {"date": "2026-12-31", "category": "ico", "title": "Far-future Event"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_events_json_is_not_a_dict(monkeypatch):
    """Defensive: load() could return a list or None on a malformed file."""
    monkeypatch.setattr(brief, "load", lambda name: ["not", "a", "dict"])
    assert brief._upcoming_events_section(NOW) is None


# ── Category label mapping ──────────────────────────────────────────────────

def test_unknown_category_falls_back_to_evt(monkeypatch):
    doc = _events(
        {"date": "2026-05-30", "category": "novel_category", "title": "X"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert "[EVT] X" in out


@pytest.mark.parametrize("category,label", [
    ("wasde",           "WASDE"),
    ("ico",             "ICO"),
    ("vietnam_customs", "VN"),
    ("cecafe",          "CECAFÉ"),
    ("fnd",             "FND"),
    ("central_bank",    "CB"),
    ("other",           "EVT"),
])
def test_category_label_mapping(monkeypatch, category, label):
    doc = _events({"date": "2026-05-30", "category": category, "title": "Foo"})
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert f"[{label}]" in out


# ── Integration smoke test: full brief tolerates missing optional data ──────

def test_build_brief_message_does_not_crash_with_no_events(monkeypatch):
    """Whole-handler smoke: brief renders even when every optional data
    source returns None (matching a fresh sandbox / cold-cache state)."""
    monkeypatch.setattr(brief, "load", lambda name: None)
    out = brief.build_brief_message()
    assert "Coffee Intel" in out
    assert "Coming up · next 24h" not in out   # section omitted gracefully
