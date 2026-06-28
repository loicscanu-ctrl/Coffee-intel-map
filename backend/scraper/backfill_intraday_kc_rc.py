"""
backfill_intraday_kc_rc.py
Deep backfill (target: 5 years) of the 15-min intraday points for ICE Robusta
(RM) and Arabica (KC), from Barchart's CONTINUOUS front-month series.

Why continuous + pagination
===========================
Barchart's queryminutes.ashx caps at ~5000 bars per request (~9 months at
15-min), and any single delivery contract only trades ~1-2 years. To span 5
years we use the continuous front symbols RM*0 / KC*0 — Barchart stitches the
front month across rolls AND tags every row with the real contract symbol — and
we paginate BACKWARD with the `end` param in ~9-month windows until we reach the
target horizon or Barchart's intraday history runs out (whichever first; the
achieved span is reported, never silently truncated).

Per London trading day we extract the same five points as the validated
1-month fetcher (fetch_intraday_kc_rc.py):
  rc_open_first, rc_open_0915, rc_last_1730, kc_last_1730, kc_last_1830
plus the official settles (kc_settle, rc_settle) — looked up from the daily
archive for the SAME contract each continuous bar names (canonicalised RM→RC).

Barchart timestamps are US Central; we localise to America/Chicago and convert
to Europe/London (15-min bars stay on :00/:15/:30/:45 under the whole-hour
offset, so 17:30 / 18:30 / the 09:00 open land on bar edges).

Writes frontend/public/data/intraday_kc_rc_15min.json (same schema/file the
1-month fetcher uses; this just fills far more history).

Usage (needs chromium):
    cd backend
    python -m scraper.backfill_intraday_kc_rc [--years 5]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_REPO    = Path(__file__).parents[2]
_ARCHIVE = _REPO / "data" / "contract_prices_archive.json"
OUT_PATH = _REPO / "frontend" / "public" / "data" / "intraday_kc_rc_15min.json"

_CHICAGO = ZoneInfo("America/Chicago")
_LONDON  = ZoneInfo("Europe/London")

_T_1730, _T_1830, _T_OPEN = "17:15", "18:15", "09:00"
_MAXREC  = 5000
_MAX_PAGES = 9     # 9 × ~9 months ≈ 6+ years of headroom


def _parse_continuous(csv_text: str) -> list[dict]:
    """Parse a continuous queryminutes CSV → [{ct, london, hhmm, date, symbol,
    open, close}]. Handles BOTH row shapes:
      continuous:        'RMU26,2026-06-11 05:00,11,O,H,L,C,V'  (symbol first)
      specific contract: '2026-06-11 05:00,11,O,H,L,C,V'        (datetime first)
    """
    rows = []
    for line in (csv_text or "").strip().splitlines():
        parts = line.split(",")
        if len(parts) < 6:
            continue
        # Locate the datetime field: parts[0] if it parses, else parts[1].
        sym, dt_str = None, parts[0].strip()
        try:
            ct = datetime.strptime(dt_str, "%Y-%m-%d %H:%M")
        except ValueError:
            if len(parts) < 7:
                continue
            sym, dt_str = parts[0].strip(), parts[1].strip()
            try:
                ct = datetime.strptime(dt_str, "%Y-%m-%d %H:%M")
            except ValueError:
                continue
        try:
            o, _h, _l, c, _v = (float(x) for x in parts[-5:])
        except (ValueError, TypeError):
            continue
        ct = ct.replace(tzinfo=_CHICAGO)
        ldn = ct.astimezone(_LONDON)
        rows.append({"ct": ct, "london": ldn, "hhmm": ldn.strftime("%H:%M"),
                     "date": ldn.strftime("%Y-%m-%d"), "symbol": sym,
                     "open": o, "close": c})
    return rows


async def _fetch_continuous_paginated(symbol: str, years: int) -> list[dict]:
    """All continuous bars for `symbol` back `years`, by walking the `end`
    param backward. Reuses one authenticated Barchart page (XSRF cookie)."""
    from playwright.async_api import async_playwright
    horizon = datetime.now(timezone.utc) - timedelta(days=365 * years + 5)
    all_rows: list[dict] = []
    seen_ts: set = set()
    init = "https://www.barchart.com/futures/quotes/RMU26/interactive-chart"

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"))
        pg = await ctx.new_page()
        try:
            await pg.goto(init, wait_until="domcontentloaded", timeout=30000)
            await pg.wait_for_timeout(3500)
            end = ""   # empty → most recent
            for page_i in range(_MAX_PAGES):
                csv = await pg.evaluate(
                    """async ({sym, end, maxrec}) => {
                        function getCookie(n){const v=document.cookie.match('(^|;) ?'+n+'=([^;]*)(;|$)');return v?decodeURIComponent(v[2]):null;}
                        const h={credentials:'include',headers:{'x-xsrf-token':getCookie('XSRF-TOKEN'),'accept':'text/plain,*/*'}};
                        let url='https://www.barchart.com/proxies/timeseries/queryminutes.ashx?symbol='
                          +encodeURIComponent(sym)+'&interval=15&maxrecords='+maxrec
                          +'&order=asc&volume=contract&contractroll=combined';
                        if (end) url += '&end=' + end;
                        try{const r=await fetch(url,h);return r.ok?await r.text():'';}catch(e){return '';}
                    }""",
                    {"sym": symbol, "end": end, "maxrec": _MAXREC},
                )
                rows = _parse_continuous(csv)
                fresh = [r for r in rows if r["ct"].isoformat() not in seen_ts]
                if not fresh:
                    break
                for r in fresh:
                    seen_ts.add(r["ct"].isoformat())
                all_rows.extend(fresh)
                oldest = min(r["ct"] for r in fresh)
                print(f"[backfill5y] {symbol} page {page_i+1}: +{len(fresh)} bars, "
                      f"oldest now {oldest.date()}")
                if oldest <= horizon:
                    break
                # Next window ends just before the current oldest bar.
                end = (oldest - timedelta(minutes=1)).astimezone(_CHICAGO).strftime("%Y%m%d%H%M%S")
                await pg.wait_for_timeout(800)
        except Exception as e:  # noqa: BLE001
            print(f"[backfill5y] {symbol} fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return all_rows


def _index(rows: list[dict]) -> dict[str, dict[str, dict]]:
    out: dict[str, dict[str, dict]] = defaultdict(dict)
    for r in rows:
        out[r["date"]][r["hhmm"]] = r
    return out


def _archive_all_settles() -> dict[str, dict[str, float]]:
    """{market: {f'{date}|{canonical_symbol}': settle}} for fast lookup."""
    try:
        arch = json.loads(_ARCHIVE.read_text(encoding="utf-8"))
    except Exception:
        return {"arabica": {}, "robusta": {}}
    out = {"arabica": {}, "robusta": {}}
    for market in ("arabica", "robusta"):
        for day, contracts in (arch.get(market) or {}).items():
            for sym, rec in (contracts or {}).items():
                if rec and rec.get("price") is not None:
                    out[market][f"{day}|{sym}"] = float(rec["price"])
    return out


def run(years: int = 5) -> dict:
    from scraper.symbols import to_canonical
    rc_rows = asyncio.run(_fetch_continuous_paginated("RM*0", years))
    kc_rows = asyncio.run(_fetch_continuous_paginated("KC*0", years))
    if not rc_rows and not kc_rows:
        return {"ok": False, "reason": "no bars returned from Barchart"}

    rc_idx, kc_idx = _index(rc_rows), _index(kc_rows)
    settles = _archive_all_settles()

    def _settle(market: str, day: str, sym: "str | None") -> "float | None":
        if not sym:
            return None
        return settles.get(market, {}).get(f"{day}|{to_canonical(sym)}")

    days = sorted(set(rc_idx) | set(kc_idx))
    out_rows = []
    for day in days:
        rd, kd = rc_idx.get(day, {}), kc_idx.get(day, {})
        first_rc = rd.get(_T_OPEN)
        rc_sym = (first_rc or rd.get(_T_1730) or {}).get("symbol")
        kc_sym = (kd.get(_T_1730) or kd.get(_T_1830) or {}).get("symbol")
        out_rows.append({
            "date":          day,
            "rc_open_first": (first_rc or {}).get("open"),
            "rc_open_0915":  (first_rc or {}).get("close"),
            "rc_last_1730":  (rd.get(_T_1730) or {}).get("close"),
            "kc_last_1730":  (kd.get(_T_1730) or {}).get("close"),
            "kc_last_1830":  (kd.get(_T_1830) or {}).get("close"),
            "rc_settle":     _settle("robusta", day, rc_sym),
            "kc_settle":     _settle("arabica", day, kc_sym),
            "rc_symbol":     rc_sym,
            "kc_symbol":     kc_sym,
        })

    OUT_PATH.write_text(json.dumps(out_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    span = f"{out_rows[0]['date']} → {out_rows[-1]['date']}" if out_rows else "—"
    def _cov(k): return sum(1 for r in out_rows if r.get(k) is not None)
    print(f"[backfill5y] {len(out_rows)} days, span {span}")
    print("[backfill5y] coverage: " + ", ".join(
        f"{k}={_cov(k)}" for k in
        ["rc_open_first", "rc_open_0915", "rc_last_1730", "kc_last_1730",
         "kc_last_1830", "rc_settle", "kc_settle"]))
    print(f"[backfill5y] wrote {OUT_PATH}")
    return {"ok": True, "days": len(out_rows), "span": span}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="5-year intraday backfill of KC/RC 15-min points.")
    ap.add_argument("--years", type=int, default=5)
    args = ap.parse_args()
    status = run(years=args.years)
    sys.exit(0 if status.get("ok") else 1)
