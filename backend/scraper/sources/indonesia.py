"""
indonesia.py — Indonesia coffee data scraper.

Sources:
  ICO historical CSV: monthly green coffee exports for Indonesia.

Returns NewsItem-shaped dicts for upsert_news_item().
Note: No national price floor exists for Indonesia.
RC futures (robusta) serve as the primary benchmark — computed at export time.
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

_ICO_CSV_URL = (
    "https://www.ico.org/historical/1990%20onwards/CSV/"
    "2b%20-%20Exports%20of%20green%20coffee.csv"
)
_IDN_NAMES = {"indonesia"}


def _parse_ico_indonesia(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    rows   = list(reader)
    country_col = (reader.fieldnames or [""])[0]
    idn_row = next(
        (r for r in rows if r.get(country_col, "").strip().lower() in _IDN_NAMES),
        None,
    )
    if idn_row is None:
        return []

    monthly: list[dict] = []
    for col, val in idn_row.items():
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
        return _parse_ico_indonesia(r.text)
    except Exception as e:
        print(f"[indonesia] ICO CSV fetch failed: {e}")
        return []


async def run(page) -> list[dict]:
    results = []

    monthly = _fetch_ico_exports()
    if monthly:
        last = monthly[-1]
        results.append({
            "title":    f"Indonesia Coffee Exports (ICO) – {last['month']}",
            "body":     (
                f"Indonesia green coffee exports: {last['total_k_bags']:,}k bags in {last['month']}."
                + (f" YoY: {last['yoy_pct']:+.1f}%" if last.get("yoy_pct") is not None else "")
            ),
            "source":   "ICO",
            "category": "supply",
            "lat":      -2.5,
            "lng":      118.0,
            "tags":     ["exports", "indonesia", "ico"],
            "meta":     json.dumps({
                "monthly":      monthly,
                "last_updated": last["month"],
                "unit":         "thousand 60-kg bags",
            }),
        })

    return results
