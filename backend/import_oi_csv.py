"""
import_oi_csv.py
Imports OI history from a CSV with columns: date, contract, oi

Usage:
    python import_oi_csv.py <path_to_csv>

For each contract the script:
  1. Computes the FND using exchange rules
       KC (Arabica): 7 business days before first business day of delivery month
       RM (Robusta): 4 business days before first business day of delivery month
  2. Keeps only rows within the 30 trading days up to and including FND
  3. Groups contracts by (date, market) and inserts one NewsItem per group
     — same structure the daily scraper produces, compatible with /api/futures/oi-fnd-chart
"""

import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from sqlalchemy.orm import sessionmaker

from database import engine
from models import NewsItem

SessionLocal = sessionmaker(bind=engine)

# ── FND helpers ────────────────────────────────────────────────────────────────

LETTER_TO_MONTH = {
    "F":1,"G":2,"H":3,"J":4,"K":5,"M":6,
    "N":7,"Q":8,"U":9,"V":10,"X":11,"Z":12
}

def _first_business_day(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d

def _subtract_business_days(d: date, n: int) -> date:
    remaining = n
    while remaining > 0:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            remaining -= 1
    return d

def calc_fnd(symbol: str) -> date | None:
    m = re.match(r'^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$', symbol, re.I)
    if not m:
        return None
    product, letter, yr = m.group(1), m.group(2).upper(), int(m.group(3))
    month_num = LETTER_TO_MONTH.get(letter)
    if not month_num:
        return None
    days_before = 7 if product.upper() == "KC" else 4
    fbdm = _first_business_day(2000 + yr, month_num)
    return _subtract_business_days(fbdm, days_before)

def calc_window_start(fnd: date) -> date:
    """Return the date 30 trading days before FND (inclusive of that date)."""
    count = 0
    d = fnd
    while count < 30:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            count += 1
    return d

def market_for(sym: str) -> str:
    return "robusta" if sym.upper().startswith(("RM", "RC")) else "arabica"

def label_for(sym: str) -> str:
    return (
        "ICE London Robusta (RM)"
        if sym.upper().startswith(("RM", "RC"))
        else "ICE NY Arabica (KC)"
    )

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python import_oi_csv.py <path_to_csv>")
        sys.exit(1)

    csv_path = sys.argv[1]
    if not os.path.isfile(csv_path):
        print(f"File not found: {csv_path}")
        sys.exit(1)

    # ── 1. Read CSV → { date: { market: [ {symbol, oi} ] } } ─────────────────
    by_date_market: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sym = (row.get("contract") or row.get("symbol") or row.get("Symbol") or "").strip().upper()
            trade_date = (row.get("date") or row.get("Date") or "").strip()[:10]
            oi_raw = str(row.get("oi") or row.get("OI") or row.get("Open Interest") or "0").replace(",", "").strip()
            try:
                oi = int(float(oi_raw))
            except ValueError:
                continue
            if not sym or not trade_date or oi <= 0:
                continue
            by_date_market[trade_date][market_for(sym)].append({"symbol": sym, "oi": oi})

    # ── 2. Pre-compute FND + window start per symbol ──────────────────────────
    fnd_cache: dict[str, date | None] = {}
    ws_cache:  dict[str, date | None] = {}

    def get_fnd(sym: str) -> date | None:
        if sym not in fnd_cache:
            fnd_cache[sym] = calc_fnd(sym)
        return fnd_cache[sym]

    def get_ws(sym: str) -> date | None:
        if sym not in ws_cache:
            fnd = get_fnd(sym)
            ws_cache[sym] = calc_window_start(fnd) if fnd else None
        return ws_cache[sym]

    # Print the windows we found
    all_syms = sorted({c["symbol"] for contracts in by_date_market.values() for mkt in contracts.values() for c in mkt})
    print("\nContract windows:")
    for sym in all_syms:
        fnd = get_fnd(sym)
        ws  = get_ws(sym)
        if fnd:
            print(f"  {sym}: window {ws} to FND {fnd}")
        else:
            print(f"  {sym}: unrecognised symbol, skipped")
    print()

    # ── 3. Sort dates, track prev OI for Δ, insert ───────────────────────────
    prev_oi: dict[str, int] = {}  # symbol → last seen OI (for chg calc)
    db = SessionLocal()
    total_inserted = 0
    total_skipped  = 0

    for trade_date in sorted(by_date_market.keys()):
        td = date.fromisoformat(trade_date)

        for market, contracts in by_date_market[trade_date].items():
            # Filter to rows within each contract's 30-day window
            in_window = []
            for c in contracts:
                sym = c["symbol"]
                fnd = get_fnd(sym)
                ws  = get_ws(sym)
                if fnd and ws and ws <= td <= fnd:
                    chg = c["oi"] - prev_oi[sym] if sym in prev_oi else 0
                    in_window.append({
                        "symbol":   sym,
                        "contract": sym,
                        "oi":       c["oi"],
                        "chg":      chg,
                        "last":     None,
                        "expiry":   "",
                        "volume":   0,
                    })

            if not in_window:
                continue

            # Update prev_oi tracker
            for c in in_window:
                prev_oi[c["symbol"]] = c["oi"]

            # Sort front-month first (highest OI)
            in_window.sort(key=lambda x: -x["oi"])

            lbl   = label_for(in_window[0]["symbol"])
            title = f"{lbl} Futures – {trade_date}"

            if db.query(NewsItem).filter_by(title=title).first():
                total_skipped += 1
                continue

            db.add(NewsItem(
                title=title,
                body=f"{lbl}: {', '.join(c['symbol'] for c in in_window)}",
                source=lbl,
                category="general",
                lat=None,
                lng=None,
                tags=["futures", "price", market],
                meta=json.dumps({"contracts": in_window}),
                pub_date=datetime.strptime(trade_date, "%Y-%m-%d"),
            ))
            total_inserted += 1
            syms = ", ".join(c["symbol"] for c in in_window)
            print(f"  + {trade_date} [{market}] — {syms}")

        db.commit()

    db.close()
    print(f"\nDone — {total_inserted} inserted, {total_skipped} skipped (already exist).")


if __name__ == "__main__":
    main()
