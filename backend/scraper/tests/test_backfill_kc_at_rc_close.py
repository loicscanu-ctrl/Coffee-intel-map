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


def test_diff_within_series_cancels_contract_level():
    """diff = settle / (17:30 est) − 1, computed within the bars: a = midpoint
    of the 17:00 bar, b = close of the last bar ≤ hour 18."""
    bars = [_bar("2026-01-15", 16, 100, 101),
            _bar("2026-01-15", 17, 200, 210),   # a = midpoint 205
            _bar("2026-01-15", 18, 215, 211)]    # b = close 211
    out = bf._diff_by_day(bars)
    assert out == {"2026-01-15": round(211 / 205 - 1, 6)}


def test_diff_dst_summer_picked_by_london_hour():
    """In July (BST), the 17:00-London bar is 16:00 UTC — selection is by
    London hour. With only the 17:00 bar, a == b's bar → diff from its own
    midpoint to its own close."""
    bars = [_bar("2026-07-15", 17, 250, 252)]
    out = bf._diff_by_day(bars)
    # a = 251 (midpoint), b = 252 (close of the only ≤18 bar) → 252/251 − 1
    assert out == {"2026-07-15": round(252 / 251 - 1, 6)}


def test_no_1700_bar_yields_nothing():
    bars = [_bar("2026-01-15", 15, 100, 101), _bar("2026-01-15", 19, 100, 101)]
    assert bf._diff_by_day(bars) == {}


def test_merge_preserves_precise_forward_capture():
    existing = [{"date": "2026-06-24", "kc_at_rc_close": 311.0, "source": "acaphe_live"}]
    merged, added = bf._merge(existing, {"2026-06-24": 0.005, "2026-06-25": 0.004})
    by_date = {r["date"]: r for r in merged}
    assert by_date["2026-06-24"]["source"] == "acaphe_live"
    assert by_date["2026-06-24"]["kc_at_rc_close"] == 311.0   # not clobbered
    assert by_date["2026-06-25"]["source"] == "yahoo_hourly_backfill"
    assert by_date["2026-06-25"]["kc_after_rc_diff"] == 0.004
    assert added == 1


def test_merge_does_not_duplicate_prior_backfill():
    existing = [{"date": "2026-06-25", "kc_after_rc_diff": 0.004, "source": "yahoo_hourly_backfill"}]
    merged, added = bf._merge(existing, {"2026-06-25": 0.999})
    assert added == 0
    assert len(merged) == 1
    assert merged[0]["kc_after_rc_diff"] == 0.004


def test_merge_treats_legacy_untagged_row_as_precise():
    """A legacy row with no source tag (None) is treated as precise — backfill
    won't overwrite it."""
    existing = [{"date": "2026-06-25", "kc_at_rc_close": 311.0}]
    merged, added = bf._merge(existing, {"2026-06-25": 0.999})
    assert added == 0
    assert merged[0].get("kc_at_rc_close") == 311.0


def test_run_returns_unreachable_when_fetch_fails(monkeypatch):
    monkeypatch.setattr(bf, "_fetch_hourly_kc", lambda: None)
    out = bf.run(dry_run=True)
    assert out["ok"] is False
    assert out["reason"] == "yahoo_unreachable"
