#!/usr/bin/env python3
"""
backfill_weather_history.py — one-shot historical backfill of
backend/seed/weather_history/{origin}.json from Open-Meteo's ARCHIVE API.

Why this exists
---------------
The daily pipeline (fetch_origin_weather.py) pulls Open-Meteo's *forecast* API,
which only exposes ~92 past days, and appends them to weather_history (append-
only, never deletes). So once accumulation starts, no data is ever lost — but
any calendar days BEFORE accumulation began (e.g. Jan/early-Feb 2026, since the
accumulation only started ~late-Feb 2026) were never captured and the forecast
window can no longer reach them.

The ARCHIVE host (archive-api.open-meteo.com) has the full daily record, so this
script fetches the gap range once and fills the missing days. It is:
  • idempotent — only writes dates NOT already in history; never overwrites an
    accumulated day, so re-running is safe.
  • additive — leaves the climatology bands and everything else untouched; the
    chart rebuild (fetch_origin_weather.py) then surfaces the now-complete months.

NOTE: the archive host is not always reachable from CI (the daily fetcher uses
the forecast host for that reason). This is a manual one-shot — run it via the
"Backfill weather history" workflow_dispatch; if the archive host times out it
fails cleanly without writing.

Usage:
    python backfill_weather_history.py [--write] [--origins vn brazil ...] \
        [--start 2026-01-01] [--end 2026-02-19]
Defaults: all origins; start = Jan 1 of the current year; end = today − 6 days
(the archive lags ~5 days).
"""
from __future__ import annotations

import argparse
import datetime as dt
import socket
import sys
import time
from pathlib import Path

import requests
import urllib3.util.connection as urllib3_conn

# Force IPv4 — CI runners often lack an IPv6 route to Open-Meteo.
urllib3_conn.allowed_gai_family = lambda: socket.AF_INET

# Reuse the daily fetcher's region coords (incl. "vn") + history helpers so the
# two stay in lockstep (same region names, same on-disk format).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_origin_weather import (  # noqa: E402
    ORIGINS, HEADERS, load_history, save_history, r1,
)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
TODAY = dt.date.today()


def fetch_archive(lat: float, lon: float, start: str, end: str) -> dict:
    params = {
        "latitude": lat, "longitude": lon,
        "start_date": start, "end_date": end,
        "daily": "precipitation_sum,temperature_2m_mean,temperature_2m_max,temperature_2m_min",
        "timezone": "UTC",
    }
    last: Exception | None = None
    for attempt in range(4):
        try:
            resp = requests.get(ARCHIVE_URL, params=params, headers=HEADERS, timeout=(10, 60))
            resp.raise_for_status()
            return resp.json()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"archive fetch failed after retries: {last}")


def preflight() -> None:
    """Fail fast (and loudly) if the archive host isn't reachable from here."""
    try:
        fetch_archive(0.0, 0.0, "2020-01-01", "2020-01-02")
        print("[preflight] archive-api.open-meteo.com reachable.", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[preflight] FATAL — archive host unreachable: {e}\n"
              "The archive API is often blocked from CI; this backfill cannot run here.",
              file=sys.stderr)
        sys.exit(2)


def backfill(origin: str, start: str, end: str, write: bool) -> int:
    regions = ORIGINS[origin]
    hist = load_history(origin)
    added = 0
    for rc in regions:
        try:
            d = fetch_archive(rc["lat"], rc["lon"], start, end)["daily"]
        except Exception as e:  # noqa: BLE001 — a flaky region must not abort the origin
            print(f"  [{origin}] {rc['name']}: FETCH FAILED, skipping region: {e}", file=sys.stderr)
            continue
        times, pr = d["time"], d["precipitation_sum"]
        tm, tx, tn = d["temperature_2m_mean"], d["temperature_2m_max"], d["temperature_2m_min"]
        reg = hist["regions"].setdefault(rc["name"], {})
        for i, date in enumerate(times):
            arch_rain = r1(pr[i]) if pr[i] is not None else 0.0
            # Some archive grid cells return a null mean but have max/min — fall
            # back to (max+min)/2 so the temp series doesn't gap (e.g. Jimma, Copán).
            mean = tm[i]
            if mean is None and tx[i] is not None and tn[i] is not None:
                mean = (tx[i] + tn[i]) / 2
            arch_tmean = round(mean, 1) if mean is not None else None
            prev = reg.get(date)
            if prev is None:
                reg[date] = {"rain": arch_rain, "tmean": arch_tmean}
                added += 1
            else:
                # Fill only MISSING fields — never overwrite an accumulated value.
                # The forecast API leaves tmean=null on older past-days; the
                # archive has it, so this recovers those temps too.
                if prev.get("rain") is None and arch_rain is not None:
                    prev["rain"] = arch_rain
                    added += 1
                if prev.get("tmean") is None and arch_tmean is not None:
                    prev["tmean"] = arch_tmean
                    added += 1
        print(f"  [{origin}] {rc['name']}: {len(times)} archive days", flush=True)
        time.sleep(1)  # spacing under Open-Meteo's burst limit
    if write:
        save_history(origin, hist)
    return added


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Persist; default is a dry run.")
    ap.add_argument("--origins", nargs="*", help="Subset of origin keys. Default: all.")
    ap.add_argument("--start", default=f"{TODAY.year}-01-01", help="Inclusive start (YYYY-MM-DD).")
    ap.add_argument("--end", default=(TODAY - dt.timedelta(days=6)).isoformat(),
                    help="Inclusive end (YYYY-MM-DD); archive lags ~5 days.")
    args = ap.parse_args()

    selected = args.origins or list(ORIGINS.keys())
    print(f"[backfill_weather_history] {len(selected)} origins · {args.start}→{args.end} "
          f"· write={args.write}")
    preflight()

    total = 0
    for origin in selected:
        if origin not in ORIGINS:
            print(f"  [skip] unknown origin: {origin}", file=sys.stderr)
            continue
        try:
            added = backfill(origin, args.start, args.end, args.write)
            total += added
            print(f"  [{origin}] filled {added} missing region-days "
                  f"({'written' if args.write else 'dry-run'})")
        except Exception as e:  # noqa: BLE001
            print(f"  [fail] {origin}: {e}", file=sys.stderr)
    print(f"[backfill_weather_history] done — {total} region-days filled.")


if __name__ == "__main__":
    main()
