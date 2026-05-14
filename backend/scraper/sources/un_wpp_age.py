"""
un_wpp_age.py — UN World Population Prospects scraper for 18+ population
("coffee-drinking age") in the 15 demand-tab markets.

Pulls UN Population Data Portal indicator for population by 5-year age
groups (Medium variant projection), filters to age cohorts >= 15, and
estimates the 18+ count for each country across 2000–2050.

Why 18+: matches the user-chosen threshold for the demand-tab age-cohort
panel. UN doesn't publish 18+ directly, so we sum 20+ exactly and add
3/5 of the 15–19 bracket (assuming uniform distribution within the bin).

This source is intended for monthly_scraper because UN WPP only refreshes
every ~2 years. Daily polling would waste bandwidth on a static dataset.

Cache shape:
  {
    "source":       "UN WPP DataPortal API",
    "last_updated": "2026-05-14",
    "countries": {
      "china": {
        "name": "China", "location_id": 156,
        "annual": [{"year": 2000, "pop_18plus": 980000000}, ...]
      },
      ...
    }
  }
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "un_wpp_age.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# UN M.49 numeric codes
_COUNTRIES = [
    ("eu",          "European Union",  918),   # 918 = EU-27 aggregate
    ("japan",       "Japan",           392),
    ("usa",         "United States",   840),
    ("china",       "China",           156),
    ("india",       "India",           356),
    ("brazil",      "Brazil",           76),
    ("indonesia",   "Indonesia",       360),
    ("vietnam",     "Vietnam",         704),
    ("russia",      "Russia",          643),
    ("mexico",      "Mexico",          484),
    ("turkey",      "Turkey",          792),
    ("philippines", "Philippines",     608),
    ("egypt",       "Egypt",           818),
    ("korea",       "South Korea",     410),
    ("ethiopia",    "Ethiopia",        231),
]

# Indicator 46 = "Population by 5-year age groups (both sexes)" in WPP DataPortal
# Variant 4 = medium projection (used after the estimates year).
_INDICATOR_ID = 46
_API_BASE     = "https://population.un.org/dataportalapi/api/v1"
_START_YEAR   = 2000
_END_YEAR     = 2050


def _fetch_country(location_id: int) -> list[dict] | None:
    """Return [{year, pop_18plus}] for one country, or None on failure."""
    url = (
        f"{_API_BASE}/data/indicators/{_INDICATOR_ID}/locations/{location_id}"
        f"/start/{_START_YEAR}/end/{_END_YEAR}"
    )
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning(f"[un_wpp_age] location {location_id} fetch failed: {e}")
        return None

    rows = body.get("data") if isinstance(body, dict) else body
    if not isinstance(rows, list):
        return None

    # Group by year, summing the per-age-bucket values that overlap 18+.
    # Each row carries: timeLabel/Year, ageStart, ageEnd, value (in 1000s).
    by_year: dict[int, float] = {}
    for row in rows:
        try:
            year = int(row.get("timeLabel") or row.get("year") or row.get("Time") or 0)
            age_start = int(row.get("ageStart") if row.get("ageStart") is not None else row.get("AgeStart", -1))
            age_end   = int(row.get("ageEnd")   if row.get("ageEnd")   is not None else row.get("AgeEnd",   -1))
            value     = float(row.get("value")  if row.get("value")    is not None else row.get("Value",   0))
        except (TypeError, ValueError):
            continue

        if year < _START_YEAR or year > _END_YEAR:
            continue
        if age_end < 18:
            continue

        # 15-19 bracket contributes 3/5 of its count (ages 18, 19 out of 5).
        # All higher brackets contribute fully.
        if age_start <= 18 <= age_end and age_start != age_end:
            span = max(1, age_end - age_start + 1)
            contributing = age_end - 17  # ages 18..age_end inclusive
            weight = contributing / span
            by_year[year] = by_year.get(year, 0.0) + value * weight
        else:
            by_year[year] = by_year.get(year, 0.0) + value

    if not by_year:
        return None

    return [
        # UN reports population in thousands — multiply back to absolute
        {"year": y, "pop_18plus": int(round(by_year[y] * 1000))}
        for y in sorted(by_year)
    ]


def _build_payload() -> dict | None:
    countries: dict[str, dict] = {}
    for short, name, loc_id in _COUNTRIES:
        rows = _fetch_country(loc_id)
        if rows:
            latest = rows[-1]
            countries[short] = {
                "name":        name,
                "location_id": loc_id,
                "annual":      rows,
                "latest_year": latest["year"],
                "latest_pop":  latest["pop_18plus"],
            }
        else:
            logger.warning(f"[un_wpp_age] no data for {short}")

    if not countries:
        return None
    return {
        "source":       "UN WPP DataPortal API (5yr age groups, medium variant)",
        "last_updated": datetime.utcnow().date().isoformat(),
        "age_threshold": 18,
        "countries":    countries,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        payload = _build_payload()
        if not payload:
            print("[un_wpp_age] no data fetched — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        n = len(payload["countries"])
        print(f"[un_wpp_age] OK: {n}/{len(_COUNTRIES)} countries, 18+ cohort {_START_YEAR}–{_END_YEAR}")

        if db is not None:
            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"UN WPP 18+ Population – {payload['last_updated']}",
                "body":     f"Tracked {n} countries for coffee-drinking-age cohort projection.",
                "source":   "UN WPP",
                "category": "demand",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["population", "demand", "un-wpp", "age-cohort"],
                "meta":     json.dumps(payload),
            })
    except Exception as e:
        print(f"[un_wpp_age] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[un_wpp_age] cache read failed: {e}")
        return None
