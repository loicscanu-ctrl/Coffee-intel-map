"""
trial_15min_kc_rc.py  —  ONE-MONTH TRIAL (verification, not production)

Goal: confirm we can gather, per trading day, the exact data points the
open-direction feature needs at 15-minute resolution (which lands cleanly on
the :30 boundaries, unlike hourly bars). For each London trading day in the
last ~1 month it collects:

  1. at 17:30 London (ICE Robusta close): last-traded ARABICA (KC) and
     ROBUSTA (RC)                                        → kc_last_1730, rc_last_1730
  2. at 18:30 London (ICE Arabica settle): last-traded ARABICA (KC)
                                                          → kc_last_1830
  3. SETTLEMENT price for both KC and RC (the official daily settle, distinct
     from last-traded) — gathered now, used in a later stage
                                                          → kc_settle, rc_settle
  4. ROBUSTA open 15 min after its open = the first 15-min bar (09:00–09:15
     London) close                                       → rc_open_0915

15-min bars are timestamped at the bar START (… 17:15, 17:30 …), so the price
"at 17:30" is the CLOSE of the 17:15→17:30 bar; "at 18:30" is the close of the
18:15→18:30 bar; "RC 15 min after open" is the close of the 09:00→09:15 bar.

Intraday bars: Yahoo chart API, interval=15m, range≈1mo (Yahoo caps 15m near
60 days). Robusta is fetched as RM=F — the platform's notes say Yahoo's RM=F
*daily continuous* has been unreliable, so a KEY purpose of this trial is to
see whether RM=F INTRADAY actually returns data. The settlement prices come
from the in-repo daily archive (data/contract_prices_archive.json), which is
the official Barchart settle.

Writes a small inspect file (frontend/public/data/_trial_15min_kc_rc.json) and
prints a per-day table. This is a throwaway probe — not wired into anything.

Usage:
    cd backend
    python -m scraper.trial_15min_kc_rc
"""
from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT     = Path(__file__).parents[2]
_ARCHIVE  = _ROOT / "data" / "contract_prices_archive.json"
OUT_PATH  = _ROOT / "frontend" / "public" / "data" / "_trial_15min_kc_rc.json"

_LONDON   = ZoneInfo("Europe/London")
_YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
_HEADERS  = {"User-Agent": "Mozilla/5.0 (compatible; coffee-intel/1.0)"}


def _fetch_15m(symbol: str, range_str: str = "1mo") -> "list[dict] | None":
    """15-min bars for `symbol` as [{ts_utc, open, close}] (London-naive
    handled by caller). None if the symbol returns nothing on either host."""
    params = {"interval": "15m", "range": range_str, "includePrePost": "false"}
    last_err = None
    for host in _YAHOO_HOSTS:
        url = f"https://{host}/v8/finance/chart/{symbol}"
        for attempt in range(3):
            try:
                r = requests.get(url, params=params, headers=_HEADERS, timeout=30)
                r.raise_for_status()
                res = (r.json().get("chart") or {}).get("result")
                if not res:
                    last_err = "no chart.result"
                    break
                res0 = res[0]
                ts = res0.get("timestamp") or []
                q = ((res0.get("indicators") or {}).get("quote") or [{}])[0]
                opens, closes = q.get("open") or [], q.get("close") or []
                bars = []
                for i, t in enumerate(ts):
                    o = opens[i] if i < len(opens) else None
                    c = closes[i] if i < len(closes) else None
                    if o is None or c is None:
                        continue
                    bars.append({"ts_utc": int(t), "open": float(o), "close": float(c)})
                if bars:
                    print(f"[trial] {symbol}: {len(bars)} 15m bars from {host}")
                    return bars
                last_err = "empty bars"
            except Exception as e:  # noqa: BLE001
                last_err = f"{type(e).__name__}: {e}"
                time.sleep(2 ** attempt)
    print(f"[trial] {symbol}: NO DATA ({last_err})", file=sys.stderr)
    return None


def _index_by_day_time(bars: "list[dict] | None") -> dict[str, dict[str, dict]]:
    """{london_date: {"HH:MM": bar}} keyed by the bar's London START time."""
    out: dict[str, dict[str, dict]] = defaultdict(dict)
    for b in bars or []:
        dt = datetime.fromtimestamp(b["ts_utc"], tz=timezone.utc).astimezone(_LONDON)
        out[dt.strftime("%Y-%m-%d")][dt.strftime("%H:%M")] = b
    return out


