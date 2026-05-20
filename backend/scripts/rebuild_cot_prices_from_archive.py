#!/usr/bin/env python3
"""
rebuild_cot_prices_from_archive.py — set cot_weekly prices + contract labels
to TRUE max-OI from the local per-contract archive.

This is the final resolution of the Stooq continuous-feed saga. The archive
(data/contract_prices_archive.json) now holds real per-contract OI AND price
for every trading day over 5 years (loaded from the user's CSVs + the daily
fetch). For each COT-Tuesday row in cot_weekly, this script:

  1. Looks up that date in the archive (nearest prior trading day if the exact
     date is missing — holidays).
  2. Picks the max-OI contract that day, EXCLUDING any contract already at/past
     its First Notice Day (delivery-month OI is noise, not positioning).
  3. Writes that contract's real settlement price + its symbol:
       NY  → price_ny  / price_contract_ny   (arabica, KC*)
       LDN → price_ldn / price_contract_ldn  (robusta, RC*)

Both label AND price now come from the same authoritative source, so they can
never disagree again. Robusta symbols are stored canonical (RC).

Original values are archived to cot_weekly_price_archive (reason tag) for
rollback, reusing the helper from backfill_max_oi_prices.py.

Run:
    python backend/scripts/rebuild_cot_prices_from_archive.py            # dry-run
    python backend/scripts/rebuild_cot_prices_from_archive.py --apply
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "backend" / "scraper"))
sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))

import symbols as sym  # noqa: E402
from sqlalchemy import text  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import CotWeekly  # noqa: E402
from backfill_max_oi_prices import _create_archive, _archive_row, _first_notice_day  # noqa: E402

ARCHIVE = REPO_ROOT / "data" / "contract_prices_archive.json"


def _load_archive() -> dict:
    return json.loads(ARCHIVE.read_text(encoding="utf-8"))


def _archive_day(market_block: dict, target: date, max_back: int = 5) -> dict | None:
    """Return the archive cell-map for `target`, walking back up to max_back
    calendar days if the exact date is absent (holidays)."""
    for back in range(0, max_back + 1):
        key = (target - timedelta(days=back)).isoformat()
        if key in market_block:
            return market_block[key]
    return None


def _pick_max_oi(cells: dict, on: date) -> tuple[str, float] | None:
    """From {symbol: {oi, price}} pick the max-OI contract that still has a
    future FND and a price. Returns (canonical_symbol, price)."""
    best = None  # (oi, symbol, price)
    for s, v in cells.items():
        oi = v.get("oi")
        price = v.get("price")
        if oi is None or price is None:
            continue
        # Exclude contracts already at/past First Notice Day.
        # _first_notice_day expects market 'ny'/'ldn' and a letter.
        p = sym.parse(s)
        if not p:
            continue
        root, letter, yy = p
        mkt = "ny" if root == "KC" else "ldn"
        try:
            fnd = _first_notice_day(mkt, letter, 2000 + int(yy))
            if fnd and on >= fnd:
                continue
        except Exception:
            pass
        if best is None or oi > best[0]:
            best = (oi, s, price)
    if not best:
        return None
    return sym.to_canonical(best[1]), best[2]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="Commit DB writes (default dry-run).")
    args = ap.parse_args()

    archive = _load_archive()
    db = SessionLocal()
    if args.apply:
        _create_archive(db)

    try:
        rows = db.query(CotWeekly).order_by(CotWeekly.date.asc()).all()
        print(f"[rebuild] {len(rows)} cot_weekly rows; archive arabica={len(archive.get('arabica',{}))} "
              f"robusta={len(archive.get('robusta',{}))} dates")

        changed = {"ny": 0, "ldn": 0}
        missing = {"ny": 0, "ldn": 0}
        for r in rows:
            block_key = "arabica" if r.market == "ny" else "robusta"
            price_field = "price_ny" if r.market == "ny" else "price_ldn"
            contract_field = "price_contract_ny" if r.market == "ny" else "price_contract_ldn"

            cells = _archive_day(archive.get(block_key, {}), r.date)
            if not cells:
                missing[r.market] += 1
                continue
            pick = _pick_max_oi(cells, r.date)
            if not pick:
                missing[r.market] += 1
                continue
            new_contract, new_price = pick
            old_price = getattr(r, price_field)
            old_contract = getattr(r, contract_field)

            if (old_price is not None and abs(old_price - new_price) < 0.005) and old_contract == new_contract:
                continue

            changed[r.market] += 1
            if changed[r.market] <= 6 or r.date >= date(2026, 1, 1):
                print(f"  [{r.market}] {r.date}: {old_contract}@{old_price} → {new_contract}@{new_price}")
            if args.apply:
                _archive_row(db, r, "rebuild_cot_prices_from_archive.py")
                setattr(r, price_field, new_price)
                setattr(r, contract_field, new_contract)

        if args.apply:
            db.commit()

        print(f"\n[rebuild] changed: ny={changed['ny']} ldn={changed['ldn']}  "
              f"no-archive-data: ny={missing['ny']} ldn={missing['ldn']}")
        print("[rebuild] " + ("APPLIED (rollback: cot_weekly_price_archive)" if args.apply
                               else "DRY RUN — re-run with --apply to commit"))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
