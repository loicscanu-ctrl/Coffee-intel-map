#!/usr/bin/env python3
"""audit_cftc_markets.py — what does the COT universe report that we don't track?

Downloads the current CFTC disaggregated futures file and the ICE Europe COT
file (the exact same sources the macro scraper uses), lists every distinct
market with its latest report date / OI / MM positions, and marks whether it is
already covered by COMMODITY_SPECS. Untracked markets are sorted by OI so the
biggest coverage gaps float to the top.

Run in CI via the "Audit CFTC markets" workflow (cftc.gov blocks most
non-runner egress) or locally:  python -m scripts.audit_cftc_markets
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from scraper.sources.macro_cot import (  # noqa: E402
    _CFTC_DATE_COL,
    _CFTC_MARKET_COL,
    _CFTC_MM_LONG,
    _CFTC_MM_SHORT,
    _CFTC_OI,
    COMMODITY_SPECS,
    _download_cftc_df,
    _download_ice_df,
    _match_market_rows,
)


def _tracked_names(df: pd.DataFrame, market_col: str, filter_key: str) -> set[str]:
    """Exact market names our specs' filters resolve to in this file."""
    names: set[str] = set()
    for spec in COMMODITY_SPECS.values():
        filt = spec.get(filter_key)
        if not filt:
            continue
        rows = _match_market_rows(df, market_col, filt)
        names.update(rows[market_col].astype(str).str.strip().unique())
    return names


def _summarize(df: pd.DataFrame, market_col: str, source: str, filter_key: str) -> None:
    df = df.copy()
    df["_name"] = df[market_col].astype(str).str.strip()
    df["_date"] = pd.to_datetime(df[_CFTC_DATE_COL], format="%y%m%d", errors="coerce")
    df = df.dropna(subset=["_date"])
    tracked = _tracked_names(df, market_col, filter_key)

    latest = (
        df.sort_values("_date")
          .groupby("_name")
          .tail(1)[["_name", "_date", _CFTC_OI, _CFTC_MM_LONG, _CFTC_MM_SHORT]]
    )
    latest = latest.sort_values(_CFTC_OI, ascending=False)

    print(f"\n{'=' * 100}\n{source}: {latest.shape[0]} distinct markets "
          f"({len(tracked)} matched by our specs)\n{'=' * 100}")
    for flag, label in ((False, "UNTRACKED"), (True, "tracked")):
        print(f"\n-- {label} --")
        for _, r in latest.iterrows():
            if (r["_name"] in tracked) is not flag:
                continue
            print(f"  {r['_name']:<70} | {r['_date'].date()} | "
                  f"OI={int(r[_CFTC_OI]):>9,} | MM L/S={int(r[_CFTC_MM_LONG]):>7,}/{int(r[_CFTC_MM_SHORT]):>7,}")


def main() -> int:
    from datetime import date
    year = date.today().year
    _summarize(_download_cftc_df(year), _CFTC_MARKET_COL, f"CFTC disaggregated {year}", "cftc_filter")
    _summarize(_download_ice_df(year), _CFTC_MARKET_COL, f"ICE Europe COT {year}", "ice_filter")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
