#!/usr/bin/env python3
# backend/import_macro_cot.py
# One-time 52-week historical backfill for commodity_cot and commodity_prices.
#
# Usage:
#   cd backend
#   DATABASE_URL=postgresql://... python import_macro_cot.py

import os
import sys
from datetime import date, timedelta

import pandas as pd
import yfinance as yf

sys.path.insert(0, os.path.dirname(__file__))
from scraper.db import get_session
from scraper.db_macro import upsert_commodity_cot, upsert_commodity_price
from scraper.sources.macro_cot import (
    COMMODITY_SPECS,
    _CFTC_MARKET_COL, _CFTC_DATE_COL, _CFTC_MM_LONG, _CFTC_MM_SHORT,
    _CFTC_MM_SPREAD, _CFTC_OI,
    _ICE_MARKET_COL, _ICE_DATE_COL, _ICE_MM_LONG, _ICE_MM_SHORT,
    _ICE_MM_SPREAD, _ICE_OI,
    _download_cftc_df, _download_ice_df, _safe_int,
)
from models import CotWeekly

WEEKS_BACK = 52
CUTOFF = date.today() - timedelta(weeks=WEEKS_BACK)


def _all_cftc_rows(df: pd.DataFrame, sym: str, spec: dict) -> pd.DataFrame:
    filt = spec.get("cftc_filter")
    if not filt:
        return pd.DataFrame()
    mask = df[_CFTC_MARKET_COL].str.contains(filt, na=False, regex=False)
    rows = df[mask].copy()
    if rows.empty:
        print(f"WARNING: no CFTC rows for '{filt}' ({sym})", file=sys.stderr)
    return rows


def _all_ice_rows(df: pd.DataFrame, sym: str, spec: dict) -> pd.DataFrame:
    filt = spec.get("ice_filter")
    if not filt:
        return pd.DataFrame()
    mask = df[_ICE_MARKET_COL].str.contains(filt, na=False, regex=False)
    rows = df[mask].copy()
    if rows.empty:
        print(f"WARNING: no ICE rows for '{filt}' ({sym})", file=sys.stderr)
    return rows


