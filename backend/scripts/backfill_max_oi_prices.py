"""
backfill_max_oi_prices.py — retroactively rebuild the COT weekly price track
under the max-OI rule.

Background
----------
PR #63 changed `fetch_tuesday_prices.py` to anchor the Industry Pulse
chart's price line on whichever contract has the largest open interest.
Going forward, every new Tuesday writes the max-OI contract's settlement
price (and stores the contract symbol in `price_contract_{ny,ldn}`).

The legacy rows already in `cot_weekly` carry prices from the OLD rule
(first non-near-expiry contract with OI ≥ 100, roughly the front month).
For most weeks that matches max-OI exactly. The difference shows up in
the 2-3 weeks before each front-month's First Notice Day, when liquidity
has rolled to the next contract but the old picker still followed the
front.

This script rebuilds those historical prices so the chart's full 52-week
track reflects the max-OI rule end-to-end, and the contract-switch
markers appear at every historical roll boundary.

Approach
--------
For each row in `cot_weekly`:

  1. Determine the front + second contracts at that Tuesday from the
     standard ICE coffee calendar:
       KC (Arabica):  H K N U Z       (Mar May Jul Sep Dec)
       RC (Robusta):  F H K N U X     (Jan Mar May Jul Sep Nov)
     First Notice Day = 7 business days before 1st business day of
     delivery month for KC; 4 for RC (matches frontend's firstNoticeDay).

  2. Decide which carries max OI:
       a. If `oi_history.json` covers that Tuesday (last 30 trading
          days), look up directly — the per-contract OI snapshot is
          authoritative for those weeks.
       b. Otherwise use the roll-window heuristic: front-month UNLESS
          Tuesday is within ROLL_WINDOW_DAYS of the front's FND, in
          which case the second month is max-OI.

  3. Fetch that contract's settlement price for the Tuesday from
     Stooq (free CSV, no auth):
       https://stooq.com/q/d/l/?s=kc.k26&i=d
     Per-contract symbols: `<commodity>.<month_letter><year2>`
     (`kc.k26` = KC May 2026, `rc.n26` = RC July 2026).

  4. Update the row:
       price_{ny,ldn}            ← Stooq close on that Tuesday
       price_contract_{ny,ldn}   ← chosen contract symbol

Reversibility
-------------
On `--apply`, every row is archived to `cot_weekly_price_archive`
(auto-created) before the UPDATE so the change can be rolled back. A
follow-up rollback script can reverse the operation from the archive.

Usage
-----
  python backend/scripts/backfill_max_oi_prices.py              # dry-run
  python backend/scripts/backfill_max_oi_prices.py --apply      # commit
  python backend/scripts/backfill_max_oi_prices.py --apply \\
      --weeks 52                                                # last 52 weeks only
  python backend/scripts/backfill_max_oi_prices.py --apply \\
      --skip-price-refetch    # only update price_contract field, keep
                              # the existing prices (still gives you
                              # historical switch markers without
                              # hitting Stooq)

DB connection is read from `DATABASE_URL`. Falls back to the local
SQLite test DB when unset.
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from database import SessionLocal, engine  # noqa: E402
from models import CotWeekly  # noqa: E402

OI_HISTORY_PATH = ROOT.parent / "data" / "oi_history.json"

KC_CONTRACTS = ["H", "K", "N", "U", "Z"]
RC_CONTRACTS = ["F", "H", "K", "N", "U", "X"]
LETTER_TO_MONTH = {
    "F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
    "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12,
}

# Trading days before First Notice Day where liquidity is assumed to have
# rolled to the next contract. Calibrated empirically from the live
# oi_history.json (PR #63) — KC crosses over ~17 days before front FND
# (KCN26 overtook KCK26 around Apr 7 / K-FND was Apr 24), RC crosses over
# ~26 days before (RMN26 overtook RMK26 by Apr 2 / K-FND was Apr 27).
# RC rolls earlier than KC; using one shared constant misclassifies a
# meaningful fraction of pre-roll-window weeks.
ROLL_WINDOW_DAYS_BY_MARKET = {
    "ny":  17,
    "ldn": 26,
}

# Stooq sometimes throttles. Sleep this many seconds between requests so
# a full backfill doesn't trip the rate limit. ~150 requests for a year
# of weekly data on two markets → ~5 minutes total at 2s.
STOOQ_THROTTLE_SECONDS = 2.0


# ── Contract calendar helpers ────────────────────────────────────────────────

def _first_business_day(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.weekday() in (5, 6):
        d += timedelta(days=1)
    return d


def _subtract_business_days(d: date, n: int) -> date:
    while n > 0:
        d -= timedelta(days=1)
        if d.weekday() not in (5, 6):
            n -= 1
    return d


def _first_notice_day(market: str, letter: str, year: int) -> date:
    """KC FND = 7 biz days before 1st biz day of delivery month;
       RC FND = 4 biz days before. Matches frontend/app/futures/page.tsx."""
    month = LETTER_TO_MONTH[letter]
    fbd = _first_business_day(year, month)
    days_before = 7 if market == "ny" else 4
    return _subtract_business_days(fbd, days_before)


def _next_contract_after(market: str, target_date: date) -> tuple[str, int] | None:
    """First contract whose FND is strictly after `target_date`. Looks
    across the current calendar year and the next, then picks the
    earliest-FND match."""
    contracts = KC_CONTRACTS if market == "ny" else RC_CONTRACTS
    candidates: list[tuple[date, str, int]] = []
    for year_offset in range(0, 2):
        try_year = target_date.year + year_offset
        for letter in contracts:
            try:
                fnd = _first_notice_day(market, letter, try_year)
            except Exception:
                continue
            if fnd > target_date:
                candidates.append((fnd, letter, try_year))
    if not candidates:
        return None
    candidates.sort()
    _, letter, year = candidates[0]
    return letter, year


def _front_and_second(market: str, tuesday: date) -> tuple[tuple[str, int] | None, tuple[str, int] | None]:
    front = _next_contract_after(market, tuesday)
    if not front:
        return None, None
    front_letter, front_year = front
    front_fnd = _first_notice_day(market, front_letter, front_year)
    second = _next_contract_after(market, front_fnd)
    return front, second


def _contract_symbol(market: str, letter: str, year: int) -> str:
    """KCN26-style symbol. RC contracts on ICE are RM* in some sources
    and RC* in others; we use RC* internally to match frontend
    conventions."""
    prefix = "KC" if market == "ny" else "RC"
    return f"{prefix}{letter}{year % 100:02d}"


# ── Max-OI lookups ──────────────────────────────────────────────────────────

def _load_oi_history() -> dict | None:
    if not OI_HISTORY_PATH.exists():
        return None
    import json
    try:
        return json.loads(OI_HISTORY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


_OI_SYMBOL_RE = re.compile(r"^[A-Z]{2}([FGHJKMNQUVXZ])(\d{2})$")


def _max_oi_from_history(market: str, tuesday: date, oi_history: dict | None) -> tuple[str, int] | None:
    """If oi_history.json covers a day within 3 days of `tuesday`, return
    the max-OI contract on that day. Returns None when out of window."""
    if not oi_history:
        return None
    key = "arabica" if market == "ny" else "robusta"
    days = oi_history.get(key, [])
    closest = None
    for d in days:
        try:
            d_date = date.fromisoformat(d.get("date", ""))
        except (ValueError, TypeError):
            continue
        if abs((d_date - tuesday).days) > 3:
            continue
        if closest is None or abs((d_date - tuesday).days) < abs((closest[0] - tuesday).days):
            closest = (d_date, d)
    if not closest:
        return None
    contracts = closest[1].get("contracts", [])
    if not contracts:
        return None
    best = max(contracts, key=lambda c: c.get("oi", 0))
    m = _OI_SYMBOL_RE.match(best.get("symbol", ""))
    if not m:
        return None
    return m.group(1), 2000 + int(m.group(2))


def _max_oi_by_heuristic(market: str, tuesday: date) -> tuple[str, int] | None:
    """Front-month UNLESS Tuesday is within the market's roll window of
    front FND, in which case second-month. Returns None if calendar lookup
    fails. Per-market window sizes derived empirically — see ROLL_WINDOW_DAYS_BY_MARKET."""
    front, second = _front_and_second(market, tuesday)
    if not front:
        return None
    front_letter, front_year = front
    front_fnd = _first_notice_day(market, front_letter, front_year)
    roll_window = ROLL_WINDOW_DAYS_BY_MARKET.get(market, 14)
    roll_threshold = front_fnd - timedelta(days=roll_window)
    if tuesday >= roll_threshold and second is not None:
        return second
    return front


# ── Stooq price fetch ────────────────────────────────────────────────────────

def _stooq_symbol(market: str, letter: str, year: int) -> str:
    """Stooq per-contract symbol. Verified pattern:
       kc.k26 → KC May 2026
       rc.k26 → RC May 2026 (London Robusta)
    Yearly digit is last two of calendar year."""
    prefix = "kc" if market == "ny" else "rc"
    return f"{prefix}.{letter.lower()}{year % 100:02d}"


# Cache fetched CSVs in-process so we don't re-hit Stooq for each Tuesday
# on the same contract. Maps stooq_symbol → list[dict(date, close)] sorted.
_STOOQ_CACHE: dict[str, list[dict]] = {}


def _fetch_stooq_history(stooq_sym: str) -> list[dict]:
    if stooq_sym in _STOOQ_CACHE:
        return _STOOQ_CACHE[stooq_sym]

    url = f"https://stooq.com/q/d/l/?s={stooq_sym}&i=d"
    headers = {"User-Agent": "Mozilla/5.0 (Coffee-intel-map backfill)"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"    [stooq] {stooq_sym} → HTTP {e.code}")
        _STOOQ_CACHE[stooq_sym] = []
        return []
    except Exception as e:
        print(f"    [stooq] {stooq_sym} → {type(e).__name__}: {e}")
        _STOOQ_CACHE[stooq_sym] = []
        return []

    # Stooq returns "No data" as a single short line when the symbol is
    # unknown or the contract too old. Detect that explicitly.
    if not body or "No data" in body[:100]:
        _STOOQ_CACHE[stooq_sym] = []
        return []

    rows = []
    for row in csv.DictReader(io.StringIO(body)):
        d_raw = row.get("Date", "")
        c_raw = row.get("Close", "")
        try:
            d_iso = date.fromisoformat(d_raw).isoformat()
            close = float(c_raw)
        except (ValueError, TypeError):
            continue
        rows.append({"date": d_iso, "close": close})
    rows.sort(key=lambda r: r["date"])
    _STOOQ_CACHE[stooq_sym] = rows
    time.sleep(STOOQ_THROTTLE_SECONDS)
    return rows


def _close_on(stooq_sym: str, target_date: date) -> float | None:
    """Settlement close for `target_date`. Falls back to previous trading
    day if Tuesday itself wasn't a trading session (rare; KC trades on
    Tuesdays normally)."""
    rows = _fetch_stooq_history(stooq_sym)
    if not rows:
        return None
    target_iso = target_date.isoformat()
    # Exact match first
    for r in rows:
        if r["date"] == target_iso:
            return r["close"]
    # Fall back to most-recent day on or before target (handle holidays)
    earlier = [r for r in rows if r["date"] < target_iso]
    if not earlier:
        return None
    return earlier[-1]["close"]


# ── Archive table ──────────────────────────────────────────────────────────

ARCHIVE_DDL_PG = """
CREATE TABLE IF NOT EXISTS cot_weekly_price_archive (
    archived_id          SERIAL PRIMARY KEY,
    archived_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    archive_reason       TEXT NOT NULL,
    cot_weekly_id        INTEGER NOT NULL,
    cot_weekly_date      DATE NOT NULL,
    cot_weekly_market    VARCHAR(3) NOT NULL,
    prev_price_ny        FLOAT,
    prev_price_ldn       FLOAT,
    prev_price_contract_ny  VARCHAR(20),
    prev_price_contract_ldn VARCHAR(20)
);
"""

ARCHIVE_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS cot_weekly_price_archive (
    archived_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    archived_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archive_reason       TEXT NOT NULL,
    cot_weekly_id        INTEGER NOT NULL,
    cot_weekly_date      DATE NOT NULL,
    cot_weekly_market    VARCHAR(3) NOT NULL,
    prev_price_ny        REAL,
    prev_price_ldn       REAL,
    prev_price_contract_ny  VARCHAR(20),
    prev_price_contract_ldn VARCHAR(20)
);
"""


