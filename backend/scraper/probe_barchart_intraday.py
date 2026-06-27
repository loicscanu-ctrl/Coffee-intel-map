"""
probe_barchart_intraday.py  —  THROWAWAY PROBE

Question: can we get ROBUSTA (RM) 15-minute intraday history from Barchart?
Yahoo has zero robusta intraday; Barchart is already integrated for quotes
(fetch_oi_json.py) and DOES carry robusta. This probe reuses that Playwright +
XSRF-token session pattern and tries Barchart's historical intraday endpoints
for the liquid front contracts (RMU26 robusta, KCU26 arabica for a sanity
control), at 15-min interval, and dumps what comes back (HTTP status, payload
size, how many bars, the time span, a sample) so we can see whether robusta
intraday is available and how deep.

Writes frontend/public/data/_probe_barchart.json for inspection. Not wired
into anything; delete after.

Usage (needs chromium): python -m scraper.probe_barchart_intraday
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT_PATH = Path(__file__).parents[2] / "frontend" / "public" / "data" / "_probe_barchart.json"
INIT_URL = "https://www.barchart.com/futures/quotes/RMU26/interactive-chart"


async def _probe() -> dict:
    from playwright.async_api import async_playwright
    out: dict = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36")
        )
        pg = await ctx.new_page()
        try:
            await pg.goto(INIT_URL, wait_until="domcontentloaded", timeout=30000)
            await pg.wait_for_timeout(3500)
            out = await pg.evaluate(
                """async () => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const xsrf = getCookie('XSRF-TOKEN');
                    const h = { credentials: 'include',
                                headers: { 'x-xsrf-token': xsrf, 'accept': 'application/json, text/plain, */*' } };

                    // Endpoint variants to try, per symbol.
                    const symbols = ['RMU26', 'KCU26', 'RM*0', 'KC*0'];
                    const builders = {
                      'queryminutes.ashx': (s) =>
                        'https://www.barchart.com/proxies/timeseries/queryminutes.ashx?symbol='
                        + encodeURIComponent(s)
                        + '&interval=15&maxrecords=400&order=asc&volume=contract&contractroll=combined',
                      'core-api/historical': (s) =>
                        'https://www.barchart.com/proxies/core-api/v1/historical/get?symbol='
                        + encodeURIComponent(s)
                        + '&type=minutes&interval=15&maxRecords=400&order=asc'
                        + '&fields=' + encodeURIComponent('tradeTime,openPrice,highPrice,lowPrice,lastPrice'),
                    };

                    const results = {};
                    for (const s of symbols) {
                      for (const [name, build] of Object.entries(builders)) {
                        const key = name + ' :: ' + s;
                        try {
                          const r = await fetch(build(s), h);
                          const text = await r.text();
                          // Count rows: CSV → lines; JSON → results length.
                          let rows = 0, span = null, sample = text.slice(0, 180);
                          const trimmed = text.trim();
                          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                            try {
                              const j = JSON.parse(trimmed);
                              const arr = j.data || j.results || (Array.isArray(j) ? j : []);
                              rows = Array.isArray(arr) ? arr.length : 0;
                              if (rows) { span = [JSON.stringify(arr[0]).slice(0,120),
                                                  JSON.stringify(arr[rows-1]).slice(0,120)]; }
                            } catch (e) {}
                          } else {
                            const lines = trimmed ? trimmed.split('\\n') : [];
                            rows = lines.length;
                            if (rows) { span = [lines[0], lines[lines.length-1]]; }
                          }
                          results[key] = { status: r.status, bytes: text.length, rows, span, sample };
                        } catch (e) {
                          results[key] = { error: String(e) };
                        }
                      }
                    }
                    return { xsrf_present: !!xsrf, results };
                }"""
            )
        except Exception as e:  # noqa: BLE001
            out = {"error": f"{type(e).__name__}: {e}"}
        finally:
            await ctx.close()
            await browser.close()
    return out


def main() -> None:
    result = asyncio.run(_probe())
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[probe] xsrf_present={result.get('xsrf_present')}")
    for key, r in (result.get("results") or {}).items():
        if "error" in r:
            print(f"[probe] {key}: ERROR {r['error'][:80]}")
        else:
            print(f"[probe] {key}: status={r['status']} bytes={r['bytes']} rows={r['rows']}")
            if r.get("span"):
                print(f"[probe]     span: {r['span'][0]}  ...  {r['span'][1]}")
    print(f"[probe] wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
