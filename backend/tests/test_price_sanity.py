# backend/tests/test_price_sanity.py
"""Tests for the macro money-flow price-sanity guard."""
from datetime import date
from types import SimpleNamespace

from scraper.price_sanity import (
    baselines_by_symbol,
    corrupt_batch_dates,
    is_price_sane,
    robust_baseline,
)


def _row(symbol, close_price, d=None):
    return SimpleNamespace(symbol=symbol, close_price=close_price, date=d)


def test_robust_baseline_ignores_single_garbage_value():
    # ~50 good gold prices near 4000 plus one corrupt $4 → median stays ~4000.
    prices = [4000 + i for i in range(50)] + [4.01]
    assert 3900 <= robust_baseline(prices) <= 4100


def test_robust_baseline_none_when_empty():
    assert robust_baseline([]) is None
    assert robust_baseline([None, 0, -5]) is None


def test_egregious_2026_07_14_values_flagged_insane():
    # The 10x-1000x garbage from the 2026-07-14 run vs real baselines.
    assert is_price_sane(4.01, 4116) is False      # gold $4 vs ~$4,116
    assert is_price_sane(4.01, 72) is False         # wti $4 vs ~$72
    assert is_price_sane(79.3, 6.17) is False        # copper $79 vs ~$6
    assert is_price_sane(4061, 316) is False         # soy_meal $4,061 vs ~$316
    assert is_price_sane(6.33, 76) is False          # brent $6 vs ~$76


def test_legit_values_stay_sane():
    assert is_price_sane(4116, 4300) is True
    assert is_price_sane(72.4, 72) is True
    # Legit precious-metals rally: gold ~$5,200 / silver ~$106 vs baselines
    # ~$4,500 / ~$60 are within 3x → not flagged.
    assert is_price_sane(5230, 4500) is True
    assert is_price_sane(106, 60) is True
    # A ~2x move (arabica 3.17 → 6.31) is within 3x, so the per-value check
    # alone does NOT flag it — the batch check below catches it instead.
    assert is_price_sane(6.31, 3.17) is True


def test_no_baseline_accepts_first_price():
    assert is_price_sane(4116, None) is True


def test_nonpositive_never_sane():
    assert is_price_sane(0, 100) is False
    assert is_price_sane(-3, 100) is False
    assert is_price_sane(None, 100) is False


def test_ratio_boundaries():
    assert is_price_sane(300, 100) is True
    assert is_price_sane(301, 100) is False
    assert is_price_sane(100 / 3, 100) is True
    assert is_price_sane(100 / 3 - 0.01, 100) is False


def test_baselines_by_symbol():
    rows = [_row("gold", 4000), _row("gold", 4100), _row("gold", 4.01),
            _row("wti", 72), _row("wti", 73)]
    b = baselines_by_symbol(rows)
    assert 3900 <= b["gold"] <= 4200
    assert 72 <= b["wti"] <= 73


def test_corrupt_batch_date_catches_whole_bad_fetch():
    # Realistic history (median is robust with real ~50-week windows), then a
    # corrupt 2026-07-14 batch: gold/wti/copper egregiously wrong AND arabica
    # only ~2x off (sub-threshold on its own).
    good_weeks = [date(2026, 6, 2), date(2026, 6, 9), date(2026, 6, 16),
                  date(2026, 6, 23), date(2026, 6, 30), date(2026, 7, 7)]
    bad = date(2026, 7, 14)
    good_vals = {"gold": 4116, "wti": 72, "copper": 6.17, "arabica": 3.17, "robusta": 3892}
    bad_vals = {"gold": 4.01, "wti": 4.01, "copper": 79.3, "arabica": 6.31, "robusta": 3849}
    rows = [_row(s, v, w) for s, v in good_vals.items() for w in good_weeks]
    rows += [_row(s, v, bad) for s, v in bad_vals.items()]

    baseline = baselines_by_symbol(rows)
    corrupt = corrupt_batch_dates(rows, baseline)
    # 3 egregious symbols (gold/wti/copper) on 07-14 → whole date flagged.
    assert corrupt == {bad}
    # arabica's sub-3x value on that date is distrusted too (carried forward),
    # while robusta's genuinely-fine value is also distrusted for that day — the
    # exporter recovers it via its archive fallback.
    assert not is_price_sane(bad_vals["gold"], baseline["gold"])
    assert is_price_sane(bad_vals["arabica"], baseline["arabica"])  # 2x, sane per-value


def test_no_corrupt_batch_on_clean_weeks():
    good = date(2026, 7, 7)
    rows = [_row("gold", 4116, good), _row("wti", 72, good), _row("copper", 6.17, good)]
    assert corrupt_batch_dates(rows, baselines_by_symbol(rows)) == set()
