"""Standardized Precipitation-Evapotranspiration Index (SPEI).

Same skeleton as `spi_calc.py` but on the climatic water balance D = P − ET₀
instead of raw precipitation.

D is real-valued (can be negative when ET₀ > P) and roughly symmetric, so
we fit a **normal** distribution per calendar month — robust, no
degenerate cases at the tails, no zero-mass mixing needed. Vicente-Serrano
(2010) prefers a 3-parameter log-logistic for slightly heavier tails, but
the L-moment estimator for that distribution is fragile on small samples
and the practical drought-monitoring signal is nearly identical: SPEI < −1
flags deficit, SPEI > 1 flags surplus. We keep the door open to swap in a
log-logistic later by isolating the fit behind `_fit(arr)`.

Mirrors `spi_calc.py` API verbatim:
    monthly_d(p_map, et0_map)        → {'YYYY-MM': D}
    rolling_sum(monthly_d, scale)    → {'YYYY-MM': trailing-`scale` sum of D}
    spei(calibration_d, current_d)   → z-score against same-calendar-month set
    spei_for_month(...)              → orchestrator like spi_for_month

Pure math, no I/O — scipy is the only dep (same as SPI).
"""
from __future__ import annotations

import numpy as np
from scipy import stats
from spi_calc import _month_index

_CLAMP = 1e-6


def monthly_d(p_map: dict[str, float], et0_map: dict[str, float]) -> dict[str, float]:
    """{'YYYY-MM': D} where D = P − ET₀, for months where BOTH inputs exist.

    Drops months where either side is missing — those months can't form a
    water balance and shouldn't bias the calibration distribution.
    """
    out: dict[str, float] = {}
    for k, p in p_map.items():
        et0 = et0_map.get(k)
        if p is None or et0 is None:
            continue
        out[k] = float(p) - float(et0)
    return dict(sorted(out.items()))


def rolling_sum(monthly: dict[str, float], scale: int) -> dict[str, float]:
    """Same contract as `spi_calc.rolling_sum` but accepts negative values
    (D can be negative when ET₀ > P).

    Emits a sum only where the trailing `scale` months are present and
    contiguous (no calendar gaps).
    """
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


def _fit(arr: np.ndarray) -> tuple[float, float] | None:
    """Normal fit isolated behind a helper so we can swap in log-logistic
    (scipy.stats.fisk) later without touching `spei()`."""
    if arr.size < 10:
        return None
    mu = float(arr.mean())
    sigma = float(arr.std(ddof=1))
    if sigma <= 0:
        return None
    return mu, sigma


def spei(calibration: list[float], current: float) -> float | None:
    """SPEI z-score for `current` against `calibration` (same calendar month
    + scale). Returns None when the calibration sample is too small (<10)
    or has zero variance (degenerate fit)."""
    arr = np.asarray([v for v in calibration if v is not None], dtype=float)
    fit = _fit(arr)
    if fit is None:
        return None
    mu, sigma = fit
    F = float(stats.norm.cdf(float(current), loc=mu, scale=sigma))
    F = min(max(F, _CLAMP), 1.0 - _CLAMP)   # avoid ±inf at the tails
    return round(float(stats.norm.ppf(F)), 2)


def spei_for_month(monthly_calib_d: dict[str, float],
                   current_monthly_d: dict[str, float],
                   target_key: str, scale: int) -> float | None:
    """SPEI-`scale` for `target_key` ('YYYY-MM'). Mirrors `spi_for_month`:
    calibration = trailing-sum values for the SAME calendar month across the
    baseline; current = the trailing sum ending at target_key, built from
    calib + current merged."""
    cal_sums = rolling_sum(monthly_calib_d, scale)
    tgt_month = target_key.split("-")[1]
    same_month = [v for k, v in cal_sums.items() if k.split("-")[1] == tgt_month]
    merged = {**monthly_calib_d, **{k: v for k, v in current_monthly_d.items() if v is not None}}
    cur = rolling_sum(merged, scale).get(target_key)
    if cur is None:
        return None
    return spei(same_month, cur)
