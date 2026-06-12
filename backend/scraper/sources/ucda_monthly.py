"""ucda_monthly.py — Uganda Coffee Development Authority monthly export reports.

Discovers and parses the monthly PDF reports UCDA publishes at
https://ugandacoffee.go.ug/resource-center/reports/monthly-reports (4 listing
pages → ~80 PDFs going back to ~2018). Outputs a single static JSON the
front-end consumes the same way it does Brazil's cecafe.json:

  frontend/public/data/uganda_monthly.json
  {
    "source": "UCDA Monthly Coffee Report",
    "updated":  "2026-06-10",
    "series": [
      {
        "month":           "YYYY-MM",
        "robusta_bags":     ...,
        "arabica_bags":     ...,
        "total_bags":       ...,
        "value_usd":        ...,
        "by_grade":         [{"grade": "Screen 18", "bags": ...}, ...],
        "by_destination":   [{"country": "Italy", "bags": ...}, ...],
        "_parser":         "v1" | "v2" | …,                # for traceability
        "_source_pdf":     "/sites/default/files/.../<file>.pdf"
      },
      …
    ]
  }

UCDA's listing pages AND their PDF host both Cloudflare-block GitHub Actions
IPs with 403, so the scraper uses patchright (the same Playwright-stealth
fork the cecafe-daily scraper uses) for HTTP fetches. For maintainability
the parser is a registry of per-format functions — UCDA's report format
has changed 3-4 times since 2018 and is expected to keep changing. Adding
a new format = one new `_parse_vN()` function + one entry in PARSERS.

Diagnostic mode (--diag) dumps the raw extracted text for every PDF into
debug/ucda/ so the operator can inspect format drift and design the next
parser version without re-downloading.

Usage:
    cd backend
    python -m scraper.sources.ucda_monthly             # preview / discover only
    python -m scraper.sources.ucda_monthly --write     # parse + write JSON
    python -m scraper.sources.ucda_monthly --diag      # also dump raw text
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR  = ROOT / "frontend" / "public" / "data"
CACHE_DIR = ROOT / "backend"  / "scraper" / "cache" / "ucda"
DEBUG_DIR = ROOT / "backend"  / "scraper" / "debug" / "ucda"
OUT_PATH  = DATA_DIR / "uganda_monthly.json"

UCDA_BASE = "https://ugandacoffee.go.ug"
LISTING_URLS = [
    f"{UCDA_BASE}/resource-center/reports/monthly-reports",
    f"{UCDA_BASE}/resource-center/reports/monthly-reports?page=1",
    f"{UCDA_BASE}/resource-center/reports/monthly-reports?page=2",
    f"{UCDA_BASE}/resource-center/reports/monthly-reports?page=3",
]

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Two PDF URL patterns observed in UCDA's listings:
#   1. /sites/default/files/YYYY-MM/<filename>.pdf  — older Drupal asset path
#   2. /file-download/download/public/<numeric-id>  — newer Drupal download
_PDF_LINK_RE = re.compile(
    r'href=["\']'
    r'(?P<href>'
    r'(?:/sites/default/files/[^"\']+\.pdf)'
    r'|(?:/file-download/download/public/\d+)'
    r')["\']',
    re.I,
)

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

CALL_TIMEOUT = 60


# ── data model ──────────────────────────────────────────────────────────────

@dataclass
class MonthlyReport:
    month: str                          # "YYYY-MM"
    robusta_bags: int | None = None
    arabica_bags: int | None = None
    total_bags:   int | None = None
    value_usd:    float | None = None
    by_grade:       list[dict] = field(default_factory=list)
    by_destination: list[dict] = field(default_factory=list)
    parser_version: str = "unknown"     # which _parse_vN handled it
    source_pdf:     str | None = None
    parse_warnings: list[str] = field(default_factory=list)


# ── discovery (patchright stealth) ──────────────────────────────────────────

async def _fetch_html_browser(url: str) -> str | None:
    """Render a UCDA page with patchright so Cloudflare/JS challenges resolve."""
    try:
        from patchright.async_api import async_playwright
    except ImportError:
        logger.warning("[ucda] patchright unavailable — cannot reach UCDA")
        return None

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            ctx = await browser.new_context(user_agent=_BROWSER_HEADERS["User-Agent"])
            page = await ctx.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                await page.wait_for_timeout(2_500)
                return await page.content()
            finally:
                await page.close()
        finally:
            await browser.close()


async def _fetch_pdf_browser(url: str) -> bytes | None:
    """Download a PDF via the patchright context so cookies / TLS-fingerprint
    bypass passes the same anti-bot checks as the HTML page."""
    try:
        from patchright.async_api import async_playwright
    except ImportError:
        return None
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            ctx = await browser.new_context(user_agent=_BROWSER_HEADERS["User-Agent"])
            resp = await ctx.request.get(url, timeout=CALL_TIMEOUT * 1000)
            if not resp.ok:
                logger.warning(f"[ucda] PDF fetch {url} → HTTP {resp.status}")
                return None
            return await resp.body()
        finally:
            await browser.close()


def _try_requests(url: str) -> bytes | None:
    """Fast-path: try a plain requests fetch first. Often works for the PDF
    host even when the HTML listing page is gated."""
    try:
        r = requests.get(url, headers=_BROWSER_HEADERS, timeout=CALL_TIMEOUT,
                         allow_redirects=True)
        if r.status_code == 200 and len(r.content) > 1024:
            return r.content
    except Exception:                       # noqa: BLE001
        pass
    return None


def discover_pdf_urls_from_html(html: str) -> list[str]:
    """Return absolute URLs of every PDF link on a UCDA listing page."""
    seen: set[str] = set()
    out: list[str] = []
    for m in _PDF_LINK_RE.finditer(html or ""):
        href = m.group("href")
        url = href if href.startswith("http") else UCDA_BASE + href
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


async def discover_all_pdfs() -> list[str]:
    """Walk every listing page, return the union of PDF URLs found.
    Skips listing pages that fail to load (returns an empty list for them)."""
    all_urls: list[str] = []
    for page_url in LISTING_URLS:
        html = await _fetch_html_browser(page_url)
        if not html:
            print(f"  [ucda] {page_url}: discovery failed (no HTML)")
            continue
        page_urls = discover_pdf_urls_from_html(html)
        print(f"  [ucda] {page_url}: {len(page_urls)} PDFs")
        all_urls.extend(page_urls)
    # Dedupe across pages while preserving first-seen order.
    seen: set[str] = set()
    deduped: list[str] = []
    for u in all_urls:
        if u not in seen:
            seen.add(u); deduped.append(u)
    return deduped


# ── PDF text extraction ────────────────────────────────────────────────────

def _extract_pages(pdf_bytes: bytes) -> list[str]:
    """Run pdfplumber on the PDF and return per-page text. Page boundaries
    matter: the v2 destinations engine scopes its search to the page(s)
    carrying the table header, which kills TOC / narrative false-matches by
    construction. Returns [] on any extraction failure."""
    try:
        import io

        import pdfplumber
    except ImportError:
        logger.error("[ucda] pdfplumber not installed")
        return []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return [p.extract_text() or "" for p in pdf.pages]
    except Exception as e:                  # noqa: BLE001
        logger.warning(f"[ucda] pdfplumber failed: {e}")
        return []


def _extract_text(pdf_bytes: bytes) -> str:
    """All pages concatenated — used for diagnostics dumps and the v1
    whole-text parsing paths."""
    return "\n".join(_extract_pages(pdf_bytes))


# ── parsers (one per observed report format) ────────────────────────────────
#
# UCDA's monthly report layout has changed 3-4 times since 2018. The driver
# tries every parser in PARSERS order and keeps the first that succeeds.
# Adding a new format: write `_parse_vN(text, source_url)`, append to PARSERS,
# write a synthetic-text test in tests/test_ucda_monthly.py.

_MONTH_NAMES_RE = (
    r"January|February|March|April|May|June|July|August|"
    r"September|October|November|December|Jan|Feb|Mar|Apr|Jul|Aug|Sept?|Oct|Nov|Dec"
)

# Title pattern — strict. Only matches the month-year when it sits inside a
# title-shaped phrase ("Monthly Coffee Report - <Month> <Year>", "Report For
# <Month> <Year>", etc.). Picking this BEFORE the generic first-match avoids
# the year-misdetection bug observed on /file-download/public/{id} PDFs: those
# PDFs have no month in the URL, and the head of the document mentioned a
# comparison period ("December 2024") BEFORE the actual title ("November
# 2025") in the extracted text — the old regex picked the comparison.
_TITLE_MONTH_YEAR_RE = re.compile(
    rf"(?:monthly\s+(?:coffee\s+)?report|coffee\s+report|report\s+for|"
    rf"report\s+of|for\s+the\s+month\s+of)\s*[-–:]?\s*"
    rf"(?P<month>{_MONTH_NAMES_RE})\s*[,.]?\s*(?P<year>20\d{{2}})",
    re.I,
)

# Generic fallback — first <Month> <Year>, possibly with "Coffee Report" between.
_MONTH_YEAR_RE = re.compile(
    rf"(?P<month>{_MONTH_NAMES_RE})\s+(?:Coffee\s+Report\s*[-–]?\s*)?(?P<year>20\d{{2}})",
    re.I,
)

_NUM_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def _ym_from_text(text: str, fallback_url: str | None) -> str | None:
    """Heuristic report-month detection. Strategy (refined after dispatch #N
    showed the generic first-match producing wrong-month entries for the
    `/file-download/download/public/{id}` PDFs whose URL slug carries no
    month):

      1. PREFER the URL filename — those carry the explicit reporting month
         (e.g. ".../2025-07/09-June 2025 Report.pdf" → "2025-06"). The
         leading "09-" / "08-" prefix is an upload sequence, not a date.
      2. Look for a TITLE-shaped match in the text head ("Monthly Coffee
         Report - November 2025"). Comparison-period mentions like
         "vs November 2024" don't match this pattern.
      3. Fall back to the FIRST generic `<Month> <Year>` in the head. This
         is best-effort for old reports whose title doesn't match the
         title pattern.
    """
    # 1. URL-first detection — most reliable signal for UCDA's recent files.
    if fallback_url:
        slug = fallback_url.replace("%20", " ")
        for word, mo_num in MONTH_NAMES.items():
            mw = re.search(rf"\b{re.escape(word)}\s+(20\d{{2}})\b", slug, re.I)
            if mw:
                return f"{int(mw.group(1)):04d}-{mo_num:02d}"

    head = (text or "")[:3000]

    # 2. Title-shaped match — strict.
    tm = _TITLE_MONTH_YEAR_RE.search(head)
    if tm:
        mo = MONTH_NAMES.get(tm.group("month").lower())
        yr = int(tm.group("year"))
        if mo: return f"{yr:04d}-{mo:02d}"

    # 3. Generic fallback.
    m = _MONTH_YEAR_RE.search(head)
    if m:
        mo = MONTH_NAMES.get(m.group("month").lower())
        yr = int(m.group("year"))
        if mo: return f"{yr:04d}-{mo:02d}"
    return None


def _url_carries_month(url: str | None) -> bool:
    """True iff the URL slug contains an English month name + 4-digit year
    (after %20 → space). Used to prefer URL-anchored YM detections over
    text-scan ones when content-deduping the report list."""
    if not url:
        return False
    slug = url.replace("%20", " ")
    for word in MONTH_NAMES:
        if re.search(rf"\b{re.escape(word)}\s+20\d{{2}}\b", slug, re.I):
            return True
    return False


def _to_int(s: str) -> int | None:
    try:
        return int(float(s.replace(",", "").strip()))
    except (ValueError, AttributeError):
        return None


def _to_float(s: str) -> float | None:
    try:
        return float(s.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


# Known coffee grades to look for in a line-keyed scan. Robusta first (more
# common in Uganda), then Arabica varieties. The matchers are case-insensitive
# substring tests — small surface area, easy to extend.
#
# IMPORTANT: order matters. Longer/more-specific labels go first so we don't
# accidentally collapse "Organic Robusta" → "Robusta". `Sustainable` is its
# own thing UCDA reports separately (washed/sustainable Robusta program).
GRADE_LABELS_ROBUSTA = [
    "Screen 18", "Screen 17", "Screen 15", "Screen 14", "Screen 13",
    "Screen 12", "Screen 10", "BHP", "Organic Robusta", "Sustainable",
    "Washed Robusta", "Kiboko", "FAQ",
]
GRADE_LABELS_ARABICA = [
    "Bugisu AA", "Bugisu A+", "Bugisu A", "Bugisu PB", "Bugisu B",
    "Drugar", "Wugar", "Arabica Parchment", "Mt Elgon", "Washed Arabica",
    "Organic Arabica",
]
_ROBUSTA_GRADE_SET = {g.lower() for g in GRADE_LABELS_ROBUSTA}
_ARABICA_GRADE_SET = {g.lower() for g in GRADE_LABELS_ARABICA}


def _sum_robusta(by_grade: list[dict]) -> int | None:
    s = sum(g.get("bags", 0) for g in by_grade
            if g.get("grade", "").lower() in _ROBUSTA_GRADE_SET)
    return s or None


def _sum_arabica(by_grade: list[dict]) -> int | None:
    s = sum(g.get("bags", 0) for g in by_grade
            if g.get("grade", "").lower() in _ARABICA_GRADE_SET)
    return s or None


def _split_dest_row(nums: list[int]) -> tuple[int, int, int]:
    """Split a row's plausible cell values into (Robusta, Arabica, Total) bags.

    UCDA's destinations table columns are R / A / Total / %ind / %cum.
    %ind and %cum are < 100 and already filtered out before this helper runs.
    For a typical row pdfplumber gives us 2-3 plausible cells:

      • 3 cells [R, A, T] (e.g. Italy 183,308 / 15,438 / 198,746)
        → Total is the max; the next-largest is Robusta; Arabica = T − R
      • 2 cells [R, T] where T == R (e.g. Sudan 51,100 / 51,100 — robusta-only
        destination, Arabica column blank in the source)
        → R = T, A = 0
      • 1 cell — a single value got captured (rare partial row)
        → R = T = the value, A = 0
      • 6+ cells when the report layout puts MONTH and CTD side-by-side
        (e.g. Italy 4,500 / 600 / 5,100 / 161,159 / 1,310 / 162,469).
        Both triples pass the 250k filter for small destinations or early
        in the crop year. Picking the larger T over-counts by a factor of
        ~2x (the 2020-23 over-counter pattern in the invariant check). We
        find ALL (a, b, c) triples where a+b=c and prefer the smallest T,
        which is the MONTH triple.
    """
    if not nums:
        return 0, 0, 0

    # Collect candidate (T, R, A) interpretations of the row, then pick the
    # smallest T. Two sources contribute:
    #   • TRIPLES: (a, b, c) with a + b ≈ c — the standard R-A-T tuple.
    #     Tiny T values (< 500 bags) are rejected so spurious format-
    #     marker triples like "33 + 12 = 45" can't hijack the row.
    #   • PAIRS: a value appearing twice in the row — the Sudan-style
    #     robusta-only signature where the source PDF leaves the Arabica
    #     cell blank, so pdfplumber emits two copies of the Total (R = T).
    #     The smallest qualifying pair wins (so a month pair beats a CTD
    #     pair in the same row).
    # Preferring the smallest T across candidate sets means the MONTH
    # interpretation beats the CTD/YTD one on multi-column rows.
    candidates: list[tuple[int, int, int]] = []  # (T, R, A)

    sorted_nums = sorted(nums)
    n = len(sorted_nums)
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                a, b, c = sorted_nums[i], sorted_nums[j], sorted_nums[k]
                if c >= 500 and abs(a + b - c) <= 1:
                    candidates.append((c, b, a))  # T=c, R=larger leg, A=smaller
    for i in range(n - 1):
        if sorted_nums[i] == sorted_nums[i + 1] and sorted_nums[i] >= 500:
            candidates.append((sorted_nums[i], sorted_nums[i], 0))
            break  # smallest pair only — repeats further up are redundant

    if candidates:
        candidates.sort(key=lambda c: c[0])
        T, R, A = candidates[0]
        return R, A, T

    # Fallback for 1- or 2-cell rows that produced no triple or pair.
    sorted_desc = sorted(nums, reverse=True)
    T = sorted_desc[0]
    if len(sorted_desc) == 1:
        return T, 0, T
    R = sorted_desc[1]
    A = max(0, T - R)
    return R, A, T


# Destination countries observed across UCDA's reports. Order matters only
# for the v1 line-scan (break-after-first-match) — new names go at the END
# so v1 behavior on already-passing months is unchanged. The v2 engine is
# position-based and order-independent. When the v2 published-total
# cross-check reports a shortfall, a missing country is the usual culprit —
# add it here.
KNOWN_COUNTRIES = (
    "italy", "germany", "sudan", "belgium", "morocco", "spain", "usa",
    "united states", "kenya", "russia", "russian federation", "switzerland",
    "netherlands", "south africa", "uk", "united kingdom", "france",
    "japan", "china", "india", "saudi arabia", "uae", "united arab emirates",
    "egypt", "turkey", "korea", "south korea", "portugal", "greece",
    "ethiopia", "rwanda", "tanzania", "burundi", "south sudan", "djibouti",
    "algeria", "tunisia", "australia", "canada", "mexico", "brazil",
    "estonia", "poland", "romania", "singapore", "croatia", "israel",
    # Added with the v2 engine (observed in the 2025-06 walkthrough):
    "u.s.a", "u.a.e", "vietnam", "latvia", "slovenia", "lebanon", "jordan",
    "albania", "austria", "sweden", "libya", "new zealand", "ecuador",
    "denmark", "finland", "norway", "ireland", "ukraine", "lithuania",
    "hungary", "bulgaria", "slovakia", "serbia", "malta", "cyprus",
    "qatar", "kuwait", "hong kong", "taiwan", "indonesia", "malaysia",
)

# Spelling variants → one canonical display name, so the frontend's
# per-country aggregation doesn't split "U.S.A" / "Usa" / "United States"
# into three bars.
_COUNTRY_DISPLAY_OVERRIDES = {
    "usa": "United States", "u.s.a": "United States",
    "united states": "United States",
    "uk": "United Kingdom", "united kingdom": "United Kingdom",
    "uae": "United Arab Emirates", "u.a.e": "United Arab Emirates",
    "united arab emirates": "United Arab Emirates",
    "russian federation": "Russia",
    "korea": "South Korea", "south korea": "South Korea",
}


def _country_display(c: str) -> str:
    return _COUNTRY_DISPLAY_OVERRIDES.get(c, c.title())


# Markers that flag the start / end of the destinations table across the
# observed UCDA report formats. The Annex number drifts between years (Annex
# 3 in 2022-23, Annex 4 in 2024, etc.); detecting any of them is fine since
# we use the FIRST matched header position. End markers stop the scope so
# we don't pick up countries from the following section (TRADE ACTORS,
# EXPORTERS, BUYERS — all of which mention countries too).
_DEST_START_MARKERS = (
    "Main Destinations of Uganda",
    "DESTINATION POSITION HELD",
    "Destinations of Uganda Coffee",
    "Top Destinations",
)
_DEST_END_MARKERS = (
    "Annex 4:", "Annex 5:", "Annex 6:", "Annex 7:", "Annex 8:",
    "TRADE ACTORS", "Trade Actors",
    "EXPORTERS", "Top Exporters", "Top Coffee Exporters",
    "BUYERS", "Top Buyers", "Top International Buyers",
    "GRADE BREAKDOWN", "Grade Breakdown",
    "Top Coffee Exporters",
)


def _extract_destinations_table(text: str, known_countries: tuple[str, ...]) -> list[dict]:
    """Slice the text at the destinations-table boundaries and walk every
    country match inside that scope.

    Why this approach beats the line-by-line scan:
      • pdfplumber sometimes collapses an entire table page onto one line —
        the `break`-after-first-match in the old scan dropped every country
        except the first when this happened (the 2024-26 under-counting
        pattern in the sanity check).
      • Narrative paragraphs and trade-actor tables mention country names
        too; the old scan added their (small) numbers as if they were
        destination cells (the 2020-23 over-counting pattern).

    Returns a list shaped like the old line-by-line output. Empty list when
    no table header is found, signalling the caller to fall back to the
    flat scan."""
    # Find the start of the destinations table by scanning for any known
    # header marker. Headers can be wrapped across lines (newline before /
    # after) so we search case-insensitively.
    table_start = -1
    low = text.lower()
    for marker in _DEST_START_MARKERS:
        i = low.find(marker.lower())
        if i >= 0:
            table_start = i
            break
    if table_start < 0:
        return []

    # Find the end of the table — first end-marker strictly after the start.
    # If nothing matches, run to the end of the text (the report's last
    # section is sometimes the destinations table itself).
    table_end = len(text)
    for end_marker in _DEST_END_MARKERS:
        i = low.find(end_marker.lower(), table_start + 30)
        if 0 < i < table_end:
            table_end = i

    scope = text[table_start:table_end]

    # Find every (position, country) inside the scope, sorted by position.
    positions: list[tuple[int, str]] = []
    for c in known_countries:
        for m in re.finditer(rf"(?<![A-Za-z]){re.escape(c)}\b", scope, re.I):
            positions.append((m.start(), c))
    if not positions:
        return []
    positions.sort(key=lambda p: p[0])

    # Slice the scope between consecutive country positions and extract the
    # numeric cells from each per-row segment. Each country claims the text
    # from its name to the next country's name (or scope end if last).
    out: list[dict] = []
    for i, (pos, country) in enumerate(positions):
        next_pos = positions[i + 1][0] if i + 1 < len(positions) else len(scope)
        row_text = scope[pos:next_pos]
        nums = [_to_int(m.group(0)) for m in _NUM_RE.finditer(row_text)]
        nums = [n for n in nums if n is not None and 100 <= n <= 250_000]
        if not nums:
            continue
        rob, ara, tot = _split_dest_row(nums)
        out.append({
            "country":      _country_display(country),
            "bags":         tot,
            "robusta_bags": rob,
            "arabica_bags": ara,
        })
    return out


# ── v2 destinations engine (page-scoped, published-total cross-check) ───────
#
# Designed off the operator's June-2025 walkthrough of the real PDF layout:
#
#   1. SCOPE: only the page(s) whose text carries the "Main Destinations of
#      Uganda Coffee" header participate. pdfplumber often drops the spaces
#      ("MainDestinationsofUgandaCoffeebyTypeinJune2025"), so the regex
#      allows zero-width gaps. TOC pages match too, but they carry no
#      country+number rows, so they contribute nothing.
#   2. ROWS look like  "1 Italy 1 321,460 30,150 351,610 34.67 34.67":
#      rank / name / prior-month rank / Robusta / Arabica / Total / %ind /
#      %cum. Cells classify by FORM, not position: ranks are small ints
#      (≤ _V2_RANK_MAX) sitting BEFORE the first big number; the % columns
#      carry decimal points. A row's reading is the LEFTMOST candidate —
#      either an R+A=T triple or an equal-value pair — so month columns
#      beat CTD/cumulative columns when both are present.
#   3. SINGLE-TYPE destinations print value + total only ("Sudan 79,080
#      79,080") — an equal pair. Family defaults to Robusta (Uganda is
#      ~80% robusta); known arabica-only buyers live in _V2_ARABICA_ONLY.
#   4. CROSS-CHECK: the table's published footer ("Total 907,058 107,004
#      1,014,062") is parse-time ground truth. Σ row robusta/arabica must
#      match it. A mismatch first tries flipping single-type family
#      assignments (unique exact one-flip fixes only), then surfaces a
#      parse warning the dashboard can display.

_V2_HEADER_RE = re.compile(r"main\s*destinations?\s*of\s*uganda\s*coffee", re.I)
_V2_TOTAL_ROW_RE = re.compile(r"total\s+(\d[\d,]*)\s+(\d[\d,]*)\s+(\d[\d,]*)", re.I)
_V2_RANK_MAX = 70          # rank columns (current + prior month) stay under this
_V2_CELL_MAX = 800_000     # no single destination plausibly exceeds this / month

# Single-type destinations whose blank column is the ROBUSTA one. Everything
# else defaults to robusta-only. Grows as cross-check warnings surface.
_V2_ARABICA_ONLY = {"saudi arabia"}


def _v2_country_matches(scope: str) -> list[tuple[int, int, str]]:
    """Every (start, end, country) for KNOWN_COUNTRIES in the scope, with
    overlapping spans resolved longest-wins ("South Sudan" beats the "Sudan"
    embedded in it). Multi-word names tolerate squeezed spaces
    ("SouthAfrica") since pdfplumber drops them on packed slides."""
    found: list[tuple[int, int, str]] = []
    for c in KNOWN_COUNTRIES:
        pat = r"\s*".join(re.escape(w) for w in c.split())
        for m in re.finditer(rf"(?<![A-Za-z]){pat}\b", scope, re.I):
            found.append((m.start(), m.end(), c))
    found.sort(key=lambda t: (t[0], -(t[1] - t[0])))
    kept: list[tuple[int, int, str]] = []
    for s, e, c in found:
        if any(s < ke and ks < e for ks, ke, _ in kept):
            continue
        kept.append((s, e, c))
    return kept


def _v2_row_from_nums(country: str, nums: list[int]) -> dict | None:
    """LEFTMOST-candidate cell split. Walk the cells left to right; at each
    position prefer an R+A=T triple (±1 bag rounding), else an equal-value
    pair (single-type row). Month columns precede CTD columns in every
    observed layout, so leftmost == the month reading."""
    for i in range(len(nums) - 1):
        if i + 2 < len(nums) and abs(nums[i] + nums[i + 1] - nums[i + 2]) <= 1:
            return {"bags": nums[i + 2], "robusta_bags": nums[i],
                    "arabica_bags": nums[i + 1]}
        if nums[i] == nums[i + 1]:
            if country in _V2_ARABICA_ONLY:
                return {"bags": nums[i], "robusta_bags": 0,
                        "arabica_bags": nums[i], "_single_type": True}
            return {"bags": nums[i], "robusta_bags": nums[i],
                    "arabica_bags": 0, "_single_type": True}
    return None


def _v2_parse_rows(scope: str) -> list[dict]:
    matches = _v2_country_matches(scope)
    rows: list[dict] = []
    seen: set[str] = set()
    for i, (s, e, country) in enumerate(matches):
        seg_end = matches[i + 1][0] if i + 1 < len(matches) else len(scope)
        seg = scope[e:seg_end]
        # The published footer ("Total 907,058 …") and the repeated column
        # headers ("Robusta Arabica Total Individual …") both contain the
        # word "Total" — anything from there on is table chrome, not row
        # cells. This is what protects the row that spans a page break.
        cut = re.search(r"total", seg, re.I)
        if cut:
            seg = seg[:cut.start()]
        nums: list[int] = []
        seen_big = False
        for m in _NUM_RE.finditer(seg):
            tok = m.group(0)
            if "." in tok:
                continue                    # % columns carry decimals
            n = _to_int(tok)
            if n is None or n > _V2_CELL_MAX:
                continue                    # cell-concatenation outliers
            if n <= _V2_RANK_MAX and not seen_big:
                continue                    # prior-month rank before the data
            nums.append(n)
            if n > _V2_RANK_MAX:
                seen_big = True
        if len(nums) < 2:
            continue                        # page-break-mangled row — dropped
        row = _v2_row_from_nums(country, nums)
        if row is None:
            continue
        disp = _country_display(country)
        if disp in seen:
            continue                        # first (rank-ordered) match wins
        seen.add(disp)
        row["country"] = disp
        rows.append(row)
    return rows


def _v2_published_totals(scope: str) -> tuple[int, int, int] | None:
    """The footer row "Total <Robusta> <Arabica> <Total>". Candidates must
    satisfy R + A ≈ T and clear a 50k floor (real monthly totals are 200k+;
    the floor rejects sub-table 'Total' rows). Largest T wins — that's the
    grand total when a multi-page table prints intermediate ones."""
    best: tuple[int, int, int] | None = None
    for m in _V2_TOTAL_ROW_RE.finditer(scope):
        r, a, t = _to_int(m.group(1)), _to_int(m.group(2)), _to_int(m.group(3))
        if r is None or a is None or t is None:
            continue
        if abs(r + a - t) <= 1 and t >= 50_000 and (best is None or t > best[2]):
            best = (r, a, t)
    return best


def _extract_destinations_v2(
    pages: list[str],
) -> tuple[list[dict], tuple[int, int, int] | None, list[str]]:
    """Returns (rows, published_totals, warnings). Empty rows ⇒ the caller
    falls back to the v1 slicer + line-scan (older report formats)."""
    scoped = [p for p in pages if p and _V2_HEADER_RE.search(p)]
    if not scoped:
        return [], None, []
    scope = "\n".join(scoped)
    rows = _v2_parse_rows(scope)
    if not rows:
        return [], None, []
    published = _v2_published_totals(scope)
    warnings: list[str] = []
    if published:
        pr, pa, pt = published
        sr = sum(r["robusta_bags"] for r in rows)
        sa = sum(r["arabica_bags"] for r in rows)
        if (sr, sa) != (pr, pa):
            dr, da = pr - sr, pa - sa
            # A wrong single-type family default moves the SAME amount off
            # one family onto the other. Flip the unique row that fixes both
            # sums exactly; anything fuzzier stays a warning for the
            # operator (no speculative auto-corrections).
            if dr == -da and dr != 0:
                over = "robusta_bags" if dr < 0 else "arabica_bags"
                under = "arabica_bags" if dr < 0 else "robusta_bags"
                cands = [r for r in rows
                         if r.get("_single_type") and r[over] == abs(dr)]
                if len(cands) == 1:
                    row = cands[0]
                    row[under], row[over] = row[over], 0
                    warnings.append(
                        f"single-type family flipped for {row['country']} "
                        f"({abs(dr):,} bags) to match published totals")
                    sr = sum(r["robusta_bags"] for r in rows)
                    sa = sum(r["arabica_bags"] for r in rows)
        if (sr, sa) != (pr, pa):
            # Severity gate on NET volume missing (not per-family deltas:
            # those double-count offsetting family mis-assignments that
            # don't change total volume). Sub-1% residuals — unlisted
            # micro-destinations, one-bag rounding, small family swaps —
            # are recorded but worded so the dashboard's /cross-check
            # failed/ filter ignores them; the first live run showed they
            # occur on nearly every month and would have turned the
            # operator-facing flag into permanent noise.
            miss_net = abs((pr + pa) - (sr + sa))
            label = ("destinations cross-check failed"
                     if pt and miss_net / pt > 0.01
                     else "destinations cross-check residual (≤1% of trade)")
            warnings.append(
                f"{label}: "
                f"Σrobusta={sr:,} vs published {pr:,} (Δ{pr - sr:+,}); "
                f"Σarabica={sa:,} vs published {pa:,} (Δ{pa - sa:+,})")
        if abs(pr + pa - pt) > 1:
            warnings.append("published destinations Total row inconsistent (R+A != T)")
    else:
        warnings.append("no published Total row found on destinations page(s)")
    for r in rows:
        r.pop("_single_type", None)
    return rows, published, warnings


def _parse_v1_recent(text: str, source_url: str | None,
                     pages: list[str] | None = None) -> MonthlyReport | None:
    """First-pass parser modelled on the recent (2024+) report layout
    suggested by UCDA's search snippets ("Period/Coffee Type … Qty(60-kg bags)
    Value (US $)"). Conservative: only emits a MonthlyReport when it can
    pin down the month + at least one of robusta/arabica totals.

    This is the diagnostic-first format — when parsers fail to fully classify
    a PDF, the driver still records the discovered month + raw_text path so
    we can iterate the parser without re-downloading.
    """
    ym = _ym_from_text(text, source_url)
    if not ym:
        return None
    rep = MonthlyReport(month=ym, parser_version="v1", source_pdf=source_url)

    # NB: we deliberately do NOT regex "Total Robusta" / "Total Arabica" out of
    # the text. The first round of dispatch showed that pattern wildly
    # unreliable: it matched footnote numbers, % values, screen sub-totals,
    # etc., producing values like robusta=4, arabica=5 for some months. The
    # grade table downstream parses cleanly across every era, so we SUM by
    # family below — see _sum_robusta / _sum_arabica.
    # Per-line USD value capture is still done by regex since the report
    # doesn't break value down by grade in a stable way.
    m = re.search(rf"value\s*\(?\s*US\s*\$?\s*\)?[^\n\d]*?({_NUM_RE.pattern})",
                  text, re.I)
    if m:
        v = _to_float(m.group(1))
        # USD value for a Uganda month is six-figure+ — reject obvious noise.
        if v is not None and v >= 100_000:
            rep.value_usd = v

    # Grade breakdown — scan every line for known grade labels followed by
    # at least one numeric column. Captures `{grade, bags}` only when the
    # number looks plausible (≥ 100 bags to skip percentage cells).
    for line in text.splitlines():
        for label in GRADE_LABELS_ROBUSTA + GRADE_LABELS_ARABICA:
            if label.lower() in line.lower():
                nums = [_to_int(m.group(0)) for m in _NUM_RE.finditer(line)]
                nums = [n for n in nums if n and n >= 100]
                if nums:
                    rep.by_grade.append({"grade": label, "bags": nums[0]})
                break
    # Dedupe — keep the LARGEST value per grade when the parser sees the
    # same name more than once. Two cases produce dupes: (a) narrative
    # mentions of a grade before the table (often tiny numbers from prior-
    # period comparisons), (b) the table line being split across two
    # pdfplumber lines so the same grade fires twice. Keeping max(bags)
    # picks the real table row over the narrative noise.
    _g_max: dict[str, int] = {}
    for g in rep.by_grade:
        cur = _g_max.get(g["grade"], 0)
        if g["bags"] > cur:
            _g_max[g["grade"]] = g["bags"]
    rep.by_grade = [{"grade": name, "bags": bags} for name, bags in _g_max.items()]

    # Destinations — v2 engine first: page-scoped to the "Main Destinations
    # of Uganda Coffee" header, order-based cell classification, and a
    # published-Total cross-check (see _extract_destinations_v2). Reports
    # whose format predates that header fall back to the older two-stage
    # slicer + line-scan below.
    pages_list = [p for p in (pages or []) if p] or [text]
    v2_rows, v2_published, v2_warnings = _extract_destinations_v2(pages_list)
    if v2_rows:
        rep.by_destination = v2_rows
        rep.parse_warnings.extend(v2_warnings)
    else:
        sliced = _extract_destinations_table(text, KNOWN_COUNTRIES)
        # ALWAYS run the line-scan in addition to the slicer, then dedupe by
        # max(bags). The 2024-05/24-11/25-04/25-06 etc. cases showed the
        # slicer can lock onto a region that contains a header marker but
        # not the actual table — e.g. a TOC or a slide footer — yielding 1
        # country with the year (2025) as its bag count. Without the
        # line-scan as a backup, those months end up with Σ destinations
        # ≈ 2k. Running both and taking max means: the slicer's clean data
        # wins where it's right, the line-scan's coverage wins where the
        # slicer missed the real table.
        if sliced:
            rep.by_destination.extend(sliced)
        for line in text.splitlines():
            low = line.lower()
            for c in KNOWN_COUNTRIES:
                # Tolerate rank-prefix without space ("2Germany"): negative
                # lookbehind on letters instead of \b so "2Germany" matches
                # (digit→letter is not a word boundary).
                if re.search(rf"(?<![A-Za-z]){re.escape(c)}\b", low):
                    nums = [_to_int(m.group(0)) for m in _NUM_RE.finditer(line)]
                    nums = [n for n in nums if n is not None and 100 <= n <= 250_000]
                    if nums:
                        rob, ara, tot = _split_dest_row(nums)
                        rep.by_destination.append({
                            "country":      _country_display(c),
                            "bags":         tot,
                            "robusta_bags": rob,
                            "arabica_bags": ara,
                        })
                    break
        # Dedupe destinations — keep the LARGEST value per country.
        _d_max: dict[str, dict] = {}
        for d in rep.by_destination:
            cur = _d_max.get(d["country"])
            if cur is None or d["bags"] > cur["bags"]:
                _d_max[d["country"]] = d
        rep.by_destination = list(_d_max.values())

    # Derive robusta/arabica/total volumes. Source priority:
    #   1. The destinations table's published Total row (v2) — printed by
    #      UCDA itself, so it IS the month's export total. Authoritative.
    #   2. Otherwise reconcile the two decompositions we extracted —
    #      Σ grade table vs Σ by_destination — per family, taking the
    #      LARGER reading. When they disagree, one extractor missed cells;
    #      whichever caught more wins for that family.
    if v2_published:
        pr, pa, pt = v2_published
        rep.robusta_bags, rep.arabica_bags, rep.total_bags = pr, pa, pt
        gsum = (_sum_robusta(rep.by_grade) or 0) + (_sum_arabica(rep.by_grade) or 0)
        if gsum and abs(gsum - pt) / pt > 0.05:
            rep.parse_warnings.append(
                f"grade-table sum {gsum:,} differs >5% from published "
                f"export total {pt:,}")
    else:
        grade_r = _sum_robusta(rep.by_grade) or 0
        grade_a = _sum_arabica(rep.by_grade) or 0
        dest_r  = sum(d.get("robusta_bags", 0) for d in rep.by_destination)
        dest_a  = sum(d.get("arabica_bags", 0) for d in rep.by_destination)
        merged_r = max(grade_r, dest_r) or None
        merged_a = max(grade_a, dest_a) or None
        rep.robusta_bags = merged_r
        rep.arabica_bags = merged_a
        if merged_r is not None or merged_a is not None:
            rep.total_bags = (merged_r or 0) + (merged_a or 0)

    if rep.robusta_bags is None and rep.arabica_bags is None:
        rep.parse_warnings.append(
            "No robusta/arabica grade rows matched — likely format drift on the "
            "grade breakdown table."
        )
        return rep        # still surface the month + warnings
    return rep


# Registry — first parser to return a populated MonthlyReport wins.
PARSERS = [
    ("v1_recent", _parse_v1_recent),
]


def parse_pdf(pdf_bytes: bytes, source_url: str | None) -> MonthlyReport | None:
    pages = _extract_pages(pdf_bytes)
    text = "\n".join(pages)
    if not text.strip():
        return None
    for name, parser in PARSERS:
        try:
            rep = parser(text, source_url, pages)
            if rep:
                rep.parser_version = name
                return rep
        except Exception as e:              # noqa: BLE001
            logger.warning(f"[ucda] parser {name} crashed: {e} ({source_url})")
    # All parsers failed → emit a stub so the diagnostic dump still surfaces
    # the URL + extracted month (if any) for manual inspection.
    ym = _ym_from_text(text, source_url) or "unknown"
    return MonthlyReport(
        month=ym, source_pdf=source_url, parser_version="failed",
        parse_warnings=["No registered parser matched this PDF."],
    )


# ── cache + diagnostic dump ────────────────────────────────────────────────

def _cache_path(url: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", url.replace(UCDA_BASE, ""))
    return CACHE_DIR / f"{safe.strip('_')}.pdf"


async def _get_pdf_bytes(url: str) -> bytes | None:
    cached = _cache_path(url)
    if cached.exists():
        return cached.read_bytes()
    # Try plain requests first (fast path), then patchright.
    data = _try_requests(url) or await _fetch_pdf_browser(url)
    if data:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
    return data


def _dump_diagnostics(url: str, text: str, report: MonthlyReport | None) -> None:
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", url.replace(UCDA_BASE, ""))[:120]
    (DEBUG_DIR / f"{safe}.txt").write_text(text or "", encoding="utf-8")
    if report:
        (DEBUG_DIR / f"{safe}.json").write_text(
            json.dumps(asdict(report), indent=2, default=str), encoding="utf-8")


# ── orchestrator ───────────────────────────────────────────────────────────

async def run_async(write: bool = False, diag: bool = False,
                    max_pdfs: int | None = None) -> int:
    print("[ucda] discovering PDFs across listing pages...")
    pdf_urls = await discover_all_pdfs()
    if not pdf_urls:
        print("[ucda] no PDFs discovered — bailing")
        return 1
    print(f"[ucda] discovered {len(pdf_urls)} unique PDFs")
    if max_pdfs:
        pdf_urls = pdf_urls[:max_pdfs]

    reports: list[MonthlyReport] = []
    parser_counts: dict[str, int] = {}
    for i, url in enumerate(pdf_urls):
        data = await _get_pdf_bytes(url)
        if not data:
            print(f"  [{i+1:>3}/{len(pdf_urls)}] DOWNLOAD FAILED {url}")
            continue
        text = _extract_text(data)
        rep  = parse_pdf(data, url)
        if rep is None:
            print(f"  [{i+1:>3}/{len(pdf_urls)}] PDF unreadable {url}")
            continue
        reports.append(rep)
        parser_counts[rep.parser_version] = parser_counts.get(rep.parser_version, 0) + 1
        print(f"  [{i+1:>3}/{len(pdf_urls)}] {rep.month}  parser={rep.parser_version}  "
              f"rob={rep.robusta_bags or '?'} ara={rep.arabica_bags or '?'} "
              f"grades={len(rep.by_grade)} dests={len(rep.by_destination)} "
              f"warn={len(rep.parse_warnings)}")
        if diag:
            _dump_diagnostics(url, text, rep)

    # Content-fingerprint dedupe — drop reports whose parsed numbers exactly
    # match another report's. UCDA hosts many recent PDFs at TWO URLs (a
    # `/sites/default/files/...named.pdf` AND a `/file-download/download/
    # public/{id}` alias). The numeric URL has no month in the slug, so its
    # YM detection falls through to the text scan and historically picked
    # the comparison-period mention (off by ~11 months). After this dedupe
    # only the URL-anchored detection survives per fingerprint.
    by_fingerprint: dict[tuple, MonthlyReport] = {}
    for r in reports:
        if r.robusta_bags is None and r.arabica_bags is None:
            # Stubs (failed parsers, no totals) — never collapse, they all
            # surface independently for the operator.
            by_fingerprint[(id(r),)] = r
            continue
        key = (
            r.robusta_bags, r.arabica_bags,
            tuple(sorted((g["grade"], g.get("bags", 0)) for g in r.by_grade)),
            tuple(sorted((d["country"], d.get("bags", 0)) for d in r.by_destination)),
        )
        prior = by_fingerprint.get(key)
        if prior is None:
            by_fingerprint[key] = r
        else:
            # Prefer the report whose URL slug names the month — its YM
            # detection is anchored, not heuristic.
            prior_anchored = _url_carries_month(prior.source_pdf)
            new_anchored   = _url_carries_month(r.source_pdf)
            if new_anchored and not prior_anchored:
                by_fingerprint[key] = r
    dropped = len(reports) - len(by_fingerprint)
    if dropped:
        print(f"[ucda] content-fingerprint dedupe collapsed {dropped} alias PDFs")
    reports = list(by_fingerprint.values())

    # Sort + dedupe by month (keep the most-classified report per month).
    reports.sort(key=lambda r: (r.month, r.parser_version != "failed"))
    deduped: dict[str, MonthlyReport] = {}
    for r in reports:
        prior = deduped.get(r.month)
        if prior is None or (prior.parser_version == "failed" and r.parser_version != "failed"):
            deduped[r.month] = r
    series = sorted(deduped.values(), key=lambda r: r.month)

    payload = {
        "source":  "UCDA Monthly Coffee Report",
        "source_url": LISTING_URLS[0],
        "updated": datetime.utcnow().date().isoformat(),
        "unit":    "60-kg bags",
        "parser_summary": parser_counts,
        "series":  [asdict(r) for r in series],
    }

    print(f"\n[ucda] discovered {len(pdf_urls)} PDFs → "
          f"{len(reports)} reports → {len(series)} unique months")
    print(f"[ucda] parser distribution: {parser_counts}")

    if write:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(
            json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
        print(f"[ucda] wrote {OUT_PATH}")
    else:
        print("[ucda] preview mode — re-run with --write to persist")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Persist JSON to public/data")
    ap.add_argument("--diag",  action="store_true",
                    help="Dump raw PDF text + parsed JSON per PDF to debug/")
    ap.add_argument("--max",   type=int, default=None,
                    help="Cap the number of PDFs processed (for quick iteration)")
    args = ap.parse_args()
    return asyncio.run(run_async(write=args.write, diag=args.diag, max_pdfs=args.max))


if __name__ == "__main__":
    sys.exit(main())
