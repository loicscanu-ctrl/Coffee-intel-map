#!/usr/bin/env python3
"""fetch_vhi.py — weekly NOAA STAR Vegetation Health Index per origin.

Replaces an earlier NetCDF/bbox attempt (commits 0653aec + 0ba107e) that never
produced data — all 7 weather JSONs were shipping vhi_week=None, 0 provinces.
Switching to NOAA STAR's admin-1 text export endpoint:

    GET https://www.star.nesdis.noaa.gov/smcd/emb/vci/VH/get_TS_admin.php
        ?country=BRA&provinceID=13&year1=2023&year2=2026&type=Mean

Wins over the gridded approach:
  - No netCDF4 / numpy deps (smaller runner image, faster install).
  - NOAA's own admin-1 aggregation, not our pixel bbox approximation.
  - Plain text; pure parser fixture-tests in scraper.tests.test_vhi.

Pipeline:
  1. Load backend/seed/vhi_province_ids.json — {origin: {country_iso3,
     provinces: {region: {province_id, noaa_name}}}}. Regions with a null
     province_id are skipped with a warning; CI doesn't fail.
  2. For each origin × region: GET the endpoint, parse via scraper.vhi.
  3. Write frontend/public/data/vhi_{origin}.json — separate file from
     {origin}_weather.json so the daily weather rebuild can't wipe these
     weekly fields.

Usage:
    python backend/scripts/fetch_vhi.py [--write] [--origins brazil ...]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import socket
import sys
import time
from pathlib import Path

import requests
import urllib3.util.connection as urllib3_conn

# Force IPv4 — same defensive choice fetch_origin_weather.py makes.
urllib3_conn.allowed_gai_family = lambda: socket.AF_INET

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from scraper import vhi  # noqa: E402

DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"
SEED_PATH = REPO_ROOT / "backend" / "seed" / "vhi_province_ids.json"

# 3 years of trailing history keeps each response under ~6 KB and gives the
# frontend enough series to draw a seasonal context chart later.
YEAR_WINDOW = 3
N_RECENT = 12   # weeks shipped to the frontend chart


def _load_seed() -> dict:
    try:
        return json.loads(SEED_PATH.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[vhi] failed to load province seed: {e}", file=sys.stderr)
        sys.exit(2)


def fetch_origin(origin: str, origin_cfg: dict,
                 session: requests.Session,
                 year1: int, year2: int) -> dict:
    """Fetch every region in one origin. Returns the JSON-ready payload."""
    iso3 = origin_cfg["country_iso3"]
    provinces_in = origin_cfg.get("provinces") or {}
    provinces_out: dict[str, dict] = {}
    missing: list[str] = []
    errors: list[str] = []

    for region, meta in provinces_in.items():
        pid = (meta or {}).get("province_id")
        if not pid:
            missing.append(region)
            print(f"  [vhi] {origin}/{region}: no provinceID seeded — skipping.")
            continue
        try:
            parsed = vhi.fetch_vhi(iso3, pid, year1, year2, session=session)
            head = vhi.latest_and_recent(parsed["rows"], n_recent=N_RECENT)
            provinces_out[region] = {
                "province_id":     pid,
                "noaa_name":       (meta or {}).get("noaa_name") or parsed.get("province_name"),
                "weeks_in_window": len(parsed["rows"]),
                **head,
            }
            latest = head["vhi_latest"]
            print(f"  [vhi] {origin}/{region} pid={pid} weeks={len(parsed['rows'])} "
                  f"latest={latest['iso_week'] if latest else 'n/a'} "
                  f"vhi={latest['vhi'] if latest else 'n/a'} "
                  f"({latest['severity'] if latest else 'n/a'})")
            # Light rate-limit; NOAA's PHP backend is single-threaded per IP.
            time.sleep(0.4)
        except requests.RequestException as e:
            errors.append(f"{region}: {e}")
            print(f"  [vhi] {origin}/{region} ERROR: {e}", file=sys.stderr)

    return {
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "country_iso3": iso3,
        "year_window":  [year1, year2],
        "provinces":    provinces_out,
        "missing_province_ids": missing,
        "errors":       errors,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="Persist results to frontend/public/data/vhi_*.json")
    ap.add_argument("--origins", nargs="*", default=None,
                    help="Subset of origins to fetch (default: all in the seed)")
    args = ap.parse_args()

    seed = _load_seed()
    origins = {k: v for k, v in seed.items() if not k.startswith("_")}
    if args.origins:
        origins = {k: v for k, v in origins.items() if k in args.origins}
        if not origins:
            print(f"[vhi] no matching origins in seed: {args.origins}", file=sys.stderr)
            return 2

    today = dt.date.today()
    year2 = today.year
    year1 = year2 - YEAR_WINDOW

    print(f"[vhi] fetching {len(origins)} origins, years {year1}–{year2}")
    session = requests.Session()
    summary = []

    if args.write:
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    for origin, cfg in origins.items():
        payload = fetch_origin(origin, cfg, session, year1, year2)
        summary.append((origin, len(payload["provinces"]),
                        len(payload["missing_province_ids"]),
                        len(payload["errors"])))
        if args.write:
            out = DATA_DIR / f"vhi_{origin}.json"
            out.write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                           encoding="utf-8")
            print(f"  → wrote {out.name}")

    print("\n[vhi] summary  origin            ok   missing   err")
    for origin, ok, miss, err in summary:
        print(f"          {origin:<16} {ok:>3}     {miss:>3}     {err:>3}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
