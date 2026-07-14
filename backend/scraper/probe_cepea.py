"""
Diagnostic probe: why does the CEPEA/ESALQ coffee scrape return nothing?

news.json carries 0 "CEPEA/ESALQ" items, so brazil_arabica (whose only source is
this scrape) never populates. This probe reproduces the scraper's fetch in CI and
reports exactly where it breaks — anti-bot block vs. page-structure change:

  1. Playwright stealth render of the indicator page (the scraper's path):
     HTTP status, <title>, #tables, price-like matches, visible-text sample,
     and what _parse_price_table() extracts.
  2. Plain HTTP GET with browser headers (is it a hard 403/Cloudflare wall?).
  3. The CEPEA JSON "consulta" series endpoints (a structured fallback that
     bypasses the rendered table entirely, if reachable).

Pure diagnostic — no DB, no commits. Run via the "Probe: CEPEA" workflow.
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

DEBUG = Path("debug/cepea_probe")
DEBUG.mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

URL = "https://www.cepea.org.br/en/indicator/coffee.aspx"
URL_BR = "https://www.cepea.org.br/br/indicador/cafe.aspx"
PRICE_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")

# CEPEA's site AJAX endpoint that feeds the indicator chart/table with a JSON
# series — product IDs: 23 = Arábica (ESALQ/BM&F), 24 = Robusta/Conilon.
CONSULTA = ("https://www.cepea.org.br/br/aynzul/consultarserie.js.php"
            "?id_indicador[]={pid}")


def plain_get(url: str) -> None:
    print(f"\n[http] GET {url}")
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
        print(f"   HTTP {r.status}  {len(body)} bytes")
        prices = PRICE_RE.findall(body)
        print(f"   price-like matches: {len(prices)} (first: {prices[:5]})")
    except Exception as e:  # noqa: BLE001
        print(f"   failed: {type(e).__name__}: {e}")


def consulta(pid: int, name: str) -> None:
    url = CONSULTA.format(pid=pid)
    print(f"\n[consulta] {name} (id={pid}) {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                   "Referer": URL_BR})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
        print(f"   HTTP {r.status}  {len(body)} bytes")
        print(f"   head: {body[:400]!r}")
    except Exception as e:  # noqa: BLE001
        print(f"   failed: {type(e).__name__}: {e}")


async def render() -> None:
    try:
        from playwright_stealth import Stealth
    except ImportError:
        Stealth = None
        print("[render] playwright_stealth NOT importable")
    from playwright.async_api import async_playwright

    from scraper.sources.cepea import _parse_price_table  # reuse the real parser

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for url in (URL, URL_BR):
            ctx = await browser.new_context(user_agent=UA, locale="pt-BR")
            pg = await ctx.new_page()
            if Stealth:
                try:
                    await Stealth().apply_stealth_async(pg)
                except Exception as e:  # noqa: BLE001
                    print(f"[render] stealth apply failed: {e}")
            print(f"\n{'='*60}\n[render] {url}")
            try:
                resp = await pg.goto(url, wait_until="networkidle", timeout=45000)
                print(f"   goto HTTP {resp.status if resp else '?'}")
            except Exception as e:  # noqa: BLE001
                print(f"   goto error: {type(e).__name__}: {e}")
            await pg.wait_for_timeout(6000)
            try:
                html = await pg.content()
            except Exception as e:  # noqa: BLE001
                print(f"   content error: {e}")
                await ctx.close()
                continue
            fn = "en" if "/en/" in url else "br"
            (DEBUG / f"cepea_{fn}.html").write_text(html, encoding="utf-8")
            title = await pg.title()
            ntables = len(await pg.query_selector_all("table"))
            nselects = len(await pg.query_selector_all("select"))
            from bs4 import BeautifulSoup
            text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
            prices = PRICE_RE.findall(text)
            price, dstr = _parse_price_table(html)
            print(f"   title={title!r}")
            print(f"   tables={ntables} selects={nselects} bytes={len(html)}")
            print(f"   price-like in text: {len(prices)} (first {prices[:6]})")
            print(f"   _parse_price_table → price={price} date={dstr}")
            # cloudflare/challenge signatures
            low = text.lower()
            for sig in ("just a moment", "verify you are human", "cloudflare",
                        "access denied", "captcha", "attention required"):
                if sig in low:
                    print(f"   ⚠ challenge signature: {sig!r}")
            print(f"   text[:400]: {text[:400]!r}")
            await ctx.close()
        await browser.close()


async def main() -> None:
    plain_get(URL)
    plain_get(URL_BR)
    consulta(23, "Arabica")
    consulta(24, "Conilon")
    await render()


if __name__ == "__main__":
    asyncio.run(main())
