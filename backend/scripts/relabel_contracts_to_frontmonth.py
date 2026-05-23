#!/usr/bin/env python3
"""
relabel_contracts_to_frontmonth.py — rewrite price_contract_{ny,ldn} on
existing cot_weekly rows to reflect the FND-based front-month convention,
matching the continuous-front-month price data those rows actually carry.

Why this exists
---------------
PR #63 introduced the max-OI labelling convention: the price track on the
Industry Pulse chart was supposed to follow whichever contract held the
largest open interest on each COT Tuesday. Max-OI typically rolls 2-3
weeks before First Notice Day (FND), well ahead of when the conventional
front-month rolls.

The companion backfill script (backfill_max_oi_prices.py) tried to refetch
per-contract prices from Stooq using symbols like `kc.k26`. Verification
against external sources later confirmed that Stooq's per-month symbols
are NOT absolute per-contract data — they're continuous front-month
streams that only "become" the contract they're named after starting at
that contract's own FND. As a result, every backfilled row got a max-OI
label slapped onto a front-month-by-FND price. The price track is
internally honest (matches what the continuous KC1!/RM1! feed showed at
the time), but the labels misrepresent the underlying contract.

This script restores label/price alignment by setting each
price_contract_{ny,ldn} to the contract whose FND is the next future FND
relative to the COT Tuesday — i.e. the actual front month as the wider
market sees it. NO price changes: those are already correct under the
front-month convention. The cot_weekly_price_archive rows written by the
earlier backfill remain in place as rollback.

True per-contract historical data (so max-OI labels can be used legitimately)
needs a different source — Interactive Brokers via ib_insync, Barchart,
ICE Direct, etc. — and is the suggested follow-up (see RUNBOOK §C).

Run
---
    python backend/scripts/relabel_contracts_to_frontmonth.py            # dry-run (default)
    python backend/scripts/relabel_contracts_to_frontmonth.py --apply    # write to DB

Idempotent: runs against the current state and updates only rows whose
stored contract differs from the front-month pick.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))

# Re-use the calendar helpers from the original backfill — same FND math,
# same KC/RC contract letter sets.
from backfill_max_oi_prices import (  # noqa: E402
    _contract_symbol,
    _next_contract_after,
)

from database import SessionLocal  # noqa: E402
from models import CotWeekly  # noqa: E402


def _front_month(market: str, tuesday: date) -> str | None:
    """Front-month under the FND convention: the contract whose FND is
    the next future FND relative to `tuesday`. Returns the storage-format
    symbol (e.g. KCK26, RCN26) or None on calendar-lookup failure."""
    nxt = _next_contract_after(market, tuesday)
    if not nxt:
        return None
    return _contract_symbol(market, nxt[0], nxt[1])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true",
                    help="Commit DB writes. Default is dry-run.")
    ap.add_argument("--weeks", type=int, default=520,
                    help="Look back this many weekly rows per market (default 520 = 10y).")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = (
            db.query(CotWeekly)
            .order_by(CotWeekly.date.desc())
            .limit(args.weeks * 2)
            .all()
        )
        print(f"Loaded {len(rows)} cot_weekly rows for relabel")

        ny_changes:  list[tuple[date, str | None, str | None]] = []
        ldn_changes: list[tuple[date, str | None, str | None]] = []

        for r in rows:
            tuesday = r.date
            if r.market == "ny":
                want = _front_month("ny", tuesday)
                have = r.price_contract_ny
                if want != have:
                    ny_changes.append((tuesday, have, want))
                    if args.apply:
                        r.price_contract_ny = want
            elif r.market == "ldn":
                want = _front_month("ldn", tuesday)
                have = r.price_contract_ldn
                if want != have:
                    ldn_changes.append((tuesday, have, want))
                    if args.apply:
                        r.price_contract_ldn = want

        if args.apply:
            db.commit()

        # Diff report.
        def show(market: str, changes):
            print(f"\n=== {market}: {len(changes)} rows would change " +
                  ("(APPLIED)" if args.apply else "(dry-run)") + " ===")
            if not changes:
                return
            print(f"{'date':<12} {'was':<10} → {'will be':<10}")
            for d, was, will in changes[:30]:
                print(f"{d.isoformat():<12} {str(was):<10} → {str(will):<10}")
            if len(changes) > 30:
                print(f"   ... and {len(changes) - 30} more (suppressed)")

        show("NY",  ny_changes)
        show("LDN", ldn_changes)

        if not args.apply:
            print(f"\nDry-run complete. Pass --apply to commit {len(ny_changes) + len(ldn_changes)} updates.")
        else:
            print(f"\nApplied: {len(ny_changes)} NY + {len(ldn_changes)} LDN = "
                  f"{len(ny_changes) + len(ldn_changes)} rows.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
