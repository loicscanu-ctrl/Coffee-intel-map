"""
ecf_stocks.py — European Coffee Federation port-stocks scraper.

ECF publishes bi-monthly stock reports under
  https://www.ecf-coffee.org/category/publications/stocks/
as individual WordPress posts named e.g.
  /stocks-in-european-ports-january-february-2026/
Each post embeds an infographic + PDF with the headline figure.

Strategy:
  1. GET the stocks-category index, find every "stocks-in-european-ports-*" post URL.
  2. For each post (latest N), fetch its HTML and extract:
       a) any linked PDF URL
       b) inline "X.X million bags" / "X,XXX,XXX bags" / "X million 60-kg bags" phrases
  3. Build a monthly series keyed by the period encoded in the post slug
     ("january-february-2026" → 2026-02 etc.) and emit a NewsItem with the
     same schema export_stocks.py already reads (source="ECF").
"""
from __future__ import annotations

import io
import json
import re
from datetime import date
from urllib.parse import urljoin

import requests

_HEADERS = {
    # Real Chrome UA — ECF's WAF returns 403 for anything that looks like a bot.
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

_INDEX_URL = "https://www.ecf-coffee.org/category/publications/stocks/"
_INDEX_URLS = [
    "https://www.ecf-coffee.org/category/whats-new/news/",
    "https://www.ecf-coffee.org/category/news/",
    "https://www.ecf-coffee.org/category/whats-new/news/page/2/",
    _INDEX_URL,
]
# Posts have slugs starting with "stocks-in-european-ports-".
_POST_HREF = re.compile(
    r'href="(https?://(?:www\.)?ecf-coffee\.org/(stocks-in-european-ports-[^/"]+)/?)"',
    re.I,
)
# PDFs hosted under wp-content/uploads.
_PDF_HREF = re.compile(
    r'href="(https?://[^"]*?(?:wp-content/uploads|ecf-coffee\.org)[^"]*?\.pdf)"',
    re.I,
)

_MONTH_NUM = {
    "january":1, "february":2, "march":3, "april":4, "may":5, "june":6,
    "july":7, "august":8, "september":9, "october":10, "november":11, "december":12,
}

# Posts list multiple months inline, e.g.:
#   "Total stocks decreased from 458,801 tons in December 2025
#    to 441,323 tons in January 2026, and further to 408,152 tons
#    in February 2026"
# So we extract every "(value) tons in (Month) (Year)" match and build
# a monthly series, then fall back to the single-figure patterns for older
# posts that used "X million bags".
_TONS_MONTH_PAT = re.compile(
    r"([\d,]{4,12})\s*(?:tons?|tonnes?|metric\s+tons?|MT)\s*"
    r"in\s+("
    r"january|february|march|april|may|june|"
    r"july|august|september|october|november|december"
    r")\s+(20\d{2})",
    re.I,
)

_FIGURE_PATTERNS = [
    # "stocks ... at 9.8 million bags"
    re.compile(
        r"stocks?[^.]{0,120}?at\s+([\d.,]+)\s*million\s+(?:60[- ]kg\s+)?bags",
        re.I | re.S,
    ),
    # "Total stocks: 9,234,567 bags"
    re.compile(
        r"(?:total|european|stocks?)[^.]{0,60}?stocks?[^\d]{0,60}?([\d,]{6,12})\s*bags",
        re.I | re.S,
    ),
    # "Stocks decreased to 8.9 million bags"
    re.compile(
        r"stocks?\s+(?:rose|fell|decreased|increased|reached|stand(?:ing|s)?\s+at)[^.]{0,80}?"
        r"([\d.,]+)\s*million\s+bags",
        re.I | re.S,
    ),
]


def _tons_to_bags(tons: int) -> int:
    """ECF stocks reports in metric tonnes. Convert to 60-kg bags."""
    return int(round(tons * 1000 / 60))


def _entries_from_tons_text(text: str) -> list[dict]:
    """Pick every '(N,XXX) tons in MONTH YYYY' match and emit one entry each."""
    months = {n: i + 1 for i, n in enumerate([
        "january","february","march","april","may","june",
        "july","august","september","october","november","december",
    ])}
    out: list[dict] = []
    for m in _TONS_MONTH_PAT.finditer(text):
        try:
            tons = int(m.group(1).replace(",", ""))
        except ValueError:
            continue
        if not (100_000 < tons < 2_000_000):  # 100k-2M MT plausible band
            continue
        mo  = months[m.group(2).lower()]
        yr  = int(m.group(3))
        out.append({
            "period":    f"{yr}-{mo:02d}",
            "value_raw": _tons_to_bags(tons),
            "value_mt":  tons,
        })
    # Dedupe by period, keep first occurrence (the text usually lists them
    # in chronological order so first = most authoritative for that month).
    seen: dict[str, dict] = {}
    for e in out:
        seen.setdefault(e["period"], e)
    return list(seen.values())


def _today() -> str:
    return date.today().isoformat()


def _period_from_slug(slug: str) -> tuple[str, int, int] | None:
    """'stocks-in-european-ports-january-february-2026' → ('2026-02', 2026, 2).

    Uses the *second* month if the slug carries a range — that's the data-as-of
    month ECF reports against. Single-month slugs are also supported.
    """
    m = re.search(
        rf"-({'|'.join(_MONTH_NUM)})(?:-({'|'.join(_MONTH_NUM)}))?-(\d{{4}})$",
        slug.lower(),
    )
    if not m:
        return None
    second = m.group(2) or m.group(1)
    year = int(m.group(3))
    month_num = _MONTH_NUM[second]
    return f"{year}-{month_num:02d}", year, month_num


def _figure_from_text(text: str) -> int | None:
    """Convert the best-matched headline figure to integer bags."""
    for pat in _FIGURE_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        raw = m.group(1)
        if "million" in pat.pattern.lower():
            try:
                return int(float(raw.replace(",", ".")) * 1_000_000)
            except ValueError:
                continue
        try:
            val = int(raw.replace(",", ""))
        except ValueError:
            continue
        if val < 1_000_000:  # likely "9,234" meaning thousands of bags
            val *= 1000
        if 1_000_000 <= val <= 30_000_000:
            return val
    return None


# ── PDF type-breakdown parser ─────────────────────────────────────────────────
# ECF yearly PDFs (e.g. "2026-Stocks-European-Ports.pdf") include per-type
# monthly series (Arabica Washed/Unwashed, Robusta) on pages 5-12.

_PDF_YEAR_PAT = re.compile(r"(\d{4})-Stocks-European-Ports", re.I)

# Which pdfplumber cell text maps to which DB field
_TYPE_FIELD_MAP: dict[str, str] = {
    "washed":     "arabica_washed_mt",
    "mild":       "arabica_washed_mt",
    "unwashed":   "arabica_unwashed_mt",
    "brazilian":  "arabica_unwashed_mt",
    "natural":    "arabica_unwashed_mt",
    "robusta":    "robusta_mt",
    "other":      "other_mt",
}

_PDF_MONTHS_EN = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    **{m: i + 1 for i, m in enumerate([
        "january","february","march","april","may","june",
        "july","august","september","october","november","december",
    ])},
}

