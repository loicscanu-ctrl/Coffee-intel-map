import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from scraper.quant_model.calibration import (
    _calibrate_market,
    _forward_return,
    _pearson,
)


def test_forward_return_picks_bracketing_closes():
    prices = [
        (date(2026, 1, 1), 100.0),
        (date(2026, 1, 6), 110.0),   # ~5 days later
        (date(2026, 1, 13), 120.0),
    ]
    # Signal on Jan 1, horizon 5 → P0=100 (on/before), P1=first close on/after Jan 6 → 110 → +10%
    assert _forward_return(prices, date(2026, 1, 1), 5) == 10.0


def test_forward_return_none_when_no_future_price():
    prices = [(date(2026, 1, 1), 100.0)]
    assert _forward_return(prices, date(2026, 1, 1), 5) is None  # nothing ≥ Jan 6


def test_forward_return_none_before_first_price():
    prices = [(date(2026, 1, 10), 100.0), (date(2026, 1, 20), 105.0)]
    assert _forward_return(prices, date(2026, 1, 1), 5) is None  # no close on/before signal


def test_pearson_perfect_positive():
    assert _pearson([1, 2, 3, 4], [2, 4, 6, 8]) == 1.0


def test_pearson_none_for_tiny_or_flat():
    assert _pearson([1, 2], [1, 2]) is None          # n < 3
    assert _pearson([1, 1, 1], [1, 2, 3]) is None    # zero variance


def test_calibrate_market_hit_rate_and_means():
    # Bullish signals precede up moves, bearish precede down moves → 100% hit rate.
    history = [
        {"date": "2026-01-01", "net_index": 40.0},   # bullish
        {"date": "2026-01-06", "net_index": -30.0},  # bearish
        {"date": "2026-01-11", "net_index": 2.0},    # neutral (ignored for hit rate)
    ]
    prices = [
        (date(2026, 1, 1), 100.0),
        (date(2026, 1, 6), 110.0),   # +10% after the bullish call
        (date(2026, 1, 11), 99.0),   # -10% after the bearish call
        (date(2026, 1, 16), 99.0),   # flat after the neutral day
    ]
    m = _calibrate_market(history, prices, horizon=5, neutral_band=8.0)
    assert m["n"] == 3
    assert m["n_directional"] == 2
    assert m["hit_rate"] == 100.0
    assert m["mean_ret_bull"] == 10.0
    assert m["mean_ret_bear"] == -10.0
    assert m["corr"] is not None
