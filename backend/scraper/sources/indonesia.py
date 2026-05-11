"""
indonesia.py — Indonesia coffee data scraper.

Sources:
  ICO historical CSV: monthly green coffee exports for Indonesia.

Returns NewsItem-shaped dicts for upsert_news_item().
Note: No national price floor exists for Indonesia.
RC futures (robusta) serve as the primary benchmark — computed at export time.
"""
from __future__ import annotations

import json

from scraper.sources._ico_common import fetch_ico_exports


async def run(page) -> list[dict]:
    results = []

    monthly = fetch_ico_exports({"indonesia"}, "indonesia")
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
