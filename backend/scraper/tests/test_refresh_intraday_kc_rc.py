"""Unit tests for the daily intraday refresh merge logic.

Network/Playwright is not exercised — only the pure `_merge`, which is where
the "recent dates overwrite, all older history is preserved" guarantee lives.
"""
from scraper import refresh_intraday_kc_rc as r


def _row(date, rc=None):
    return {"date": date, "rc_last_1730": rc, "kc_last_1730": None}


def test_merge_preserves_old_and_appends_new():
    existing = [_row("2026-06-20", 3500), _row("2026-06-23", 3550)]
    fresh = {"2026-06-26": _row("2026-06-26", 3600)}
    merged, n_new = r._merge(existing, fresh)
    assert [m["date"] for m in merged] == ["2026-06-20", "2026-06-23", "2026-06-26"]
    assert n_new == 1
    # untouched old records preserved exactly
    assert merged[0]["rc_last_1730"] == 3500


def test_merge_overwrites_overlapping_dates():
    existing = [_row("2026-06-25", 3500), _row("2026-06-26", 1111)]
    fresh = {"2026-06-26": _row("2026-06-26", 3600)}  # corrected/re-fetched
    merged, n_new = r._merge(existing, fresh)
    assert n_new == 0  # the date already existed
    by_date = {m["date"]: m for m in merged}
    assert by_date["2026-06-26"]["rc_last_1730"] == 3600  # fresh wins
    assert by_date["2026-06-25"]["rc_last_1730"] == 3500  # old kept


def test_merge_output_is_date_sorted():
    existing = [_row("2026-06-26"), _row("2026-06-20")]
    fresh = {"2026-06-23": _row("2026-06-23")}
    merged, _ = r._merge(existing, fresh)
    assert [m["date"] for m in merged] == sorted(m["date"] for m in merged)


def test_merge_tolerates_garbage_existing_rows():
    existing = [{"no_date": 1}, "not a dict", _row("2026-06-20")]
    fresh = {"2026-06-26": _row("2026-06-26")}
    merged, n_new = r._merge(existing, fresh)
    assert [m["date"] for m in merged] == ["2026-06-20", "2026-06-26"]
    assert n_new == 1


def test_merge_empty_existing():
    merged, n_new = r._merge([], {"2026-06-26": _row("2026-06-26")})
    assert [m["date"] for m in merged] == ["2026-06-26"]
    assert n_new == 1
