"""
us_cpi.py — Headline US CPI (CPI-U) scraper for the Macro tab.

This is the *broad* US consumer-price index — the BLS "Table 1" release
(https://www.bls.gov/news.release/cpi.t01.htm), not the coffee-specific
retail sub-index that retail_cpi.py already tracks. It gives the
macro-inflation backdrop that frames every commodity position: when
headline/core CPI runs hot, the Fed-path / USD / real-rate regime shifts
under the whole complex.

Four series, all from the BLS public API (Consumer Price Index for All
Urban Consumers, U.S. city average, NOT seasonally adjusted — NSA is the
basis BLS uses for the headline 12-month change quoted in the release):

  all_items — CUUR0000SA0     (All items)
  core      — CUUR0000SA0L1E  (All items less food and energy)
  food      — CUUR0000SAF1    (Food)
  energy    — CUUR0000SA0E    (Energy)

Each is a monthly index; we compute YoY % so the four overlay cleanly.

Cache shape:
  {
    "source":       "US Bureau of Labor Statistics (CPI-U)",
    "source_url":   "https://www.bls.gov/news.release/cpi.t01.htm",
    "last_updated": "YYYY-MM-DD",
    "series": {
      "all_items": {"name": "...", "series_id": "...", "source_url": "...",
                    "monthly": [{"period": "YYYY-MM", "index": float, "yoy_pct": float|null}]},
      "core":      {...}, "food": {...}, "energy": {...}
    }
  }

API access is anonymous (no key needed: 25 queries/day, 10-year window).
A registered BLS API key in the BLS_API_KEY env var lifts the window to
20 years. On any failure the existing cache is retained so the Macro tab
keeps rendering.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "us_cpi.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Content-Type": "application/json",
}

_RELEASE_URL = "https://www.bls.gov/news.release/cpi.t01.htm"

# BLS CPI-U series (NSA — matches the headline 12-month change in cpi.t01).
_SERIES = {
    "all_items": {"id": "CUUR0000SA0",    "name": "All items"},
    "core":      {"id": "CUUR0000SA0L1E", "name": "All items less food & energy (core)"},
    "food":      {"id": "CUUR0000SAF1",   "name": "Food"},
    "energy":    {"id": "CUUR0000SA0E",   "name": "Energy"},
}

_PERIOD_TO_MONTH = {f"M{i:02d}": f"{i:02d}" for i in range(1, 13)}


def _yoy_series(rows: list[dict]) -> list[dict]:
    """Compute YoY % from prior-year same month. Rows have 'period' YYYY-MM and 'index'."""
    by_period = {r["period"]: r["index"] for r in rows if r.get("index") is not None}
    out: list[dict] = []
    for r in rows:
        if r.get("index") is None:
            continue
        y, m = r["period"].split("-")
        prev = f"{int(y) - 1}-{m}"
        prev_idx = by_period.get(prev)
        yoy = round(((r["index"] / prev_idx) - 1.0) * 100.0, 2) if prev_idx else None
        out.append({"period": r["period"], "index": r["index"], "yoy_pct": yoy})
    return out


def _fetch_bls() -> dict[str, dict] | None:
    """One BLS API call for all four CPI-U series.

    Returns {series_key: {rows}} parsed into our monthly/YoY shape, or None
    if the request fails outright. Individual series that come back empty are
    simply omitted.
    """
    api_key = os.environ.get("BLS_API_KEY", "").strip()
    end_year = datetime.utcnow().year
    # No key: BLS caps the window at 10 years/query. A registered key lifts it
    # to 20 — request the larger window only when we have one.
    start_year = end_year - (19 if api_key else 10)

    payload: dict = {
        "seriesid":  [s["id"] for s in _SERIES.values()],
        "startyear": str(start_year),
        "endyear":   str(end_year),
    }
    if api_key:
        payload["registrationkey"] = api_key

    url = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
    try:
        r = requests.post(url, headers=_HEADERS, json=payload, timeout=30)
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning(f"[us_cpi] BLS fetch failed: {e}")
        return None

    if body.get("status") != "REQUEST_SUCCEEDED":
        logger.warning(f"[us_cpi] BLS status {body.get('status')}: {body.get('message')}")
        return None

    # id -> series_key reverse map
    id_to_key = {meta["id"]: key for key, meta in _SERIES.items()}

    result: dict[str, dict] = {}
    for s in body.get("Results", {}).get("series", []):
        sid = s.get("seriesID")
        key = id_to_key.get(sid)
        if not key:
            continue
        rows: list[dict] = []
        for d in s.get("data", []):
            period = d.get("period", "")
            if period not in _PERIOD_TO_MONTH:  # skip annual averages (M13) etc.
                continue
            try:
                idx = float(d["value"])
            except (KeyError, TypeError, ValueError):
                continue
            rows.append({"period": f"{d['year']}-{_PERIOD_TO_MONTH[period]}", "index": idx})
        if not rows:
            continue
        rows.sort(key=lambda r: r["period"])
        result[key] = {
            "name":       _SERIES[key]["name"],
            "series_id":  sid,
            "source_url": f"https://data.bls.gov/timeseries/{sid}",
            "monthly":    _yoy_series(rows),
        }
    return result or None


def _build_payload() -> dict | None:
    series = _fetch_bls()
    if not series:
        return None
    return {
        "source":       "US Bureau of Labor Statistics (CPI-U)",
        "source_url":   _RELEASE_URL,
        "last_updated": datetime.utcnow().date().isoformat(),
        "series":       series,
    }


async def run(page, db) -> None:  # noqa: ARG001
    """Fetch headline US CPI, persist to cache + DB news item.

    Mirrors retail_cpi.run: the cache file is gitignored and doesn't survive
    cross-job in CI, so we also stash the full payload in a NewsItem.meta the
    exporter can fall back to.
    """
    try:
        payload = _build_payload()
        if not payload:
            print("[us_cpi] BLS fetch failed — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        names = ", ".join(payload["series"].keys())
        print(f"[us_cpi] OK: {len(payload['series'])}/4 series ({names}), "
              f"last_updated={payload['last_updated']}")

        if db is not None:
            # Headline-stat body so the Macro news feed / Telegram brief can
            # surface the latest all-items + core YoY.
            parts: list[str] = []
            for key, label in (("all_items", "Headline"), ("core", "Core")):
                monthly = (payload["series"].get(key) or {}).get("monthly") or []
                if not monthly:
                    continue
                yoy = monthly[-1].get("yoy_pct")
                if yoy is None:
                    continue
                parts.append(f"{label}: {'+' if yoy >= 0 else ''}{yoy:.1f}% YoY")
            body = (
                "US CPI (CPI-U) — " + ", ".join(parts)
                if parts
                else f"US CPI series fetched: {names}"
            )

            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"US CPI – {payload['last_updated']}",
                "body":     body,
                "source":   "US CPI",
                "category": "macro",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["cpi", "inflation", "macro"],
                "meta":     json.dumps(payload),
            })
    except Exception as e:
        print(f"[us_cpi] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[us_cpi] cache read failed: {e}")
        return None
