#!/usr/bin/env python3
"""
verify_switch_prices.py — cross-check every stored contract switch in
cot.json against authoritative per-contract closes from Stooq.

Run from the repo root:
    python backend/scripts/verify_switch_prices.py

Requires only urllib (stdlib). No API keys, no installs.

For every switch in cot.json (the last 5y, post-backfill):
  1. Find the "from" and "to" contract symbols
  2. Fetch each contract's full history from Stooq as CSV
  3. Look up the Tuesday close for {pre-week, switch-week, post-week}
  4. Compare against the value stored in cot.json
  5. Print PASS / FAIL per row, with both numbers side-by-side

Exit code 0 = all PASS, 1 = at least one FAIL.

Stooq URL format:
    https://stooq.com/q/d/l/?s=kc.k26&i=d
where s = <commodity>.<month-letter><yy>. The two-letter prefix is `kc`
for Arabica and `rc` for Robusta. Free, no auth, ~60 years deep.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
COT_JSON = REPO_ROOT / "frontend" / "public" / "data" / "cot.json"

# Tolerance: settlement vs Tuesday-close can occasionally differ by 1-2
# ticks due to feed timing. ¢/lb for KC, $/MT for RC.
TOL_NY  = 1.0     # ¢/lb
TOL_LDN = 5.0     # $/MT


def stooq_symbol(market: str, contract: str) -> str:
    """KCK26 → kc.k26 ;  RCN26 → rc.n26"""
    prefix = "kc" if market == "ny" else "rc"
    letter = contract[2]
    year = contract[3:]
    return f"{prefix}.{letter.lower()}{year}"


_cache: dict[str, dict[str, float]] = {}


def fetch_stooq_closes(symbol: str) -> dict[str, float]:
    """Return {date_iso: close} for a Stooq per-contract symbol."""
    if symbol in _cache:
        return _cache[symbol]
    url = f"https://stooq.com/q/d/l/?{urllib.parse.urlencode({'s': symbol, 'i': 'd'})}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            body = r.read().decode("utf-8")
    except Exception as e:
        print(f"  [warn] Stooq fetch failed for {symbol}: {e}", file=sys.stderr)
        _cache[symbol] = {}
        return {}
    closes: dict[str, float] = {}
    for row in csv.DictReader(io.StringIO(body)):
        try:
            closes[row["Date"]] = float(row["Close"])
        except (KeyError, ValueError):
            continue
    _cache[symbol] = closes
    time.sleep(2.0)  # Stooq throttles on burst requests
    return closes


def find_switches(data: list[dict]) -> tuple[list[dict], list[dict]]:
    """Walk cot.json, return list of switches per market."""
    out_ny: list[dict] = []
    out_ldn: list[dict] = []
    prev_ny = prev_ldn = None
    prev_d_ny = prev_d_ldn = None
    for row in data:
        ny = row.get("ny") or {}
        ldn = row.get("ldn") or {}
        c_ny = ny.get("price_contract_ny")
        c_ldn = ldn.get("price_contract_ldn")
        d = row["date"]
        if c_ny and prev_ny and c_ny != prev_ny:
            out_ny.append({"date": d, "from": prev_ny, "to": c_ny, "prev_date": prev_d_ny})
        if c_ny:
            prev_ny = c_ny
            prev_d_ny = d
        if c_ldn and prev_ldn and c_ldn != prev_ldn:
            out_ldn.append({"date": d, "from": prev_ldn, "to": c_ldn, "prev_date": prev_d_ldn})
        if c_ldn:
            prev_ldn = c_ldn
            prev_d_ldn = d
    return out_ny, out_ldn


def verify_one(market: str, switch: dict, by_date: dict, ordered: list[str]) -> bool:
    """Returns True if PASS."""
    tol = TOL_NY if market == "ny" else TOL_LDN
    sym_from = stooq_symbol(market, switch["from"])
    sym_to   = stooq_symbol(market, switch["to"])
    closes_from = fetch_stooq_closes(sym_from)
    closes_to   = fetch_stooq_closes(sym_to)

    d_pre = switch["prev_date"]
    d_sw  = switch["date"]
    i = ordered.index(d_sw)
    d_pos = ordered[i + 1] if i + 1 < len(ordered) else None

    rows = []
    rows.append(("pre-week",  d_pre, switch["from"], sym_from, closes_from))
    rows.append(("switch wk", d_sw,  switch["to"],   sym_to,   closes_to))
    if d_pos:
        rows.append(("post-week", d_pos, switch["to"], sym_to, closes_to))

    print(f"\n  Switch {switch['from']} → {switch['to']} on {switch['date']}")
    ok_all = True
    for role, d, contract, _sym, closes in rows:
        stored_side = by_date[d].get(market) or {}
        stored = stored_side.get(f"price_{market}")
        stooq  = closes.get(d)
        diff = (stored - stooq) if (stored is not None and stooq is not None) else None
        status = "?" if (stored is None or stooq is None) else ("PASS" if abs(diff) <= tol else "FAIL")
        if status == "FAIL":
            ok_all = False
        diff_str = f"{diff:+.2f}" if diff is not None else "—"
        print(f"    {role:<9} {d}  contract={contract}  stooq={stooq!s:<10} stored={stored!s:<10} Δ={diff_str:<8} {status}")
    return ok_all


def main() -> int:
    data = json.loads(COT_JSON.read_text(encoding="utf-8"))
    by_date = {r["date"]: r for r in data}
    ordered = [r["date"] for r in data]

    sw_ny, sw_ldn = find_switches(data)
    print(f"Found {len(sw_ny)} NY switches, {len(sw_ldn)} LDN switches in cot.json")

    failed = 0
    print("\n=== NY ===")
    for sw in sw_ny[-5:]:
        if not verify_one("ny", sw, by_date, ordered):
            failed += 1

    print("\n=== LDN ===")
    for sw in sw_ldn[-5:]:
        if not verify_one("ldn", sw, by_date, ordered):
            failed += 1

    print(f"\nTotal failures: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
