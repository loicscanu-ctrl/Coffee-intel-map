"""Settle-aware reference-date logic for the OI snapshot.

fetch_oi_json stamps each settle under `price_date = ref − 1 business day`.
Historically ref = date.today(), which only works if the job runs the morning
AFTER a session. _reference_date advances ref to the next day once past the
settle hour on a weekday, so an EVENING capture stamps the just-settled session
correctly — while morning/daytime runs are unchanged.
"""
from datetime import datetime, timezone

from scraper.fetch_oi_json import _prev_biz_day, _reference_date


def _price_date(now):
    return _prev_biz_day(_reference_date(now), 1)


def _utc(y, m, d, h):
    return datetime(y, m, d, h, 0, tzinfo=timezone.utc)


def test_morning_run_unchanged():
    # Wed 03:00 UTC → prior session Tue (same as the old date.today()-1 logic).
    assert _price_date(_utc(2026, 7, 1, 3)) == "2026-06-30"


def test_evening_run_captures_same_day_session():
    # Tue 21:00 UTC (post-settle) → Tue's own just-settled session.
    assert _price_date(_utc(2026, 6, 30, 21)) == "2026-06-30"


def test_daytime_presettle_run_uses_prior_session():
    # Tue 14:00 UTC (before settle) → still the prior session (Mon).
    assert _price_date(_utc(2026, 6, 30, 14)) == "2026-06-29"


def test_friday_evening_captures_friday():
    assert _price_date(_utc(2026, 7, 3, 22)) == "2026-07-03"   # 2026-07-03 is a Friday


def test_weekend_run_rolls_to_friday():
    # Saturday morning → most recent session is Friday.
    assert _price_date(_utc(2026, 7, 4, 3)) == "2026-07-03"
