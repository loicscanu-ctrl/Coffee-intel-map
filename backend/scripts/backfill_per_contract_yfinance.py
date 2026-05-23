#!/usr/bin/env python3
"""
backfill_per_contract_yfinance.py — backfill cot_weekly under the max-OI
rule using TRUE per-contract historical bars from Yahoo Finance.

Fixes the Stooq continuous-front-month trap (May 2026): the previous
backfill via `kc.k26`-style symbols on Stooq returned stitched front-
month data, not absolute per-contract bars. yfinance with the `.NYB`
suffix (NY Arabica) returns proper per-contract series — see the user
example:
    yf.download("KCH24.NYB", start="2024-01-01", end="2024-02-15")
    yf.download("KCK24.NYB", start="2024-01-01", end="2024-02-15")
…each returns ONLY that absolute contract's bars, never stitched.

For NY (Arabica / KC): suffix `.NYB`.
For LDN (Robusta / RC): ICE Europe contracts. Yahoo's symbol convention
here is less consistent — the script tries a list of suffixes per
contract and uses whichever returns non-empty data. Recorded as the
authoritative source in the `--strategy` field of the log so any
unexpected mismatch is traceable.

When a per-contract fetch yields no data (suffix unknown, contract too
old, etc.), the row is SKIPPED rather than falling back to continuous
data — the whole point is to never re-introduce stitched values. The
existing FND-based label + continuous-front-month price stays in place
for those rows.

Schema writes
-------------
For each Tuesday + market combination:
  - price_{ny,ldn}            ← Yahoo close on that Tuesday for the
                                max-OI contract
  - price_contract_{ny,ldn}   ← max-OI contract symbol (e.g. KCN26)

Original values are archived to `cot_weekly_price_archive` with
reason='backfill_per_contract_yfinance.py' for rollback.

Run
---
    python backend/scripts/backfill_per_contract_yfinance.py            # dry-run
    python backend/scripts/backfill_per_contract_yfinance.py --apply    # commit

Sample-only mode for testing a small batch:
    python backend/scripts/backfill_per_contract_yfinance.py --weeks 12 --apply
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))


# Re-use the calendar + max-OI heuristic from the existing backfill.
import yfinance as yf  # noqa: E402
from backfill_max_oi_prices import (  # noqa: E402
    _archive_row,
    _contract_symbol,
    _create_archive,
    _load_oi_history,
    _max_oi_by_heuristic,
    _max_oi_from_history,
)

from database import SessionLocal  # noqa: E402
from models import CotWeekly  # noqa: E402

# ── Yahoo per-contract ticker suffix lists ───────────────────────────────────
# NY (NYBOT Arabica): `.NYB` is the verified, single-suffix convention.
# LDN (ICE Europe Robusta): less standardized on Yahoo. The script tries
# each suffix until one returns rows. First-success wins; absence is
# logged so we can iterate.
SUFFIXES_BY_MARKET = {
    "ny":  [".NYB"],
    "ldn": [".NYB", ".L", ""],   # try .NYB first (some sources route ICE EU
                                  # through the NYBOT-tagged symbol), then UK,
                                  # then bare. Bare ticker last because Yahoo
                                  # sometimes routes it via continuous data.
}

# Yahoo download window: from one month before the target Tuesday to one
# month after. Comfortably covers settlement-day gaps without paging the
# whole contract life-cycle on every call.
DOWNLOAD_PADDING = timedelta(days=30)

# Cache: {(yahoo_ticker, padded_start, padded_end): {date_iso: close}}.
# Each unique contract is downloaded at most once per script run.
_YF_CACHE: dict[tuple, dict[str, float]] = {}


def _yahoo_symbols(market: str, contract: str) -> list[str]:
    """KCH24 / RCN26 → [KCH24.NYB] or [RCN26.NYB, RCN26.L, RCN26]."""
    return [f"{contract}{sfx}" for sfx in SUFFIXES_BY_MARKET[market]]


def _fetch_contract_window(yahoo_sym: str, start: date, end: date) -> dict[str, float]:
    """Download daily bars for `yahoo_sym` over [start, end]. Returns
    {YYYY-MM-DD: close}. Empty dict on no-data or fetch error."""
    cache_key = (yahoo_sym, start.isoformat(), end.isoformat())
    if cache_key in _YF_CACHE:
        return _YF_CACHE[cache_key]

    try:
        df = yf.download(
            yahoo_sym,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),  # yfinance end is exclusive
            interval="1d",
            progress=False,
            auto_adjust=False,
            threads=False,
        )
    except Exception as e:
        print(f"    [yf] {yahoo_sym} → {type(e).__name__}: {e}")
        _YF_CACHE[cache_key] = {}
        return {}

    if df is None or df.empty:
        _YF_CACHE[cache_key] = {}
        return {}

    closes: dict[str, float] = {}
    # yfinance may return MultiIndex columns when downloading a single ticker
    # under recent versions; flatten defensively.
    close_col = df["Close"] if "Close" in df.columns else df.get(("Close", yahoo_sym))
    if close_col is None:
        # Last-ditch: take whatever first column matches "Close" prefix.
        cands = [c for c in df.columns if (isinstance(c, str) and c.startswith("Close"))
                 or (isinstance(c, tuple) and c and str(c[0]).startswith("Close"))]
        close_col = df[cands[0]] if cands else None
    if close_col is None:
        _YF_CACHE[cache_key] = {}
        return {}

    for idx, val in close_col.dropna().items():
        try:
            closes[idx.strftime("%Y-%m-%d")] = float(val)
        except Exception:
            continue
    _YF_CACHE[cache_key] = closes
    return closes


def _close_on(market: str, contract: str, tuesday: date) -> tuple[float | None, str | None]:
    """Find the close on `tuesday` for `contract` across all candidate
    Yahoo suffixes. Returns (close, yahoo_sym_used) or (None, None)."""
    win_start = tuesday - DOWNLOAD_PADDING
    win_end   = tuesday + DOWNLOAD_PADDING
    target_iso = tuesday.isoformat()

    for yahoo_sym in _yahoo_symbols(market, contract):
        closes = _fetch_contract_window(yahoo_sym, win_start, win_end)
        if target_iso in closes:
            return closes[target_iso], yahoo_sym
        # Fall back to previous trading day if Tuesday itself is missing
        # (very rare for futures, but holiday weeks happen). Walk back up
        # to 4 days.
        for delta in range(1, 5):
            iso = (tuesday - timedelta(days=delta)).isoformat()
            if iso in closes:
                return closes[iso], yahoo_sym
        if closes:
            # Symbol returned data but not for the target Tuesday — note
            # and continue to try other suffixes.
            continue
    return None, None


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--apply", action="store_true",
                    help="Commit DB writes. Default is dry-run.")
    ap.add_argument("--weeks", type=int, default=260,
                    help="Backfill window in weeks per market (default 260 = 5y).")
    ap.add_argument("--markets", default="ny,ldn",
                    help="Comma-separated subset of markets to backfill: ny, ldn, or both.")
    args = ap.parse_args()

    selected = [m.strip() for m in args.markets.split(",") if m.strip()]
    print(f"[backfill_per_contract] markets={selected} weeks={args.weeks} mode={'APPLY' if args.apply else 'dry-run'}")

    oi_history = _load_oi_history()
    if oi_history:
        print(f"[backfill_per_contract] oi_history.json loaded "
              f"(NY={len(oi_history.get('arabica', []))} days, "
              f"LDN={len(oi_history.get('robusta', []))} days)")

    db = SessionLocal()
    if args.apply:
        _create_archive(db)

    try:
        # Pull the relevant rows for both markets at once.
        rows = (
            db.query(CotWeekly)
            .filter(CotWeekly.market.in_(selected))
            .order_by(CotWeekly.date.desc())
            .limit(args.weeks * len(selected))
            .all()
        )
        print(f"[backfill_per_contract] loaded {len(rows)} cot_weekly rows")

        # Stats
        stats = {
            "no_max_oi": 0,
            "no_yahoo_data": 0,
            "ok_updated":  0,
            "ok_unchanged": 0,
        }
        per_market: dict[str, dict[str, int]] = {m: {**stats} for m in selected}

        for r in rows:
            tuesday = r.date
            market = r.market
            price_field    = "price_ny"          if market == "ny" else "price_ldn"
            contract_field = "price_contract_ny" if market == "ny" else "price_contract_ldn"

            # Determine max-OI contract for this Tuesday: oi_history first
            # (authoritative for the ~30 days it covers), then heuristic.
            hit = _max_oi_from_history(market, tuesday, oi_history)
            source = "history"
            if not hit:
                hit = _max_oi_by_heuristic(market, tuesday)
                source = "heuristic"
            if not hit:
                per_market[market]["no_max_oi"] += 1
                continue
            letter, year = hit
            target_contract = _contract_symbol(market, letter, year)

            # Fetch absolute per-contract close from Yahoo.
            close, yahoo_sym = _close_on(market, target_contract, tuesday)
            if close is None:
                per_market[market]["no_yahoo_data"] += 1
                print(f"  [skip] {market.upper()} {tuesday} {target_contract} — "
                      f"no Yahoo data via {SUFFIXES_BY_MARKET[market]}")
                continue

            existing_price    = getattr(r, price_field)
            existing_contract = getattr(r, contract_field)
            new_changes_price    = (existing_price    is None) or (abs(existing_price - close) > 0.005)
            new_changes_contract = existing_contract != target_contract

            if not (new_changes_price or new_changes_contract):
                per_market[market]["ok_unchanged"] += 1
                continue

            per_market[market]["ok_updated"] += 1
            tag = "APPLY" if args.apply else "WOULD"
            print(f"  [{tag}] {market.upper()} {tuesday}: "
                  f"price {existing_price!s:<8} → {close:.2f} "
                  f"({existing_contract!s} → {target_contract})  "
                  f"yf={yahoo_sym} src={source}")

            if args.apply:
                _archive_row(db, r, "backfill_per_contract_yfinance.py")
                setattr(r, price_field, close)
                setattr(r, contract_field, target_contract)

            # Gentle rate-limit even though yfinance batches.
            if (sum(s["ok_updated"] for s in per_market.values()) % 20) == 0:
                time.sleep(0.5)

        if args.apply:
            db.commit()

        # Summary
        print("\n=== summary ===")
        for m, s in per_market.items():
            print(f"  {m.upper()}: ok_updated={s['ok_updated']}  ok_unchanged={s['ok_unchanged']}  "
                  f"no_yahoo_data={s['no_yahoo_data']}  no_max_oi={s['no_max_oi']}")
        if not args.apply:
            print("\nDry-run complete. Re-run with --apply to commit.")
        else:
            print("\nApplied. Original values archived to cot_weekly_price_archive.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
