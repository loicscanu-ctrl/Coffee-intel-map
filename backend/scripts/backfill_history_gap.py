#!/usr/bin/env python3
"""backfill_history_gap.py — fill the 2025 gap between SPEI seed and live history.

The SPEI seed (build_spei_baselines.py) covers 1995-01-01 .. 2024-12-31.
The daily weather history (fetch_origin_weather.py) starts at 2026-01-01.
That leaves all of 2025 with no data on either side.

SPEI-3 with target 2026-02 needs a contiguous 3-month window: 2025-12,
2026-01, 2026-02. The seed has no 2025; the history has no 2025; merge
breaks contiguity at the seam and rolling_sum returns nothing. Result:
spei_1 emits (only needs target month) but spei_3 doesn't (needs 3
contiguous months including 2025-12).

Fix: pull the archive endpoint for the full 2025-01-01..2025-12-31 range
per region and inject the daily rows into history as new entries. SPEI
then has a contiguous chain from 1995 through the present.

Idempotent: only writes dates that don't already exist in history. Same
retry + per-origin checkpoint pattern as build_spei_baselines.py.

Sandbox blocks the archive host; runs in CI under
`.github/workflows/backfill-history-gap.yml`.

Usage:
    python backend/scripts/backfill_history_gap.py            # preview
    python backend/scripts/backfill_history_gap.py --write    # persist
    python backend/scripts/backfill_history_gap.py --write --start 2024-10-01
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
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelHistoryGapBackfill/1.0)"}
HISTORY_DIR = Path(__file__).resolve().parents[1] / "seed" / "weather_history"

# Defaults: fill the year-of-2025 gap between SPEI seed end (2024-12-31)
# and the daily history start (2026-01-01).
DEFAULT_START = "2025-01-01"
DEFAULT_END   = "2025-12-31"

# Retry posture. Long ranges (30Y) trip Open-Meteo's archive rate limiter
# after ~30 min of sustained calls — the server then returns 429 until the
# hourly window resets. The default short backoffs (5/15/30s) can't escape
# that window, so 429 specifically gets a much longer sleep that's likely
# to outlast the rate-limit interval. Plain ReadTimeouts use the original
# short ladder since they usually clear on the very next attempt.
CALL_TIMEOUT = 60
MAX_ATTEMPTS = 4
RETRY_SLEEP_S       = (5, 15, 30, 60)        # generic errors / timeouts
RETRY_SLEEP_S_429   = (60, 180, 300, 600)    # rate-limit (HTTP 429)


def _is_rate_limit(exc: Exception) -> bool:
    """True when the exception is an HTTPError carrying 429."""
    if isinstance(exc, requests.HTTPError):
        resp = getattr(exc, "response", None)
        return resp is not None and resp.status_code == 429
    return False


def fetch_daily_range(lat: float, lon: float,
                      start: str, end: str) -> dict[str, dict]:
    """Daily rain + tmean + et0 from archive for [start, end] → {date: {…}}.

    Returns rows with all three fields when each value is non-null; falls
    back to None for individual missing fields. essm is left out — the
    archive endpoint serves different soil layers from our forecast-side
    ESSM and SPEI doesn't need it anyway.
    """
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = requests.get(ARCHIVE_URL, headers=HEADERS, timeout=CALL_TIMEOUT, params={
                "latitude": lat, "longitude": lon,
                "start_date": start, "end_date": end,
                "daily": "precipitation_sum,temperature_2m_mean,et0_fao_evapotranspiration",
                "timezone": "auto",
            })
            r.raise_for_status()
            d = r.json()["daily"]
            out: dict[str, dict] = {}
            for day, pr, tm, et0 in zip(
                d["time"],
                d["precipitation_sum"],
                d["temperature_2m_mean"],
                d["et0_fao_evapotranspiration"],
            ):
                row: dict[str, float | None] = {
                    "rain":  r1(pr) if pr is not None else None,
                    "tmean": r1(tm) if tm is not None else None,
                    "essm":  None,
                    "et0":   r1(et0) if et0 is not None else None,
                }
                # Skip days where the API gave us nothing useful.
                if row["rain"] is None and row["tmean"] is None and row["et0"] is None:
                    continue
                out[day] = row
            return out
        except requests.RequestException as e:
            last_err = e
            if attempt < MAX_ATTEMPTS - 1:
                ladder = RETRY_SLEEP_S_429 if _is_rate_limit(e) else RETRY_SLEEP_S
                sleep = ladder[attempt]
                tag = "RATE_LIMIT" if _is_rate_limit(e) else type(e).__name__
                print(f"    retry {attempt + 1}/{MAX_ATTEMPTS - 1} in {sleep}s "
                      f"({tag})", file=sys.stderr, flush=True)
                time.sleep(sleep)
    raise last_err if last_err else RuntimeError("fetch_daily_range: no error captured")


def process_region(reg_hist: dict, lat: float, lon: float,
                   start: str, end: str) -> tuple[int, int]:
    """Fill new dates in [start, end] that don't already exist in reg_hist.

    Returns (n_added, n_skipped_existing).
    """
    new_rows = fetch_daily_range(lat, lon, start, end)
    added = 0
    skipped = 0
    for date, row in new_rows.items():
        if date in reg_hist:
            skipped += 1
            continue
        reg_hist[date] = row
        added += 1
    return added, skipped


def _load_history(origin: str) -> dict | None:
    path = HISTORY_DIR / f"{origin}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_history(origin: str, hist: dict) -> None:
    path = HISTORY_DIR / f"{origin}.json"
    # Sort the per-region date dicts so the diff is reviewable.
    regions = hist.get("regions") or {}
    for name, rh in regions.items():
        regions[name] = dict(sorted(rh.items()))
    path.write_text(json.dumps(hist, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="Persist filled rows back to seed/weather_history/")
    ap.add_argument("--origins", nargs="*", default=list(ORIGINS))
    ap.add_argument("--regions", nargs="*", default=None,
                    help="Region names to process (e.g. 'Sul de Minas' Sidama). "
                         "When set, only these regions are fetched — used for "
                         "surgical recovery after a partial-failure run so we "
                         "don't burn API calls on already-completed regions.")
    ap.add_argument("--throttle-s", type=float, default=1.0,
                    help="Sleep between region requests (default 1.0s). Bump "
                         "to 3-5s when re-running after a 429 to stay clear "
                         "of Open-Meteo's hourly archive-endpoint rate limit.")
    ap.add_argument("--start", default=DEFAULT_START,
                    help=f"YYYY-MM-DD inclusive (default {DEFAULT_START})")
    ap.add_argument("--end",   default=DEFAULT_END,
                    help=f"YYYY-MM-DD inclusive (default {DEFAULT_END})")
    args = ap.parse_args()

    # Validate dates parse before burning network calls.
    try:
        dt.date.fromisoformat(args.start)
        dt.date.fromisoformat(args.end)
    except ValueError as e:
        print(f"[history-gap] bad date: {e}", file=sys.stderr)
        return 2

    print(f"[history-gap] filling {args.start}..{args.end} into "
          f"{len(args.origins)} origins")

    grand_added = 0
    grand_skipped = 0
    grand_failed: list[str] = []

    for origin in args.origins:
        hist = _load_history(origin)
        if hist is None:
            print(f"  {origin}: no history file — skipping.")
            continue
        regions = hist.setdefault("regions", {})
        per_origin_added = 0
        for reg_meta in ORIGINS[origin]:
            name = reg_meta["name"]
            if args.regions and name not in args.regions:
                continue  # Surgical-recovery mode: skip un-listed regions.
            reg_hist = regions.setdefault(name, {})
            try:
                added, skipped = process_region(reg_hist, reg_meta["lat"],
                                                reg_meta["lon"], args.start, args.end)
                print(f"  {origin}/{name}: added {added}, "
                      f"skipped {skipped} (already present)", flush=True)
                per_origin_added += added
                grand_added += added
                grand_skipped += skipped
            except Exception as e:  # noqa: BLE001
                print(f"  {origin}/{name}: FAILED {e}", file=sys.stderr, flush=True)
                grand_failed.append(f"{origin}/{name}")
            time.sleep(args.throttle_s)
        if args.write and per_origin_added:
            _write_history(origin, hist)
            print(f"  → checkpoint: wrote {origin}.json "
                  f"(+{per_origin_added} rows)", flush=True)

    print(f"\nSummary: added={grand_added} skipped_existing={grand_skipped} "
          f"failed_regions={len(grand_failed)}")
    if grand_failed:
        print(f"Failed regions (re-dispatch to retry): {grand_failed}")
    if not args.write:
        print("(preview only — re-run with --write to persist)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
