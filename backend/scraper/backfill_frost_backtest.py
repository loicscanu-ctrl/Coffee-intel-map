"""Blind frost backtest harness — validates the physics model against REAL
historical hourly weather for Brazil's documented frost disasters.

The threshold sanity-check (scraper/tests/test_frost_backtest.py) reconstructs
each event from its recorded air minimum. This harness does the honest thing:
pulls the actual ERA5 hourly archive (temperature / dew point / cloud / wind)
for each event's peak nights at the worst-hit regions, runs assess_night over
the real data, and reports whether the model would have fired 'critical'.

It can't run in the sandbox / CI — the network policy blocks Open-Meteo
(both the forecast and archive hosts). Run it either:
  * somewhere archive-api.open-meteo.com is reachable, or
  * with OPEN_METEO_ARCHIVE_BASE set to a proxy that forwards to it (same
    Cloudflare-Worker trick as the thermocline ERDDAP proxy — the worker's
    egress isn't on the blocklist).

Usage:
    cd backend
    # direct (where archive-api is reachable):
    python -m scraper.backfill_frost_backtest
    # via a proxy:
    OPEN_METEO_ARCHIVE_BASE=https://om-proxy.acct.workers.dev \
        python -m scraper.backfill_frost_backtest

Exit codes:
    0 — backtest ran (see report; non-zero mismatches are printed, not fatal)
    2 — archive unreachable / not configured (deploy a proxy; nothing proven)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests

from scraper.rules import frost_model as fm

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "seed" / "frost_events.json"

DEFAULT_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

# Representative station per frost-belt region (same points the live weather
# fetcher uses). São Paulo ≈ the Mogiana belt around Franca.
REGION_LATLON = {
    "Sul de Minas":   (-21.55, -45.43),   # Varginha
    "Cerrado":        (-18.95, -46.99),   # Patrocínio
    "São Paulo":      (-20.54, -47.40),   # Franca (Alta Mogiana)
    "Paraná":         (-23.31, -50.62),   # Londrina
}


def _archive_base() -> str:
    return os.environ.get("OPEN_METEO_ARCHIVE_BASE", "").strip() or DEFAULT_ARCHIVE


def _fetch_hourly(lat: float, lon: float, start: str, end: str) -> dict | None:
    """ERA5 hourly for [start, end] at (lat, lon). None on any failure."""
    params = {
        "latitude": lat, "longitude": lon,
        "start_date": start, "end_date": end,
        "hourly": "temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m",
        "timezone": "America/Sao_Paulo",
    }
    try:
        r = requests.get(_archive_base(), params=params, timeout=45)
        r.raise_for_status()
        return r.json().get("hourly")
    except requests.RequestException as e:
        print(f"    fetch failed ({lat},{lon}) {start}..{end}: "
              f"{type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
        return None


def _nights(hourly: dict) -> dict[str, tuple[list, list, list, list]]:
    """Group the hourly arrays by local calendar day → per-day slices."""
    times = hourly.get("time") or []
    temp  = hourly.get("temperature_2m") or []
    dew   = hourly.get("dew_point_2m") or []
    cloud = hourly.get("cloud_cover") or []
    wind  = hourly.get("wind_speed_10m") or []
    out: dict[str, tuple[list, list, list, list]] = {}
    for i, ts in enumerate(times):
        day = ts[:10]
        t, d, c, w = out.setdefault(day, ([], [], [], []))
        t.append(temp[i] if i < len(temp) else None)
        d.append(dew[i] if i < len(dew) else None)
        c.append(cloud[i] if i < len(cloud) else None)
        w.append(wind[i] if i < len(wind) else None)
    return out


def _reachable() -> bool:
    try:
        r = requests.get(_archive_base(), params={
            "latitude": -21.55, "longitude": -45.43,
            "start_date": "2021-07-20", "end_date": "2021-07-20",
            "hourly": "temperature_2m", "timezone": "UTC"}, timeout=20)
        return r.ok
    except requests.RequestException:
        return False


def run() -> int:
    events = json.loads(CATALOG.read_text(encoding="utf-8"))["events"]
    print(f"[frost-backtest] archive base: {_archive_base()}")
    if not _reachable():
        print("[frost-backtest] FATAL: Open-Meteo archive unreachable. Set "
              "OPEN_METEO_ARCHIVE_BASE to a proxy that forwards to "
              "archive-api.open-meteo.com, or run where it's reachable. "
              "Nothing proven.", file=sys.stderr)
        return 2

    total = hits = 0
    for ev in events:
        print(f"\n[{ev['id']}] {ev['label']} — expect {ev['expected_severity']}")
        # Fetch a window bracketing the peak dates (±1 day for the pre-dawn min).
        dates = sorted(ev["peak_dates"])
        start, end = dates[0], dates[-1]
        worst_by_region: dict[str, str | None] = {}
        for region in ev["regions"]:
            latlon = REGION_LATLON.get(region)
            if not latlon:
                continue
            hourly = _fetch_hourly(*latlon, start, end)
            if not hourly:
                worst_by_region[region] = None
                continue
            worst_sev = None
            worst_rank = -1
            rank = {None: -1, "watch": 0, "alert": 1, "critical": 2}
            for _day, (t, d, c, w) in _nights(hourly).items():
                a = fm.assess_night(t, c, w, d)
                sev = fm.severity(a.risk, a.frost_type, a.surface_min_c, a.hours_below_0)
                if rank[sev] > worst_rank:
                    worst_rank, worst_sev = rank[sev], sev
            worst_by_region[region] = worst_sev
            mark = "✓" if worst_sev == ev["expected_severity"] else "✗"
            print(f"    {mark} {region:15s} worst modelled severity: {worst_sev}")
            total += 1
            if worst_sev == ev["expected_severity"]:
                hits += 1

    print(f"\n[frost-backtest] {hits}/{total} region-events matched expected "
          f"severity. Mismatches indicate thresholds needing calibration.")
    return 0


if __name__ == "__main__":
    sys.exit(run())
