"""
fetch_tuesday_prices.py
Fetches and stores Tuesday settlement prices for KC (NY Arabica) and RM (London Robusta)
from Barchart after market close.

Prices are stored via upsert_cot_price() — IMMUTABLE once set.
A Tuesday price already in the DB is never overwritten by any subsequent run.

Run standalone:
    python backend/scraper/fetch_tuesday_prices.py
"""

import asyncio
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from scraper.db import create_cot_position_table, migrate_drop_cot_weekly_position_columns, upsert_cot_price

BARCHART_INIT_URL = "https://www.barchart.com/futures/quotes/KCK26/overview"


async def _fetch_chains() -> dict:
    from playwright.async_api import async_playwright
    result = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        )
        pg = await ctx.new_page()
        try:
            await pg.goto(BARCHART_INIT_URL, wait_until="domcontentloaded", timeout=30000)
            await pg.wait_for_timeout(3000)
            data = await pg.evaluate(
                """async () => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const xsrf = getCookie('XSRF-TOKEN');
                    const h = { credentials: 'include', headers: { 'x-xsrf-token': xsrf, 'accept': 'application/json' } };
                    const base = 'https://www.barchart.com/proxies/core-api/v1/quotes/get';
                    const fields = 'symbol,contractName,contractExpirationDate,lastPrice,openInterest,symbolCode';
                    const opts = '&orderBy=contractExpirationDate&orderDir=asc&limit=3&raw=1';
                    const [kcResp, rmResp] = await Promise.all([
                        fetch(base + '?symbol=KC%5EF&fields=' + fields + opts, h),
                        fetch(base + '?symbol=RM%5EF&fields=' + fields + opts, h),
                    ]);
                    return {
                        kc: kcResp.ok ? await kcResp.json() : null,
                        rm: rmResp.ok ? await rmResp.json() : null,
                    };
                }"""
            )
            result = data or {}
        except Exception as e:
            print(f"[tuesday_prices] Barchart fetch error: {e}")
        finally:
            await ctx.close()
            await browser.close()
    return result


def _max_oi_contract(raw: dict) -> tuple[float, str] | None:
    """Return (lastPrice, symbol) for the contract with the largest open interest.

    Previously this took the first non-near-expiry contract with OI >= 100,
    which is usually the front-month spec. The new rule (per user request)
    is to follow whichever contract actually carries the most liquidity —
    typically the same as the front month, but during the roll window the
    weight shifts to the next contract before the front goes into FND.
    Anchoring the COT-Tuesday price to the max-OI contract means the
    Industry Pulse chart's price track always reflects the contract the
    bulk of the market is positioning in.

    Contracts within 14 days of expiry are still excluded — those last few
    days of OI on a near-expiring contract are dominated by delivery
    mechanics, not speculative positioning, and would distort the chart.

    Returns the contract symbol alongside the price so it can be persisted
    to `price_contract_{ny,ldn}` — the Industry Pulse chart uses week-to-week
    contract changes to render switch markers.
    """
    from datetime import timedelta
    cutoff = date.today() + timedelta(days=14)
    best: tuple[int, float, str] | None = None
    for it in (raw or {}).get("data", []):
        r = it.get("raw", it)
        oi = r.get("openInterest")
        price = r.get("lastPrice")
        symbol = r.get("symbol") or ""
        if oi is None or price is None:
            continue
        exp_str = r.get("contractExpirationDate", "")
        try:
            if date.fromisoformat(exp_str) <= cutoff:
                continue
        except Exception:
            pass
        oi_int = int(oi)
        if best is None or oi_int > best[0]:
            best = (oi_int, float(price), str(symbol))
    if best is None:
        return None
    return best[1], best[2]


def _front_price(raw: dict) -> float | None:
    """Back-compat shim used by callers that only want the price."""
    hit = _max_oi_contract(raw)
    return hit[0] if hit else None


async def main() -> None:
    create_cot_position_table()
    migrate_drop_cot_weekly_position_columns()

    tuesday = date.today().isoformat()
    print(f"[tuesday_prices] Fetching settlement prices for {tuesday} ...")

    chains = await _fetch_chains()

    kc_hit = _max_oi_contract(chains.get("kc"))
    rm_hit = _max_oi_contract(chains.get("rm"))
    kc_price, kc_contract = kc_hit if kc_hit else (None, None)
    rm_price, rm_contract = rm_hit if rm_hit else (None, None)

    if kc_price is None and rm_price is None:
        print("[tuesday_prices] No prices fetched — aborting.")
        sys.exit(1)

    if kc_price is not None:
        written = upsert_cot_price("ny", tuesday, "price_ny", kc_price, contract=kc_contract)
        status = "written" if written else "skipped (already set)"
        print(f"[tuesday_prices] NY  price_ny  {tuesday} = {kc_price}¢/lb  [{kc_contract}]  → {status}")
    else:
        print("[tuesday_prices] WARNING: no KC front price available")

    if rm_price is not None:
        written = upsert_cot_price("ldn", tuesday, "price_ldn", rm_price, contract=rm_contract)
        status = "written" if written else "skipped (already set)"
        print(f"[tuesday_prices] LDN price_ldn {tuesday} = ${rm_price}/MT  [{rm_contract}]  → {status}")
    else:
        print("[tuesday_prices] WARNING: no RM front price available")


if __name__ == "__main__":
    asyncio.run(main())
