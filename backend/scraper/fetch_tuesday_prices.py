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

from scraper.db import upsert_cot_price, migrate_cot_weekly_columns

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


def _front_price(raw: dict) -> float | None:
    """Return the lastPrice of the front contract with OI >= 100."""
    from datetime import timedelta
    cutoff = date.today() + timedelta(days=14)
    for it in (raw or {}).get("data", []):
        r = it.get("raw", it)
        oi = r.get("openInterest")
        if oi is not None and int(oi) < 100:
            continue
        exp_str = r.get("contractExpirationDate", "")
        try:
            if date.fromisoformat(exp_str) <= cutoff:
                continue
        except Exception:
            pass
        price = r.get("lastPrice")
        if price is not None:
            return float(price)
    return None


async def main() -> None:
    migrate_cot_weekly_columns()

    tuesday = date.today().isoformat()
    print(f"[tuesday_prices] Fetching settlement prices for {tuesday} ...")

    chains = await _fetch_chains()

    kc_price = _front_price(chains.get("kc"))
    rm_price = _front_price(chains.get("rm"))

    if kc_price is None and rm_price is None:
        print("[tuesday_prices] No prices fetched — aborting.")
        sys.exit(1)

    if kc_price is not None:
        written = upsert_cot_price("ny", tuesday, "price_ny", kc_price)
        status = "written" if written else "skipped (already set)"
        print(f"[tuesday_prices] NY  price_ny  {tuesday} = {kc_price}¢/lb  → {status}")
    else:
        print("[tuesday_prices] WARNING: no KC front price available")

    if rm_price is not None:
        written = upsert_cot_price("ldn", tuesday, "price_ldn", rm_price)
        status = "written" if written else "skipped (already set)"
        print(f"[tuesday_prices] LDN price_ldn {tuesday} = ${rm_price}/MT  → {status}")
    else:
        print("[tuesday_prices] WARNING: no RM front price available")


if __name__ == "__main__":
    asyncio.run(main())
