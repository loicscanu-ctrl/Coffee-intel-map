#!/usr/bin/env python3
"""
load_contract_csv.py — ingest bulk per-contract OI or price CSVs into the
date-keyed contract history archive (data/contract_prices_archive.json).

The archive is the authoritative per-contract daily OI + price history.
Schema (date-keyed so OI and price for the same trading date land together,
regardless of which source/day filled them):

    {
      "_meta": {...},
      "arabica": { "YYYY-MM-DD": { "KCN26": {"oi": 78136, "price": 270.15}, ... }, ... },
      "robusta": { "YYYY-MM-DD": { "RCN26": {"oi": 28003, "price": 3345.0}, ... }, ... }
    }

CSV format (header row required):
    date,contract,oi        (--kind oi)
    date,contract,price     (--kind price ; also accepts 'close'/'last_price' header)

Symbol convention: KC* → arabica; RM*/RC* → robusta. RM is normalized to RC
(our internal convention everywhere else) on write.

Run:
    python backend/scripts/load_contract_csv.py --kind oi    --csv path/to/oi.csv
    python backend/scripts/load_contract_csv.py --kind price --csv path/to/price.csv

Idempotent: re-loading the same CSV overwrites those (date,contract) cells
with the same values. Loading price after OI (or vice-versa) merges — it
never wipes the other field.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = REPO_ROOT / "data" / "contract_prices_archive.json"
sys.path.insert(0, str(REPO_ROOT / "backend" / "scraper"))
import symbols as _sym  # noqa: E402

# Keep 5y + buffer of trading days, matching the Industry Pulse 5Y window.
RETENTION_DAYS = 366 * 6  # calendar-day span ~6y; trims clearly-ancient rows only


def _market_and_symbol(contract: str, root: str | None = None) -> tuple[str, str] | None:
    """Resolve a CSV contract cell to (market, canonical_symbol).

    Accepts full symbols (KCN26, RMN26, RCN26) or bare month+year (N26) when
    a `root` (KC/RM) is supplied — the bulk price CSVs are bare per-file.
    Canonical = RC for robusta (via symbols.to_canonical).
    """
    c = (contract or "").strip().upper()
    if not _sym.parse(c) and root:
        c = f"{root.upper()}{c}"          # bare 'N26' + root 'RM' → 'RMN26'
    market = _sym.market_of(c)
    if not market:
        return None
    return market, _sym.to_canonical(c)


def _load_archive() -> dict:
    if ARCHIVE.exists():
        doc = json.loads(ARCHIVE.read_text(encoding="utf-8"))
        # Migrate legacy list-based shape → date-keyed, if needed.
        if isinstance(doc.get("arabica"), list):
            doc = _migrate_legacy(doc)
        return doc
    return {
        "_meta": {
            "description": (
                "Authoritative per-contract daily OI + price history, date-keyed. "
                "Each date → {contract: {oi, price}}. OI from the daily Barchart "
                "fetch (oi_date = N-2) and bulk CSVs; price from the daily fetch "
                "(price_date = N-1) and bulk price CSVs. RM robusta symbols stored "
                "as RC. Industry Pulse sources its price line from here."
            ),
            "started": date.today().isoformat(),
            "sources": [],
        },
        "arabica": {},
        "robusta": {},
    }


def _migrate_legacy(doc: dict) -> dict:
    """Convert the old list-of-snapshots archive to date-keyed.

    Old: {market: [{price_date, oi_date, contracts:[{symbol, oi, last_price}]}]}
    OI was stamped at oi_date, price at price_date — so each snapshot's OI and
    price land on DIFFERENT date keys in the new model.
    """
    out = {"_meta": doc.get("_meta", {}), "arabica": {}, "robusta": {}}
    out["_meta"]["migrated_from"] = "list-based dual-date snapshots"
    for market in ("arabica", "robusta"):
        for snap in doc.get(market, []):
            od = snap.get("oi_date")
            pd = snap.get("price_date")
            for c in snap.get("contracts", []):
                sym = c.get("symbol", "")
                ms = _market_and_symbol(sym)
                if not ms:
                    continue
                _, norm = ms
                if od and c.get("oi") is not None:
                    out[market].setdefault(od, {}).setdefault(norm, {})["oi"] = c["oi"]
                if pd and c.get("last_price") is not None:
                    out[market].setdefault(pd, {}).setdefault(norm, {})["price"] = c["last_price"]
    return out


def _apply_retention(doc: dict) -> None:
    today = date.today()
    for market in ("arabica", "robusta"):
        days = doc.get(market, {})
        cutoff = (today.toordinal() - RETENTION_DAYS)
        stale = [d for d in days if datetime.strptime(d, "%Y-%m-%d").date().toordinal() < cutoff]
        for d in stale:
            del days[d]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kind", required=True, choices=["oi", "price"])
    ap.add_argument("--csv", required=True)
    ap.add_argument("--root", choices=["KC", "RM", "RC"], default=None,
                    help="Prefix for bare contract cells (e.g. 'N26'). Use KC for "
                         "the arabica price CSV, RM for the robusta price CSV.")
    ap.add_argument("--dry-run", action="store_true", help="Parse + report, don't write.")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"[load] CSV not found: {csv_path}", file=sys.stderr)
        return 1

    doc = _load_archive()

    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    if not rows:
        print("[load] empty CSV", file=sys.stderr)
        return 1

    # Resolve the value column name.
    headers = {h.lower(): h for h in rows[0].keys()}
    if args.kind == "oi":
        val_col = headers.get("oi")
        field = "oi"
        cast = lambda v: int(float(v))
    else:
        val_col = (headers.get("last") or headers.get("settle") or headers.get("close")
                   or headers.get("price") or headers.get("last_price"))
        field = "price"
        cast = lambda v: float(v)
    date_col = headers.get("date") or headers.get("trade_date")
    contract_col = headers.get("contract") or headers.get("symbol")
    if not (val_col and date_col and contract_col):
        print(f"[load] missing required columns. Found headers: {list(headers.values())}", file=sys.stderr)
        return 1

    stats = {"arabica": 0, "robusta": 0, "skipped": 0, "bad": 0}
    for r in rows:
        ms = _market_and_symbol(r[contract_col], root=args.root)
        if not ms:
            stats["skipped"] += 1
            continue
        market, sym = ms
        d = r[date_col].strip()
        raw = r[val_col].strip()
        if raw == "" or raw.lower() in ("nan", "none", "null"):
            stats["bad"] += 1
            continue
        try:
            value = cast(raw)
        except (TypeError, ValueError):
            stats["bad"] += 1
            continue
        doc[market].setdefault(d, {}).setdefault(sym, {})[field] = value
        stats[market] += 1

    _apply_retention(doc)
    src_note = f"{args.kind}:{csv_path.name} ({stats['arabica']+stats['robusta']} cells)"
    doc["_meta"].setdefault("sources", []).append(src_note)

    n_dates_a = len(doc.get("arabica", {}))
    n_dates_r = len(doc.get("robusta", {}))
    print(f"[load] kind={args.kind}  loaded arabica={stats['arabica']} robusta={stats['robusta']} "
          f"cells (skipped={stats['skipped']} bad={stats['bad']})")
    print(f"[load] archive now spans arabica={n_dates_a} dates, robusta={n_dates_r} dates")
    a_dates = sorted(doc.get("arabica", {}))
    if a_dates:
        print(f"[load] arabica date range: {a_dates[0]} → {a_dates[-1]}")

    if args.dry_run:
        print("[load] DRY RUN — not writing.")
        return 0

    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    size_mb = ARCHIVE.stat().st_size / 1e6
    print(f"[load] wrote {ARCHIVE} ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
