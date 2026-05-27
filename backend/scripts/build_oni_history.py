#!/usr/bin/env python3
"""build_oni_history.py — build the long ONI history seed (1980→present).

The live farmer-economics scraper keeps only the last 18 months of ONI; the
historical-analog engine needs the full record. NOAA CPC's oni.ascii.txt holds
1950→present and is reachable from GitHub runners, so this runs as a monthly
one-shot CI job (.github/workflows/build-oni-history.yml) and commits
backend/seed/oni_history_full.json. The exporter then reads that static seed and
computes analogs (enso_analogs.find_analogs) — no live fetch at export time.

    python backend/scripts/build_oni_history.py            # preview
    python backend/scripts/build_oni_history.py --write     # write the seed
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))
from enso_analogs import parse_oni_series  # noqa: E402

NOAA_ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelONIHistory/1.0)"}
SINCE_YEAR = 1980
SEED_PATH = Path(__file__).resolve().parents[1] / "seed" / "oni_history_full.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    r = requests.get(NOAA_ONI_URL, headers=HEADERS, timeout=60)
    r.raise_for_status()
    series = parse_oni_series(r.text, since_year=SINCE_YEAR)
    if not series:
        print("ERROR: parsed zero ONI rows — aborting", file=sys.stderr)
        sys.exit(1)

    payload = {
        "_schema": "oni[] = {year, month, label, value}; NOAA CPC 3-mo running "
                   f"mean anchored to season centre month, {SINCE_YEAR}–present.",
        "source": NOAA_ONI_URL,
        "updated": date.today().isoformat(),
        "oni": series,
    }
    span = f"{series[0]['label']}..{series[-1]['label']}"
    print(f"Parsed {len(series)} ONI months ({span})")
    if args.write:
        SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
        SEED_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {SEED_PATH}")
    else:
        print(f"(preview only — re-run with --write to save to {SEED_PATH})")


if __name__ == "__main__":
    main()
