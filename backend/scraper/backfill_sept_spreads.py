"""
backfill_sept_spreads.py
One-off: daily settles for the KC July (N), September (U) and December (Z)
contracts, 2006→current, from Barchart's queryeod endpoint (same fetch path as
backfill_cot_deep). Feeds the September X-ray event study with real
Jul→Sep and Sep→Dec calendar-spread history around each year's delivery window.

Writes data/kc_sept_dec_contracts.json:
  { "2010": { "N": {"2010-06-01": 136.2, ...}, "U": {...}, "Z": {...} }, ... }
Dates are trimmed to May 1 → Oct 15 of the contract year — the study window.
Append-once per year: a year already present with all three legs is skipped,
so re-runs only fetch what's missing (plus the current year).

Run from backend/:  python -m scraper.backfill_sept_spreads
"""
import asyncio
import json
import sys
from datetime import UTC, date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.backfill_cot_deep import _fetch_eod, _parse_eod  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "data" / "kc_sept_dec_contracts.json"

FIRST_YEAR = 2006
LEGS = ("N", "U", "Z")   # July, September, December


def _trim(px: dict[str, float], year: int) -> dict[str, float]:
    lo, hi = f"{year}-05-01", f"{year}-10-15"
    return {d: v for d, v in sorted(px.items()) if lo <= d <= hi}


def main() -> None:
    cur_year = date.today().year
    existing: dict = {}
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    need: list[tuple[int, str]] = []
    for y in range(FIRST_YEAR, cur_year + 1):
        have = existing.get(str(y)) or {}
        for leg in LEGS:
            # re-fetch the current year (still trading); past years append-once
            if y == cur_year or not (have.get(leg) or {}):
                need.append((y, leg))
    if not need:
        print("[sept_spreads] nothing to fetch — all years present")
        return

    symbols = [f"KC{leg}{y % 100:02d}" for y, leg in need]
    print(f"[sept_spreads] fetching {len(symbols)} contracts: {symbols[0]} … {symbols[-1]}")
    raw = asyncio.run(_fetch_eod(symbols, maxrecords=700))

    got = 0
    for (y, leg), sym in zip(need, symbols):
        px = _trim(_parse_eod(raw.get(sym, "")), y)
        if not px:
            print(f"[sept_spreads]   {sym}: no data")
            continue
        existing.setdefault(str(y), {})[leg] = px
        got += 1
        print(f"[sept_spreads]   {sym}: {len(px)} settles ({min(px)} → {max(px)})")

    if not got:
        print("[sept_spreads] nothing fetched — file unchanged")
        return
    existing["_meta"] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "source": "Barchart queryeod (KC N/U/Z per-contract daily settles, c/lb)",
        "window": "May 1 → Oct 15 of contract year",
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=1), encoding="utf-8")
    yrs = sorted(k for k in existing if k.isdigit())
    print(f"[sept_spreads] wrote {OUT_PATH.name}: {len(yrs)} years ({yrs[0]}–{yrs[-1]}), +{got} legs this run")


if __name__ == "__main__":
    main()
