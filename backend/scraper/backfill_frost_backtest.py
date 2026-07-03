"""Frost backtest harness — validates the physics model against REAL
Open-Meteo data. Two modes:

RECENT (default) — the last ~90 days from the FORECAST API, across the frost
belt. The forecast host (api.open-meteo.com) IS reachable from GitHub Actions,
so this runs in CI with no archive access and no proxy — validating the model
end-to-end on live data and reporting what it flags in the current season.
Runs via .github/workflows/frost-backtest.yml.

EVENTS — the deep blind backtest against the documented disasters (1975 /
1994 / 2021) using the ERA5 ARCHIVE host. That host is blocked from CI and
from this sandbox, so events-mode needs either somewhere archive-api.open-
meteo.com is reachable, or OPEN_METEO_ARCHIVE_BASE pointed at a Cloudflare
Worker that forwards to it (same trick as the thermocline ERDDAP proxy —
the worker's egress isn't on the blocklist).

Usage:
    cd backend
    python -m scraper.backfill_frost_backtest                    # recent, 90 d
    python -m scraper.backfill_frost_backtest --mode recent --days 60
    python -m scraper.backfill_frost_backtest --mode events      # needs archive
    OPEN_METEO_ARCHIVE_BASE=https://om-proxy.acct.workers.dev \
        python -m scraper.backfill_frost_backtest --mode events

Exit codes:
    0 — ran (report printed; mismatches/flags are informational, not fatal)
    2 — the endpoint the chosen mode needs is unreachable (nothing proven)
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests

from scraper.rules import frost_model as fm

# Open-Meteo "occasionally goes slow (>20 s response)". Match the daily
# weather fetcher's resilience: several attempts with progressively-longer
# (single-scalar) timeouts + backoff, so one slow spell doesn't fail the
# whole backtest. Scalars apply to BOTH connect and read — a 90-day hourly
# response is large and can take tens of seconds to generate.
_FETCH_TIMEOUTS = (60, 90, 120)

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "seed" / "frost_events.json"

DEFAULT_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
# Forecast API — reachable from GitHub Actions (unlike the archive host).
# Keeps ~92 days of recent past, so the "recent" mode validates the model on
# REAL data from the current frost season without the archive or a proxy.
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
# The regions that actually frost (the belt). Coastal Espírito Santo excluded.
FROST_BELT = ("Sul de Minas", "Cerrado", "São Paulo", "Paraná")
_HOURLY_VARS = "temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m"

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


def _get_hourly(url: str, params: dict, tag: str) -> dict | None:
    """GET the Open-Meteo `hourly` block with retries + backoff. None on
    terminal failure (all attempts exhausted)."""
    last = ""
    for i, timeout in enumerate(_FETCH_TIMEOUTS):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json().get("hourly")
        except requests.RequestException as e:
            last = f"{type(e).__name__}: {str(e)[:100]}"
            if i < len(_FETCH_TIMEOUTS) - 1:
                time.sleep(2 ** (i + 1))
    print(f"    fetch failed {tag} after {len(_FETCH_TIMEOUTS)} attempts: {last}",
          file=sys.stderr)
    return None


def _fetch_hourly(lat: float, lon: float, start: str, end: str) -> dict | None:
    """ERA5 hourly for [start, end] at (lat, lon). None on any failure."""
    return _get_hourly(_archive_base(), {
        "latitude": lat, "longitude": lon,
        "start_date": start, "end_date": end,
        "hourly": _HOURLY_VARS, "timezone": "America/Sao_Paulo",
    }, tag=f"({lat},{lon}) {start}..{end}")


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


def _fetch_recent(lat: float, lon: float, past_days: int) -> dict | None:
    """Recent hourly (last `past_days`) from the FORECAST API at (lat, lon).
    None on terminal failure (retries handled by _get_hourly)."""
    return _get_hourly(FORECAST_URL, {
        "latitude": lat, "longitude": lon,
        "past_days": min(past_days, 92), "forecast_days": 1,
        "hourly": _HOURLY_VARS, "timezone": "America/Sao_Paulo",
    }, tag=f"({lat},{lon}) recent {past_days}d")


def run_recent(days: int = 90) -> int:
    """Run the model over the last `days` of REAL forecast-API data across the
    frost belt, reporting every day the model would have flagged. Validates
    the model end-to-end on live data and shows what it's calling this season.
    Runnable from GitHub Actions (the forecast host is reachable there).

    Informational: exit 0 if it ran (any frost days are reported, not fatal),
    exit 2 only if the forecast API is unreachable."""
    print(f"[frost-backtest] recent mode — last {days} d via {FORECAST_URL}", flush=True)
    ran = False
    flagged = 0
    for region in FROST_BELT:
        latlon = REGION_LATLON.get(region)
        if not latlon:
            continue
        hourly = _fetch_recent(*latlon, days)
        if not hourly:
            continue
        ran = True
        days_by = _nights(hourly)
        region_hits = []
        for day, (t, d, c, w) in sorted(days_by.items()):
            a = fm.assess_night(t, c, w, d)
            sev = fm.severity(a.risk, a.frost_type, a.surface_min_c, a.hours_below_0)
            if sev is not None:
                region_hits.append((day, sev, a))
        if region_hits:
            print(f"\n  {region}: {len(region_hits)} frost day(s) flagged")
            for day, sev, a in region_hits:
                print(f"    {day}  {sev:8s}  canopy {a.surface_min_c:.1f}°C  "
                      f"air {a.air_min_c:.1f}°C  {a.frost_type}  "
                      f"{a.hours_below_0}h<0")
                flagged += 1
        else:
            print(f"  {region}: no frost in the last {days} d "
                  f"(model did not false-positive on normal winter nights)")
    if not ran:
        print("[frost-backtest] FATAL: forecast API unreachable — nothing run.",
              file=sys.stderr)
        return 2
    print(f"\n[frost-backtest] recent run complete: {flagged} frost-day(s) "
          f"flagged across the belt over the last {days} d.")
    return 0


def run_events() -> int:
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


def main(argv: list[str] | None = None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--mode", choices=("recent", "events"), default="recent",
        help="recent: last N days via the forecast API (works from CI); "
             "events: the deep 1975/1994/2021 archive backtest (needs archive "
             "access / a proxy). Default: recent.",
    )
    ap.add_argument("--days", type=int, default=90,
                    help="Recent-mode lookback (max 92, forecast-API limit).")
    args = ap.parse_args(argv)
    return run_recent(args.days) if args.mode == "recent" else run_events()


if __name__ == "__main__":
    sys.exit(main())
