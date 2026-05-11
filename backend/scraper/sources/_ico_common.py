"""
_ico_common.py

Shared helper for ICO (International Coffee Organization) "Exports of
green coffee" monthly CSV. Each country scraper used to inline an
identical ~50-line parser; this consolidates them.

CSV layout: first column is country name, remaining columns are
"YYYY Mon" buckets (e.g. "2024 Jan"). Bags are in thousands of 60-kg
bags as published by the ICO.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime

import requests

_ICO_CSV_URL = (
    "https://www.ico.org/historical/1990%20onwards/CSV/"
    "2b%20-%20Exports%20of%20green%20coffee.csv"
)
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}


def parse_ico_country(content: str, country_names: set[str]) -> list[dict]:
    """Parse the ICO exports CSV for one country. Returns up to the
    last 48 months as dicts with `month`, `total_k_bags`, `yoy_pct`."""
    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)
    country_col = (reader.fieldnames or [""])[0]
    country_lc = {n.lower() for n in country_names}
    row = next(
        (r for r in rows if r.get(country_col, "").strip().lower() in country_lc),
        None,
    )
    if row is None:
        return []

    monthly: list[dict] = []
    for col, val in row.items():
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
    result: list[dict] = []
    for r in monthly:
        ym = r["month"]
        yr, mo = ym.split("-")
        ly = f"{int(yr) - 1}-{mo}"
        ly_val = by_month.get(ly)
        yoy = round((r["total_k_bags"] - ly_val) / ly_val * 100, 1) if ly_val and ly_val > 0 else None
        result.append({**r, "yoy_pct": yoy})
    return result


def fetch_ico_exports(country_names: set[str], log_prefix: str) -> list[dict]:
    """Fetch the ICO CSV and parse it for one country. Errors are logged
    with `log_prefix` (e.g. "uganda") and return an empty list."""
    try:
        r = requests.get(_ICO_CSV_URL, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        return parse_ico_country(r.text, country_names)
    except Exception as e:
        print(f"[{log_prefix}] ICO CSV fetch failed: {e}")
        return []
