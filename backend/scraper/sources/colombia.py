"""
colombia.py — Colombia coffee data scraper.

Sources:
  FNC (Federación Nacional de Cafeteros): precio interno (daily farmer buy price)
  ICO historical CSV: monthly green coffee exports for Colombia (same source as Vietnam)

Returns NewsItem-shaped dicts for upsert_news_item().
"""
from __future__ import annotations

import json
import re
from datetime import date

from scraper.sources._ico_common import fetch_ico_exports

_TODAY = lambda: date.today().isoformat()


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
    monthly = fetch_ico_exports({"colombia"}, "colombia")
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
