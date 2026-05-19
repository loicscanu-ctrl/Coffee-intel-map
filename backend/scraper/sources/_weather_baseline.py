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
