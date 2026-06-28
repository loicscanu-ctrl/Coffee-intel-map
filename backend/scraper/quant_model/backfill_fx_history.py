"""
backfill_fx_history.py
One-shot DEEP backfill of fx_history.json (the per-pair daily FX closes that
back the Coffee Currency Index) to 2020, so the open-direction model's CCI
features have multi-year history instead of the ~1y the daily jsDelivr fetcher
keeps.

Why Yahoo here (not jsDelivr like the daily job): jsDelivr's fawazahmed0 API only
serves dates >= 2024-03-02 (probed empirically), and Stooq blocks datacenter IPs.
Yahoo's chart v8 endpoint returns all tracked pairs — including the exotics
(VND, COP, IDR, PEN) and GTQ — back to 2020-01-01, and its native orientation
for these exact tickers matches the convention the daily fetcher already stores
(BRL=X = BRL-per-USD; EURUSD=X = USD-per-EUR), so the index math is unchanged.

This is a backfill, not the daily path: it runs once via workflow_dispatch and
commits the deep file. The daily fetch_currency_index.py then MERGES recent days
on top (it no longer truncates to tail(365)), so the deep history persists.

Usage:
    cd backend
    python -m scraper.quant_model.backfill_fx_history [--since 2020-01-01]
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from scraper.quant_model.fetch_currency_index import (  # noqa: E402
    EXPORTERS, IMPORTERS, FX_OUT, _safe_float,
)
from scraper.validate_export import safe_write_json  # noqa: E402

_UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")}
# GTQ is a non-CCI reference pair (Guatemala farmgate USD conversion) the daily
# job also stores; keep it in the deep file so nothing downstream regresses.
_GTQ = ("GTQ=X", "USD/GTQ", "reference", 0.0)


def _yahoo_closes(ticker: str, p1: int, p2: int) -> "pd.Series":
    """Daily close series for a Yahoo FX ticker over [p1, p2] (unix secs).
    Native orientation is preserved (matches the daily fetcher's stored shape)."""
    last = ""
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = (f"https://{host}/v8/finance/chart/{ticker}"
               f"?period1={p1}&period2={p2}&interval=1d")
        try:
            r = requests.get(url, headers=_UA, timeout=30)
            if r.status_code != 200:
                last = f"HTTP {r.status_code}"; continue
            res = r.json()["chart"]["result"][0]
            ts = res.get("timestamp") or []
            cl = (res.get("indicators", {}).get("quote", [{}])[0] or {}).get("close") or []
            data = {}
            for t, c in zip(ts, cl):
                if c is None:
                    continue
                d = datetime.utcfromtimestamp(t).date()
                data[pd.Timestamp(d)] = float(c)
            if data:
                return pd.Series(data).sort_index()
            last = "empty"
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}"
    print(f"  WARNING {ticker}: {last}", file=sys.stderr)
    return pd.Series(dtype=float)


def _merge_history(existing_pair: dict | None, closes: "pd.Series") -> list[dict]:
    """Merge a deep close series with any existing pair history (Yahoo wins on
    overlapping dates; older non-overlapping dates preserved)."""
    by_date: dict[str, float] = {}
    for row in (existing_pair or {}).get("history", []) or []:
        d, c = row.get("date"), _safe_float(row.get("close"))
        if d and c is not None:
            by_date[d] = c
    for ts, v in closes.items():
        c = _safe_float(v)
        if c is not None:
            by_date[ts.date().isoformat()] = c
    return [{"date": d, "close": by_date[d]} for d in sorted(by_date)]


def run(since: str = "2020-01-01") -> dict:
    p1 = int(datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp())
    p2 = int(datetime.now(timezone.utc).timestamp()) + 86400

    existing = {}
    if FX_OUT.exists():
        try:
            import json
            existing = (json.loads(FX_OUT.read_text(encoding="utf-8")).get("pairs") or {})
        except Exception:
            existing = {}

    pairs: dict[str, dict] = {}
    specs = ([(t, n, "export", w) for t, n, w in EXPORTERS]
             + [(t, n, "import", w) for t, n, w in IMPORTERS]
             + [_GTQ])
    for ticker, name, typ, w in specs:
        closes = _yahoo_closes(ticker, p1, p2)
        if closes.empty:
            # keep whatever we already had rather than dropping the pair
            if ticker in existing:
                pairs[ticker] = existing[ticker]
            continue
        hist = _merge_history(existing.get(ticker), closes)
        pairs[ticker] = {"name": name, "type": typ, "weight": w, "history": hist}
        span = f"{hist[0]['date']}..{hist[-1]['date']}" if hist else "—"
        print(f"  {ticker:9s} {name:18s} {len(hist):5d} closes  {span}")
        time.sleep(0.3)

    if not pairs:
        return {"ok": False, "reason": "no pairs fetched"}

    out = {
        "scraped_at":   datetime.now(timezone.utc).isoformat(),
        "history_days": max((len(p.get("history", [])) for p in pairs.values()), default=0),
        "pairs":        pairs,
        "backfilled_since": since,
    }
    safe_write_json(FX_OUT, out, lambda d: (bool(d.get("pairs")), "no fx pairs"))
    print(f"\nSaved deep fx_history → {FX_OUT}  ({len(pairs)} pairs)")
    return {"ok": True, "pairs": len(pairs), "history_days": out["history_days"]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2020-01-01")
    args = ap.parse_args()
    status = run(args.since)
    sys.exit(0 if status.get("ok") else 1)
