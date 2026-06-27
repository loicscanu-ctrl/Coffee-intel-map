"""
backfill_kc_at_rc_close.py
One-time historical seed for kc_at_rc_close_history.json using hourly KC
futures bars, so the open-direction model's `kc_after_rc_diff` feature can
go live immediately instead of waiting weeks for the forward capture
(capture_kc_at_rc_close.py) to accumulate.

What it produces
================
For each trading day in the last ~2 years it records the front-month Arabica
(KC) price at ~17:30 London — the ICE Robusta session close — approximated as
the MIDPOINT of the hourly bar covering 17:00–18:00 London. (KC settles at
18:30 London, RC closes 17:30 London, so the bar's midpoint is the closest
single hourly mark to 17:30; forward live captures from the 15-min poll are
more precise, and take precedence on any overlapping date.)

The output schema matches the forward capture exactly, with a `source`
provenance flag:
    {"date": "2026-06-25", "kc_at_rc_close": 311.2, "source": "yahoo_hourly_backfill"}

Source + where to run
=====================
Hourly bars come from Yahoo Finance's chart API (KC=F, interval=1h, range up
to 730d). Yahoo blocks/rate-limits some cloud IPs — including this repo's
restricted agent sandbox (proxy denies the host) and, intermittently, GitHub
Actions. So run this where Yahoo is reachable:
    * a normal dev machine / laptop (most reliable), or
    * the one-shot GitHub Actions workflow (1.95) via workflow_dispatch — the
      runner has open internet and the script retries; if Yahoo is blocked
      there it exits non-zero and you fall back to running locally.

Usage:
    cd backend
    python -m scraper.backfill_kc_at_rc_close            # merge into history
    python -m scraper.backfill_kc_at_rc_close --dry-run  # print, don't write
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT_PATH = Path(__file__).parents[2] / "frontend" / "public" / "data" / "kc_at_rc_close_history.json"

_LONDON      = ZoneInfo("Europe/London")
_RC_CLOSE_HR = 17          # the 17:00–18:00 London bar contains the 17:30 close
_KEEP_DAYS   = 730
_SOURCE      = "yahoo_hourly_backfill"
# Forward captures are 15-min precise; never let the coarser backfill overwrite
# a real one on the same date.
_PRECISE_SOURCES = {"acaphe_live", None}   # None = legacy rows w/o a source tag

_YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; coffee-intel/1.0)"}


def _fetch_hourly_kc(range_days: int = 730) -> "list[dict] | None":
    """Hourly KC=F bars as [{ts_utc, open, close}], or None if unreachable.

    Tries both Yahoo hosts. The chart API caps 1h history near 730d.
    """
    params = {"interval": "1h", "range": f"{range_days}d", "includePrePost": "false"}
    last_err = None
    for host in _YAHOO_HOSTS:
        url = f"https://{host}/v8/finance/chart/KC=F"
        for attempt in range(3):
            try:
                r = requests.get(url, params=params, headers=_HEADERS, timeout=30)
                r.raise_for_status()
                doc = r.json()
                res = (doc.get("chart") or {}).get("result")
                if not res:
                    last_err = "no chart.result"
                    break
                res0 = res[0]
                ts = res0.get("timestamp") or []
                quote = ((res0.get("indicators") or {}).get("quote") or [{}])[0]
                opens  = quote.get("open")  or []
                closes = quote.get("close") or []
                bars = []
                for i, t in enumerate(ts):
                    o = opens[i] if i < len(opens) else None
                    c = closes[i] if i < len(closes) else None
                    if o is None or c is None:
                        continue
                    bars.append({"ts_utc": int(t), "open": float(o), "close": float(c)})
                if bars:
                    print(f"[backfill] {len(bars)} hourly bars from {host}")
                    return bars
                last_err = "empty bars"
            except Exception as e:  # noqa: BLE001
                last_err = f"{type(e).__name__}: {e}"
                time.sleep(2 ** attempt)
    print(f"[backfill] Yahoo unreachable ({last_err}). Run on a host with Yahoo "
          f"access (laptop) or via the workflow_dispatch job.", file=sys.stderr)
    return None


def _kc_at_rc_close_by_day(bars: list[dict]) -> dict[str, float]:
    """Map each London trading date → KC at ~17:30 London, the midpoint of the
    17:00–18:00 London bar."""
    by_day: dict[str, float] = {}
    for b in bars:
        dt_london = datetime.fromtimestamp(b["ts_utc"], tz=timezone.utc).astimezone(_LONDON)
        if dt_london.hour != _RC_CLOSE_HR:
            continue
        date_str = dt_london.strftime("%Y-%m-%d")
        # Midpoint of the 17:00–18:00 bar ≈ price at 17:30.
        by_day[date_str] = round((b["open"] + b["close"]) / 2.0, 2)
    return by_day


def _load_history() -> list[dict]:
    if not OUT_PATH.exists():
        return []
    try:
        data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _merge(existing: list[dict], backfill: dict[str, float]) -> tuple[list[dict], int]:
    """Add backfilled dates that aren't already covered by a precise (forward)
    capture. Returns (merged_rows, n_added)."""
    by_date = {r.get("date"): r for r in existing if r.get("date")}
    added = 0
    for date_str, price in sorted(backfill.items()):
        cur = by_date.get(date_str)
        if cur is not None and cur.get("source") in _PRECISE_SOURCES:
            continue   # never clobber a 15-min-precise forward capture
        if cur is not None and cur.get("source") == _SOURCE:
            continue   # already backfilled
        by_date[date_str] = {"date": date_str, "kc_at_rc_close": price, "source": _SOURCE}
        added += 1
    merged = sorted(by_date.values(), key=lambda r: r.get("date", ""))[-_KEEP_DAYS:]
    return merged, added


def run(dry_run: bool = False) -> dict:
    bars = _fetch_hourly_kc()
    if bars is None:
        return {"ok": False, "reason": "yahoo_unreachable"}
    backfill = _kc_at_rc_close_by_day(bars)
    if not backfill:
        return {"ok": False, "reason": "no_1700_london_bars_parsed"}

    existing = _load_history()
    merged, added = _merge(existing, backfill)
    span = f"{merged[0]['date']} → {merged[-1]['date']}" if merged else "—"
    print(f"[backfill] candidate days: {len(backfill)} ({min(backfill)} → {max(backfill)}); "
          f"added {added} new rows; history now {len(merged)} rows ({span})")

    if dry_run:
        print("[backfill] --dry-run: not writing.")
    else:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        print(f"[backfill] wrote {OUT_PATH}")
    return {"ok": True, "added": added, "total": len(merged)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Backfill kc_at_rc_close_history.json from hourly KC bars.")
    ap.add_argument("--dry-run", action="store_true", help="print summary, don't write the file")
    args = ap.parse_args()
    status = run(dry_run=args.dry_run)
    sys.exit(0 if status.get("ok") else 1)
