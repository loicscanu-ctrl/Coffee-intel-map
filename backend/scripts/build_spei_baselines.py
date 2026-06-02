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
    python backend/scripts/build_spei_baselines.py --write --force   # refetch even seeded regions

Resilience: retries each archive call up to 3× with exponential backoff,
writes the seed after EACH origin (so a CI timeout preserves progress),
and skips already-seeded regions by default — a re-dispatch after partial
failure only refetches what's still missing.

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

# Per-call timeout deliberately shorter than the previous 180s: Open-Meteo's
# archive endpoint typically responds in <5s for our payload size. If it's
# silent for 60s the connection is dead; better to fail fast and let the
# retry loop catch it than burn the whole runner budget waiting.
CALL_TIMEOUT = 60
MAX_ATTEMPTS = 3
RETRY_SLEEP_S = (5, 15, 30)   # cumulative budget per region: ~50s of pure sleep


def fetch_monthly(lat: float, lon: float) -> dict[str, dict[str, float]]:
    """Daily archive (precip + Penman-Monteith ET₀) → {'YYYY-MM': {'p': mm, 'et0': mm}}.

    Open-Meteo's archive serves `et0_fao_evapotranspiration` as a daily
    variable; we just sum it the same way as precip. Months where either
    variable lacks any days remain in the output but with the missing side
    as 0.0 — the SPEI calculator filters those out in `monthly_d()`.

    Retries on RequestException with exponential backoff (most archive
    timeouts are transient — the previous 35-min run had ~30% first-call
    failure rate with zero retries).
    """
    last_err: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = requests.get(ARCHIVE_URL, headers=HEADERS, timeout=CALL_TIMEOUT, params={
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
        except requests.RequestException as e:
            last_err = e
            if attempt < MAX_ATTEMPTS - 1:
                sleep = RETRY_SLEEP_S[attempt]
                print(f"    retry {attempt + 1}/{MAX_ATTEMPTS - 1} in {sleep}s "
                      f"({type(e).__name__})", file=sys.stderr, flush=True)
                time.sleep(sleep)
    # All attempts exhausted — propagate the last error so the caller logs
    # the region as failed and moves on.
    raise last_err if last_err else RuntimeError("fetch_monthly: no error captured")


def _load_existing() -> dict:
    """Existing seed's origins map (so a partial rebuild merges, not replaces)."""
    if SEED_PATH.exists():
        try:
            return json.loads(SEED_PATH.read_text(encoding="utf-8")).get("origins", {})
        except Exception:  # noqa: BLE001
            pass
    return {}


def _write_seed(out: dict) -> None:
    """Write the seed file. Pulled out so we can checkpoint after each origin."""
    payload = {
        "_schema": "origins[origin][region] = {'YYYY-MM': {'p': monthly precip mm, "
                   "'et0': monthly Penman-Monteith ET₀ mm}}, "
                   f"{START[:4]}–{END[:4]} ERA5 archive. SPEI calibration baseline.",
        "origins": out,
    }
    SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEED_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")


def _region_complete(existing_region: dict | None) -> bool:
    """True when an existing region entry has the full 30y × 12mo = 360 months.
    Used by --skip-existing to fast-skip rather than refetch ~10s of data."""
    if not existing_region:
        return False
    # Some entries might exist but be incomplete from an earlier partial run;
    # the threshold of 350 lets us tolerate the rare month NOAA reports as
    # entirely null without forcing a refetch.
    return len(existing_region) >= 350


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--origins", nargs="*", default=list(ORIGINS))
    ap.add_argument("--force", action="store_true",
                    help="Refetch even regions that already have a complete seed entry.")
    args = ap.parse_args()

    out: dict[str, dict[str, dict[str, dict[str, float]]]] = _load_existing()
    skip_existing = not args.force
    n_skipped = 0
    n_fetched = 0
    n_failed = 0

    for origin in args.origins:
        existing_origin = out.setdefault(origin, {})
        for reg in ORIGINS[origin]:
            name = reg["name"]
            if skip_existing and _region_complete(existing_origin.get(name)):
                print(f"  {origin}/{name}: skip (already seeded with "
                      f"{len(existing_origin[name])} months)", flush=True)
                n_skipped += 1
                continue
            try:
                monthly = fetch_monthly(reg["lat"], reg["lon"])
                existing_origin[name] = monthly      # merge in-place (per-region)
                if monthly:
                    ks = sorted(monthly)
                    print(f"  {origin}/{name}: {len(monthly)} months "
                          f"({ks[0]}..{ks[-1]})", flush=True)
                else:
                    print(f"  {origin}/{name}: empty", flush=True)
                n_fetched += 1
            except Exception as e:  # noqa: BLE001
                print(f"  {origin}/{name}: FAILED {e}", file=sys.stderr, flush=True)
                n_failed += 1
            time.sleep(1)  # be gentle on the free archive API
        # Checkpoint after each origin — so a runner-timeout kill preserves
        # everything we've fetched so far rather than losing it all.
        if args.write:
            _write_seed(out)
            print(f"  → checkpoint: wrote {SEED_PATH.name} "
                  f"({sum(len(r) for r in out.values())} regions total)", flush=True)

    # Final summary so the workflow log makes it obvious which regions still
    # need a follow-up dispatch.
    print(f"\nSummary: fetched={n_fetched} skipped={n_skipped} failed={n_failed}")
    if n_failed:
        print("Failed regions can be filled by re-dispatching the workflow — "
              "skip-existing will preserve everything that succeeded.")
    if args.write:
        print(f"Wrote {SEED_PATH} ({len(out)} origins)")
    else:
        print(f"(preview only — re-run with --write to save to {SEED_PATH})")


if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
