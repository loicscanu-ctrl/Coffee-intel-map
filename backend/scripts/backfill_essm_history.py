#!/usr/bin/env python3
"""backfill_essm_history.py — fill historic Surface Soil Moisture (ESSM).

The daily fetcher (fetch_origin_weather.py) only writes ESSM going forward,
because the Open-Meteo *forecast* endpoint it uses doesn't reach far enough
back. Result: ESSM history is ~9 days deep on the moment a region first
runs, with no way to render the chart's "calendar year" view until a year
of daily runs accumulate.

This script fills the gap from the Open-Meteo *archive* (ERA5) endpoint,
which has hourly soil moisture going back to 1940.

  - Hourly variables (m³/m³ volumetric):
      soil_moisture_0_to_7cm
      soil_moisture_7_to_28cm
      soil_moisture_28_to_100cm
  - Daily ESSM = mean over (24 hours × available layers) — same shape the
    daily fetcher produces from the forecast endpoint's hourly block.
  - Only fills dates where `essm` is currently None / missing; never
    overwrites a stored value.

Idempotent. Re-dispatching after a failure resumes from the next missing
date (no checkpoint state needed — the JSON itself is the checkpoint).

Usage:
    # Preview what would change (no write)
    python backend/scripts/backfill_essm_history.py

    # Persist (writes per-origin as each origin completes)
    python backend/scripts/backfill_essm_history.py --write

    # Limit lookback to keep the first run cheap
    python backend/scripts/backfill_essm_history.py --write --days 400

    # Single origin
    python backend/scripts/backfill_essm_history.py --write --origins brazil
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_origin_weather import ORIGINS  # noqa: E402

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelESSMBackfill/1.0)"}
HISTORY_DIR = Path(__file__).resolve().parents[1] / "seed" / "weather_history"

# ERA5 archive's soil-moisture layers. Depths differ slightly from the
# forecast API (0_to_1 / 1_to_3 / 3_to_9 / 9_to_27 / 27_to_81 cm) but the
# unit (volumetric fraction m³/m³) and the meaning (root-zone moisture) are
# the same — mean across the available layers maps to our existing ESSM.
ERA5_LAYERS = (
    "soil_moisture_0_to_7cm",
    "soil_moisture_7_to_28cm",
    "soil_moisture_28_to_100cm",
)

CALL_TIMEOUT = 90
MAX_ATTEMPTS = 3
RETRY_SLEEP_S = (5, 15, 30)


def _daily_essm_from_hourly(hourly: dict | None) -> dict[str, float]:
    """Hourly archive block → {date: daily ESSM}. Mirrors the live fetcher's
    `_daily_essm` exactly: each hour's value = mean of available layers,
    each day's value = mean of its hours. Days with no data are omitted."""
    if not hourly or "time" not in hourly:
        return {}
    times = hourly["time"]
    layers = [hourly[k] for k in ERA5_LAYERS if k in hourly]
    if not layers:
        return {}
    by_date: dict[str, list[float]] = {}
    for i, ts in enumerate(times):
        vals = [col[i] for col in layers if i < len(col) and col[i] is not None]
        if vals:
            by_date.setdefault(ts[:10], []).append(sum(vals) / len(vals))
    return {d: round(sum(v) / len(v), 3) for d, v in by_date.items() if v}


def fetch_essm_range(lat: float, lon: float,
                     start: str, end: str) -> dict[str, float]:
    """Hourly ERA5 archive over [start, end] → {date: ESSM}."""
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = requests.get(ARCHIVE_URL, headers=HEADERS, timeout=CALL_TIMEOUT, params={
                "latitude": lat, "longitude": lon,
                "start_date": start, "end_date": end,
                "hourly": ",".join(ERA5_LAYERS),
                "timezone": "auto",
            })
            r.raise_for_status()
            return _daily_essm_from_hourly(r.json().get("hourly"))
        except requests.RequestException as e:
            last_err = e
            if attempt < MAX_ATTEMPTS - 1:
                sleep = RETRY_SLEEP_S[attempt]
                print(f"    retry {attempt + 1}/{MAX_ATTEMPTS - 1} in {sleep}s "
                      f"({type(e).__name__})", file=sys.stderr, flush=True)
                time.sleep(sleep)
    raise last_err if last_err else RuntimeError("fetch_essm_range: no error")


