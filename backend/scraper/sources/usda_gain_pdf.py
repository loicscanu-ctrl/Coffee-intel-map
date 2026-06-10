"""usda_gain_pdf.py — pull USDA FAS GAIN Coffee Annual PSD tables.

The PSD downloadable CSV the `psd_coffee` source uses doesn't carry forward-
year forecasts for coffee — USDA only publishes those in the GAIN PDF
narrative reports (e.g. `BR2026-0025: Brazil Coffee Annual`, June 1 2026).
This source plugs that gap: discovers the latest GAIN Coffee Annual report
per origin, downloads the PDF, extracts the PSD table at the back, and
emits {producer: {annual: […]}} rows shaped exactly like `psd_coffee` does
so the export_stocks merger drops them in transparently.

Discovery:
  GET https://www.fas.usda.gov/data/<slug>-coffee-annual  (HTML landing page)
  → extract the newgainapi PDF link via regex.

Parsing:
  pdfplumber → text → regex matchers for "Market Year Begin: <Mon YYYY>"
  headers + named PSD rows (Production, Bean Exports, …). Values are in
  USDA's native thousand-60-kg-bags unit; converted to MT by × 60 to match
  the psd_coffee output shape (`exports_mt` etc.).

Idempotent. Re-running on the same PDF produces identical output.
Caches at backend/scraper/cache/usda_gain_<slug>.json so consumers
(export_stocks.py) can read without re-fetching when only the merge step
re-runs.

Usage:
    cd backend
    python -m scraper.sources.usda_gain_pdf brazil    # one-off probe
"""
from __future__ import annotations

import io
import json
import logging
import re
import sys
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_DIR = Path(__file__).resolve().parents[1] / "cache"

_FAS_BASE  = "https://www.fas.usda.gov"
_LANDING_FMT = _FAS_BASE + "/data/{slug}-coffee-annual"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# Producers we know how to fetch. Slug matches FAS's URL pattern
# (`/data/<slug>-coffee-annual`). Add new entries as new origins
# are wired into demand_stocks.
PRODUCER_SLUGS = {
    "brazil":    "brazil",
    "vietnam":   "vietnam",
    "colombia":  "colombia",
    "indonesia": "indonesia",
    "honduras":  "honduras",
    "ethiopia":  "ethiopia",
    "uganda":    "uganda",
}

# PSD CSV uses MT where 1 MT = 1000 60-kg-bags ÷ 60 (per psd_coffee._to_mt).
# GAIN PDFs publish in raw "1000 60-kg bags" units, so the multiplier is 60.
_MT_PER_K_BAGS = 60

# USDA PSD attribute → our short field name. Match by prefix because USDA's
# wording drifts ("Bean Imports" vs "Beans Imports", etc.).
_PSD_ATTRS = {
    "Production":             "production_mt",
    "Bean Imports":           "imports_mt",
    "Beans Imports":          "imports_mt",
    "Bean Exports":           "exports_mt",
    "Beans Exports":          "exports_mt",
    "Domestic Consumption":   "consumption_mt",
    "Ending Stocks":          "stocks_mt",
    "Beginning Stocks":       "begin_stocks_mt",
    "Roast & Ground Exports": "roast_exports_mt",
    "Soluble Exports":        "soluble_exports_mt",
}

CALL_TIMEOUT = 60
REQUEST_RETRIES = 2


# ── parser (no network — unit-testable) ──────────────────────────────────────

_NUM_RE  = re.compile(r"-?\d[\d,]*")
# "Market Year Begin: Jul 2024" / "MY 2024/25" / etc. — USDA isn't consistent.
_MY_BEGIN_RE = re.compile(r"Market Year Begin[:\s]*([A-Z][a-z]{2})\s+(\d{4})", re.I)
_MY_SLASH_RE = re.compile(r"\b(20\d{2})\s*/\s*(\d{2}|20\d{2})\b")


