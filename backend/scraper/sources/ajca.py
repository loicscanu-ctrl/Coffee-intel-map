"""
ajca.py — All Japan Coffee Association scraper.

Source pages
  - https://coffee.ajca.or.jp/data/           statistics hub
  - PDFs under /wordpress/wp-content/uploads/{YYYY}/{MM}/

The data-hub HTML already exposes the latest annual figures inline
(consumption + green-coffee imports in tonnes), so the MVP simply
regexes them out. Monthly PDFs are discovered by URL pattern so we
can layer monthly granularity on top later without touching this file
much. Replaces the AJCA HTML scraper that returned bad magnitudes.

Writes backend/scraper/cache/ajca.json:

  {
    "source": "AJCA",
    "source_url": "https://coffee.ajca.or.jp/data/",
    "last_updated": "2026-05-12",
    "latest_year":            "2025",
    "latest_consumption_mt":  397272,
    "latest_imports_mt":      359382,
    "monthly_imports_pdf":    "https://coffee.ajca.or.jp/wordpress/.../j-import202603.pdf",
    "monthly_exports_pdf":    "...",
    "supply_demand_pdf":      "...",
    "yearly_imports_pdf":     "...",
    "pdf_index": [...]   # all data-* PDFs found on the page
  }
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_HUB_URL    = "https://www.ajca.or.jp/data/"
_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "ajca.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
}

# Patterns mining the inline Japanese text on the data hub.
# "2025年の日本のコーヒー消費量 397,272 トン" → consumption 397272
_CONS_PAT  = re.compile(
    r"(20\d{2})\s*年\s*の\s*日本\s*の\s*コーヒー\s*消費量\s*([\d,]+)\s*トン",
)
# "2025年のコーヒー生豆の輸入量 359,382 トン" → imports 359382
_IMP_PAT   = re.compile(
    r"(20\d{2})\s*年\s*の\s*コーヒー\s*生豆\s*の\s*輸入量\s*([\d,]+)\s*トン",
)

# Reasonable range gate (Japan imports ≈ 350-450k MT/yr historically).
_MT_MIN = 100_000
_MT_MAX = 1_000_000


def _parse_mt(raw: str) -> int | None:
    try:
        v = int(raw.replace(",", ""))
        return v if _MT_MIN <= v <= _MT_MAX else None
    except ValueError:
        return None


# All PDFs under /wp-content/uploads/, with their data prefix and trailing
# year+month or year tag. Captures help us identify the "latest" of each kind.
_PDF_PAT = re.compile(
    r'href="(https?://[^"]*/wp-content/uploads/(\d{4})/(\d{2})/'
    r'(data-jukyu|data-yunyu-suii|data-24|data-gc-yunyuryo-tanka|data-rcic-yunyuryo-tanka|'
    r'data7-import-(?:nama|gc|rc|ic|other)|data7-export|data-decaf|'
    r'j-import|j-export)([^.]*)\.pdf)"',
    re.I,
)


def _collect_pdf_index(html: str) -> list[dict]:
    """Return every coffee-data PDF link on the hub page, with metadata."""
    out: list[dict] = []
    for m in _PDF_PAT.finditer(html):
        url, year, month, kind, tail = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        # Some filenames bake the date into the tail too (e.g. "202603").
        tail_date = re.search(r"(\d{6})", tail)
        out.append({
            "url":         url,
            "kind":        kind,
            "upload_year": year,
            "upload_month": month,
            "data_period": tail_date.group(1) if tail_date else None,
        })
    return out


def _latest_pdf_by_kind(index: list[dict], kind: str) -> str | None:
    """Most recent PDF of a given kind, sorted by data_period or upload date."""
    candidates = [p for p in index if p["kind"] == kind]
    if not candidates:
        return None
    candidates.sort(
        key=lambda p: (p.get("data_period") or (p["upload_year"] + p["upload_month"])),
        reverse=True,
    )
    return candidates[0]["url"]


def _fetch_hub() -> str | None:
    try:
        r = requests.get(_HUB_URL, headers=_HEADERS, timeout=30, allow_redirects=True)
        r.raise_for_status()
        return r.text
    except Exception as e:
        logger.warning(f"[ajca] hub fetch failed: {e}")
        return None


def _parse_hub(html: str) -> dict | None:
    cons_match = _CONS_PAT.search(html)
    imp_match  = _IMP_PAT.search(html)

    consumption_mt: int | None = None
    imports_mt:     int | None = None
    consumption_year: str | None = None
    imports_year:     str | None = None

    if cons_match:
        consumption_year = cons_match.group(1)
        consumption_mt   = _parse_mt(cons_match.group(2))
    if imp_match:
        imports_year = imp_match.group(1)
        imports_mt   = _parse_mt(imp_match.group(2))

    if consumption_mt is None and imports_mt is None:
        return None

    latest_year = imports_year or consumption_year

    pdf_index = _collect_pdf_index(html)

    return {
        "source":                 "AJCA",
        "source_url":             _HUB_URL,
        "last_updated":           datetime.utcnow().date().isoformat(),
        "latest_year":            latest_year,
        "latest_consumption_mt":  consumption_mt,
        "latest_imports_mt":      imports_mt,
        "monthly_imports_pdf":    _latest_pdf_by_kind(pdf_index, "j-import"),
        "monthly_exports_pdf":    _latest_pdf_by_kind(pdf_index, "j-export"),
        "supply_demand_pdf":      _latest_pdf_by_kind(pdf_index, "data-jukyu"),
        "yearly_imports_pdf":     _latest_pdf_by_kind(pdf_index, "data-yunyu-suii"),
        "pdf_index":              pdf_index,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        html = _fetch_hub()
        if not html:
            print("[ajca] No HTML — retaining cache")
            return
        parsed = _parse_hub(html)
        if not parsed:
            print("[ajca] Could not extract figures from hub page — retaining cache")
            return
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8")
        print(
            f"[ajca] {parsed['latest_year']} "
            f"imports={parsed['latest_imports_mt']} MT  "
            f"consumption={parsed['latest_consumption_mt']} MT "
            f"({len(parsed['pdf_index'])} pdfs indexed)"
        )
    except Exception as e:
        print(f"[ajca] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[ajca] cache read failed: {e}")
        return None


if __name__ == "__main__":
    import asyncio

    async def _main():
        await run(None, None)

    asyncio.run(_main())
