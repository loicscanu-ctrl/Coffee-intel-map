#!/usr/bin/env python3
"""build_spei_baselines.py — build the 30-yr monthly P + ET₀ baseline the
SPEI calculator needs.

Same architecture as `build_spi_baselines.py`: a one-shot CI job that hits
`archive-api.open-meteo.com` (blocked from the Claude Code sandbox but
reachable from GitHub's runners) and writes a static seed. The seed is
committed; the daily fetcher (`fetch_origin_weather.py`) then computes SPEI
locally from that seed + the current month's P/ET₀ — no archive call at
runtime.

The shape stores **raw monthly P and ET₀** (not pre-computed D = P − ET₀)
so that:
  - We can re-derive D if the formula evolves (e.g. swap Penman-Monteith
    for Hargreaves on a fallback path).
  - We keep both inputs available for debugging / sanity-checking.

    python backend/scripts/build_spei_baselines.py            # preview
    python backend/scripts/build_spei_baselines.py --write    # write/merge the seed

Builds onto any existing seed, so a partial `--origins` run preserves the
others. Coordinates come from `fetch_origin_weather.ORIGINS` (same source
of truth the SPI builder uses).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_origin_weather import ORIGINS  # noqa: E402

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelSPEIBaseline/1.0)"}
START, END = "1995-01-01", "2024-12-31"   # 30 years — matches SPI window
SEED_PATH = Path(__file__).resolve().parents[1] / "seed" / "spei_30yr_baselines.json"


def fetch_monthly(lat: float, lon: float) -> dict[str, dict[str, float]]:
    """Daily archive (precip + Penman-Monteith ET₀) → {'YYYY-MM': {'p': mm, 'et0': mm}}.

    Open-Meteo's archive serves `et0_fao_evapotranspiration` as a daily
    variable; we just sum it the same way as precip. Months where either
    variable lacks any days remain in the output but with the missing side
    as 0.0 — the SPEI calculator filters those out in `monthly_d()`.
    """
    r = requests.get(ARCHIVE_URL, headers=HEADERS, timeout=180, params={
        "latitude": lat, "longitude": lon,
        "start_date": START, "end_date": END,
        "daily": "precipitation_sum,et0_fao_evapotranspiration",
        "timezone": "auto",
    })
    r.raise_for_status()
    d = r.json()["daily"]
    p_acc:   dict[str, float] = defaultdict(float)
    et0_acc: dict[str, float] = defaultdict(float)
    for day, pr, et0 in zip(d["time"], d["precipitation_sum"], d["et0_fao_evapotranspiration"]):
        ym = day[:7]
        if pr is not None:
            p_acc[ym]   += pr
        if et0 is not None:
            et0_acc[ym] += et0
    out: dict[str, dict[str, float]] = {}
    for ym in sorted(set(p_acc) | set(et0_acc)):
        out[ym] = {"p": round(p_acc[ym], 1), "et0": round(et0_acc[ym], 1)}
    return out


def _load_existing() -> dict:
    """Existing seed's origins map (so a partial rebuild merges, not replaces)."""
    if SEED_PATH.exists():
        try:
            return json.loads(SEED_PATH.read_text(encoding="utf-8")).get("origins", {})
        except Exception:  # noqa: BLE001
            pass
    return {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--origins", nargs="*", default=list(ORIGINS))
    args = ap.parse_args()

    out: dict[str, dict[str, dict[str, dict[str, float]]]] = _load_existing()
    for origin in args.origins:
        regions: dict[str, dict[str, dict[str, float]]] = {}
        for reg in ORIGINS[origin]:
            try:
                monthly = fetch_monthly(reg["lat"], reg["lon"])
                regions[reg["name"]] = monthly
                if monthly:
                    ks = sorted(monthly)
                    print(f"  {origin}/{reg['name']}: {len(monthly)} months "
                          f"({ks[0]}..{ks[-1]})", flush=True)
                else:
                    print(f"  {origin}/{reg['name']}: empty", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"  {origin}/{reg['name']}: FAILED {e}", file=sys.stderr)
            time.sleep(1)  # be gentle on the free archive API
        if regions:
            out[origin] = regions   # merge/replace just this origin

    payload = {
        "_schema": "origins[origin][region] = {'YYYY-MM': {'p': monthly precip mm, "
                   "'et0': monthly Penman-Monteith ET₀ mm}}, "
                   f"{START[:4]}–{END[:4]} ERA5 archive. SPEI calibration baseline.",
        "origins": out,
    }
    if args.write:
        SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
        SEED_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
        print(f"Wrote {SEED_PATH} ({len(out)} origins)")
    else:
        print(f"(preview only — re-run with --write to save to {SEED_PATH})")


if __name__ == "__main__":
    main()
