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

def _extract_text(pdf_bytes: bytes) -> str:
    """Run pdfplumber on the PDF and concatenate every page's text. Returns
    "" on any extraction failure (parser then logs a warning and skips)."""
    try:
        import io

        import pdfplumber
    except ImportError:
        logger.error("[ucda] pdfplumber not installed")
        return ""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            parts = [p.extract_text() or "" for p in pdf.pages]
        return "\n".join(parts)
    except Exception as e:                  # noqa: BLE001
        logger.warning(f"[ucda] pdfplumber failed: {e}")
        return ""


# ── parsers (one per observed report format) ────────────────────────────────
#
# UCDA's monthly report layout has changed 3-4 times since 2018. The driver
# tries every parser in PARSERS order and keeps the first that succeeds.
# Adding a new format: write `_parse_vN(text, source_url)`, append to PARSERS,
# write a synthetic-text test in tests/test_ucda_monthly.py.

_MONTH_YEAR_RE = re.compile(
    r"(?P<month>January|February|March|April|May|June|July|August|"
    r"September|October|November|December|Jan|Feb|Mar|Apr|Jul|Aug|Sept?|Oct|Nov|Dec)"
    r"\s+(?:Coffee\s+Report\s*[-–]?\s*)?(?P<year>20\d{2})",
    re.I,
)

_NUM_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def _ym_from_text(text: str, fallback_url: str | None) -> str | None:
    """Heuristic report-month detection. Strategy (first round of diagnostic
    runs showed the original priority was inverted — text matches inside
    comparison columns like "Volume vs June 2024" overrode the correct month
    from the URL filename):

      1. PREFER the URL filename — those carry the explicit reporting month
         (e.g. ".../2025-07/09-June 2025 Report.pdf" → "2025-06"). The
         leading "09-" / "08-" prefix is an upload sequence, not a date.
      2. Fall back to text scan — pick the FIRST `<Month> <Year>` that
         appears in the upper third of the document (title region), since
         later occurrences are typically comparison-period mentions.
    """
    # 1. URL-first detection — most reliable signal for UCDA's recent files.
    if fallback_url:
        slug = fallback_url.replace("%20", " ")
        for word, mo_num in MONTH_NAMES.items():
            mw = re.search(rf"\b{re.escape(word)}\s+(20\d{{2}})\b", slug, re.I)
            if mw:
                return f"{int(mw.group(1)):04d}-{mo_num:02d}"

    # 2. Text fallback — only scan the first ~3000 chars (title region) so we
    #    don't pick up comparison-period mentions further down.
    head = (text or "")[:3000]
    m = _MONTH_YEAR_RE.search(head)
    if m:
        mo = MONTH_NAMES.get(m.group("month").lower())
        yr = int(m.group("year"))
        if mo: return f"{yr:04d}-{mo:02d}"
    return None


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


def _parse_v1_recent(text: str, source_url: str | None) -> MonthlyReport | None:
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
    # Dedupe (in case the same grade hits multiple lines, keep first).
    seen_g: set[str] = set()
    rep.by_grade = [g for g in rep.by_grade
                    if not (g["grade"] in seen_g or seen_g.add(g["grade"]))]

    # Destinations — a "country …  N bags" table pattern. Country names from
    # the common UCDA destination set; very permissive on the number column.
    known_countries = (
        "italy", "germany", "sudan", "belgium", "morocco", "spain", "usa",
        "united states", "kenya", "russia", "russian federation", "switzerland",
        "netherlands", "south africa", "uk", "united kingdom", "france",
        "japan", "china", "india", "saudi arabia", "uae", "united arab emirates",
        "egypt", "turkey", "korea", "south korea", "portugal", "greece",
        "ethiopia", "rwanda", "tanzania", "burundi", "south sudan", "djibouti",
        "algeria", "tunisia", "australia", "canada", "mexico", "brazil",
    )
    for line in text.splitlines():
        low = line.lower()
        for c in known_countries:
            # Tolerate rank-prefix without space ("2Germany"). pdfplumber's
            # text extraction sometimes drops the space between the row
            # number and the country name, so a plain \b boundary at the
            # left fails on those rows (digit→letter isn't a word boundary).
            # Use a negative lookbehind on letters instead — matches both
            # "1 Italy" and "2Germany" but not "Burundi" inside another
            # word.
            if re.search(rf"(?<![A-Za-z]){re.escape(c)}\b", low):
                nums = [_to_int(m.group(0)) for m in _NUM_RE.finditer(line)]
                # No Uganda destination has ever shipped > 250k bags in a
                # single month (Italy's monthly peak ≈ 200k). Cap at 250k
                # so a pdfplumber cell-concatenation artifact like the
                # Feb-2024 India=20,242,023 outlier (vs the real 48,303
                # bag total in that report) gets rejected instead of
                # polluting the all-time aggregate.
                nums = [n for n in nums if n is not None and 100 <= n <= 250_000]
                if nums:
                    # Pick the LARGEST plausible value on the row — that's
                    # the Total column (Robusta + Arabica). Picking the
                    # first plausible number was returning the Robusta-only
                    # column for every multi-stream destination (Italy total
                    # 198,746 → was being read as 183,308 Robusta-only;
                    # India total 38,833 → as 35,233; etc.). %share columns
                    # (39.67, 71.44 etc.) are < 100 so already rejected.
                    rep.by_destination.append({"country": c.title(), "bags": max(nums)})
                break
    # Dedupe destinations.
    seen_c: set[str] = set()
    rep.by_destination = [d for d in rep.by_destination
                          if not (d["country"] in seen_c or seen_c.add(d["country"]))]

    # Derive robusta/arabica/total volumes from the grade table — these are
    # MUCH more reliable than regex-matching "Total Robusta" out of the text
    # (which was prone to footnote / sub-total noise). When the grade table
    # is empty (format drift on grades themselves), the report still surfaces
    # the month + warnings so the operator can spot the failure mode.
    rep.robusta_bags = _sum_robusta(rep.by_grade)
    rep.arabica_bags = _sum_arabica(rep.by_grade)
    if rep.robusta_bags is not None or rep.arabica_bags is not None:
        rep.total_bags = (rep.robusta_bags or 0) + (rep.arabica_bags or 0)

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
    text = _extract_text(pdf_bytes)
    if not text:
        return None
    for name, parser in PARSERS:
        try:
            rep = parser(text, source_url)
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
              f"grades={len(rep.by_grade)} dests={len(rep.by_destination)}")
        if diag:
            _dump_diagnostics(url, text, rep)

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