def _close_at(day_bars: dict[str, dict], start_hhmm: str) -> "float | None":
    """Close of the bar that STARTS at start_hhmm (so its close is the price
    at start+15min)."""
    bar = day_bars.get(start_hhmm)
    return bar["close"] if bar else None


def _archive_settles() -> dict[str, dict[str, float]]:
    """{date: {"kc": front_settle, "rc": front_settle}} from the daily archive
    (official Barchart settle, front month = first contract key per day)."""
    out: dict[str, dict[str, float]] = {}
    try:
        arch = json.loads(_ARCHIVE.read_text(encoding="utf-8"))
    except Exception:
        return out

    def _front(market: dict, day: str) -> "float | None":
        contracts = market.get(day) or {}
        for sym in contracts:
            px = (contracts[sym] or {}).get("price")
            if px is not None:
                return float(px)
        return None

    ar, rb = arch.get("arabica") or {}, arch.get("robusta") or {}
    for day in set(ar) | set(rb):
        out[day] = {}
        kc = _front(ar, day)
        rc = _front(rb, day)
        if kc is not None:
            out[day]["kc"] = kc
        if rc is not None:
            out[day]["rc"] = rc
    return out


def run() -> dict:
    kc_bars = _fetch_15m("KC=F")
    # Robusta is the open question — probe several candidate Yahoo symbols and
    # use the first that returns intraday bars.
    rc_bars = None
    rc_symbol = None
    for cand in ["RM=F", "RC=F", "LRC=F", "RMF.NYM", "LCF=F", "D=F"]:
        b = _fetch_15m(cand)
        if b:
            rc_bars, rc_symbol = b, cand
            print(f"[trial] robusta intraday FOUND via {cand}")
            break
    if rc_bars is None:
        print("[trial] robusta intraday: NONE of the candidate symbols returned data",
              file=sys.stderr)
    if kc_bars is None and rc_bars is None:
        return {"ok": False, "reason": "no intraday data for either symbol"}

    kc_idx = _index_by_day_time(kc_bars)
    rc_idx = _index_by_day_time(rc_bars)
    settles = _archive_settles()

    days = sorted(set(kc_idx) | set(rc_idx))
    rows = []
    for day in days:
        kd, rd = kc_idx.get(day, {}), rc_idx.get(day, {})
        row = {
            "date":          day,
            # 1. at 17:30 London (close of the 17:15→17:30 bar)
            "kc_last_1730":  _close_at(kd, "17:15"),
            "rc_last_1730":  _close_at(rd, "17:15"),
            # 2. at 18:30 London (close of the 18:15→18:30 bar)
            "kc_last_1830":  _close_at(kd, "18:15"),
            # 4. robusta 15 min after open (close of the 09:00→09:15 bar)
            "rc_open_0915":  _close_at(rd, "09:00"),
            # 3. official settles from the archive
            "kc_settle":     settles.get(day, {}).get("kc"),
            "rc_settle":     settles.get(day, {}).get("rc"),
        }
        rows.append(row)

    # Keep only rows where at least the core intraday points are present.
    OUT_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # ── Inspection table ──────────────────────────────────────────────────────
    rc_intraday_days = sum(1 for r in rows if r["rc_last_1730"] is not None or r["rc_open_0915"] is not None)
    print(f"[trial] {len(rows)} days; robusta-intraday present on {rc_intraday_days}; "
          f"robusta symbol={rc_symbol or 'NONE'} → "
          f"{'WORKS' if rc_intraday_days else 'EMPTY (no Yahoo robusta intraday)'}")
    print("\n date        kc@1730  rc@1730  kc@1830  rc_open0915  kc_settle  rc_settle")
    for r in rows[-22:]:   # last ~month of trading days
        def f(x): return f"{x:8.2f}" if isinstance(x, (int, float)) else "    —   "
        print(f" {r['date']}  {f(r['kc_last_1730'])} {f(r['rc_last_1730'])} "
              f"{f(r['kc_last_1830'])} {f(r['rc_open_0915'])}   {f(r['kc_settle'])} {f(r['rc_settle'])}")
    print(f"\n[trial] wrote {OUT_PATH}")
    return {"ok": True, "days": len(rows), "rc_intraday_days": rc_intraday_days}


if __name__ == "__main__":
    status = run()
    sys.exit(0 if status.get("ok") else 1)
