#!/usr/bin/env python3
"""
audit_contract_switches.py — preview the switches the backfill would produce
and verify them against the available historical OI data.

⚠️ HISTORICAL NOTE — STOOQ DATA-FEED BUG (May 2026)
---------------------------------------------------
The original `backfill_max_oi_prices.py` script relied on Stooq per-month
symbols like `kc.k24` assuming they were absolute per-contract series.
External verification confirmed Stooq stitches these into continuous
front-month streams (each symbol holds front-month prices until that
contract becomes front, then continues with the named contract's data).
As a result, every backfilled row got a max-OI label attached to a
front-month-by-FND price — labels and prices were misaligned by 2-3
weeks around each roll. This was corrected by `relabel_contracts_to_frontmonth.py`
which restored FND-based labels matching the price source.

This audit still computes the heuristic max-OI switch dates so they can be
compared against the FND-based labels actually stored. The script's
output is now informational — the chart itself uses the FND-based labels
that align with the continuous-front-month price track.

Two pieces of evidence used here:

  1. `oi_history.json` (30-day rolling per-contract OI snapshot from the
     ICE chain scraper) — AUTHORITATIVE for ~Apr 2 → May 15. Use it to
     compare what the heuristic predicted vs what the data shows.

  2. The FND-minus-N heuristic — purely calendar-based, no primary
     source to verify pre-2026 dates against. Still print them with
     expected windows so anomalies surface.

Run:
    python backend/scripts/audit_contract_switches.py
    python backend/scripts/audit_contract_switches.py --weeks 156    # 3y view
    python backend/scripts/audit_contract_switches.py --market ldn   # one market
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

# Re-use the exact same calendar + roll-window logic the backfill applies.
from backfill_max_oi_prices import (  # noqa: E402
    KC_CONTRACTS, RC_CONTRACTS, LETTER_TO_MONTH,
    ROLL_WINDOW_DAYS_BY_MARKET,
    _first_notice_day, _front_and_second, _contract_symbol,
    _max_oi_from_history, _load_oi_history,
)

COT_JSON = ROOT / "frontend" / "public" / "data" / "cot.json"


def _max_oi_heuristic(market: str, tuesday: date) -> tuple[str, int] | None:
    """Mirror of backfill_max_oi_prices._max_oi_by_heuristic.

    Production script uses CALENDAR days for the roll-window cutoff (not
    business days). Keeping that here so this audit matches what the
    backfill actually does.
    """
    front, second = _front_and_second(market, tuesday)
    if front is None:
        return None
    front_letter, front_year = front
    front_fnd = _first_notice_day(market, front_letter, front_year)
    roll_cutoff = front_fnd - timedelta(days=ROLL_WINDOW_DAYS_BY_MARKET[market])
    if tuesday >= roll_cutoff and second is not None:
        return second
    return front


def _pick_contract(market: str, tuesday: date, oi_history: dict | None) -> tuple[tuple[str, int] | None, str]:
    """Return (contract, source) where source = 'history' (authoritative) or 'heuristic'."""
    hit = _max_oi_from_history(market, tuesday, oi_history)
    if hit:
        return hit, "history"
    return _max_oi_heuristic(market, tuesday), "heuristic"


def _all_tuesdays(weeks: int) -> list[date]:
    """The last N Tuesdays ending with today (or the most recent past Tuesday)."""
    today = date.today()
    # Walk back to the most recent Tuesday (weekday 1).
    last_tue = today - timedelta(days=(today.weekday() - 1) % 7)
    return [last_tue - timedelta(weeks=i) for i in range(weeks - 1, -1, -1)]


def _expected_switch_window(market: str, switch_from: tuple[str, int]) -> tuple[date, date]:
    """A switch FROM the old contract is triggered when `tuesday >=
    (FND(old) - ROLL_WINDOW calendar days)`. So the expected switch date
    is the first Tuesday at or after that cutoff. ±10 calendar days
    tolerance for anomaly detection.
    """
    letter, year = switch_from
    fnd = _first_notice_day(market, letter, year)
    cutoff = fnd - timedelta(days=ROLL_WINDOW_DAYS_BY_MARKET[market])
    return cutoff - timedelta(days=10), cutoff + timedelta(days=10)


def audit_market(market: str, weeks: int, oi_history: dict | None) -> list[dict]:
    """Return a list of switch events {date, from, to, source, anomaly}."""
    tuesdays = _all_tuesdays(weeks)
    picks = []
    for tue in tuesdays:
        contract, source = _pick_contract(market, tue, oi_history)
        picks.append({"date": tue, "contract": contract, "source": source})

    switches = []
    for i in range(1, len(picks)):
        prev_c = picks[i - 1]["contract"]
        curr_c = picks[i]["contract"]
        if not prev_c or not curr_c:
            continue
        if prev_c == curr_c:
            continue
        # Switch detected. Anomaly = switch lands outside the expected
        # window centred on (FND(from) - ROLL_WINDOW).
        anomalies = []
        win_start, win_end = _expected_switch_window(market, prev_c)
        if picks[i]["date"] < win_start:
            anomalies.append("early")
        elif picks[i]["date"] > win_end:
            anomalies.append("late")
        # Anomaly: two switches within 3 weeks of each other (flap).
        if switches and (picks[i]["date"] - switches[-1]["date"]).days < 21:
            anomalies.append("flap")
        switches.append({
            "date":   picks[i]["date"],
            "from":   _contract_symbol(market, *prev_c),
            "to":     _contract_symbol(market, *curr_c),
            "source": picks[i]["source"],
            "expected_window": f"{win_start.isoformat()}..{win_end.isoformat()}",
            "anomaly": ",".join(anomalies) or "ok",
        })
    return switches


def cross_check_with_cot(market: str, switches: list[dict]) -> None:
    """For the recent 8 weeks (where oi_history applies), check that the
    switches the heuristic would produce match what oi_history says."""
    if not COT_JSON.exists():
        return
    data = json.loads(COT_JSON.read_text(encoding="utf-8"))
    last_8 = data[-8:]
    market_key = market
    price_field = f"price_{market}"
    contract_field = f"price_contract_{market}"
    print(f"\n--- {market.upper()} recent COT-Tuesday prices + currently-stored contract ---")
    for row in last_8:
        m = row.get(market_key) or {}
        d = row.get("date", "?")
        p = m.get(price_field)
        c = m.get(contract_field)
        print(f"  {d}: price={p!r:<12} contract={c!r}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weeks",  type=int, default=260,
                    help="Audit window (default 260 = 5y).")
    ap.add_argument("--market", choices=["ny", "ldn", "both"], default="both")
    args = ap.parse_args()

    oi_history = _load_oi_history()
    history_window = ""
    if oi_history:
        for k, label in (("arabica", "NY"), ("robusta", "LDN")):
            days = oi_history.get(k, [])
            if days:
                history_window += f" {label}={days[-1].get('date')}→{days[0].get('date')}"
    print(f"oi_history.json:{history_window or ' (not loaded)'}")
    print(f"audit window: {args.weeks} weeks ending today")
    print(f"roll-window constants: NY={ROLL_WINDOW_DAYS_BY_MARKET['ny']} biz-days  "
          f"LDN={ROLL_WINDOW_DAYS_BY_MARKET['ldn']} biz-days")

    for market in (["ny", "ldn"] if args.market == "both" else [args.market]):
        print()
        print(f"=== {market.upper()} switches ({args.weeks}w) ===")
        switches = audit_market(market, args.weeks, oi_history)
        print(f"{len(switches)} total switches detected")
        print()
        print(f"{'date':<12} {'from':<8} {'to':<8} {'source':<10} {'expected window':<24} {'status':<10}")
        print("-" * 80)
        for s in switches:
            print(f"{s['date'].isoformat():<12} {s['from']:<8} {s['to']:<8} {s['source']:<10} {s['expected_window']:<24} {s['anomaly']:<10}")
        cross_check_with_cot(market, switches)

    print()
    print("Status key:")
    print("  'ok'     — switch lands inside the ±10d expected window")
    print("  'early'  — switch BEFORE expected window (heuristic too aggressive?)")
    print("  'late'   — switch AFTER expected window (heuristic too conservative?)")
    print("  'flap'   — two switches within 3 weeks; rare in normal markets")

    return 0


if __name__ == "__main__":
    sys.exit(main())
