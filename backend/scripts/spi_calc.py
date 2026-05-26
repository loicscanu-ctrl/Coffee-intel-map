"""Standardized Precipitation Index (SPI) via a per-calendar-month gamma fit.

Standard SPI: for a target calendar month, aggregate precipitation over the
trailing `scale` months, fit a gamma to the non-zero calibration values for that
same calendar month, then map the current aggregate through the mixed CDF
    H(x) = q + (1 - q) * G(x)        (q = fraction of zero/dry periods)
to a normal z-score. SPI < 0 = drier than the 30-yr norm, > 0 = wetter.

Pure math, no I/O — fed the 30-yr calibration seed + the live current months by
fetch_origin_weather.py. Requires scipy (guarded by the caller).
"""
from __future__ import annotations

import numpy as np
from scipy import stats

_CLAMP = 1e-6


def _month_index(key: str) -> int:
    y, m = key.split("-")
    return int(y) * 12 + int(m)


def rolling_sum(monthly: dict[str, float], scale: int) -> dict[str, float]:
    """{'YYYY-MM': precip} → {'YYYY-MM': trailing `scale`-month sum}, emitted only
    where the `scale` trailing months are present and contiguous."""
    keys = sorted(monthly)
    out: dict[str, float] = {}
    for i in range(scale - 1, len(keys)):
        window = keys[i - scale + 1: i + 1]
        contiguous = all(_month_index(window[j + 1]) - _month_index(window[j]) == 1
                         for j in range(len(window) - 1))
        vals = [monthly[k] for k in window if monthly.get(k) is not None]
        if contiguous and len(vals) == scale:
            out[keys[i]] = float(sum(vals))
    return out


def spi(calibration: list[float], current: float) -> float | None:
    """SPI z-score for `current` against `calibration` (same calendar month +
    scale). None if the sample is too small to fit a gamma reliably."""
    arr = np.asarray([v for v in calibration if v is not None], dtype=float)
    if arr.size < 10:
        return None
    nonzero = arr[arr > 0]
    if nonzero.size < 4:
        return None
    q = 1.0 - nonzero.size / arr.size                       # fraction of dry periods
    a, _loc, scale_ = stats.gamma.fit(nonzero, floc=0)
    if current <= 0:
        H = q
    else:
        H = q + (1.0 - q) * float(stats.gamma.cdf(current, a, loc=0, scale=scale_))
    H = min(max(H, _CLAMP), 1.0 - _CLAMP)                   # avoid ±inf at the tails
    return round(float(stats.norm.ppf(H)), 2)


def spi_for_month(monthly_calib: dict[str, float], current_monthly: dict[str, float],
                  target_key: str, scale: int) -> float | None:
    """SPI-`scale` for `target_key` ('YYYY-MM'). Calibration = the trailing-sum
    values for the SAME calendar month across the baseline; current = the
    trailing sum ending at target_key, built from calib+current merged."""
    cal_sums = rolling_sum(monthly_calib, scale)
    tgt_month = target_key.split("-")[1]
    same_month = [v for k, v in cal_sums.items() if k.split("-")[1] == tgt_month]
    merged = {**monthly_calib, **{k: v for k, v in current_monthly.items() if v is not None}}
    cur = rolling_sum(merged, scale).get(target_key)
    if cur is None:
        return None
    return spi(same_month, cur)
