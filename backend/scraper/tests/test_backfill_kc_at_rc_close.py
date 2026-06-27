"""Contract tests for the hourly KC-at-RC-close backfill (parse + merge).

Network is not exercised — the Yahoo fetch is mocked. These pin the two
things that must be right: the 17:00–18:00-London bar midpoint becomes the
17:30 estimate (DST-aware), and the merge never clobbers a precise forward
capture or duplicates a prior backfill.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from scraper import backfill_kc_at_rc_close as bf

_LONDON = ZoneInfo("Europe/London")


def _bar(day: str, hour_london: int, o: float, c: float) -> dict:
    dt = datetime.fromisoformat(f"{day}T{hour_london:02d}:00:00").replace(tzinfo=_LONDON)
    return {"ts_utc": int(dt.astimezone(timezone.utc).timestamp()), "open": o, "close": c}


def test_midpoint_of_1700_london_bar():
    bars = [_bar("2026-01-15", 16, 100, 101),
            _bar("2026-01-15", 17, 200, 210),   # midpoint 205 → the 17:30 estimate
            _bar("2026-01-15", 18, 300, 301)]
    out = bf._kc_at_rc_close_by_day(bars)
    assert out == {"2026-01-15": 205.0}


def test_dst_summer_bar_picked_by_london_hour():
    """In July (BST), the 17:00-London bar is 16:00 UTC — selection is by
    London hour, so it's still picked."""
    bars = [_bar("2026-07-15", 17, 250, 252)]   # built in London tz already
    out = bf._kc_at_rc_close_by_day(bars)
    assert out == {"2026-07-15": 251.0}


def test_no_1700_bar_yields_nothing():
    bars = [_bar("2026-01-15", 15, 100, 101), _bar("2026-01-15", 19, 100, 101)]
    assert bf._kc_at_rc_close_by_day(bars) == {}


def test_merge_preserves_precise_forward_capture():
    existing = [{"date": "2026-06-24", "kc_at_rc_close": 311.0, "source": "acaphe_live"}]
    merged, added = bf._merge(existing, {"2026-06-24": 999.0, "2026-06-25": 312.0})
    by_date = {r["date"]: r for r in merged}
    assert by_date["2026-06-24"]["source"] == "acaphe_live"
    assert by_date["2026-06-24"]["kc_at_rc_close"] == 311.0   # not clobbered
    assert by_date["2026-06-25"]["source"] == "yahoo_hourly_backfill"
    assert added == 1


def test_merge_does_not_duplicate_prior_backfill():
    existing = [{"date": "2026-06-25", "kc_at_rc_close": 312.0, "source": "yahoo_hourly_backfill"}]
    merged, added = bf._merge(existing, {"2026-06-25": 999.0})
    assert added == 0
    assert len(merged) == 1
    assert merged[0]["kc_at_rc_close"] == 312.0


def test_merge_treats_legacy_untagged_row_as_precise():
    """A legacy row with no source tag (None) is treated as precise — backfill
    won't overwrite it."""
    existing = [{"date": "2026-06-25", "kc_at_rc_close": 311.0}]
    merged, added = bf._merge(existing, {"2026-06-25": 999.0})
    assert added == 0
    assert merged[0]["kc_at_rc_close"] == 311.0


def test_run_returns_unreachable_when_fetch_fails(monkeypatch):
    monkeypatch.setattr(bf, "_fetch_hourly_kc", lambda: None)
    out = bf.run(dry_run=True)
    assert out["ok"] is False
    assert out["reason"] == "yahoo_unreachable"
