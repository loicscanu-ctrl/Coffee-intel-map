"""Tests for the SPI gamma-fit calculator. scipy-dependent → skipped if absent."""
import pathlib
import random
import statistics
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))

spi_calc = pytest.importorskip("spi_calc")   # needs scipy/numpy


def _synthetic_monthly(seed=0):
    """30 years of monthly precip; May ~ gamma(mean≈150), other months drier."""
    random.seed(seed)
    monthly, may = {}, []
    for y in range(1995, 2025):
        for m in range(1, 13):
            v = random.gammavariate(4.0, 37.5) if m == 5 else random.gammavariate(2.0, 30.0)
            monthly[f"{y}-{m:02d}"] = round(v, 1)
            if m == 5:
                may.append(v)
    return monthly, statistics.mean(may)


def test_spi_sign_and_magnitude():
    monthly, mean_may = _synthetic_monthly()
    at_mean = spi_calc.spi_for_month(monthly, {"2025-05": mean_may}, "2025-05", 1)
    wet     = spi_calc.spi_for_month(monthly, {"2025-05": mean_may * 2}, "2025-05", 1)
    dry     = spi_calc.spi_for_month(monthly, {"2025-05": mean_may / 4}, "2025-05", 1)
    assert abs(at_mean) < 0.5      # near normal at the mean
    assert wet > 1.0               # clearly wet
    assert dry < -1.0              # clearly dry (drought)


def test_spi3_uses_trailing_three_months():
    monthly, mean_may = _synthetic_monthly()
    s3 = spi_calc.spi_for_month(monthly, {"2025-03": 80, "2025-04": 110, "2025-05": mean_may}, "2025-05", 3)
    assert s3 is not None
    # missing one of the trailing months → can't form the 3-month sum → None
    assert spi_calc.spi_for_month(monthly, {"2025-05": mean_may}, "2025-05", 3) is None


def test_spi_none_on_thin_calibration():
    assert spi_calc.spi([10, 20, 30], 25) is None          # <10 samples
    assert spi_calc.spi([0, 0, 0, 1] + [0] * 20, 5) is None  # <4 non-zero


def test_rolling_sum_requires_contiguous_months():
    rs = spi_calc.rolling_sum({"2025-01": 10, "2025-02": 20, "2025-04": 40}, 2)
    assert rs == {"2025-02": 30.0}   # Jan+Feb only; Mar gap blocks Feb-Apr/Mar-Apr
