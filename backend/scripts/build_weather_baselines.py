#!/usr/bin/env python3
"""
build_weather_baselines.py — fetch 25-year monthly weather baselines from
Open-Meteo's free historical archive and write `backend/seed/weather_baselines.json`.

The output feeds `seasonal_z_score(region, month, current_value)` in
backend/scraper/sources/_weather_baseline.py, which the per-country
weather scrapers use to filter "naturally dry season" out of HIGH drought
flags. Without this baseline, regions naturally dry in their winter
(e.g. Brazilian Cerrado in July, Ethiopian highlands in Bega) light up as
drought every year.

Data source: archive-api.open-meteo.com — ERA5 reanalysis, free, no auth,
covers 1940-present. We pull 1995-01-01 to 2020-12-31 (26 years) which
gives the per-month sample n=26 — enough for a reliable mean/std without
including the climate-change-tilted last 5 years.

Output schema: see backend/seed/weather_baselines.json _schema block.

Run:
    python backend/scripts/build_weather_baselines.py            # preview
    python backend/scripts/build_weather_baselines.py --write    # write seed JSON

Rate-limit: Open-Meteo archive allows ~10k requests/day. This script makes
~5-10 requests total (one per region key); well under the limit.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

REPO_ROOT     = Path(__file__).resolve().parents[2]
BASELINE_PATH = REPO_ROOT / "backend" / "seed" / "weather_baselines.json"
ARCHIVE_URL   = "https://archive-api.open-meteo.com/v1/archive"

# ── Per-country representative points ─────────────────────────────────────────
# One coffee-belt point per country for v1. Sub-region split (each region in
# the country's *_weather.py) is a future enhancement — start with country-
# level to validate the seasonal filter before scaling out.
REGIONS: dict[str, dict] = {
    "colombia": {
        "label": "Colombia (Huila representative)",
        "lat":  2.53, "lon": -75.53,
    },
    "honduras": {
        "label": "Honduras (Copán representative)",
        "lat": 14.84, "lon": -89.15,
    },
    "ethiopia": {
        "label": "Ethiopia (Sidama/Yirgacheffe representative)",
        "lat":  6.27, "lon":  38.23,
    },
    "uganda": {
        "label": "Uganda (Mt Elgon representative)",
        "lat":  1.13, "lon":  34.60,
    },
    "indonesia": {
        "label": "Indonesia (Lampung representative)",
        "lat": -5.45, "lon": 105.26,
    },
    "brazil": {
        "label": "Brazil (Cerrado / Patrocínio representative)",
        "lat": -18.95, "lon": -46.99,
    },
    "vietnam": {
        "label": "Vietnam (Buôn Ma Thuột representative)",
        "lat": 12.67, "lon": 108.04,
    },
}

START_DATE = "1995-01-01"
END_DATE   = "2020-12-31"


def fetch_daily(lat: float, lon: float) -> dict:
    """Pull daily precip + 2m temp mean for the full baseline window."""
    params = {
        "latitude":   lat,
        "longitude":  lon,
        "start_date": START_DATE,
        "end_date":   END_DATE,
        "daily":      "precipitation_sum,temperature_2m_mean",
        "timezone":   "UTC",
    }
    r = requests.get(ARCHIVE_URL, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def percentile(sorted_vals: list[float], p: float) -> float:
    """Linear-interpolated percentile (matches numpy's default)."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    frac = k - lo
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac


def aggregate(daily: dict) -> dict:
    """Reduce daily series to per-calendar-month {mean, std, p10, p90}.

    For precip: sum within each (year, month), then mean/std across years.
    For temp:   mean within each (year, month), then mean/std across years.
    """
    times    = daily["daily"]["time"]
    precips  = daily["daily"]["precipitation_sum"]
    temps    = daily["daily"]["temperature_2m_mean"]

    # Bucket into (year, month) → totals/means.
    monthly_precip: dict[tuple[int, int], float]      = defaultdict(float)
    monthly_temp_sum: dict[tuple[int, int], float]    = defaultdict(float)
    monthly_temp_cnt: dict[tuple[int, int], int]      = defaultdict(int)

    for t, p, c in zip(times, precips, temps):
        y, m = int(t[:4]), int(t[5:7])
        if p is not None:
            monthly_precip[(y, m)] += p
        if c is not None:
            monthly_temp_sum[(y, m)] += c
            monthly_temp_cnt[(y, m)] += 1

    # Group by calendar month and compute statistics.
    precip_by_month: dict[int, list[float]] = defaultdict(list)
    temp_by_month:   dict[int, list[float]] = defaultdict(list)

    for (y, m), total in monthly_precip.items():
        precip_by_month[m].append(total)
    for (y, m), s in monthly_temp_sum.items():
        cnt = monthly_temp_cnt[(y, m)]
        if cnt:
            temp_by_month[m].append(s / cnt)

    precip_stats: dict[str, dict] = {}
    temp_stats:   dict[str, dict] = {}
    for m in range(1, 13):
        ps = sorted(precip_by_month.get(m, []))
        ts = sorted(temp_by_month.get(m, []))
        if ps:
            precip_stats[str(m)] = {
                "mean": round(statistics.fmean(ps), 2),
                "std":  round(statistics.pstdev(ps) if len(ps) > 1 else 0.0, 2),
                "p10":  round(percentile(ps, 0.10), 2),
                "p90":  round(percentile(ps, 0.90), 2),
                "n":    len(ps),
            }
        if ts:
            temp_stats[str(m)] = {
                "mean": round(statistics.fmean(ts), 2),
                "std":  round(statistics.pstdev(ts) if len(ts) > 1 else 0.0, 2),
                "n":    len(ts),
            }
    return {"precip_mm_monthly": precip_stats, "temp_c_monthly": temp_stats}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="Overwrite backend/seed/weather_baselines.json. Default is preview-only.")
    ap.add_argument("--regions", nargs="*",
                    help="Subset of region keys to fetch. Default: all.")
    args = ap.parse_args()

    selected = args.regions or list(REGIONS.keys())
    print(f"[build_weather_baselines] fetching {len(selected)} regions from Open-Meteo")
    print(f"  window: {START_DATE} → {END_DATE}")

    regions_out: dict[str, dict] = {}
    for key in selected:
        if key not in REGIONS:
            print(f"  [skip] unknown region key: {key}", file=sys.stderr)
            continue
        cfg = REGIONS[key]
        print(f"  [fetch] {key} ({cfg['lat']:.2f}, {cfg['lon']:.2f}) …", flush=True)
        try:
            daily = fetch_daily(cfg["lat"], cfg["lon"])
        except Exception as e:
            print(f"  [fail] {key}: {e}", file=sys.stderr)
            continue
        stats = aggregate(daily)
        regions_out[key] = {
            "_meta": cfg["label"],
            "lat":   cfg["lat"],
            "lng":   cfg["lon"],
            **stats,
        }
        time.sleep(1)  # gentle rate-limit even though we're well under the cap

    # Preserve the _schema block from the existing seed file.
    existing = json.loads(BASELINE_PATH.read_text(encoding="utf-8")) if BASELINE_PATH.exists() else {}
    schema   = existing.get("_schema", {})
    schema["status"] = (
        f"populated — built {len(regions_out)} regions from Open-Meteo archive "
        f"({START_DATE} to {END_DATE})"
    )
    doc = {"_schema": schema, "regions": regions_out}

    payload = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    print(f"[build_weather_baselines] aggregated {len(regions_out)} regions")
    if args.write:
        BASELINE_PATH.write_text(payload, encoding="utf-8")
        print(f"[build_weather_baselines] wrote {BASELINE_PATH}")
    else:
        # Preview the first 1500 chars; full file is large.
        print(payload[:1500] + ("\n...(truncated; pass --write to commit)" if len(payload) > 1500 else ""))


if __name__ == "__main__":
    main()
