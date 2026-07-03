"""
backfill_brent_intraday.py — one-off deep backfill of Brent overnight anchors
for the open-direction model's `brent_overnight` candidate feature.

Feature definition (same anchor logic as cci_overnight):
    brent_overnight(D) = Brent at 03:00 UTC on D ÷ Brent at 17:30 London on the
                         prior trading day − 1
i.e. what crude did while London robusta was shut, known at the model's
03:00-UTC fire time. Brent trades nearly 24h on ICE, so unlike FX/CCI this IS
reconstructible historically — which means the feature can be properly
BACK-TESTED before deciding whether it enters the model.

Mechanism mirrors backfill_intraday_kc_rc.py (the proven 5.7y path): Barchart
`queryminutes.ashx` per **individual contract** (expired contracts still serve
their bars), via a Playwright page holding the XSRF cookie. Per calendar day
the FRONT contract is chosen as the one with the highest traded volume that
day (the front dominates volume; avoids expiry-calendar bugs), and both
anchors are taken from that SAME contract → roll-immune:

  * 17:30-London anchor = close of the bar starting 17:15 Europe/London
  * 03:00-UTC anchor    = close of the latest bar starting ≤ 02:45 UTC

Output (merged with any existing rows; the daily 1.16 job appends forward):
  data/brent_intraday_anchors.json
  {"scraped_at": ..., "days": [{"date": D, "symbol": "CBQ25",
      "prev_1730": 78.42, "at_0300": 78.91}]}

Run: workflow_dispatch (.github/workflows/backfill-brent-intraday.yml).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_REPO    = Path(__file__).resolve().parents[2]
OUT_PATH = _REPO / "data" / "brent_intraday_anchors.json"

_CHICAGO = ZoneInfo("America/Chicago")
_LONDON  = ZoneInfo("Europe/London")
_UTC     = ZoneInfo("UTC")

_MONTHS = "FGHJKMNQUVXZ"   # Brent lists every month


def _contracts(y0: int, y1: int) -> list[str]:
    return [f"CB{m}{yr % 100:02d}" for yr in range(y0, y1 + 1) for m in _MONTHS]


async def _fetch_contracts(symbols: list[str], maxrecords: int) -> dict[str, str]:
    """{symbol: raw_csv} — one Barchart session, sequential in-page fetches."""
    from playwright.async_api import async_playwright
    out: dict[str, str] = {}
    init = f"https://www.barchart.com/futures/quotes/{symbols[0]}/interactive-chart"
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
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': getCookie('XSRF-TOKEN'),
                                           'accept': 'text/plain,*/*' } };
                    const res = {};
                    for (const s of syms) {
                        const url = 'https://www.barchart.com/proxies/timeseries/queryminutes.ashx?symbol='
                            + encodeURIComponent(s)
                            + '&interval=15&maxrecords=' + maxrec
                            // order=desc: when maxrecords truncates, keep the LAST
                            // bars — each contract's liquid front window up to
                            // expiry. asc returned the thin EARLY life for 2025+
                            // contracts, leaving the recent tail uncovered.
                            + '&order=desc&volume=contract&contractroll=combined';
                        try { const r = await fetch(url, h); res[s] = r.ok ? await r.text() : ''; }
                        catch (e) { res[s] = ''; }
                    }
                    return res;
                }""",
                {"syms": symbols, "maxrec": maxrecords},
            )
        except Exception as e:  # noqa: BLE001
            print(f"[brent_bf] Barchart fetch error: {e}", file=sys.stderr)
        finally:
            await ctx.close()
            await browser.close()
    return out or {}


def _parse_bars(csv_text: str) -> list[tuple[datetime, float, float]]:
    """[(aware start dt, close, volume)] from a Chicago-stamped minutes CSV."""
    out = []
    for line in (csv_text or "").strip().splitlines():
        parts = line.split(",")
        if len(parts) < 6:
            continue
        try:
            ct = datetime.strptime(parts[0].strip(), "%Y-%m-%d %H:%M").replace(tzinfo=_CHICAGO)
            close = float(parts[-2]); vol = float(parts[-1])
        except (ValueError, TypeError):
            continue
        out.append((ct, close, vol))
    return out


def build_days(bars_by_sym: dict[str, list]) -> list[dict]:
    """Per calendar day: pick the max-volume (front) contract, then take both
    anchors from that SAME contract. prev_1730 = that contract's 17:30-London
    close on the latest London date before D."""
    # per symbol: volume per UTC date, 17:30-London closes, ≤02:45-UTC closes
    vol_by = defaultdict(lambda: defaultdict(float))
    l1730 = defaultdict(dict)     # sym → {london_date: close}
    u0300 = defaultdict(dict)     # sym → {utc_date: (hm, close)}
    for sym, bars in bars_by_sym.items():
        for dt, close, vol in bars:
            utc = dt.astimezone(_UTC)
            vol_by[utc.strftime("%Y-%m-%d")][sym] += vol
            ldn = dt.astimezone(_LONDON)
            if ldn.strftime("%H:%M") == "17:15":
                l1730[sym][ldn.strftime("%Y-%m-%d")] = close
            hm = utc.strftime("%H:%M")
            if hm <= "02:45":
                d = utc.strftime("%Y-%m-%d")
                cur = u0300[sym].get(d)
                if cur is None or hm > cur[0]:
                    u0300[sym][d] = (hm, close)

    rows = []
    for d in sorted(vol_by):
        sym = max(vol_by[d], key=vol_by[d].get)
        at = u0300[sym].get(d)
        prevs = [x for x in l1730[sym] if x < d]
        if at is None or not prevs:
            continue
        rows.append({"date": d, "symbol": sym,
                     "prev_1730": l1730[sym][max(prevs)], "at_0300": at[1]})
    return rows


def run(y0: int, y1: int, maxrecords: int) -> int:
    syms = _contracts(y0, y1)
    print(f"[brent_bf] fetching {len(syms)} contracts CB {y0}–{y1} …")
    raw = asyncio.run(_fetch_contracts(syms, maxrecords))
    bars_by_sym = {}
    for s in syms:
        b = _parse_bars(raw.get(s, ""))
        if b:
            bars_by_sym[s] = b
    print(f"[brent_bf] contracts with bars: {len(bars_by_sym)}")
    days = build_days(bars_by_sym)
    if not days:
        print("[brent_bf] no anchor days built — leaving existing file untouched")
        return 0

    existing = []
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding="utf-8")).get("days") or []
        except Exception:
            existing = []
    by_date = {r["date"]: r for r in existing}
    for r in days:                      # backfill wins where it overlaps
        by_date[r["date"]] = r
    merged = sorted(by_date.values(), key=lambda r: r["date"])
    OUT_PATH.write_text(json.dumps({
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "source": "Barchart queryminutes per CB contract (front = max daily volume; anchors same-contract)",
        "days": merged,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[brent_bf] wrote {len(merged)} days ({merged[0]['date']} → {merged[-1]['date']})")
    return len(merged)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-year", type=int, default=2020)
    ap.add_argument("--to-year", type=int, default=2027)
    ap.add_argument("--maxrecords", type=int, default=6000)
    args = ap.parse_args()
    n = run(args.from_year, args.to_year, args.maxrecords)
    sys.exit(0 if n else 1)
