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
from datetime import date, timedelta
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


def _shift(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def _night_detail(night: tuple[list, list, list, list]) -> dict | None:
    """Physics detail for one night's hourly slice, for the calibration
    report: the coldest 2 m air, the coldest modelled canopy surface, and the
    conditions at the coldest-surface hour (so a ✗ can be read as 'ERA5 was
    genuinely mild here' vs 'ERA5 was cold but the model under-tiered'). None
    for an empty night."""
    t, d, c, w = night
    pts = [(float(tt),
            float(cc) if cc is not None else 0.0,
            float(ww) if ww is not None else 0.0,
            float(dd) if dd is not None else float(tt))
           for tt, cc, ww, dd in zip(t, c, w, d) if tt is not None]
    if not pts:
        return None
    surfaces = [fm.surface_temp(air, cl, wd, dp) for (air, cl, wd, dp) in pts]
    ci = min(range(len(surfaces)), key=lambda i: surfaces[i])
    _air, cloud_ci, wind_ci, dew_ci = pts[ci]
    return {
        "air_min": min(p[0] for p in pts),
        "canopy_min": min(surfaces),
        "cloud_at_min": cloud_ci,
        "wind_at_min": wind_ci,
        "dew_at_min": dew_ci,
    }


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
    """Blind backtest against the documented disasters using the ERA5 ARCHIVE.
    For each event/region, fetch the real hourly around the peak dates, run
    assess_night, and compare the worst modelled severity to the expected one.

    Uses the robust retry fetch (no fragile preflight); exit 2 only if EVERY
    fetch failed (archive unreachable — nothing proven)."""
    events = json.loads(CATALOG.read_text(encoding="utf-8"))["events"]
    print(f"[frost-backtest] events mode — archive base: {_archive_base()}", flush=True)
    print("  ERA5 is a ~31 km reanalysis; it smooths the valley cold-pooling "
          "that drives real frost minima, so a grid point often reads several "
          "°C milder than the station observation. Read air_min/canopy_min to "
          "tell 'model under-tiered' from 'ERA5 had no frost here'.")
    total = hits = ran = 0
    rank = {None: -1, "watch": 0, "alert": 1, "critical": 2}
    for ev in events:
        obs = ev.get("observed_air_min_c")
        print(f"\n[{ev['id']}] {ev['label']} — expect {ev['expected_severity']}"
              f"  (observed station air_min {obs:+.1f}°C)")
        dates = sorted(ev["peak_dates"])
        # ±1 day brackets the pre-dawn minimum across the timezone boundary.
        start, end = _shift(dates[0], -1), _shift(dates[-1], 1)
        for region in ev["regions"]:
            latlon = REGION_LATLON.get(region)
            if not latlon:
                continue
            hourly = _fetch_hourly(*latlon, start, end)
            if not hourly:
                print(f"    · {region:15s} (fetch unavailable)")
                continue
            ran += 1
            # Track the night that drives the worst severity (coldest canopy
            # as tiebreak) and keep its assessment + slice for the report.
            best_key: tuple[int, float] = (-2, 0.0)
            worst_sev = None
            worst_a = None
            worst_night: tuple[list, list, list, list] | None = None
            worst_day = ""
            for day, night in sorted(_nights(hourly).items()):
                t, d, c, w = night
                a = fm.assess_night(t, c, w, d)
                sev = fm.severity(a.risk, a.frost_type, a.surface_min_c, a.hours_below_0)
                key = (rank[sev], -a.surface_min_c)
                if key > best_key:
                    best_key, worst_sev, worst_a, worst_night, worst_day = (
                        key, sev, a, night, day)
            mark = "✓" if worst_sev == ev["expected_severity"] else "✗"
            det = _night_detail(worst_night) if worst_night else None
            print(f"    {mark} {region:15s} sev={str(worst_sev):8s}", end="")
            if det and worst_a is not None:
                print(f" | air {det['air_min']:+5.1f}  canopy {det['canopy_min']:+5.1f}"
                      f"  dew {det['dew_at_min']:+5.1f}  cloud {det['cloud_at_min']:3.0f}%"
                      f"  wind {det['wind_at_min']:2.0f}km/h"
                      f" | {worst_a.hours_below_0}h<0 {worst_a.hours_below_hard}h<hard"
                      f"  {worst_a.frost_type:9s} ({worst_day})")
            else:
                print()
            total += 1
            if worst_sev == ev["expected_severity"]:
                hits += 1

    if ran == 0:
        print("[frost-backtest] FATAL: archive unreachable (all fetches failed). "
              "Set OPEN_METEO_ARCHIVE_BASE to a proxy forwarding to "
              "archive-api.open-meteo.com, or run where it's reachable. "
              "Nothing proven.", file=sys.stderr)
        return 2
    print(f"\n[frost-backtest] {hits}/{total} region-events matched expected "
          f"severity on ERA5 grid data. Read each row's air_min before reading "
          f"a miss as a model error: most are the ~31 km reanalysis sitting "
          f"well above freezing where the station saw a hard freeze (smoothed "
          f"valley cold-pools) — the ladder is right, the grid has no frost to "
          f"detect there. Don't loosen thresholds to chase those.")
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
