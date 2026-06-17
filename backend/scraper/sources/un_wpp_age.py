"""
un_wpp_age.py — UN World Population Prospects scraper for 18+ population
("coffee-drinking age") in the 15 demand-tab markets.

Pulls UN Population Data Portal indicator for population by 5-year age
groups (Medium variant projection), filters to age cohorts >= 15, and
estimates the 18+ count for each country across 2000–2050.

Why 18+: matches the user-chosen threshold for the demand-tab age-cohort
panel. UN doesn't publish 18+ directly, so we sum 20+ exactly and add
2/5 of the 15–19 bracket (ages 18–19, assuming uniform distribution).

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
import os
import time
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "un_wpp_age.json"

# The UN Population Data Portal API now requires a bearer token — anonymous
# requests get a 401. Register for a free token at
#   https://population.un.org/dataportal/about/dataapi
# and expose it to the scraper via the UN_WPP_TOKEN environment variable
# (in CI, set it as the UN_WPP_TOKEN GitHub Actions secret).
_TOKEN_ENV = "UN_WPP_TOKEN"


def _headers() -> dict[str, str]:
    h = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
    }
    token = os.environ.get(_TOKEN_ENV, "").strip()
    if token:
        # Tolerate the user pasting either the raw token or "Bearer <token>".
        h["Authorization"] = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    return h

# UN M.49 numeric codes
_COUNTRIES = [
    ("eu",          "Europe",          908),   # 908 = Europe region (EU-27 code 918 404s on this indicator)
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

# Ask for big pages so a country's whole age/year matrix arrives in one (or a
# few) requests — deep pagination is what triggered the API's 502s. If the
# server caps pageSize, it just reports more pages and we loop with retries.
_PAGE_SIZE    = 5000
_MAX_PAGES    = 60
_POLITE_DELAY = 0.5           # seconds between page requests, to be gentle
_RETRY_STATUS = {429, 500, 502, 503, 504}


def _get_json(url: str, attempts: int = 4) -> dict | list:
    """GET + parse JSON, retrying transient server errors with backoff."""
    delay = 3.0
    for i in range(attempts):
        try:
            r = requests.get(url, headers=_headers(), timeout=60)
            r.raise_for_status()
            return r.json()
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else None
            if status in _RETRY_STATUS and i < attempts - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except requests.RequestException:
            if i < attempts - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
    raise RuntimeError("unreachable")


def _fetch_all_rows(location_id: int) -> list[dict] | None:
    """Fetch every data row for one country across the API's pages.

    The DataPortal paginates the age/year matrix; we request large pages and
    walk ``pageNumber`` up to the reported page count, retrying transient 5xx
    so one flaky page doesn't drop the whole country. Returns None only when
    the first page can't be retrieved at all (e.g. a 404 for a bad location).
    """
    base = (
        f"{_API_BASE}/data/indicators/{_INDICATOR_ID}/locations/{location_id}"
        f"/start/{_START_YEAR}/end/{_END_YEAR}"
    )

    def page_url(n: int) -> str:
        return f"{base}?pageNumber={n}&pageSize={_PAGE_SIZE}"

    rows: list[dict] = []
    try:
        body = _get_json(page_url(1))
    except Exception as e:
        logger.warning(f"[un_wpp_age] location {location_id} fetch failed: {e}")
        return None

    if isinstance(body, list):
        return body or None

    rows.extend(body.get("data") or [])
    try:
        total_pages = int(body.get("pages") or 1)
    except (TypeError, ValueError):
        total_pages = 1

    for n in range(2, min(total_pages, _MAX_PAGES) + 1):
        time.sleep(_POLITE_DELAY)
        try:
            body = _get_json(page_url(n))
        except Exception as e:
            logger.warning(f"[un_wpp_age] location {location_id} page {n} failed: {e} — using partial")
            break
        rows.extend(body.get("data") or [])

    return rows or None


# Projection variants other than the medium one — summing these alongside
# Medium would multiply post-estimate years. We keep everything that is NOT
# in this set (estimates + Medium), so an unexpected estimates label still
# passes rather than silently zeroing the series.
_DROP_VARIANTS = (
    "high", "low", "constant fertility", "constant mortality",
    "instant replacement", "zero migration", "no change", "momentum",
)


def _fetch_country(location_id: int) -> list[dict] | None:
    """Return [{year, pop_18plus}] for one country, or None on failure."""
    rows = _fetch_all_rows(location_id)
    if rows is None:
        return None

    # Group by year, summing the per-age-bucket values that overlap 18+.
    # Each row carries: timeLabel/Year, ageStart, ageEnd, value (in 1000s).
    # The feed mixes sexes (male/female/both) and projection variants, so we
    # keep both-sexes + Medium/estimates only and dedupe per age bracket to
    # guarantee each (year, age) is counted exactly once.
    by_year: dict[int, float] = {}
    seen: set[tuple[int, int, int]] = set()
    for row in rows:
        # Sex: keep "Both sexes" (sexId 3) — drop male/female to avoid 3x.
        sex_id = row.get("sexId")
        sex_label = str(row.get("sex") or row.get("sexLabel") or "").lower()
        if sex_id is not None:
            if int(sex_id) != 3:
                continue
        elif sex_label and "both" not in sex_label:
            continue

        # Variant: drop the alternative projection scenarios (High/Low/…).
        variant = str(row.get("variantLabel") or row.get("variant") or "").lower()
        if variant and any(v in variant for v in _DROP_VARIANTS):
            continue

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

        # Belt-and-suspenders: never count the same age bracket twice for a
        # year, even if two acceptable series slipped through the filters.
        key = (year, age_start, age_end)
        if key in seen:
            continue
        seen.add(key)

        # 15-19 bracket contributes 2/5 of its count (ages 18, 19 of 15..19).
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
        # The DataPortal API returns absolute persons (the bulk WPP CSVs are in
        # thousands, but this endpoint is not), so no unit scaling is applied.
        {"year": y, "pop_18plus": int(round(by_year[y]))}
        for y in sorted(by_year)
    ]


def _build_payload() -> dict | None:
    if not os.environ.get(_TOKEN_ENV, "").strip():
        logger.warning(
            f"[un_wpp_age] {_TOKEN_ENV} is not set — the UN DataPortal API returns 401 "
            "without a token. Get one at https://population.un.org/dataportal/about/dataapi"
        )

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