def _missing_essm_dates(reg_hist: dict, lookback_start: str) -> list[str]:
    """Existing dates ≥ lookback_start where `essm` is None or missing.

    We intentionally only fill dates that already exist in the history (rain
    or tmean has been written there at some point) — this avoids inventing
    new days the rest of the pipeline doesn't know about."""
    return sorted(d for d, v in reg_hist.items()
                  if isinstance(v, dict)
                  and d >= lookback_start
                  and v.get("essm") is None)


def process_region(reg_hist: dict, lat: float, lon: float,
                   lookback_start: str) -> tuple[int, int]:
    """Returns (n_dates_filled, n_dates_still_missing)."""
    needs = _missing_essm_dates(reg_hist, lookback_start)
    if not needs:
        return 0, 0
    start, end = needs[0], needs[-1]
    archive = fetch_essm_range(lat, lon, start, end)
    filled = 0
    still = 0
    needs_set = set(needs)
    for date in needs:
        v = archive.get(date)
        if v is None:
            still += 1
            continue
        reg_hist[date]["essm"] = v
        filled += 1
    # Some archive dates may fall outside `needs` (e.g. the range filled in
    # gaps where rain/tmean were never written either). Skip those — they're
    # the rightful job of backfill_history_gap.py, not this script.
    _ = needs_set
    return filled, still


def _load_history(origin: str) -> dict | None:
    path = HISTORY_DIR / f"{origin}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_history(origin: str, hist: dict) -> None:
    path = HISTORY_DIR / f"{origin}.json"
    regions = hist.get("regions") or {}
    for name, rh in regions.items():
        regions[name] = dict(sorted(rh.items()))
    path.write_text(json.dumps(hist, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="Persist filled values back to seed/weather_history/")
    ap.add_argument("--origins", nargs="*", default=list(ORIGINS))
    ap.add_argument("--days", type=int, default=400,
                    help="How far back to fill (default: 400 days ≈ 13 mo)")
    args = ap.parse_args()

    lookback_start = (dt.date.today() - dt.timedelta(days=args.days)).isoformat()
    print(f"[essm-backfill] lookback start = {lookback_start} "
          f"({args.days} days) across {len(args.origins)} origins")

    grand_filled = 0
    grand_still = 0
    grand_failed: list[str] = []

    for origin in args.origins:
        hist = _load_history(origin)
        if hist is None:
            print(f"  {origin}: no history file — skipping.")
            continue
        regions = hist.get("regions") or {}
        per_origin_filled = 0
        for reg_meta in ORIGINS[origin]:
            name = reg_meta["name"]
            reg_hist = regions.get(name)
            if not reg_hist:
                print(f"  {origin}/{name}: no history rows — skipping.")
                continue
            try:
                filled, still = process_region(reg_hist, reg_meta["lat"],
                                               reg_meta["lon"], lookback_start)
                if filled or still:
                    print(f"  {origin}/{name}: filled {filled}, "
                          f"still missing {still}", flush=True)
                else:
                    print(f"  {origin}/{name}: already complete.", flush=True)
                per_origin_filled += filled
                grand_filled += filled
                grand_still += still
            except Exception as e:  # noqa: BLE001
                print(f"  {origin}/{name}: FAILED {e}", file=sys.stderr, flush=True)
                grand_failed.append(f"{origin}/{name}")
            time.sleep(1)
        if args.write and per_origin_filled:
            _write_history(origin, hist)
            print(f"  → checkpoint: wrote {origin}.json "
                  f"(+{per_origin_filled} ESSM days)", flush=True)

    print(f"\nSummary: filled={grand_filled} still_missing={grand_still} "
          f"failed_regions={len(grand_failed)}")
    if grand_failed:
        print(f"Failed regions (re-dispatch to retry): {grand_failed}")
    if not args.write:
        print("(preview only — re-run with --write to persist)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