# Numeric value plausibility: 20k-800k MT per type per month
_MT_MIN, _MT_MAX = 20_000, 800_000
# ECF often reports in "thousands of tonnes" (20-800) rather than absolute
_MT_K_MIN, _MT_K_MAX = 20, 800


def _cell_to_mt(cell: str | None) -> int | None:
    if not cell:
        return None
    s = re.sub(r"[^\d]", "", str(cell).strip())
    if not s:
        return None
    n = int(s)
    if _MT_MIN <= n <= _MT_MAX:
        return n
    if _MT_K_MIN <= n <= _MT_K_MAX:
        return n * 1_000
    return None


def _type_field(text: str) -> str | None:
    t = text.strip().lower()
    for key, field in _TYPE_FIELD_MAP.items():
        if key in t:
            return field
    return None


def _parse_table_for_breakdown(table: list, default_year: int) -> dict[str, dict]:
    """
    Try two layouts:
      A) First row = month headers, first col = type label
      B) First col = month/year label, remaining cols = types
    Returns {period → {field → mt_value}}.
    """
    result: dict[str, dict] = {}
    if not table or len(table) < 2:
        return result

    def _hdr(cell: object) -> str:
        return str(cell or "").strip().lower()

    header = [_hdr(c) for c in table[0]]

    # ── Layout A: month columns, type rows ──────────────────────────────────
    month_cols: dict[int, int] = {}
    for ci, h in enumerate(header):
        for abbr, mo in _PDF_MONTHS_EN.items():
            if h == abbr or h.startswith(abbr + " ") or h.startswith(abbr + "-"):
                month_cols[ci] = mo
                break
    if month_cols:
        # Infer year from a column header that contains 4-digit year, else default
        year_in_header = default_year
        for h in header:
            m = re.search(r"(20\d{2})", h)
            if m:
                year_in_header = int(m.group(1))
                break
        for row in table[1:]:
            label = _hdr(row[0]) if row else ""
            field = _type_field(label)
            if not field:
                continue
            for ci, mo in month_cols.items():
                if ci < len(row):
                    val = _cell_to_mt(str(row[ci] or ""))
                    if val:
                        period = f"{year_in_header}-{mo:02d}"
                        result.setdefault(period, {})[field] = val
        if result:
            return result

    # ── Layout B: month/year rows, type columns ──────────────────────────────
    type_cols: dict[int, str] = {}
    for ci, h in enumerate(header):
        field = _type_field(h)
        if field:
            type_cols[ci] = field
    if type_cols:
        for row in table[1:]:
            label = _hdr(row[0]) if row else ""
            mo = None
            yr = default_year
            for abbr, m_num in _PDF_MONTHS_EN.items():
                if abbr in label:
                    mo = m_num
                    break
            year_m = re.search(r"(20\d{2})", label)
            if year_m:
                yr = int(year_m.group(1))
            if mo is None:
                continue
            period = f"{yr}-{mo:02d}"
            for ci, field in type_cols.items():
                if ci < len(row):
                    val = _cell_to_mt(str(row[ci] or ""))
                    if val:
                        result.setdefault(period, {})[field] = val

    return result


