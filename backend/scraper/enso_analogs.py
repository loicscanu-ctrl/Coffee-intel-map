"""ENSO historical-analog matching from a long ONI history.

Pure functions (no I/O, no network) so they're unit-testable. The long ONI
series is built once into backend/seed/oni_history_full.json by
scripts/build_oni_history.py and refreshed monthly; the exporter reads that seed
and calls find_analogs()/aligned_series() to surface the closest past ENSO years
to the current 6-month ONI trajectory.
"""
from __future__ import annotations

_SEASON_MONTH = {
    "DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4,
    "AMJ": 5, "MJJ": 6, "JJA": 7, "JAS": 8,
    "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12,
}
_MONTH_ABBR = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


def parse_oni_series(text: str, since_year: int = 1980) -> list[dict]:
    """Parse NOAA CPC oni.ascii.txt into a chronological ONI series.

    Each NOAA row is a 3-month running mean labelled by season code; we anchor
    it to the season's centre month. Unlike the live farmer-economics parser
    this keeps the *full* history (from `since_year`), not just the last 18
    months. Returns [{"year": 1997, "month": 11, "label": "Nov-97", "value": 2.4}, ...].
    """
    rows: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("SEAS"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        seas, yr, _total, anom = parts[0], parts[1], parts[2], parts[3]
        if seas not in _SEASON_MONTH:
            continue
        try:
            year = int(yr)
            value = float(anom)
        except ValueError:
            continue
        if year < since_year:
            continue
        month = _SEASON_MONTH[seas]
        rows.append({
            "year": year,
            "month": month,
            "label": f"{_MONTH_ABBR[month]}-{year % 100:02d}",
            "value": round(value, 2),
        })
    rows.sort(key=lambda r: (r["year"], r["month"]))
    return rows


def _lookup(series: list[dict]) -> dict[tuple[int, int], float]:
    return {(r["year"], r["month"]): r["value"] for r in series}


def _window_ending(lk: dict, end_year: int, end_month: int, n: int) -> list[float] | None:
    """The n ONI values ending at (end_year, end_month), oldest-first.

    Returns None if any month in the window is missing.
    """
    vals: list[float] = []
    y, m = end_year, end_month
    for _ in range(n):
        v = lk.get((y, m))
        if v is None:
            return None
        vals.append(v)
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(vals))


def current_trajectory(series: list[dict], n: int = 6) -> list[dict]:
    """The last `n` ONI points (the trajectory analogs are matched against)."""
    return series[-n:] if len(series) >= n else list(series)


def aligned_series(
    series: list[dict], end_year: int, end_month: int, back: int, fwd: int
) -> list[dict]:
    """A year's ONI line aligned by month-offset to a reference end month.

    offset 0 == (end_year, end_month); negatives trail, positives are what came
    *after* (so an analog ghost line shows how that ENSO event then evolved).
    Missing months are skipped. Returns [{"offset": -5, "value": 0.4}, ...].
    """
    lk = _lookup(series)
    out: list[dict] = []
    for offset in range(-back, fwd + 1):
        y, m = end_year, end_month + offset
        while m <= 0:
            m += 12
            y -= 1
        while m > 12:
            m -= 12
            y += 1
        v = lk.get((y, m))
        if v is not None:
            out.append({"offset": offset, "value": v})
    return out


def find_analogs(series: list[dict], n: int = 6, top: int = 3, fwd: int = 6) -> list[dict]:
    """Top-`top` past ENSO years whose n-month ONI window best matches the
    current trailing n-month trajectory (lowest mean-squared error).

    For each match returns its MSE plus an `offset`-aligned series spanning the
    n trailing months and `fwd` months forward, for ghost-line overlay.
    """
    import numpy as np

    if len(series) < n:
        return []
    current = series[-n:]
    cur_vals = np.asarray([c["value"] for c in current], dtype=float)
    end = current[-1]
    cur_year, end_month = end["year"], end["month"]
    lk = _lookup(series)
    first_year = series[0]["year"]

    scored: list[dict] = []
    for cand_year in range(first_year + 1, cur_year):
        window = _window_ending(lk, cand_year, end_month, n)
        if window is None:
            continue
        mse = float(np.mean((np.asarray(window, dtype=float) - cur_vals) ** 2))
        scored.append({"year": cand_year, "mse": round(mse, 4)})

    scored.sort(key=lambda r: r["mse"])
    out: list[dict] = []
    for s in scored[:top]:
        out.append({
            "year": s["year"],
            "mse": s["mse"],
            "series": aligned_series(series, s["year"], end_month, back=n - 1, fwd=fwd),
        })
    return out
