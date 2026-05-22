"""psd_country_exports.py — build an origin's annual green-coffee EXPORT series
from the USDA FAS PSD data the daily scraper already caches.

Colombia / Honduras / Indonesia / Ethiopia never get monthly ICO export data
(the ICO CSV path is dead — ico.org 403s and the tables are paywalled). USDA
PSD is open and the `psd_coffee` scraper already parses each producer's
`exports_mt` per marketing year and persists the whole parse to a DB NewsItem
(source="PSD Coffee"). This reads that row and shapes it like the other
`exports` blocks, but annual instead of monthly.
"""
from __future__ import annotations

import json

from models import NewsItem

# exports_mt = thousand-60kg-bags × 60 (see psd_coffee._to_mt)
_MT_PER_K_BAGS = 60


def psd_country_exports(db, country_key: str) -> dict | None:
    """Return an annual `exports` block for `country_key` (e.g. "ethiopia"),
    or None if PSD data isn't available yet."""
    item = (
        db.query(NewsItem)
        .filter(NewsItem.source == "PSD Coffee")
        .order_by(NewsItem.pub_date.desc())
        .first()
    )
    if not item:
        return None
    try:
        parsed = json.loads(item.meta or "{}")
    except Exception:
        return None

    prod = (parsed.get("producers") or {}).get(country_key)
    if not prod:
        return None

    rows: list[dict] = []
    prev_mt = None
    for entry in prod.get("annual") or []:
        mt = entry.get("exports_mt")
        year = entry.get("year")
        if mt is None or not year:
            continue
        yoy = round((mt - prev_mt) / prev_mt * 100, 1) if prev_mt else None
        rows.append({
            "year": str(year),
            "total_k_bags": round(mt / _MT_PER_K_BAGS, 1),
            "yoy_pct": yoy,
        })
        prev_mt = mt

    if not rows:
        return None

    return {
        "source": "USDA FAS PSD",
        "last_updated": parsed.get("last_updated", ""),
        "unit": "thousand 60-kg bags (marketing year)",
        "monthly": [],
        "annual": rows,
    }
