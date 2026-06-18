from __future__ import annotations

from scraper.sources.un_wpp_age import _median_age


def test_median_age_uniform_distribution():
    # Equal population in every 5-yr band 0..95 → median sits at the midpoint (50).
    bands = {a: 100.0 for a in range(0, 100, 5)}
    m = _median_age(bands)
    assert m is not None
    assert abs(m - 50.0) < 0.6


def test_median_age_young_population():
    # Heavily weighted to children → low median age.
    bands = {0: 500.0, 5: 400.0, 10: 300.0, 15: 200.0, 20: 100.0, 25: 50.0}
    m = _median_age(bands)
    assert m is not None
    assert m < 12


def test_median_age_interpolates_within_band():
    # Two bands of equal size: the 50th percentile lands at the boundary (10).
    bands = {0: 100.0, 5: 100.0, 10: 100.0, 15: 100.0}
    m = _median_age(bands)
    assert m is not None
    assert abs(m - 10.0) < 0.6


def test_median_age_empty_or_zero():
    assert _median_age({}) is None
    assert _median_age({0: 0.0, 5: 0.0}) is None
