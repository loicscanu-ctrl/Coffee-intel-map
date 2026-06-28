"""
backfill_enso_thermocline.py
One-time (or occasional) deep seed of the per-buoy 150 m-band temperature
archive that the daily `scraper.sources.enso_thermocline` fetcher then tops
up incrementally.

Why a separate backfill
=======================
The daily run pulls only a small recent window (RECENT_FETCH_DAYS) and merges
it into data/enso_thermocline_archive.json — it never re-pulls deep history.
This script establishes that history: it walks ERDDAP YEAR BY YEAR (each chunk
small enough to clear the Cloudflare Worker's 30 s wall), merges every chunk
into the same archive, then derives the public snapshot from the result.

Same proxy + dataset-candidate machinery as the daily fetcher — this just
drives it over a multi-year span in bounded chunks.

ENV VARS (same as the daily fetcher)
------------------------------------
  ERDDAP_PROXY_BASE    — required, e.g. "https://noaa-proxy.acct.workers.dev"
  ERDDAP_PROXY_SECRET  — required, matches PROXY_SECRET on the Worker

Usage
-----
    cd backend
    export ERDDAP_PROXY_BASE=...  ERDDAP_PROXY_SECRET=...
    python -m scraper.backfill_enso_thermocline --years 15            # preview
    python -m scraper.backfill_enso_thermocline --years 15 --write    # seed archive + snapshot

Exit codes:
    0 — seeded at least one year's data
    1 — every year-chunk failed (upstream down) and nothing was seeded
    2 — proxy not configured / secret mismatch
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, datetime

from scraper.sources import enso_thermocline as therm

logger = logging.getLogger(__name__)

DEFAULT_YEARS = 15


def run(*, years: int, write: bool, diag: bool = False) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger.info(f"[therm-backfill] seeding {years}y of TAO/TRITON 150m history via CF proxy → ERDDAP")

    proxy_base, secret = therm._proxy_env()
    if not proxy_base or not secret:
        logger.error(
            "[therm-backfill] FATAL: ERDDAP proxy not configured. "
            "Set ERDDAP_PROXY_BASE and ERDDAP_PROXY_SECRET. See cf-worker/README.md"
        )
        return 2

    archive = therm._load_archive()

    this_year = datetime.now(UTC).year
    start_year = this_year - years
    total_cells = 0
    ok_years = 0
    for yr in range(start_year, this_year + 1):
        start = f"{yr}-01-01"
        # Inclusive upper bound; the current year runs to today (end_date=None).
        end = f"{yr}-12-31" if yr < this_year else None
        obs, _dataset, status = therm._fetch_raw_obs(
            proxy_base, secret, start, end, diag=diag,
        )
        if status == 401:
            logger.error("[therm-backfill] FATAL: secret mismatch — aborting.")
            return 2
        if status != 200 or not obs:
            logger.warning(f"[therm-backfill] {yr}: no data (status={status}) — skipping")
            continue
        daily = therm._obs_to_daily_means(obs)
        cells = therm._merge_into_archive(archive, daily)
        buoy_days = sum(len(v) for v in daily.values())
        logger.info(f"[therm-backfill] {yr}: {len(obs)} obs → {buoy_days} buoy-days ({cells} cells)")
        total_cells += cells
        ok_years += 1

    if ok_years == 0:
        logger.error("[therm-backfill] every year-chunk failed — nothing seeded.")
        return 1

    therm._trim_archive(archive)
    logger.info(
        f"[therm-backfill] merged {total_cells} cells across {ok_years} years; "
        f"archive spans {therm._archive_span(archive)}"
    )

    # Derive + report the snapshot so the operator sees the result immediately.
    analyses = therm._analyse_from_archive(archive)
    doc = therm.build_payload(analyses, "pmelTaoDyT")
    n_with_data = sum(1 for a in analyses if a.latest is not None)
    n_with_climo = sum(1 for a in analyses if a.window_min_c is not None)
    logger.info(
        f"[therm-backfill] derived snapshot: {n_with_data}/{len(therm.NDBC_BUOYS)} buoys "
        f"reporting, {n_with_climo} with a climatology range"
    )

    if write:
        therm._save_archive(archive)
        therm._persist(doc)
        logger.info(
            f"[therm-backfill] wrote archive {therm.ARCHIVE_PATH} + snapshot {therm.OUT_PATH}"
        )
    else:
        logger.info("[therm-backfill] preview only — pass --write to persist")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--years", type=int, default=DEFAULT_YEARS,
                    help=f"Years of history to seed (default {DEFAULT_YEARS}).")
    ap.add_argument("--write", action="store_true", help="Persist archive + snapshot.")
    ap.add_argument("--diag", action="store_true", help="Log each chunk's response head.")
    args = ap.parse_args()
    return run(years=args.years, write=args.write, diag=args.diag)


if __name__ == "__main__":
    sys.exit(main())