def _create_archive(db) -> None:
    ddl = ARCHIVE_DDL_PG if engine.dialect.name == "postgresql" else ARCHIVE_DDL_SQLITE
    db.execute(text(ddl))
    db.commit()


def _archive_row(db, row: CotWeekly, reason: str) -> None:
    db.execute(
        text(
            """
            INSERT INTO cot_weekly_price_archive
                (archive_reason, cot_weekly_id, cot_weekly_date,
                 cot_weekly_market, prev_price_ny, prev_price_ldn,
                 prev_price_contract_ny, prev_price_contract_ldn)
            VALUES
                (:reason, :id, :d, :m, :pn, :pl, :cn, :cl)
            """
        ),
        {
            "reason": reason,
            "id":     row.id,
            "d":      row.date,
            "m":      row.market,
            "pn":     row.price_ny,
            "pl":     row.price_ldn,
            "cn":     row.price_contract_ny,
            "cl":     row.price_contract_ldn,
        },
    )


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Backfill the COT weekly price track under the max-OI rule.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--apply",   action="store_true",
                    help="Commit DB writes. Without this flag, the script prints what it would do and exits.")
    ap.add_argument("--weeks",   type=int, default=104,
                    help="Backfill the last N weekly rows per market (default 104 = 2y).")
    ap.add_argument("--skip-price-refetch", action="store_true",
                    help="Only update price_contract_{ny,ldn}; keep existing prices intact. "
                         "Useful when Stooq is unreachable or for a fast first pass that just "
                         "enables historical contract-switch markers on the chart.")
    args = ap.parse_args()

    oi_history = _load_oi_history()
    if oi_history:
        print(f"Loaded oi_history.json ({len(oi_history.get('arabica', []))} arabica days, "
              f"{len(oi_history.get('robusta', []))} robusta days)")
    else:
        print("No oi_history.json — relying on heuristic for every Tuesday")

    db = SessionLocal()
    try:
        rows = (
            db.query(CotWeekly)
            .order_by(CotWeekly.date.desc())
            .limit(args.weeks * 2)  # 2 markets per week
            .all()
        )
        rows = list(reversed(rows))   # chronological for nicer logs
        print(f"Loaded {len(rows)} cot_weekly rows ({rows[0].date} → {rows[-1].date})")
        print()

        n_changed = 0
        n_price_changed = 0
        n_contract_changed = 0
        n_skipped_no_calendar = 0
        n_skipped_no_price = 0

        for row in rows:
            market = row.market  # "ny" | "ldn"
            tuesday = row.date

            # Determine max-OI contract
            chosen = _max_oi_from_history(market, tuesday, oi_history) \
                or _max_oi_by_heuristic(market, tuesday)
            if not chosen:
                n_skipped_no_calendar += 1
                continue

            letter, year = chosen
            new_symbol = _contract_symbol(market, letter, year)

            curr_price_field = "price_ny" if market == "ny" else "price_ldn"
            curr_contract_field = "price_contract_ny" if market == "ny" else "price_contract_ldn"
            curr_price = getattr(row, curr_price_field)
            curr_contract = getattr(row, curr_contract_field)

            new_price = None
            if not args.skip_price_refetch:
                stooq_sym = _stooq_symbol(market, letter, year)
                new_price = _close_on(stooq_sym, tuesday)
                if new_price is None:
                    n_skipped_no_price += 1
                    # Still allow the contract symbol to update — markers help
                    # even if price stays.

            price_diff = (
                new_price is not None
                and curr_price is not None
                and abs(new_price - curr_price) > 0.01
            )
            contract_diff = (curr_contract or "") != new_symbol

            if not price_diff and not contract_diff:
                continue

            if price_diff:
                print(f"  {tuesday} {market.upper()}  price  {curr_price} → {new_price}  ({curr_contract or '?'} → {new_symbol})")
                n_price_changed += 1
            elif contract_diff:
                print(f"  {tuesday} {market.upper()}  contract  {curr_contract or '?'} → {new_symbol}  (price unchanged: {curr_price})")
                n_contract_changed += 1

            n_changed += 1

            if args.apply:
                if n_changed == 1:
                    _create_archive(db)
                _archive_row(
                    db, row,
                    reason=("backfill_max_oi_prices: price " if price_diff else "backfill_max_oi_prices: contract-only "),
                )
                if price_diff:
                    setattr(row, curr_price_field, new_price)
                if contract_diff:
                    setattr(row, curr_contract_field, new_symbol)
                db.add(row)
                db.commit()

        print()
        print("Summary:")
        print(f"  rows changed:                {n_changed}")
        print(f"    └ price + contract:        {n_price_changed}")
        print(f"    └ contract only:           {n_contract_changed}")
        print(f"  skipped — no calendar match: {n_skipped_no_calendar}")
        print(f"  skipped — no Stooq price:    {n_skipped_no_price}")

        if not args.apply:
            print()
            print("DRY RUN — no DB changes. Pass --apply to commit.")
            return 0

        print()
        print(f"Applied — original values archived to cot_weekly_price_archive ({n_changed} rows).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
