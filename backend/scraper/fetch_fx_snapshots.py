"""
fetch_fx_snapshots.py — intraday FX anchors for the open-direction model's
`cci_overnight` feature.

For every Coffee-Currency-Index component pair it records, per session day D:

    prev_1730  the rate at 17:30 London on the PRIOR trading day (RC close)
    at_0300    the rate at 03:00 UTC on day D (the model's pre-open fire time)

so the model can compute the CCI's overnight move 17:30(D−1) → 03:00(D) with
the published index weights. There is no historical intraday FX source, so the
feature is forward-accumulating by design (activates in open_direction.py once
≥40 days exist) — this fetcher is what accumulates it.

Mechanics mirror fetch_intraday_kc_rc.py exactly (the proven CI path): Barchart
`queryminutes.ashx` 15-min bars via a Playwright page holding the XSRF cookie.
Bars are stamped America/Chicago; each is converted tz-aware, then:

  * 17:30-London anchor = CLOSE of the bar that STARTS 17:15 Europe/London
    (correct across DST, including the US/UK mismatch weeks — see the
    regression test on _parse_csv_to_london's identical conversion).
  * 03:00-UTC anchor    = CLOSE of the bar that STARTS 02:45 UTC. The rule is
    "latest bar starting ≤ 02:45 UTC that day", which stays DETERMINISTIC no
    matter how late the 03:00 cron actually fires (GH cron drift can't shift
    the anchor to a later bar).

Per-pair failures degrade gracefully (pair skipped that run); the model
requires a majority of the basket per day, so partial days simply don't count.

Output (merged, last ~500 days kept):
  frontend/public/data/fx_intraday_snapshots.json
  {"scraped_at": ..., "days": [{"date": "YYYY-MM-DD",
      "pairs": {"BRL=X": {"prev_1730": 5.43, "at_0300": 5.44}, ...}}]}
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.validate_export import safe_write_json  # noqa: E402

_REPO    = Path(__file__).resolve().parents[2]
OUT_PATH = _REPO / "frontend" / "public" / "data" / "fx_intraday_snapshots.json"

_CHICAGO = ZoneInfo("America/Chicago")
_LONDON  = ZoneInfo("Europe/London")
_UTC     = UTC

_KEEP_DAYS = 500

# CCI component ticker (fx_history.json orientation) → Barchart forex symbol.
# Orientations match: "BRL=X" stores BRL-per-USD = ^USDBRL; "EURUSD=X" stores
# USD-per-EUR = ^EURUSD. The overnight RETURN is orientation-agnostic anyway
# (the model normalises with _strength_sign), but keeping them aligned lets the
# raw levels be eyeballed against fx_history.
_BARCHART_FX = {
    "BRL=X":    "^USDBRL",
    "VND=X":    "^USDVND",
    "COP=X":    "^USDCOP",
    "IDR=X":    "^USDIDR",
    "PEN=X":    "^USDPEN",
    "EURUSD=X": "^EURUSD",
    "JPY=X":    "^USDJPY",
    "CHF=X":    "^USDCHF",
    "CNY=X":    "^USDCNY",
    "CAD=X":    "^USDCAD",
    "KRW=X":    "^USDKRW",
    "GBP=X":    "^USDGBP",
}


async def _fetch_barchart_15m(symbols: list[str], maxrecords: int) -> dict[str, str]:
    """{barchart_symbol: raw_csv} — same XSRF-cookie in-page fetch as
    fetch_intraday_kc_rc.py, initialised from a forex chart page."""
    from playwright.async_api import async_playwright
    out: dict[str, str] = {}
    init = f"https://www.barchart.com/forex/quotes/{symbols[0]}/interactive-chart"
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
            out = await pg.evaluate(
                """async ({syms, maxrec}) => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const xsrf = getCookie('XSRF-TOKEN');
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': xsrf, 'accept': 'text/plain,*/*' } };
                    const res = {};
                    for (const s of syms) {
                        const url = 'https://www.barchart.com/proxies/timeseries/queryminutes.ashx?symbol='
                            + encodeURIComponent(s)
                            + '&interval=15&maxrecords=' + maxrec
                            + '&order=asc&volume=contract&contractroll=combined';
                        try { const r = await fetch(url, h); res[s] = r.ok ? await r.text() : ''; }
                        catch (e) { res[s] = ''; }
                    }
                    return res;
                }""",
                {"syms": symbols, "maxrec": maxrecords},
            )
        except Exception as e:  # noqa: BLE001
            print(f"[fx_snaps] Barchart fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


def _parse_bars(csv_text: str) -> list[tuple[datetime, float]]:
    """[(aware start datetime, close)] from a queryminutes CSV (Chicago-stamped)."""
    out = []
    for line in (csv_text or "").strip().splitlines():
        parts = line.split(",")
        if len(parts) < 6:
            continue
        try:
            ct = datetime.strptime(parts[0].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=_CHICAGO)
            close = float(parts[-2])
        except (ValueError, TypeError):
            continue
        out.append((ct, close))
    return out


def _anchors(bars: list[tuple[datetime, float]]) -> tuple[dict, dict]:
    """(london_1730, utc_0300) anchor maps for one pair.

    london_1730[london_date] = close of the bar starting 17:15 Europe/London.
    utc_0300[utc_date]       = close of the LATEST bar starting ≤ 02:45 UTC
                               that day (i.e. the 03:00 UTC price).
    """
    l1730: dict[str, float] = {}
    u0300: dict[str, tuple[str, float]] = {}   # date → (HH:MM, close), keep max ≤ 02:45
    for dt, close in bars:
        ldn = dt.astimezone(_LONDON)
        if ldn.strftime("%H:%M") == "17:15":
            l1730[ldn.strftime("%Y-%m-%d")] = close
        utc = dt.astimezone(_UTC)
        hm = utc.strftime("%H:%M")
        if hm <= "02:45":
            d = utc.strftime("%Y-%m-%d")
            if d not in u0300 or hm > u0300[d][0]:
                u0300[d] = (hm, close)
    return l1730, {d: v for d, (_hm, v) in u0300.items()}


def _pair_days(l1730: dict, u0300: dict) -> dict[str, dict]:
    """{session date D: {prev_1730, at_0300}} — prev_1730 is the most recent
    London 17:30 anchor strictly BEFORE D."""
    out: dict[str, dict] = {}
    ldn_dates = sorted(l1730)
    for d in sorted(u0300):
        prevs = [x for x in ldn_dates if x < d]
        if not prevs:
            continue
        out[d] = {"prev_1730": l1730[prevs[-1]], "at_0300": u0300[d]}
    return out


_BRENT_SYMBOL = "CB*1"      # Barchart continuous front Brent
_BRENT_OUT    = _REPO / "data" / "brent_intraday_anchors.json"


def _update_brent_anchors(bars: list[tuple[datetime, float]]) -> int:
    """Append NEW days' Brent anchors from the continuous-front bars.

    The backfilled per-contract rows (backfill_brent_intraday.py) are higher
    quality (roll-immune) and are never overwritten — this only fills dates the
    file doesn't have yet, keeping the brent_overnight feature current daily."""
    if not bars:
        return 0
    l1730, u0300 = _anchors(bars)
    fresh = _pair_days(l1730, u0300)
    existing = []
    if _BRENT_OUT.exists():
        try:
            existing = json.loads(_BRENT_OUT.read_text(encoding="utf-8")).get("days") or []
        except Exception:
            existing = []
    have = {r["date"] for r in existing}
    added = [{"date": d, "symbol": _BRENT_SYMBOL, **rec}
             for d, rec in fresh.items() if d not in have]
    if not added:
        return 0
    days = sorted(existing + added, key=lambda r: r["date"])
    safe_write_json(_BRENT_OUT, {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "source": "backfill (per-contract) + daily continuous-front appends",
        "days": days,
    }, ensure_ascii=False, indent=1)
    return len(added)


def run(maxrecords: int = 2000) -> dict:
    tickers = list(_BARCHART_FX)
    symbols = [_BARCHART_FX[t] for t in tickers] + [_BRENT_SYMBOL]
    raw = asyncio.run(_fetch_barchart_15m(symbols, maxrecords))

    n_brent = _update_brent_anchors(_parse_bars(raw.get(_BRENT_SYMBOL, "")))
    print(f"[fx_snaps] brent anchors: +{n_brent} new day(s)")

    per_day: dict[str, dict] = {}
    ok_pairs = 0
    for ticker in tickers:
        bars = _parse_bars(raw.get(_BARCHART_FX[ticker], ""))
        if not bars:
            print(f"[fx_snaps] {ticker} ({_BARCHART_FX[ticker]}): no bars — skipped")
            continue
        ok_pairs += 1
        l1730, u0300 = _anchors(bars)
        for d, rec in _pair_days(l1730, u0300).items():
            per_day.setdefault(d, {})[ticker] = rec

    if not per_day:
        print("[fx_snaps] no usable days this run — retaining existing file")
        return {"ok": False, "pairs": ok_pairs, "days": 0}

    existing: list = []
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding="utf-8")).get("days") or []
        except Exception:
            existing = []
    by_date = {r["date"]: r for r in existing if r.get("date")}
    for d, pairs in per_day.items():
        row = by_date.setdefault(d, {"date": d, "pairs": {}})
        row["pairs"].update(pairs)      # newest fetch wins per pair

    days = sorted(by_date.values(), key=lambda r: r["date"])[-_KEEP_DAYS:]
    safe_write_json(
        OUT_PATH,
        {"scraped_at": datetime.utcnow().isoformat() + "Z", "days": days},
        ensure_ascii=False, indent=1)

    full = sum(1 for r in days if len(r["pairs"]) >= 6)
    print(f"[fx_snaps] pairs ok {ok_pairs}/{len(tickers)} · {len(days)} days stored "
          f"({full} with ≥6-pair coverage) · latest {days[-1]['date']}")
    return {"ok": True, "pairs": ok_pairs, "days": len(days)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fetch intraday FX anchors (17:30 London / 03:00 UTC) for the CCI overnight feature.")
    ap.add_argument("--maxrecords", type=int, default=2000)
    args = ap.parse_args()
    status = run(maxrecords=args.maxrecords)
    # Non-fatal by design: the open-direction model runs fine without the
    # feature until snapshots accumulate. Exit 0 either way; the log job's
    # step-level continue-on-error is belt-and-braces.
    sys.exit(0)
