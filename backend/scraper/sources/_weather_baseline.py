"""
_weather_baseline.py — seasonal-anomaly helper for the drought scoring path.

Reads `backend/seed/weather_baselines.json` and exposes
`seasonal_z_score(region, month, value, metric="precip")` so the per-country
`*_weather.py` scrapers can downgrade a raw HIGH drought reading to a
neutral one when the conditions sit inside the region's historical norm
for that calendar month.

Without baselines, every region naturally dry for its season fires drought
flags during that season. With baselines, a drought is flagged only when
the current value falls > ~1.5 σ below the historical mean for that
region × month combination.

Loads the baseline once on first call and caches it in module state.
Returns None (sentinel) when no baseline exists for the requested
(region, month) — callers should treat None as "no seasonal adjustment
available" and fall back to absolute-threshold scoring.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

_REPO_ROOT = Path(__file__).resolve().parents[3]
_BASELINE_PATH = _REPO_ROOT / "backend" / "seed" / "weather_baselines.json"

_cached: dict | None = None


def _load_baselines() -> dict:
    """Lazy-load the baseline JSON; cache forever in this process."""
    global _cached
    if _cached is None:
        if _BASELINE_PATH.exists():
            try:
                _cached = json.loads(_BASELINE_PATH.read_text(encoding="utf-8"))
            except Exception:
                _cached = {}
        else:
            _cached = {}
    return _cached


def seasonal_z_score(
    region: str,
    month: int,
    value: float,
    metric: Literal["precip", "temp"] = "precip",
) -> float | None:
    """Z-score of `value` against the historical mean/std for (region, month).

    Returns None when no baseline data is available — callers should fall
    back to the existing absolute-threshold drought logic.

    Negative z means current value is BELOW the historical norm
    (anomalously dry for precip, anomalously cold for temp).
    Positive z means ABOVE (wet / warm).

    Example:
        z = seasonal_z_score("colombia", month=7, value=current_july_precip)
        if z is not None and z < -1.5:
            day["drought_risk"] = "H"
    """
    doc = _load_baselines()
    regions = doc.get("regions") or {}
    region_doc = regions.get(region)
    if not region_doc:
        return None

    metric_key = "precip_mm_monthly" if metric == "precip" else "temp_c_monthly"
    series = region_doc.get(metric_key)
    if not series:
        return None

    stats = series.get(str(month))
    if not stats:
        return None

    mean = stats.get("mean")
    std  = stats.get("std")
    if mean is None or not std:
        # std=0 (or missing) — can't form a z; return 0 so caller treats as "exactly typical".
        return 0.0
    return (value - mean) / std


def has_baseline(region: str) -> bool:
    """Quick check used by callers that gate the seasonal filter on data availability."""
    doc = _load_baselines()
    return region in (doc.get("regions") or {})


def mtd_rain_envelope(region: str, month: int, day: int) -> tuple[float, float, float] | None:
    """Historical (low, high, mean) of month-to-date accumulated rainfall for
    (region, calendar month, day-of-month), across the baseline years. The
    low/high band is the trimmed 10th/90th percentile (exceptional drought/flood
    years are excluded), so it reads as a realistic "normal" range.

    Returns None when the `precip_mm_mtd_daily` block hasn't been built for
    this region/date — callers then omit the envelope and show MTD only.
    """
    doc = _load_baselines()
    region_doc = (doc.get("regions") or {}).get(region)
    if not region_doc:
        return None
    daily = region_doc.get("precip_mm_mtd_daily") or {}
    stats = (daily.get(str(month)) or {}).get(str(day))
    if not stats:
        return None
    lo, hi, mean = stats.get("min"), stats.get("max"), stats.get("mean")
    if lo is None or hi is None:
        return None
    return float(lo), float(hi), float(mean if mean is not None else (lo + hi) / 2)


def mtd_rain_fields(daily_data: list[dict], region_key: str, today=None) -> dict:
    """Export helper: the three rain fields the morning brief reads, ready to
    merge into a `weather.regions[]` entry. Returns `{}` when MTD rain can't be
    computed or the historical envelope for the region/date is missing, so
    callers can `region.update(mtd_rain_fields(...))` unconditionally.

    `region_key` is the per-country baseline key ("colombia", "brazil", …).
    """
    from datetime import date as _date
    today = today or _date.today()
    mtd = mtd_rain_mm(daily_data, today)
    if mtd is None:
        return {}
    fields: dict = {"rain_mtd_mm": round(mtd, 1)}
    env = mtd_rain_envelope(region_key, today.month, today.day)
    if env:
        lo, hi, _mean = env
        fields["rain_hist_min"] = lo
        fields["rain_hist_max"] = hi
    return fields


def mtd_rain_mm(daily_data: list[dict], today) -> float | None:
    """Sum of `precip_mm` over the current calendar month from a region's
    `WeatherSnapshot.daily_data` (60-day window comfortably covers any MTD).

    `today` is a date; entries are `{"date": "YYYY-MM-DD", "precip_mm": float}`.
    Returns None when no in-month daily values are present.
    """
    total = None
    for d in daily_data or []:
        ds = d.get("date")
        if not ds or len(ds) < 7:
            continue
        try:
            y, mo = int(ds[:4]), int(ds[5:7])
        except ValueError:
            continue
        if y != today.year or mo != today.month:
            continue
        p = d.get("precip_mm")
        if isinstance(p, (int, float)):
            total = (total or 0.0) + p
    return total
