"""Contract tests for the KC-at-RC-close capture script.

The capture records the front-month Arabica price at 17:30 London once per
trading day, feeding the open-direction model's kc_after_rc_diff feature.
These pin the two correctness-critical behaviours:
  1. The London-time / DST guard records only within ±window of 17:30 London,
     and a late cron fire (or wrong-season UTC tick) skips cleanly.
  2. The Redis snapshot is parsed, freshness-checked, and the front-month KC
     extracted correctly; dedup-by-date keeps one capture per day.
"""
from datetime import datetime, timezone

from scraper import capture_kc_at_rc_close as cap


# ── London-time / DST guard ──────────────────────────────────────────────────

def test_minutes_from_rc_close_winter_gmt():
    # 17:30 UTC in January = 17:30 London (GMT) → 0 min from close.
    utc = datetime(2026, 1, 15, 17, 30, tzinfo=timezone.utc)
    nl = utc.astimezone(cap._LONDON)
    assert abs(cap._minutes_from_rc_close(nl)) < 1


def test_minutes_from_rc_close_summer_bst():
    # 16:30 UTC in July = 17:30 London (BST) → 0 min from close.
    utc = datetime(2026, 7, 15, 16, 30, tzinfo=timezone.utc)
    nl = utc.astimezone(cap._LONDON)
    assert abs(cap._minutes_from_rc_close(nl)) < 1


def test_wrong_season_utc_tick_is_out_of_window():
    # 17:30 UTC in July = 18:30 London → 60 min late, outside the window.
    utc = datetime(2026, 7, 15, 17, 30, tzinfo=timezone.utc)
    nl = utc.astimezone(cap._LONDON)
    assert cap._minutes_from_rc_close(nl) > cap._WINDOW_MIN


def test_late_cron_fire_skips(tmp_path, monkeypatch):
    """A fire hours late lands outside the window → recorded:False, no write."""
    monkeypatch.setattr(cap, "OUT_PATH", tmp_path / "kc.json")
    late = datetime(2026, 1, 15, 21, 30, tzinfo=timezone.utc)  # 21:30 London
    out = cap.run(now_utc=late)
    assert out["recorded"] is False
    assert "window" in out["reason"]
    assert not (tmp_path / "kc.json").exists()


# ── Snapshot parsing + freshness ─────────────────────────────────────────────

def test_front_kc_last_takes_first_arabica():
    snap = {"arabica": [
        {"month": "AK 05/26", "last": 309.8},
        {"month": "AN 07/26", "last": 305.0},
    ]}
    assert cap._front_kc_last(snap) == (309.8, "AK 05/26")


def test_front_kc_last_skips_null_then_takes_next():
    snap = {"arabica": [{"month": "AK 05/26", "last": None},
                        {"month": "AN 07/26", "last": 305.0}]}
    assert cap._front_kc_last(snap) == (305.0, "AN 07/26")


def test_front_kc_last_none_when_empty():
    assert cap._front_kc_last({"arabica": []}) is None
    assert cap._front_kc_last({}) is None


def test_snapshot_age_fresh_vs_stale():
    now = datetime(2026, 1, 15, 17, 30, tzinfo=timezone.utc)
    fresh = {"fetched_at": "2026-01-15T17:25:00+00:00"}   # 5 min old
    stale = {"fetched_at": "2026-01-15T16:00:00+00:00"}   # 90 min old
    assert cap._snapshot_age_min(fresh, now) < cap._MAX_AGE_MIN
    assert cap._snapshot_age_min(stale, now) > cap._MAX_AGE_MIN


# ── End-to-end record + dedup ────────────────────────────────────────────────

def _good_snap():
    return {
        "fetched_at": "2026-01-15T17:28:00+00:00",
        "arabica": [{"month": "AK 05/26", "last": 311.25}],
        "robusta": [{"month": "RK 05/26", "last": 4900.0}],
    }


def test_records_within_window(tmp_path, monkeypatch):
    monkeypatch.setattr(cap, "OUT_PATH", tmp_path / "kc.json")
    monkeypatch.setattr(cap, "_redis_get", lambda key: _good_snap())
    on_time = datetime(2026, 1, 15, 17, 30, tzinfo=timezone.utc)  # 17:30 London
    out = cap.run(now_utc=on_time)
    assert out["recorded"] is True
    assert out["record"]["date"] == "2026-01-15"
    assert out["record"]["kc_at_rc_close"] == 311.25
    # File written with one row.
    rows = cap._load_history()
    assert len(rows) == 1


def test_dedup_same_day(tmp_path, monkeypatch):
    monkeypatch.setattr(cap, "OUT_PATH", tmp_path / "kc.json")
    monkeypatch.setattr(cap, "_redis_get", lambda key: _good_snap())
    t = datetime(2026, 1, 15, 17, 30, tzinfo=timezone.utc)
    assert cap.run(now_utc=t)["recorded"] is True
    # Second call same day, still in window → skipped (already captured).
    second = cap.run(now_utc=datetime(2026, 1, 15, 17, 32, tzinfo=timezone.utc))
    assert second["recorded"] is False
    assert "already captured" in second["reason"]
    assert len(cap._load_history()) == 1


def test_stale_snapshot_not_recorded(tmp_path, monkeypatch):
    monkeypatch.setattr(cap, "OUT_PATH", tmp_path / "kc.json")
    monkeypatch.setattr(cap, "_redis_get",
                        lambda key: {"fetched_at": "2026-01-15T16:00:00+00:00",
                                     "arabica": [{"month": "AK 05/26", "last": 311.0}]})
    out = cap.run(now_utc=datetime(2026, 1, 15, 17, 30, tzinfo=timezone.utc))
    assert out["recorded"] is False
    assert "old" in out["reason"]


def test_no_redis_snapshot_skips(tmp_path, monkeypatch):
    monkeypatch.setattr(cap, "OUT_PATH", tmp_path / "kc.json")
    monkeypatch.setattr(cap, "_redis_get", lambda key: None)
    out = cap.run(now_utc=datetime(2026, 1, 15, 17, 30, tzinfo=timezone.utc))
    assert out["recorded"] is False
    assert "no live snapshot" in out["reason"]
