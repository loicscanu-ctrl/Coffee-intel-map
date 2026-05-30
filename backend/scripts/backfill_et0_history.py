#!/usr/bin/env python3
"""backfill_et0_history.py — fill ET₀ for past days the daily fetcher missed.

Why: the daily fetcher requests `et0_fao_evapotranspiration` from Open-Meteo's
*forecast* endpoint with `past_days=92`. The forecast endpoint silently
truncates ET₀ to a much shorter window (observed: ~24 days). So even though
we request 92 days, ET₀ only lands for the last ~3 weeks.

The result: SPEI gates on the latest near-complete month with both rain AND
ET₀ — and that latest month is at best the current one (partial). SPEI ends
up 0/N in production while SPI runs at the expected coverage.

The archive endpoint (`archive-api.open-meteo.com/v1/archive`) serves the
full long history of ET₀ — that's how `build_spei_baselines.py` builds
the 30-yr seed. This script reuses the same endpoint to backfill ET₀ into
EXISTING history records that lack it.

Idempotent:
  - Only fetches a region if its history has any record without `et0`.
  - Only writes ET₀ into dates that exist in the history (won't add new
    days; the daily fetcher owns that).
  - Skips dates already populated.

Sandbox blocks the archive host; runs in CI under
`.github/workflows/backfill-et0-history.yml`. Mirrors build_spei's
retry + per-origin checkpoint pattern so a runner timeout preserves
progress.

Usage:
    python backend/scripts/backfill_et0_history.py            # preview
    python backend/scripts/backfill_et0_history.py --write    # write back to history
    python backend/scripts/backfill_et0_history.py --write --origins brazil colombia
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
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelET0Backfill/1.0)"}
HISTORY_DIR = Path(__file__).resolve().parents[1] / "seed" / "weather_history"

# Same retry posture as build_spei_baselines.py.
CALL_TIMEOUT = 60
MAX_ATTEMPTS = 3
RETRY_SLEEP_S = (5, 15, 30)


def fetch_et0_range(lat: float, lon: float,
                    start: str, end: str) -> dict[str, float]:
    """Daily ET₀ from archive for [start, end] → {YYYY-MM-DD: mm/day}."""
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = requests.get(ARCHIVE_URL, headers=HEADERS, timeout=CALL_TIMEOUT, params={
                "latitude": lat, "longitude": lon,
                "start_date": start, "end_date": end,
                "daily": "et0_fao_evapotranspiration",
                "timezone": "auto",
            })
            r.raise_for_status()
            d = r.json()["daily"]
            out: dict[str, float] = {}
            for day, et0 in zip(d["time"], d["et0_fao_evapotranspiration"]):
                if et0 is not None:
                    out[day] = et0
            return out
        except requests.RequestException as e:
            last_err = e
            if attempt < MAX_ATTEMPTS - 1:
                sleep = RETRY_SLEEP_S[attempt]
                print(f"    retry {attempt + 1}/{MAX_ATTEMPTS - 1} in {sleep}s "
                      f"({type(e).__name__})", file=sys.stderr, flush=True)
                time.sleep(sleep)
    raise last_err if last_err else RuntimeError("fetch_et0_range: no error captured")


def _dates_missing_et0(reg_hist: dict) -> list[str]:
    """Existing-but-no-et0 dates in this region's history, chronological."""
    return sorted(d for d, v in reg_hist.items()
                  if isinstance(v, dict) and v.get("et0") is None)


def process_region(reg_hist: dict, lat: float, lon: float) -> tuple[int, int]:
    """Fill ET₀ for every existing date in reg_hist that lacks it.

    Returns (n_filled, n_still_missing). We only WRITE ET₀ for dates that
    already exist in the history — never invent new days.
    """
    missing = _dates_missing_et0(reg_hist)
    if not missing:
        return 0, 0
    start, end = missing[0], missing[-1]
    et0_map = fetch_et0_range(lat, lon, start, end)
    filled = 0
    for date in missing:
        et0 = et0_map.get(date)
        if et0 is None:
            continue
        reg_hist[date]["et0"] = r1(et0)
        filled += 1
    return filled, len(missing) - filled


def _load_history(origin: str) -> dict | None:
    path = HISTORY_DIR / f"{origin}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_history(origin: str, hist: dict) -> None:
    path = HISTORY_DIR / f"{origin}.json"
    path.write_text(json.dumps(hist, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="Persist filled ET₀ back to seed/weather_history/")
    ap.add_argument("--origins", nargs="*", default=list(ORIGINS),
                    help="Origins to process (default: all)")
    args = ap.parse_args()

    grand_filled = 0
    grand_missing = 0
    grand_failed: list[str] = []

    for origin in args.origins:
        hist = _load_history(origin)
        if hist is None:
            print(f"[et0-backfill] {origin}: no history file — skipping.")
            continue
        regions = hist.get("regions") or {}
        per_origin_filled = 0
        per_origin_missing = 0
        for reg_meta in ORIGINS[origin]:
            name = reg_meta["name"]
            reg_hist = regions.get(name)
            if not reg_hist:
                print(f"  {origin}/{name}: no history rows — skipping.")
                continue
            try:
                n_filled, n_still = process_region(reg_hist, reg_meta["lat"], reg_meta["lon"])
                if n_filled or n_still:
                    print(f"  {origin}/{name}: filled {n_filled}, "
                          f"still missing {n_still}", flush=True)
                else:
                    print(f"  {origin}/{name}: already complete.", flush=True)
                per_origin_filled  += n_filled
                per_origin_missing += n_still
            except Exception as e:  # noqa: BLE001
                print(f"  {origin}/{name}: FAILED {e}", file=sys.stderr, flush=True)
                grand_failed.append(f"{origin}/{name}")
            time.sleep(1)  # be gentle on the archive API
        # Checkpoint: write the whole origin's history at once so a timeout
        # kill preserves what we've already filled.
        if args.write and per_origin_filled:
            _write_history(origin, hist)
            print(f"  → checkpoint: wrote {origin}.json "
                  f"(+{per_origin_filled} ET₀ values)", flush=True)
        grand_filled  += per_origin_filled
        grand_missing += per_origin_missing

    print(f"\nSummary: filled={grand_filled} still_missing={grand_missing} "
          f"failed_regions={len(grand_failed)}")
    if grand_failed:
        print(f"Failed regions (re-dispatch to retry): {grand_failed}")
    if not args.write:
        print("(preview only — re-run with --write to persist)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
