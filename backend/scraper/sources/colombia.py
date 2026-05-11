"""
colombia.py — Colombia coffee data scraper.

Sources:
  FNC (Federación Nacional de Cafeteros): precio interno (daily farmer buy price)
  ICO historical CSV: monthly green coffee exports for Colombia (same source as Vietnam)

Returns NewsItem-shaped dicts for upsert_news_item().
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime

import requests

_TODAY = lambda: date.today().isoformat()
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

# ── ICO exports CSV ───────────────────────────────────────────────────────────

_ICO_CSV_URL = (
    "https://www.ico.org/historical/1990%20onwards/CSV/"
    "2b%20-%20Exports%20of%20green%20coffee.csv"
)
_COL_NAMES = {"colombia"}


def _parse_ico_colombia(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    rows   = list(reader)
    country_col = (reader.fieldnames or [""])[0]
    col_row = next(
        (r for r in rows if r.get(country_col, "").strip().lower() in _COL_NAMES),
        None,
    )
    if col_row is None:
        return []

    monthly: list[dict] = []
    for col, val in col_row.items():
        if col == country_col:
            continue
        m = re.match(r"(\d{4})\s+([A-Za-z]{3})", col.strip())
        if not m:
            continue
        try:
            dt = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y %b")
        except ValueError:
            continue
        try:
            bags_k = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            continue
        if bags_k <= 0:
            continue
        monthly.append({"month": f"{dt.year}-{dt.month:02d}", "total_k_bags": round(bags_k, 1)})

    monthly.sort(key=lambda x: x["month"])
    if len(monthly) > 48:
        monthly = monthly[-48:]

    # Add YoY %
    by_month = {r["month"]: r["total_k_bags"] for r in monthly}
    result = []
    for r in monthly:
        ym = r["month"]
        yr, mo = ym.split("-")
        ly = f"{int(yr) - 1}-{mo}"
        ly_val = by_month.get(ly)
        yoy = None
        if ly_val and ly_val > 0:
            yoy = round((r["total_k_bags"] - ly_val) / ly_val * 100, 1)
        result.append({**r, "yoy_pct": yoy})
    return result


def _fetch_ico_exports() -> list[dict]:
    try:
        r = requests.get(_ICO_CSV_URL, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        return _parse_ico_colombia(r.text)
    except Exception as e:
        print(f"[colombia] ICO CSV fetch failed: {e}")
        return []


# ── FNC precio interno ─────────────────────────────────────────────────────────

_FNC_URLS = [
    "https://federaciondecafeteros.org/wp/precio-del-cafe/",
    "https://federaciondecafeteros.org/",
]

# Regex: "$1,800,000" or "1.800.000" or "1800000" near "carga" / "kg"
_PRICE_RE = re.compile(
    r"\$?\s*([\d][,.\d]+)\s*(?:COP|pesos?)?",
    re.IGNORECASE,
)
_CARGA_RE = re.compile(
    r"(?:por\s+carga|precio\s+interno|carga\s+de\s+125|precio\s+caf[eé])",
    re.IGNORECASE,
)


def _extract_precio_interno(html: str) -> dict | None:
    """Try to extract precio interno (COP per 125-kg load) from page HTML."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)

    # Find paragraphs / divs with "precio interno" or "por carga" context
    candidates = []
    for tag in soup.find_all(string=_CARGA_RE):
        parent_text = tag.parent.get_text(" ", strip=True) if tag.parent else str(tag)
        m = _PRICE_RE.search(parent_text)
        if m:
            raw = m.group(1).replace(".", "").replace(",", "")
            try:
                val = int(raw)
                if 500_000 < val < 10_000_000:  # sanity: 500k–10M COP/carga
                    candidates.append(val)
            except ValueError:
                pass

    if not candidates:
        # Broader fallback: look for any large number near "COP" in page text
        for m in re.finditer(r"([\d][.,\d]+)\s*(?:cop|pesos?)", text, re.IGNORECASE):
            raw = m.group(1).replace(".", "").replace(",", "")
            try:
                val = int(raw)
                if 500_000 < val < 10_000_000:
                    candidates.append(val)
            except ValueError:
                pass

    if not candidates:
        return None

    # Take the most common value (or largest if all unique)
    from collections import Counter
    most_common = Counter(candidates).most_common(1)[0][0]
    return {"cop_per_carga": most_common, "as_of": _TODAY(), "source": "FNC"}


async def run(page) -> list[dict]:
    results = []

    # ── 1. FNC precio interno ────────────────────────────────────────────────
    precio = None
    for url in _FNC_URLS:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2_000)
            html = await page.content()
            precio = _extract_precio_interno(html)
            if precio:
                break
        except Exception as e:
            print(f"[colombia] FNC {url} failed: {e}")

    if precio:
        results.append({
            "title":    f"Colombia FNC Precio Interno – {_TODAY()}",
            "body":     f"FNC internal purchase price: {precio['cop_per_carga']:,} COP/carga (125 kg) as of {precio['as_of']}.",
            "source":   "FNC",
            "category": "supply",
            "lat":      4.571,
            "lng":      -74.297,
            "tags":     ["price", "colombia", "fnc", "precio-interno"],
            "meta":     json.dumps(precio),
        })

    # ── 2. ICO monthly exports (HTTP, no browser needed) ─────────────────────
    monthly = _fetch_ico_exports()
    if monthly:
        last = monthly[-1]
        results.append({
            "title":    f"Colombia Coffee Exports (ICO) – {last['month']}",
            "body":     (
                f"Colombia green coffee exports: {last['total_k_bags']:,}k bags in {last['month']}."
                + (f" YoY: {last['yoy_pct']:+.1f}%" if last.get('yoy_pct') is not None else "")
            ),
            "source":   "ICO",
            "category": "supply",
            "lat":      4.571,
            "lng":      -74.297,
            "tags":     ["exports", "colombia", "ico"],
            "meta":     json.dumps({
                "monthly":      monthly,
                "last_updated": last["month"],
                "unit":         "thousand 60-kg bags",
            }),
        })

    return results
