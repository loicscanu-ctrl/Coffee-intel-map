"""Unit tests for the FX outlier guard (_filter_fx_outliers).

The guard protects the returns-based Coffee Currency Index from a single corrupt
FX print injecting a fake spike-and-recover. It rejects closes implying a > ±30%
one-day move (or a non-positive value), judging each vs the PRIOR RAW close so it
self-heals on glitches yet lets a real permanent step-devaluation re-level.
"""
import pandas as pd

from scraper.quant_model.fetch_currency_index import (
    _filter_fx_outliers,
    _merge_close_series,
)


def _h(*closes):
    return [{"date": f"2026-01-{i+1:02d}", "close": c} for i, c in enumerate(closes)]


def test_normal_series_untouched():
    clean, n = _filter_fx_outliers(_h(5.00, 5.05, 4.98, 5.10))
    assert n == 0
    assert [r["close"] for r in clean] == [5.00, 5.05, 4.98, 5.10]


def test_single_glitch_spike_dropped_and_series_recovers():
    # 5.0 -> 9.0 (+80%, bad) -> 5.1 (good). The spike is dropped; 5.1 stays
    # because it's judged against the raw 9.0 (−43%? no — see below).
    clean, n = _filter_fx_outliers(_h(5.00, 9.00, 5.10, 5.05))
    assert n == 2
    levels = [r["close"] for r in clean]
    assert 9.00 not in levels            # the bad print is never kept
    assert levels == [5.00, 5.05]        # series recovers at the true level


def test_zero_and_garbage_dropped():
    clean, n = _filter_fx_outliers(_h(5.00, 0.0, 5.02))
    assert n == 1
    assert 0.0 not in [r["close"] for r in clean]
    assert [r["close"] for r in clean] == [5.00, 5.02]


def test_permanent_devaluation_relevels_not_blanked():
    # A real step from ~23000 to ~31000 (VND-style, +35%). The first jumped day
    # is dropped, but the series MUST continue at the new level, not blank out.
    clean, n = _filter_fx_outliers(_h(23000, 31000, 31050, 31100, 31080))
    levels = [r["close"] for r in clean]
    # Series keeps flowing at the new level (most days retained at ~31000).
    assert sum(1 for c in levels if c > 30000) >= 3
    assert 23000 in levels  # the pre-deval level is kept


def test_within_threshold_kept():
    # A 29% move is under the 30% bound → kept.
    clean, n = _filter_fx_outliers(_h(5.00, 6.45))   # +29%
    assert n == 0
    assert [r["close"] for r in clean] == [5.00, 6.45]


# ── shared merge helper (used by both the daily merge and the deep backfill) ──

def test_merge_close_series_new_wins_and_preserves_and_guards():
    existing = [{"date": "2026-01-01", "close": 5.00},
                {"date": "2026-01-02", "close": 5.05}]
    closes = pd.Series({pd.Timestamp("2026-01-02"): 5.06,   # overlap → new wins
                        pd.Timestamp("2026-01-03"): 9.90})   # +96% → outlier
    hist, n = _merge_close_series(existing, closes, "BRL=X")
    by_date = {r["date"]: r["close"] for r in hist}
    assert by_date["2026-01-01"] == 5.00      # old preserved
    assert by_date["2026-01-02"] == 5.06      # fresh value wins on overlap
    assert "2026-01-03" not in by_date        # outlier dropped
    assert n == 1


def test_merge_close_series_handles_empty_inputs():
    hist, n = _merge_close_series(None, None)
    assert hist == [] and n == 0
