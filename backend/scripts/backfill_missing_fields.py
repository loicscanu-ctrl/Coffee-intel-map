#!/usr/bin/env python3
"""backfill_missing_fields.py — heal missing weather-history fields from archive.

Generalization of the original backfill_et0_history.py: the daily fetcher
(fetch_origin_weather.py) sometimes stores `None` for a field on a given
date because the Open-Meteo *forecast* endpoint silently returned null
for that date/coordinate. The archive endpoint usually has the value.

Known cases that motivated this script:
  - ET₀: forecast endpoint truncates to ~24 days back even with past_days=92.
  - Rain: forecast endpoint returned null for 2026-03..2026-04 across every
    region (61 days), plus 2026-01 for 4 of 5 Vietnam regions (extra 31).

The script is field-generic so any future "API silently returned null"
recurrence is a single re-dispatch.

Behavior:
  - For each region, identify dates in history where ANY requested field
    is None.
  - One archive call per region covering that date span, requesting the
    fields the region needs.
  - Only fills nulls; never overwrites a stored value.
  - Only writes ET₀/rain/tmean for dates that already exist in history —
    won't invent new days (that's backfill_history_gap.py's job).

Idempotent. Same retry + per-origin checkpoint posture as
build_spei_baselines.py.

Usage:
    python backend/scripts/backfill_missing_fields.py            # preview
    python backend/scripts/backfill_missing_fields.py --write    # persist
    python backend/scripts/backfill_missing_fields.py --write --fields rain
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
from fetch_origin_weather import ORIGINS, r1  # noqa: E402

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelMissingFieldBackfill/1.0)"}
HISTORY_DIR = Path(__file__).resolve().parents[1] / "seed" / "weather_history"

# Field name in our history JSON → Open-Meteo daily-variable name.
FIELD_TO_ARCHIVE_VAR = {
    "rain":  "precipitation_sum",
    "et0":   "et0_fao_evapotranspiration",
    "tmean": "temperature_2m_mean",
}

CALL_TIMEOUT = 60
MAX_ATTEMPTS = 3
RETRY_SLEEP_S = (5, 15, 30)


def fetch_field_range(lat: float, lon: float,
                      start: str, end: str,
                      fields: list[str]) -> dict[str, dict[str, float]]:
    """Daily archive for the requested fields over [start, end].
    Returns {date: {field: value}} only for dates with at least one non-null."""
    daily_vars = ",".join(FIELD_TO_ARCHIVE_VAR[f] for f in fields)
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = requests.get(ARCHIVE_URL, headers=HEADERS, timeout=CALL_TIMEOUT, params={
                "latitude": lat, "longitude": lon,
                "start_date": start, "end_date": end,
                "daily": daily_vars,
                "timezone": "auto",
            })
            r.raise_for_status()
            d = r.json()["daily"]
            out: dict[str, dict[str, float]] = {}
            for i, day in enumerate(d["time"]):
                row: dict[str, float] = {}
                for f in fields:
                    var = FIELD_TO_ARCHIVE_VAR[f]
                    series = d.get(var) or []
                    if i < len(series) and series[i] is not None:
                        row[f] = r1(series[i])
                if row:
                    out[day] = row
            return out
        except requests.RequestException as e:
            last_err = e
            if attempt < MAX_ATTEMPTS - 1:
                sleep = RETRY_SLEEP_S[attempt]
                print(f"    retry {attempt + 1}/{MAX_ATTEMPTS - 1} in {sleep}s "
                      f"({type(e).__name__})", file=sys.stderr, flush=True)
                time.sleep(sleep)
    raise last_err if last_err else RuntimeError("fetch_field_range: no error")


def _dates_with_any_null(reg_hist: dict, fields: list[str]) -> list[str]:
    """Existing dates where at least one requested field is None."""
    return sorted(d for d, v in reg_hist.items()
                  if isinstance(v, dict)
                  and any(v.get(f) is None for f in fields))


def process_region(reg_hist: dict, lat: float, lon: float,
                   fields: list[str]) -> tuple[int, int]:
    """Fill any of `fields` that are None in reg_hist.

    Returns (n_field_values_filled, n_field_values_still_missing).
    """
    needs = _dates_with_any_null(reg_hist, fields)
    if not needs:
        return 0, 0
    start, end = needs[0], needs[-1]
    archive_rows = fetch_field_range(lat, lon, start, end, fields)
    filled = 0
    still_missing = 0
    for date in needs:
        new = archive_rows.get(date) or {}
        for f in fields:
            if reg_hist[date].get(f) is not None:
                continue
            v = new.get(f)
            if v is None:
                still_missing += 1
            else:
                reg_hist[date][f] = v
                filled += 1
    return filled, still_missing


def _load_history(origin: str) -> dict | None:
    path = HISTORY_DIR / f"{origin}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_history(origin: str, hist: dict) -> None:
    path = HISTORY_DIR / f"{origin}.json"
    # Sort per-region dates so the diff is reviewable.
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
    ap.add_argument("--fields", nargs="*",
                    default=["rain", "et0", "tmean"],
                    choices=list(FIELD_TO_ARCHIVE_VAR.keys()),
                    help="Fields to heal (default: rain, et0, tmean)")
    args = ap.parse_args()

    print(f"[backfill] healing fields={args.fields} across "
          f"{len(args.origins)} origins")

    grand_filled = 0
    grand_missing = 0
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
                                               reg_meta["lon"], args.fields)
                if filled or still:
                    print(f"  {origin}/{name}: filled {filled}, "
                          f"still missing {still}", flush=True)
                else:
                    print(f"  {origin}/{name}: already complete.", flush=True)
                per_origin_filled += filled
                grand_filled += filled
                grand_missing += still
            except Exception as e:  # noqa: BLE001
                print(f"  {origin}/{name}: FAILED {e}", file=sys.stderr, flush=True)
                grand_failed.append(f"{origin}/{name}")
            time.sleep(1)
        if args.write and per_origin_filled:
            _write_history(origin, hist)
            print(f"  → checkpoint: wrote {origin}.json "
                  f"(+{per_origin_filled} field values)", flush=True)

    print(f"\nSummary: filled={grand_filled} still_missing={grand_missing} "
          f"failed_regions={len(grand_failed)}")
    if grand_failed:
        print(f"Failed regions (re-dispatch to retry): {grand_failed}")
    if not args.write:
        print("(preview only — re-run with --write to persist)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