def _parse_text_for_breakdown(text: str, default_year: int) -> dict[str, dict]:
    """
    Fallback text parser: detects type section headers, then reads
    'Month [YYYY] value' patterns within each section.
    """
    result: dict[str, dict] = {}
    current_field: str | None = None
    current_year: int = default_year

    for line in text.split("\n"):
        ll = line.strip()
        if not ll:
            continue

        # Section header detection (short line mentioning a type keyword)
        if len(ll) < 80:
            field = _type_field(ll)
            if field:
                current_field = field
                # Reset year to default when entering new section
                current_year = default_year

        if current_field is None:
            continue

        # Year override in line
        ym = re.search(r"(20\d{2})", ll)
        if ym:
            current_year = int(ym.group(1))

        # Month + value on same line
        ll_lower = ll.lower()
        for abbr, mo in _PDF_MONTHS_EN.items():
            if abbr in ll_lower:
                nums = re.findall(r"[\d,]{4,}", ll)
                for n in nums:
                    val = _cell_to_mt(n)
                    if val:
                        period = f"{current_year}-{mo:02d}"
                        result.setdefault(period, {})[current_field] = val
                        break
                break

    return result


def _fetch_bytes(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30)
        if r.status_code == 200:
            return r.content
    except Exception:
        pass
    return None


def _parse_pdf_type_breakdown(pdf_url: str) -> dict[str, dict]:
    """
    Download ECF PDF and extract per-type monthly breakdown from pages 5-12.
    Returns {period → {arabica_washed_mt, arabica_unwashed_mt, robusta_mt, …}}.
    """
    try:
        import pdfplumber
    except ImportError:
        print("[ecf_stocks] pdfplumber not installed — skipping type breakdown")
        return {}

    # Infer year from PDF URL
    ym = _PDF_YEAR_PAT.search(pdf_url)
    default_year = int(ym.group(1)) if ym else date.today().year

    pdf_bytes = _fetch_bytes(pdf_url)
    if not pdf_bytes:
        print(f"[ecf_stocks] PDF download failed: {pdf_url}")
        return {}

    result: dict[str, dict] = {}
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = pdf.pages[4:min(13, len(pdf.pages))]  # pages 5-13 (1-indexed)
            for page in pages:
                # Table extraction first
                for table in (page.extract_tables() or []):
                    parsed = _parse_table_for_breakdown(table, default_year)
                    for period, bd in parsed.items():
                        result.setdefault(period, {}).update(bd)

                # Text fallback for pages that mention type keywords
                text = page.extract_text() or ""
                if any(k in text.lower() for k in ["washed", "unwashed", "robusta", "mild", "natural"]):
                    parsed = _parse_text_for_breakdown(text, default_year)
                    for period, bd in parsed.items():
                        # Only add fields not already found via table
                        for field, val in bd.items():
                            result.setdefault(period, {}).setdefault(field, val)
    except Exception as e:
        print(f"[ecf_stocks] PDF parse error: {e}")

    if result:
        print(f"[ecf_stocks] type breakdown: {len(result)} periods — {sorted(result)}")
    else:
        print("[ecf_stocks] type breakdown: nothing found in PDF pages 5-13")
    return result


