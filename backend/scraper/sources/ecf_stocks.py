"""
ecf_stocks.py — European Coffee Federation green coffee stocks scraper.

ECF publishes monthly stock data for European ports (Hamburg, Antwerp,
Trieste, Le Havre, Barcelona, Amsterdam, Bremen, Genoa, Rotterdam).
Data is available on ecf-coffee.org as HTML tables or downloadable Excel.

Returns a NewsItem with source="ECF" and meta containing monthly stock series.
"""
from __future__ import annotations

import json
import re
from datetime import date

import requests
from bs4 import BeautifulSoup

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}
def _today() -> str:
    return date.today().isoformat()

# ECF statistics pages — try in order
_ECF_URLS = [
    "https://www.ecf-coffee.org/resources/statistics/",
    "https://www.ecf-coffee.org/knowledge/statistics/",
    "https://www.ecf-coffee.org/statistics/",
    "https://www.ecf-coffee.org/",
]

# Typical ECF stock range: 8-18 million 60-kg bags stored in EU ports
_STOCK_MIN_BAGS = 1_000_000
_STOCK_MAX_BAGS = 30_000_000


def _parse_ecf_stocks(html: str) -> list[dict] | None:
    """Try to extract monthly stock table from ECF HTML."""
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)

    # Pattern: look for numbers near "bags" or "tonnes" in a table
    # ECF data is typically in thousands of 60-kg bags
    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        header_row = rows[0] if rows else None
        if not header_row:
            continue

        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
        if not any(kw in " ".join(headers) for kw in ["month", "year", "bags", "stock", "total"]):
            continue

        monthly = []
        for row in rows[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) < 2:
                continue
            # Try to find date + number
            date_cell = cells[0]
            for cell in cells[1:]:
                m = re.search(r"([\d,. ]+)", cell)
                if m:
                    try:
                        val_str = m.group(1).replace(",", "").replace(" ", "").replace(".", "")
                        val = int(val_str)
                        if 10_000 < val < 100_000_000:
                            monthly.append({"period": date_cell, "value_raw": val})
                    except ValueError:
                        pass

        if len(monthly) >= 3:
            return monthly

    # Fallback: look for any bold/large numbers near stock keywords
    candidates = []
    for m in re.finditer(r"(\d[\d,. ]+)\s*(?:thousand bags|t bags|000 bags|M bags|bags|60-kg)", text, re.I):
        try:
            raw = m.group(1).replace(",", "").replace(" ", "").replace(".", "")
            val = int(raw)
            if _STOCK_MIN_BAGS / 1000 < val < _STOCK_MAX_BAGS / 1000:
                # Likely in thousands
                candidates.append(val * 1000)
            elif _STOCK_MIN_BAGS < val < _STOCK_MAX_BAGS:
                candidates.append(val)
        except ValueError:
            pass

    if candidates:
        return [{"period": _today(), "value_raw": candidates[0], "note": "best-effort parse"}]

    return None


async def run(page) -> list[dict]:
    stocks_data = None
    source_url = None

    for url in _ECF_URLS:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3_000)
            html = await page.content()
            parsed = _parse_ecf_stocks(html)
            if parsed:
                stocks_data = parsed
                source_url = url
                break
        except Exception as e:
            print(f"[ecf_stocks] {url} failed: {e}")

    if not stocks_data:
        # Try direct HTTP without browser (ECF may serve tables without JS)
        for url in _ECF_URLS:
            try:
                r = requests.get(url, headers=_HEADERS, timeout=20)
                if r.status_code == 200:
                    parsed = _parse_ecf_stocks(r.text)
                    if parsed:
                        stocks_data = parsed
                        source_url = url
                        break
            except Exception:
                pass

    if not stocks_data:
        print("[ecf_stocks] No stock data found on ECF website")
        return []

    latest = stocks_data[-1] if isinstance(stocks_data, list) else stocks_data
    value_bags = latest.get("value_raw", 0)

    return [{
        "title":    f"ECF European Port Stocks – {_today()}",
        "body":     f"ECF European green coffee stocks: {value_bags:,} bags ({value_bags // 1_000_000:.1f}M bags). Source: {source_url}",
        "source":   "ECF",
        "category": "demand",
        "lat":      51.5,
        "lng":      5.0,
        "tags":     ["stocks", "europe", "ecf", "demand"],
        "meta":     json.dumps({
            "monthly":    stocks_data,
            "latest_bags": value_bags,
            "as_of":       _today(),
            "source_url":  source_url,
        }),
    }]
