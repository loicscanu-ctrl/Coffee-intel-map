"""
ethiopia.py — Ethiopia coffee data scraper.

Sources:
  ECX (Ethiopian Coffee Exchange): daily auction prices (best-effort).
  ICO historical CSV: monthly green coffee exports for Ethiopia.

Ethiopia is the world's largest arabica-origin country and 5th largest exporter.
100% arabica; main harvest Oct-Jan; second crop Mar-May.
Key grade: Grade 1/2 natural (Harrar, Sidama) and washed (Yirgacheffe, Limu).
"""
from __future__ import annotations

import json
import re
from datetime import date

from bs4 import BeautifulSoup

from scraper.sources._ico_common import fetch_ico_exports


def _today() -> str:
    return date.today().isoformat()
_LAT, _LNG = 9.145, 40.489   # Ethiopia centroid

# ECX (Ethiopian Coffee Exchange) — best-effort price scrape
# ECX posts daily price reports; URL may vary by release
_ECX_URLS = [
    "https://www.ecx.com.et/",
    "https://www.ecx.com.et/CoffeeMarketSummary.aspx",
    "https://www.ecx.com.et/MarketData.aspx",
]

# Sanity check: ETB per kg, typical 50-150 ETB/kg
_PRICE_MIN_ETB = 30.0
_PRICE_MAX_ETB = 500.0


def _extract_ecx_price(html: str) -> dict | None:
    """Try to extract ECX coffee price from HTML. Returns dict or None."""
    soup = BeautifulSoup(html, "html.parser")
    _text = soup.get_text(" ", strip=True)

    # Pattern: "Coffee" near a number like "85.50" or "85,50"
    # ECX quotes Grade 1-5 prices in ETB/kg
    price_re = re.compile(r"(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:ETB|birr)?", re.I)
    context_re = re.compile(r"(?:coffee|washed|natural|grade\s*[1-5]|arabica)", re.I)

    candidates = []
    for tag in soup.find_all(string=context_re):
        parent = tag.find_parent()
        if parent:
            sibling_text = parent.get_text(" ", strip=True)
            for m in price_re.finditer(sibling_text):
                raw = m.group(1).replace(",", ".")
                try:
                    val = float(raw)
                    if _PRICE_MIN_ETB <= val <= _PRICE_MAX_ETB:
                        candidates.append(val)
                except ValueError:
                    pass

    if not candidates:
        return None

    from collections import Counter
    price = Counter(candidates).most_common(1)[0][0]
    return {
        "etb_per_kg": price,
        "as_of": _today(),
        "source": "ECX",
        "grade": "All grades avg",
    }


async def run(page) -> list[dict]:
    results = []

    # 1. ECX price (Playwright — best-effort)
    ecx_price = None
    for url in _ECX_URLS:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3_000)
            html = await page.content()
            ecx_price = _extract_ecx_price(html)
            if ecx_price:
                break
        except Exception as e:
            print(f"[ethiopia] ECX {url} failed: {e}")

    if ecx_price:
        results.append({
            "title":    f"Ethiopia ECX Coffee Price – {_today()}",
            "body":     f"ECX auction price: {ecx_price['etb_per_kg']:.2f} ETB/kg as of {ecx_price['as_of']}.",
            "source":   "ECX",
            "category": "supply",
            "lat":      _LAT,
            "lng":      _LNG,
            "tags":     ["price", "ethiopia", "ecx", "arabica"],
            "meta":     json.dumps(ecx_price),
        })
    else:
        print("[ethiopia] ECX price not found — skipping")

    # 2. ICO monthly exports (pure HTTP)
    monthly = fetch_ico_exports({"ethiopia"}, "ethiopia")
    if monthly:
        last = monthly[-1]
        results.append({
            "title":    f"Ethiopia Coffee Exports (ICO) – {last['month']}",
            "body":     (
                f"Ethiopia green coffee exports: {last['total_k_bags']:,}k bags in {last['month']}."
                + (f" YoY: {last['yoy_pct']:+.1f}%" if last.get("yoy_pct") is not None else "")
            ),
            "source":   "ICO",
            "category": "supply",
            "lat":      _LAT,
            "lng":      _LNG,
            "tags":     ["exports", "ethiopia", "ico"],
            "meta":     json.dumps({
                "monthly":      monthly,
                "last_updated": last["month"],
                "unit":         "thousand 60-kg bags",
            }),
        })

    return results