def _strip_html(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


def _fetch(url: str) -> str | None:
    try:
        r = requests.get(url, headers=_HEADERS, timeout=25, allow_redirects=True)
        if r.status_code != 200:
            return None
        return r.text
    except Exception:
        return None


def _collect_posts(index_html: str) -> list[str]:
    seen: list[str] = []
    for m in _POST_HREF.finditer(index_html):
        url = m.group(1)
        if url not in seen:
            seen.append(url)
    return seen


def _post_pdf(html: str, base: str) -> str | None:
    m = _PDF_HREF.search(html)
    return urljoin(base, m.group(1)) if m else None


def _post_to_entries(url: str) -> list[dict]:
    """Return one or more {period, value_raw, ...} entries for a stocks post.

    Modern ECF posts list multiple months inline (Dec→Jan→Feb), so a single
    post can yield 2-3 monthly entries. Old posts only carry the headline
    bags-figure; we fall back to that.
    """
    html = _fetch(url)
    if not html:
        return []
    text = _strip_html(html)
    pdf = _post_pdf(html, url)

    # First try: extract every "(N) tons in MONTH YYYY" match
    entries = _entries_from_tons_text(text)
    if entries:
        for e in entries:
            e["post_url"] = url
            if pdf:
                e["pdf_url"] = pdf
        return entries

    # Fallback: single-figure "X million bags" patterns + period from slug
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    period_info = _period_from_slug(slug)
    bags = _figure_from_text(text)
    if not period_info and not bags:
        return []
    period_label = period_info[0] if period_info else _today()[:7]
    entry = {
        "period":     period_label,
        "post_url":   url,
    }
    if bags is not None:
        entry["value_raw"] = bags
    if pdf:
        entry["pdf_url"] = pdf
    return [entry]



async def run(page) -> list[dict]:
    post_urls: list[str] = []
    pages_seen = 0
    for idx_url in _INDEX_URLS:
        html = _fetch(idx_url)
        if not html:
            continue
        pages_seen += 1
        for m in _POST_HREF.finditer(html):
            url = m.group(1)
            if url not in post_urls:
                post_urls.append(url)

    if pages_seen == 0:
        print("[ecf_stocks] all index pages unreachable")
        return []
    if not post_urls:
        print("[ecf_stocks] no stocks posts found")
        return []
    print(f"[ecf_stocks] index pages: {pages_seen}, posts: {len(post_urls)}")

    entries: list[dict] = []
    for url in post_urls[:12]:
        entries.extend(_post_to_entries(url))

    if not entries:
        print("[ecf_stocks] no parseable entries from posts")
        return []

    by_period: dict[str, dict] = {}
    for e in entries:
        prev = by_period.get(e["period"])
        if not prev or (e.get("value_raw") and not prev.get("value_raw")):
            by_period[e["period"]] = e

    series = sorted(by_period.values(), key=lambda x: x["period"])
    latest = next((e for e in reversed(series) if e.get("value_raw")), series[-1])

    # Fetch latest PDF and merge per-type breakdown into series entries
    latest_pdf = latest.get("pdf_url")
    if latest_pdf:
        breakdown_by_period = _parse_pdf_type_breakdown(latest_pdf)
        for entry in series:
            bd = breakdown_by_period.get(entry["period"])
            if bd:
                entry.update(bd)

    value_bags = latest.get("value_raw") or 0
    return [{
        "title":    f"ECF European Port Stocks – {latest['period']}",
        "body":     (
            f"ECF European green coffee stocks for {latest['period']}: "
            f"{value_bags:,} bags ({value_bags / 1_000_000:.1f}M). "
            f"Source: {latest.get('post_url', _INDEX_URL)}"
        ),
        "source":   "ECF",
        "category": "demand",
        "lat":      51.5,
        "lng":      5.0,
        "tags":     ["stocks", "europe", "ecf", "demand"],
        "meta":     json.dumps({
            "monthly":     series,
            "latest_bags": value_bags or None,
            "as_of":       _today(),
            "source_url":  _INDEX_URL,
            "latest_post": latest.get("post_url"),
            "latest_pdf":  latest.get("pdf_url"),
        }),
    }]
