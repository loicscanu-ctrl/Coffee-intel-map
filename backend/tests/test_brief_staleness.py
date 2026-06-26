"""Contract tests for the `_staleness_tag` helper.

Pins the rule that drives the inline " (Nd old)" tag the morning brief
emits next to date-bearing section headers (Brazil daily reg, NY / London
certified). The threshold is >1 day: fresh = today or yesterday (no tag),
2-day-old and older = visible tag.

Why pin this in a test: the staleness tag is the only visible cue that
distinguishes "yesterday's data" from "two-day-old data" — see the
2026-06-26 incident where the brief shipped Wed data on Fri morning with
no indication it was 2d stale. A silent regression would re-introduce
exactly that failure mode.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest

from telegram.handlers.brief import _staleness_tag


TODAY = date(2026, 6, 26)


@pytest.mark.parametrize("data_date,expected_tag", [
    # Fresh: today / yesterday → no tag
    ("2026-06-26", ""),
    ("2026-06-25", ""),
    # Stale: 2+ days
    ("2026-06-24", " <i>(2d old)</i>"),
    ("2026-06-23", " <i>(3d old)</i>"),
    ("2026-06-19", " <i>(7d old)</i>"),
])
def test_string_dates(data_date, expected_tag):
    assert _staleness_tag(data_date, today=TODAY) == expected_tag


def test_accepts_iso_datetime_string():
    """Generated_at fields from JSONs come in full ISO; should still parse."""
    assert _staleness_tag("2026-06-24T05:30:00Z", today=TODAY) == " <i>(2d old)</i>"
    assert _staleness_tag("2026-06-25T23:59:59+00:00", today=TODAY) == ""


def test_accepts_date_object():
    assert _staleness_tag(date(2026, 6, 24), today=TODAY) == " <i>(2d old)</i>"


def test_accepts_datetime_object():
    assert _staleness_tag(datetime(2026, 6, 24, 12, 0), today=TODAY) == " <i>(2d old)</i>"


def test_none_or_empty_returns_no_tag():
    """A missing date is the legacy-snapshot case — don't fabricate a tag."""
    assert _staleness_tag(None, today=TODAY) == ""
    assert _staleness_tag("",  today=TODAY) == ""
    assert _staleness_tag("   ", today=TODAY) == ""


def test_unparseable_date_returns_no_tag():
    """A malformed date string must not crash the brief — return no tag."""
    assert _staleness_tag("not a date", today=TODAY) == ""
    assert _staleness_tag("2026/06/24", today=TODAY) == ""  # slashes, not parsed
    assert _staleness_tag("yesterday", today=TODAY) == ""


def test_future_date_returns_no_tag():
    """Clock skew between scraper / brief could give a 'future' as-of date.
    Treat as fresh rather than a negative-day tag."""
    assert _staleness_tag("2026-06-27", today=TODAY) == ""
    assert _staleness_tag("2026-06-30", today=TODAY) == ""
