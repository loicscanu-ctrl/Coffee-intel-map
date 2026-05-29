"""Tests for the SPEI log-logistic calculator. scipy-dependent → skipped if absent.

SPEI is calibrated on the climatic water balance D = P − ET₀, which is
real-valued (can be negative). The log-logistic fit lives in spei_calc.py.
"""
import pathlib
import random
import statistics
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))

spei_calc = pytest.importorskip("spei_calc")   # needs scipy/numpy


def _synthetic_d_series(seed: int = 0) -> tuple[dict[str, float], float]:
    """30 years of monthly D (P − ET₀); May mean ≈ +20mm (wet),
    other months centred at −40mm (dry). Real-valued, roughly symmetric.

    Returns (monthly D dict, mean D for May).
    """
    random.seed(seed)
    monthly: dict[str, float] = {}
    may_vals: list[float] = []
    for y in range(1995, 2025):
        for m in range(1, 13):
            mu = 20.0 if m == 5 else -40.0
            v = random.gauss(mu, 30.0)
            monthly[f"{y}-{m:02d}"] = round(v, 1)
            if m == 5:
                may_vals.append(v)
    return monthly, statistics.mean(may_vals)


# ── D helper ────────────────────────────────────────────────────────────────

def test_monthly_d_subtracts_pairwise_and_drops_partial_months():
    p   = {"2025-01": 100.0, "2025-02": 50.0, "2025-03": 80.0, "2025-04": None}
    et0 = {"2025-01":  40.0, "2025-02": None, "2025-03": 90.0, "2025-04": 100.0}
    d = spei_calc.monthly_d(p, et0)
    assert d == {"2025-01": 60.0, "2025-03": -10.0}   # Feb dropped (et0 None), Apr dropped (p None)


# ── Core SPEI ───────────────────────────────────────────────────────────────

def test_spei_sign_and_magnitude():
    monthly_d, mean_may = _synthetic_d_series()
    at_mean = spei_calc.spei_for_month(monthly_d, {"2025-05": mean_may}, "2025-05", 1)
    wet     = spei_calc.spei_for_month(monthly_d, {"2025-05": mean_may + 100}, "2025-05", 1)
    dry     = spei_calc.spei_for_month(monthly_d, {"2025-05": mean_may - 100}, "2025-05", 1)
    assert at_mean is not None and abs(at_mean) < 0.5       # near normal at the mean
    assert wet  is not None and wet  >  1.0                  # clearly wet (positive water balance)
    assert dry  is not None and dry  < -1.0                  # clearly dry (deficit)


def test_spei3_uses_trailing_three_months():
    monthly_d, mean_may = _synthetic_d_series()
    s3 = spei_calc.spei_for_month(
        monthly_d,
        {"2025-03": -30, "2025-04": -10, "2025-05": mean_may},
        "2025-05", 3,
    )
    assert s3 is not None
    # missing the trailing months → no rolling 3-month sum → None
    assert spei_calc.spei_for_month(monthly_d, {"2025-05": mean_may}, "2025-05", 3) is None


def test_spei_none_on_thin_calibration():
    # <10 samples → can't fit
    assert spei_calc.spei([10.0, 20.0, -5.0], 0.0) is None


def test_rolling_sum_supports_negative_values_and_requires_contiguity():
    rs = spei_calc.rolling_sum(
        {"2025-01": 10.0, "2025-02": -30.0, "2025-04": 40.0},
        2,
    )
    # Jan+Feb only; Mar gap blocks Feb-Apr/Mar-Apr; sum can be negative.
    assert rs == {"2025-02": -20.0}
