"""
japan_stocks.py — Japan Coffee Association monthly stock and import data.

The All Japan Coffee Association (AJCA) publishes monthly statistics at
https://www.ajca.or.jp/. Data includes import volumes, stock levels,
and apparent consumption. Most content is in Japanese; numbers are parseable.

Returns a NewsItem with source="AJCA" and meta containing monthly series.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)",
    "Accept-Language": "ja,en;q=0.9",
}
_TODAY = lambda: date.today().isoformat()

_AJCA_URLS = [
    "https://www.ajca.or.jp/",
    "https://www.ajca.or.jp/data/",
    "https://www.ajca.or.jp/toukei/",
    "https://www.ajca.or.jp/statistics/",
]

# Japan import/stock figures are typically in metric tons (60kg bags equivalent)
# Japan imports roughly 450,000 MT/year (~7.5M bags)
_IMPORT_MIN_MT = 10_000
_IMPORT_MAX_MT = 1_000_000


def _parse_ajca_data(html: str) -> dict | None:
    """Try to extract import/stock data from AJCA HTML."""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)

    # Look for tables with monthly data
    monthly_imports = []
    monthly_stocks  = []

    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            # Check if first cell looks like a date/period
            period_re = re.match(r"(\d{4})[年/-](\d{1,2})", cells[0])
            if period_re:
                yr, mo = period_re.group(1), period_re.group(2).zfill(2)
                period = f"{yr}-{mo}"
                for cell in cells[1:]:
                    m = re.search(r"([\d,]+)", cell)
                    if m:
                        try:
                            val = int(m.group(1).replace(",", ""))
                            if _IMPORT_MIN_MT < val < _IMPORT_MAX_MT:
                                monthly_imports.append({"month": period, "value_mt": val})
                                break
                        except ValueError:
                            pass

    # Fallback: parse any large MT numbers from text
    if not monthly_imports:
        for m in re.finditer(r"(\d[\d,]+)\s*(?:MT|mt|t|トン|袋|kton)", text, re.I):
            try:
                val = int(m.group(1).replace(",", ""))
                if _IMPORT_MIN_MT < val < _IMPORT_MAX_MT:
                    monthly_imports.append({"month": _TODAY()[:7], "value_mt": val, "note": "best-effort"})
                    break
            except ValueError:
                pass

    if not monthly_imports:
        return None

    latest = monthly_imports[-1]
    bags = round(latest["value_mt"] / 60 * 1000)  # MT -> 60kg bags

    return {
        "monthly_imports": monthly_imports[-24:] if len(monthly_imports) > 24 else monthly_imports,
        "latest_mt":       latest["value_mt"],
        "latest_bags":     bags,
        "period":          latest["month"],
    }


async def run(page) -> list[dict]:
    data = None

    for url in _AJCA_URLS:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3_000)
            html = await page.content()
            data = _parse_ajca_data(html)
            if data:
                break
        except Exception as e:
            print(f"[japan_stocks] {url} failed: {e}")

    if not data:
        # Try direct HTTP
        for url in _AJCA_URLS:
            try:
                r = requests.get(url, headers=_HEADERS, timeout=20)
                if r.status_code == 200:
                    data = _parse_ajca_data(r.text)
                    if data:
                        break
            except Exception:
                pass

    if not data:
        print("[japan_stocks] No data found on AJCA website")
        return []

    return [{
        "title":    f"Japan Coffee Imports (AJCA) – {data['period']}",
        "body":     f"Japan coffee imports: {data['latest_mt']:,} MT ({data['latest_bags']:,} bags) in {data['period']}.",
        "source":   "AJCA",
        "category": "demand",
        "lat":      35.68,
        "lng":      139.69,
        "tags":     ["stocks", "japan", "ajca", "demand", "imports"],
        "meta":     json.dumps(data),
    }]