def _to_int(s: str) -> int | None:
    try:
        return int(s.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _market_year_label(begin_year: int) -> str:
    """USDA marketing year by USDA's own ending-year convention: a MY that
    *begins* in Jul 2024 ends in Jun 2025 → labelled "2025". Our consumer
    (psd_coffee output, downstream demand_stocks.json) uses that single-year
    label, so emit it identically."""
    return str(begin_year + 1)


def parse_psd_text(text: str) -> dict[str, dict[str, int]]:
    """Parse a USDA GAIN PSD-table text block → {year_label: {attr: mt}}.

    `year_label` is USDA's marketing-year-ending year (e.g. "2027" for the
    MY that begins Jul 2026). Values are in metric tons (MT), to match the
    psd_coffee output shape that export_stocks merges into.

    The parser is intentionally permissive — it scans every line for known
    attribute prefixes and pulls the numeric columns. Header lines provide
    the year ordering; if header detection fails the function returns {}.
    """
    lines = [line.rstrip() for line in text.splitlines()]

    # 1. Find the year columns by scanning for "Market Year Begin: Mon YYYY"
    #    occurrences. Each match is one year column (Old USDA + New Post sub-
    #    columns share the same year, so we count distinct begin_year values).
    year_begins: list[int] = []
    seen = set()
    for line in lines:
        for m in _MY_BEGIN_RE.finditer(line):
            yr = int(m.group(2))
            if yr in seen:
                continue
            seen.add(yr)
            year_begins.append(yr)
    if not year_begins:
        return {}

    # USDA Coffee Annual reports carry "Old USDA Official" + "New Post" sub-
    # columns per year. Default to 2 per year; the parser tolerates 1 or 2.
    sub_cols = 2
    expected_numbers_per_row = len(year_begins) * sub_cols

    # 2. For each known attribute prefix, pull the value row.
    out: dict[str, dict[str, int]] = {}
    for line in lines:
        stripped = line.strip()
        # Match by longest prefix first so "Bean Exports" doesn't lose to
        # a stray "Bean" elsewhere.
        attr_key: str | None = None
        for prefix in sorted(_PSD_ATTRS.keys(), key=len, reverse=True):
            if stripped.startswith(prefix):
                attr_key = _PSD_ATTRS[prefix]
                break
        if not attr_key:
            continue
        nums = [_to_int(m.group(0)) for m in _NUM_RE.finditer(stripped)]
        nums = [n for n in nums if n is not None]
        # Many real-world reports include line-trailing footnote markers
        # ('(1)'/'(2)') that get captured as 1 / 2. Discard tiny trailing
        # numbers that are clearly out of range vs the rest of the row.
        if not nums:
            continue
        if expected_numbers_per_row and len(nums) > expected_numbers_per_row:
            # Trim trailing footnote-style numbers (≤ 2) off the end if the
            # row has too many cells.
            while len(nums) > expected_numbers_per_row and nums[-1] <= 2:
                nums.pop()
        # If row is shorter than expected, pad on the left with None so the
        # rightmost-by-year alignment still holds (the row gives us only
        # later-year values in some formats).
        pad = max(0, expected_numbers_per_row - len(nums))
        nums = [None] * pad + nums

        # 3. For each year column, pick its "New Post" value (the rightmost
        #    of the sub_cols positions). If New Post is 0 AND the prior
        #    sub-col is non-zero, fall back to that (USDA leaves the "New"
        #    column blank/zero when no revision has been made).
        for i, begin_year in enumerate(year_begins):
            start = i * sub_cols
            cells = nums[start:start + sub_cols]
            # Take the rightmost non-None, non-zero value as the post value.
            value = None
            for cell in reversed(cells):
                if cell is not None and cell != 0:
                    value = cell
                    break
            if value is None:
                # All zero or missing — keep the rightmost provided value
                # (could legitimately be 0, e.g. "Roast & Ground Exports").
                for cell in reversed(cells):
                    if cell is not None:
                        value = cell
                        break
            if value is None:
                continue
            label = _market_year_label(begin_year)
            out.setdefault(label, {})[attr_key] = value * _MT_PER_K_BAGS

    return out


def _total_exports_mt(row: dict[str, int]) -> int | None:
    """Sum bean + soluble + roast streams into a Cecafé-comparable total.

    USDA's PSD breaks exports into three rows (Bean / Soluble / Roast &
    Ground), and the CSV-side psd_coffee scraper only captures "Bean
    Exports" (green-only) under `exports_mt`. Brazil's GAIN PDF June 2026
    forecast is 45M green + 4M soluble + 0.07M roast = 49.07M total — and
    49.07M is the number that matches Cecafé's series[].total downstream.
    So this parser sums all three streams into `exports_mt`, keeping the
    individual streams as separate fields for traceability."""
    if row.get("exports_mt") is None:
        return None
    total = row.get("exports_mt", 0)
    total += row.get("soluble_exports_mt", 0) or 0
    total += row.get("roast_exports_mt", 0) or 0
    return total


def to_psd_coffee_shape(parsed: dict[str, dict[str, int]],
                       country: str) -> dict | None:
    """Reshape `parse_psd_text` output into the {annual: [...], latest_*}
    shape that `psd_coffee.py` produces — so export_stocks._psd_producers()
    can consume it without changes."""
    if not parsed:
        return None
    # Compute the green+soluble+roast total per year and overwrite
    # exports_mt so downstream consumers see the Cecafé-comparable figure.
    rows: list[dict] = []
    for yr, fields in sorted(parsed.items()):
        row = {"year": yr, **fields}
        total = _total_exports_mt(row)
        if total is not None:
            row["bean_exports_mt"] = row.get("exports_mt")     # preserve green-only
            row["exports_mt"]      = total                      # promote total to summary
        rows.append(row)
    latest = rows[-1]
    return {
        "source":                 f"USDA FAS GAIN ({country})",
        "last_updated":           datetime.utcnow().date().isoformat(),
        "annual":                 rows,
        "latest_year":            latest["year"],
        "latest_production_mt":   latest.get("production_mt"),
        "latest_exports_mt":      latest.get("exports_mt"),
        "latest_consumption_mt":  latest.get("consumption_mt"),
        "latest_stocks_mt":       latest.get("stocks_mt"),
        "latest_begin_stocks_mt": latest.get("begin_stocks_mt"),
    }


# ── discovery + fetch ────────────────────────────────────────────────────────

_PDF_LINK_RE = re.compile(
    r'https?://apps\.fas\.usda\.gov/newgainapi/api/Report/DownloadReportByFileName\?fileName=[^"\s<>]+\.pdf',
    re.I,
)


def discover_latest_pdf_url(slug: str) -> str | None:
    """Scrape the FAS landing page for the country's latest Coffee Annual PDF.
    Returns the full apps.fas.usda.gov URL, or None on any failure (caller
    falls back to cache or skips merge)."""
    url = _LANDING_FMT.format(slug=slug)
    try:
        r = requests.get(url, headers=_HEADERS, timeout=CALL_TIMEOUT)
        r.raise_for_status()
    except Exception as e:                 # noqa: BLE001
        logger.warning(f"[usda_gain] {slug} landing fetch failed: {e}")
        return None
    matches = _PDF_LINK_RE.findall(r.text)
    if not matches:
        logger.warning(f"[usda_gain] {slug} landing page yielded no PDF link")
        return None
    # FAS pages typically embed a single "Full report" PDF; if multiple, take
    # the first (matches the page's hero link).
    return matches[0]


def fetch_pdf_text(pdf_url: str) -> str | None:
    """Download a GAIN PDF and return its full text content. Uses pdfplumber
    for layout-aware extraction so the PSD table comes out roughly line-
    aligned with how `parse_psd_text` expects it."""
    last_err: Exception | None = None
    for attempt in range(REQUEST_RETRIES + 1):
        try:
            r = requests.get(pdf_url, headers=_HEADERS, timeout=CALL_TIMEOUT)
            r.raise_for_status()
            break
        except Exception as e:              # noqa: BLE001
            last_err = e
            if attempt < REQUEST_RETRIES:
                continue
            logger.warning(f"[usda_gain] PDF download failed: {e}")
            return None
    try:
        import pdfplumber  # local import: heavy
    except ImportError:
        logger.warning("[usda_gain] pdfplumber not installed — skipping")
        return None
    try:
        with pdfplumber.open(io.BytesIO(r.content)) as pdf:
            parts = [page.extract_text() or "" for page in pdf.pages]
        return "\n".join(parts)
    except Exception as e:                  # noqa: BLE001
        logger.warning(f"[usda_gain] PDF parse failed: {e}")
        return None
    _ = last_err  # silence unused-warning


def fetch_country_forecast(short: str) -> dict | None:
    """Top-level orchestrator: discover → fetch → parse → shape.

    Live path (preferred): FAS landing page → newgainapi PDF link → pdfplumber.
    Seed fallback: when the live path returns None for any reason (FAS
    Cloudflare-blocks GitHub Actions IPs with 403 today), read a hand-
    maintained file at `backend/seed/usda_gain/<short>.json` shaped exactly
    like the live output. Lets us ship USDA-published forecasts even while
    the live scrape is blocked. The seed wins the moment it exists, so the
    operator can use it as a manual override too — same pattern as the
    brazil_export_target.json seed."""
    slug = PRODUCER_SLUGS.get(short)
    if not slug:
        logger.info(f"[usda_gain] no slug registered for {short}")
        return None

    pdf_url = discover_latest_pdf_url(slug)
    if pdf_url:
        text = fetch_pdf_text(pdf_url)
        if text:
            parsed = parse_psd_text(text)
            shaped = to_psd_coffee_shape(parsed, short)
            if shaped:
                shaped["source_pdf"] = pdf_url
                return shaped

    # Live path produced nothing — try the seed.
    seed = _load_seed(short)
    if seed:
        print(f"[usda_gain] {short}: using seed fallback (live FAS fetch unavailable)")
        return seed
    return None


def _load_seed(short: str) -> dict | None:
    """Return the committed seed override for a country, or None."""
    seed_path = (Path(__file__).resolve().parents[2]
                 / "seed" / "usda_gain" / f"{short}.json")
    if not seed_path.exists():
        return None
    try:
        return json.loads(seed_path.read_text(encoding="utf-8"))
    except Exception:                       # noqa: BLE001
        return None


# ── cache + DB integration ──────────────────────────────────────────────────

def _cache_path(short: str) -> Path:
    return _CACHE_DIR / f"usda_gain_{short}.json"


def load_cached(short: str) -> dict | None:
    p = _cache_path(short)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:                       # noqa: BLE001
        return None


def write_cache(short: str, payload: dict) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(short).write_text(json.dumps(payload, indent=2), encoding="utf-8")


async def run(page, db) -> None:                  # noqa: ARG001
    """Monthly-scraper entrypoint. Loops every registered producer slug,
    fetches the latest GAIN PSD table, writes the cache + DB row. Failures
    on a single country don't block the rest."""
    for short in PRODUCER_SLUGS:
        try:
            data = fetch_country_forecast(short)
        except Exception as e:                # noqa: BLE001
            print(f"[usda_gain] {short}: FAILED {e}")
            continue
        if not data:
            print(f"[usda_gain] {short}: no PDF data — retaining cache")
            continue
        write_cache(short, data)
        latest = data.get("latest_year", "?")
        exp = data.get("latest_exports_mt", "?")
        prod = data.get("latest_production_mt", "?")
        print(f"[usda_gain] {short}: MY {latest} prod={prod} MT "
              f"exports={exp} MT (source={data.get('source_pdf','?').split('=')[-1]})")
        if db is not None:
            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"USDA GAIN {short} – MY {latest}",
                "body":     f"PSD forecast from GAIN PDF: exports={exp} MT, prod={prod} MT",
                "source":   f"USDA GAIN {short}",
                "category": "supply",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["psd", "gain", "usda", short],
                "meta":     json.dumps(data),
            })


if __name__ == "__main__":
    # CLI for one-off probes: `python -m scraper.sources.usda_gain_pdf brazil`
    short = sys.argv[1] if len(sys.argv) > 1 else "brazil"
    out = fetch_country_forecast(short)
    if out:
        print(json.dumps(out, indent=2))
    else:
        print(f"[usda_gain] {short}: no data")
        sys.exit(1)
