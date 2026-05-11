"""
honduras.py — Honduras coffee data scraper.

Sources:
  ICO historical CSV: monthly green coffee exports for Honduras.
  IHCAFE (Instituto Hondureño del Café): precio de referencia (best-effort).

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
_HND_NAMES = {"honduras"}


def _parse_ico_honduras(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    rows   = list(reader)
    country_col = (reader.fieldnames or [""])[0]
    hnd_row = next(
        (r for r in rows if r.get(country_col, "").strip().lower() in _HND_NAMES),
        None,
    )
    if hnd_row is None:
        return []

    monthly: list[dict] = []
    for col, val in hnd_row.items():
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

    by_month = {r["month"]: r["total_k_bags"] for r in monthly}
    result = []
    for r in monthly:
        ym = r["month"]
        yr, mo = ym.split("-")
        ly = f"{int(yr) - 1}-{mo}"
        ly_val = by_month.get(ly)
        yoy = round((r["total_k_bags"] - ly_val) / ly_val * 100, 1) if ly_val and ly_val > 0 else None
        result.append({**r, "yoy_pct": yoy})
    return result


def _fetch_ico_exports() -> list[dict]:
    try:
        r = requests.get(_ICO_CSV_URL, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        return _parse_ico_honduras(r.text)
    except Exception as e:
        print(f"[honduras] ICO CSV fetch failed: {e}")
        return []


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
        return {"hnl_per_quintal": most_common, "as_of": _TODAY(), "source": "IHCAFE"}
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
            "title":    f"Honduras IHCAFE Precio de Referencia – {_TODAY()}",
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

    # ── 2. ICO monthly exports (HTTP, no browser needed) ─────────────────────
    monthly = _fetch_ico_exports()
    if monthly:
        last = monthly[-1]
        results.append({
            "title":    f"Honduras Coffee Exports (ICO) – {last['month']}",
            "body":     (
                f"Honduras green coffee exports: {last['total_k_bags']:,}k bags in {last['month']}."
                + (f" YoY: {last['yoy_pct']:+.1f}%" if last.get('yoy_pct') is not None else "")
            ),
            "source":   "ICO",
            "category": "supply",
            "lat":      14.84,
            "lng":      -87.20,
            "tags":     ["exports", "honduras", "ico"],
            "meta":     json.dumps({
                "monthly":      monthly,
                "last_updated": last["month"],
                "unit":         "thousand 60-kg bags",
            }),
        })

    return results
