#!/usr/bin/env python3
"""build_spi_baselines.py — build the 30-yr monthly-precip baseline the SPI
calculator needs.

Open-Meteo's *archive* API (archive-api.open-meteo.com) holds the 30-yr history.
It's blocked from the Claude Code sandbox (403 — not on its egress allowlist) but
reachable from GitHub's runners, so this runs as a one-shot CI job
(.github/workflows/build-spi-baselines.yml, workflow_dispatch) — NOT locally. It
writes backend/seed/spi_30yr_baselines.json, which is committed; CI then computes
SPI from that static seed + the current month's rain (no archive call) — see
spi_calc.py + fetch_origin_weather.py.

    python backend/scripts/build_spi_baselines.py            # preview
    python backend/scripts/build_spi_baselines.py --write    # write/merge the seed

Builds onto any existing seed, so a partial `--origins` run preserves the others.
Coordinates come from fetch_origin_weather.ORIGINS so the SPI baseline regions
stay in lock-step with the live weather fetcher.
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
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelSPIBaseline/1.0)"}
START, END = "1995-01-01", "2024-12-31"   # 30 years
SEED_PATH = Path(__file__).resolve().parents[1] / "seed" / "spi_30yr_baselines.json"


def fetch_monthly(lat: float, lon: float) -> dict[str, float]:
    """Daily archive precip → {'YYYY-MM': monthly total mm}."""
    r = requests.get(ARCHIVE_URL, headers=HEADERS, timeout=120, params={
        "latitude": lat, "longitude": lon,
        "start_date": START, "end_date": END,
        "daily": "precipitation_sum", "timezone": "auto",
    })
    r.raise_for_status()
    d = r.json()["daily"]
    monthly: dict[str, float] = defaultdict(float)
    for day, mm in zip(d["time"], d["precipitation_sum"]):
        if mm is not None:
            monthly[day[:7]] += mm
    return {k: round(v, 1) for k, v in sorted(monthly.items())}


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

    out: dict[str, dict[str, dict[str, float]]] = _load_existing()
    for origin in args.origins:
        regions: dict[str, dict[str, float]] = {}
        for reg in ORIGINS[origin]:
            try:
                monthly = fetch_monthly(reg["lat"], reg["lon"])
                regions[reg["name"]] = monthly
                print(f"  {origin}/{reg['name']}: {len(monthly)} months "
                      f"({min(monthly)}..{max(monthly)})", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"  {origin}/{reg['name']}: FAILED {e}", file=sys.stderr)
            time.sleep(1)  # be gentle on the free archive API
        if regions:
            out[origin] = regions   # merge/replace just this origin

    payload = {
        "_schema": "origins[origin][region] = {'YYYY-MM': monthly precip mm}, "
                   f"{START[:4]}–{END[:4]} ERA5 archive. SPI calibration baseline.",
        "origins": out,
    }
    if args.write:
        SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
        SEED_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {SEED_PATH} ({len(out)} origins)")
    else:
        print(f"(preview only — re-run with --write to save to {SEED_PATH})")


if __name__ == "__main__":
    main()
