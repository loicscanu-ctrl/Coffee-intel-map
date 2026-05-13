"""
honduras.py — Honduras coffee data scraper.

Sources:
  ICO historical CSV: monthly green coffee exports for Honduras.
  IHCAFE (Instituto Hondureño del Café): precio de referencia (best-effort).

Returns NewsItem-shaped dicts for upsert_news_item().
"""
from __future__ import annotations

import json
import re
from datetime import date


def _today() -> str:
    return date.today().isoformat()


# ── IHCAFE precio de referencia ────────────────────────────────────────────────

_IHCAFE_URLS = [
    "https://www.ihcafe.hn/",
    "https://www.ihcafe.hn/index.php/estadisticas/precio-referencia",
]

# Honduras farm-gate price is quoted in Lempiras per quintal (46 kg)
_PRICE_RE = re.compile(r"([\d][,.\d]+)\s*(?:L|HNL|lempiras?)?", re.IGNORECASE)
_CONTEXT_RE = re.compile(
    r"(?:precio\s+de\s+referencia|precio\s+caf[eé]|quintal|precio\s+al\s+productor)",
    re.IGNORECASE,
)


def _extract_ihcafe_price(html: str) -> dict | None:
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")

        candidates = []
        for tag in soup.find_all(string=_CONTEXT_RE):
            parent_text = tag.parent.get_text(" ", strip=True) if tag.parent else str(tag)
            m = _PRICE_RE.search(parent_text)
            if m:
                raw = m.group(1).replace(".", "").replace(",", "")
                try:
                    val = int(raw)
                    if 500 < val < 30_000:  # sanity: 500–30,000 HNL/quintal
                        candidates.append(val)
                except ValueError:
                    pass

        if not candidates:
            return None

        from collections import Counter
        most_common = Counter(candidates).most_common(1)[0][0]
        return {"hnl_per_quintal": most_common, "as_of": _today(), "source": "IHCAFE"}
    except Exception as e:
        print(f"[honduras] IHCAFE price extract failed: {e}")
        return None


async def run(page) -> list[dict]:
    results = []

    # ── 1. IHCAFE precio de referencia ────────────────────────────────────────
    ihcafe_price = None
    for url in _IHCAFE_URLS:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(2_000)
            html = await page.content()
            ihcafe_price = _extract_ihcafe_price(html)
            if ihcafe_price:
                break
        except Exception as e:
            print(f"[honduras] IHCAFE {url} failed: {e}")

    if ihcafe_price:
        results.append({
            "title":    f"Honduras IHCAFE Precio de Referencia – {_today()}",
            "body":     (
                f"IHCAFE reference price: {ihcafe_price['hnl_per_quintal']:,} HNL/quintal (46 kg) "
                f"as of {ihcafe_price['as_of']}."
            ),
            "source":   "IHCAFE",
            "category": "supply",
            "lat":      14.84,
            "lng":      -87.20,
            "tags":     ["price", "honduras", "ihcafe", "precio-referencia"],
            "meta":     json.dumps(ihcafe_price),
        })

    return results