def main():
    today = date.today()
    years = list({today.year - 1, today.year})

    print("Downloading CFTC files...")
    cftc_frames = []
    for yr in years:
        try:
            cftc_frames.append(_download_cftc_df(yr))
            print(f"  CFTC {yr}: OK")
        except Exception as e:
            print(f"  CFTC {yr}: SKIP ({e})")
    cftc_df = pd.concat(cftc_frames, ignore_index=True) if cftc_frames else pd.DataFrame()

    print("Downloading ICE files...")
    ice_frames = []
    for yr in years:
        try:
            ice_frames.append(_download_ice_df(yr))
            print(f"  ICE {yr}: OK")
        except Exception as e:
            print(f"  ICE {yr}: SKIP ({e})")
    ice_df = pd.concat(ice_frames, ignore_index=True) if ice_frames else pd.DataFrame()

    # Collect all (sym, date, fields) COT rows within the 52-week window
    cot_rows: list[tuple] = []

    for sym, spec in COMMODITY_SPECS.items():
        if spec.get("cftc_filter"):
            rows = _all_cftc_rows(cftc_df, sym, spec)
            if rows.empty:
                continue
            rows["_date_parsed"] = pd.to_datetime(rows[_CFTC_DATE_COL], format="%y%m%d", errors="coerce")
            rows = rows.dropna(subset=["_date_parsed"])
            rows = rows[rows["_date_parsed"].dt.date >= CUTOFF]
            for _, row in rows.iterrows():
                cot_rows.append((sym, row["_date_parsed"].date(), {
                    "mm_long":   _safe_int(row[_CFTC_MM_LONG]),
                    "mm_short":  _safe_int(row[_CFTC_MM_SHORT]),
                    "mm_spread": _safe_int(row[_CFTC_MM_SPREAD]),
                    "oi_total":  _safe_int(row[_CFTC_OI]),
                }))

        elif spec.get("ice_filter"):
            rows = _all_ice_rows(ice_df, sym, spec)
            if rows.empty:
                continue
            rows["_date_parsed"] = pd.to_datetime(rows[_ICE_DATE_COL], errors="coerce")
            rows = rows.dropna(subset=["_date_parsed"])
            rows = rows[rows["_date_parsed"].dt.date >= CUTOFF]
            for _, row in rows.iterrows():
                cot_rows.append((sym, row["_date_parsed"].date(), {
                    "mm_long":   _safe_int(row[_ICE_MM_LONG]),
                    "mm_short":  _safe_int(row[_ICE_MM_SHORT]),
                    "mm_spread": _safe_int(row.get(_ICE_MM_SPREAD, 0) or 0),
                    "oi_total":  _safe_int(row[_ICE_OI]),
                }))

    print(f"Collected {len(cot_rows)} COT rows across {WEEKS_BACK} weeks")

    # Batch-fetch yfinance prices — one download per ticker for the full date range
    yfinance_pairs = [
        (sym, dt) for sym, dt, _ in cot_rows
        if COMMODITY_SPECS[sym]["price_source"] == "yfinance"
    ]
    # Deduplicate by ticker, collect all dates
    ticker_dates: dict[str, set] = {}
    for sym, dt in yfinance_pairs:
        ticker = COMMODITY_SPECS[sym]["yfinance_ticker"]
        ticker_dates.setdefault(ticker, set()).add(dt)

    price_cache: dict[tuple, float] = {}
    print("Fetching yfinance prices...")
    for ticker, dates in ticker_dates.items():
        start = min(dates) - timedelta(days=7)
        end   = max(dates) + timedelta(days=1)
        try:
            hist = yf.download(ticker, start=start.isoformat(), end=end.isoformat(),
                               interval="1d", auto_adjust=True, progress=False)
            if hist.empty:
                print(f"  {ticker}: no data", file=sys.stderr)
                continue
            hist.index = pd.to_datetime(hist.index).date
            # Map all yfinance symbols that share this ticker
            for sym2, dt2 in yfinance_pairs:
                if COMMODITY_SPECS[sym2]["yfinance_ticker"] != ticker:
                    continue
                for offset in range(6):
                    check = dt2 - timedelta(days=offset)
                    if check in hist.index:
                        price_cache[(sym2, dt2)] = float(hist.loc[check, "Close"])
                        break
            print(f"  {ticker}: OK")
        except Exception as e:
            print(f"  {ticker}: ERROR {e}", file=sys.stderr)

    # Upsert all rows
    db = get_session()
    try:
        inserted_cot = 0
        for sym, report_date, fields in cot_rows:
            upsert_commodity_cot(db, sym, report_date, fields)
            inserted_cot += 1

        # Build {sym -> set of report_dates} from the COT rows we collected
        sym_dates: dict[str, set] = {}
        for sym, report_date, _ in cot_rows:
            sym_dates.setdefault(sym, set()).add(report_date)

        inserted_prices = 0
        processed_proxies: set = set()

        for sym, report_date, _ in cot_rows:
            spec = COMMODITY_SPECS[sym]
            src  = spec["price_source"]

            if src == "yfinance":
                price = price_cache.get((sym, report_date))
                if price is not None:
                    upsert_commodity_price(db, sym, report_date, price)
                    inserted_prices += 1

            elif src == "proxy":
                proxy_sym = spec["price_proxy"]
                # Find the proxy symbol's COT date nearest to our report_date
                proxy_dates = sym_dates.get(proxy_sym, set())
                proxy_date = min(proxy_dates, key=lambda d: abs((d - report_date).days)) if proxy_dates else report_date
                proxy_price = price_cache.get((proxy_sym, proxy_date))
                if proxy_price is not None:
                    converted = proxy_price * spec["proxy_to_usd_per_mt_factor"]
                    upsert_commodity_price(db, sym, report_date, converted)
                    inserted_prices += 1

            elif src == "cot_weekly":
                key = (sym, report_date)
                if key not in processed_proxies:
                    row = db.query(CotWeekly).filter_by(market="ldn", date=report_date).first()
                    if row and row.price_ldn:
                        upsert_commodity_price(db, sym, report_date, float(row.price_ldn))
                        inserted_prices += 1
                    processed_proxies.add(key)

        print(f"Done. {inserted_cot} COT rows upserted, {inserted_prices} prices upserted.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
