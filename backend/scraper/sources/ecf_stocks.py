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

import pdfplumber
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
# Post URLs (stocks-in-european-ports-…) live on news pages, NOT the stocks-
# category page (which only lists yearly PDFs). Scan both for resilience.
_INDEX_URLS = [
    "https://www.ecf-coffee.org/category/whats-new/news/",
    "https://www.ecf-coffee.org/category/news/",
    "https://www.ecf-coffee.org/category/whats-new/news/page/2/",
    _INDEX_URL,  # also scan stocks index in case ECF restructures
]
# Yearly PDFs are listed only on the stocks-category page.
_YEARLY_PDF_PAT = re.compile(
    r'href="(https?://[^"]*?/wp-content/uploads/[^"]*?(\d{4})-Stocks-European-Ports[^"]*?\.pdf)"',
    re.I,
)
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


def _parse_yearly_pdf(pdf_url: str, year: str) -> list[dict]:
    """Download an ECF yearly PDF and extract monthly stock entries.

    ECF yearly reports (YYYY-Stocks-European-Ports.pdf) contain the same
    monthly tonnage data as the bi-monthly web posts, but covering the full
    calendar year. Returns a list of {period, value_raw, value_mt, pdf_url}
    entries (one per month found). Falls back to a single December entry if
    only a headline bags figure is extractable.
    """
    try:
        r = requests.get(pdf_url, headers=_HEADERS, timeout=60)
        if r.status_code != 200:
            return []
        raw = r.content
    except Exception as e:
        print(f"[ecf_stocks] yearly PDF download failed ({year}): {e}")
        return []

    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            # First 5 pages contain all headline figures in ECF yearly reports.
            text = " ".join(page.extract_text() or "" for page in pdf.pages[:5])
    except Exception as e:
        print(f"[ecf_stocks] yearly PDF parse failed ({year}): {e}")
        return []

    entries = _entries_from_tons_text(text)
    if entries:
        for e in entries:
            e["pdf_url"] = pdf_url
            e["from_yearly_pdf"] = True
        return entries

    bags = _figure_from_text(text)
    if bags:
        return [{
            "period":          f"{year}-12",
            "value_raw":       bags,
            "pdf_url":         pdf_url,
            "from_yearly_pdf": True,
        }]

    return []


async def run(page) -> list[dict]:
    # Collect post URLs across multiple ECF index pages.
    post_urls: list[str] = []
    yearly_pdfs: list[dict] = []
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
        # Yearly PDFs only appear on the stocks-category page.
        for m in _YEARLY_PDF_PAT.finditer(html):
            entry = {"year": m.group(2), "pdf_url": m.group(1)}
            if entry not in yearly_pdfs:
                yearly_pdfs.append(entry)

    if pages_seen == 0:
        print("[ecf_stocks] all index pages unreachable")
        return []
    if not post_urls and not yearly_pdfs:
        print("[ecf_stocks] no stocks posts or yearly PDFs found")
        return []
    print(f"[ecf_stocks] index pages: {pages_seen}, posts: {len(post_urls)}, yearly_pdfs: {len(yearly_pdfs)}")

    # Latest 12 posts ~= last 2 years of bi-monthly reports — plenty.
    # Each post can produce multiple monthly entries.
    entries: list[dict] = []
    for url in post_urls[:12]:
        entries.extend(_post_to_entries(url))

    if not entries and not yearly_pdfs:
        print("[ecf_stocks] no parseable entries from posts and no yearly PDFs")
        return []

    # Post entries take priority. Build by_period from posts first.
    by_period: dict[str, dict] = {}
    for e in entries:
        prev = by_period.get(e["period"])
        if not prev or (e.get("value_raw") and not prev.get("value_raw")):
            by_period[e["period"]] = e

    # Parse historical yearly PDFs and fill in gaps not covered by posts.
    yearly_pdf_count = 0
    if yearly_pdfs:
        sorted_pdfs = sorted(yearly_pdfs, key=lambda y: y["year"])
        for pdf_info in sorted_pdfs:
            pdf_entries = _parse_yearly_pdf(pdf_info["pdf_url"], pdf_info["year"])
            added = 0
            for e in pdf_entries:
                p = e.get("period", "")
                if p and p not in by_period:
                    by_period[p] = e
                    added += 1
            yearly_pdf_count += added
            print(f"[ecf_stocks] yearly PDF {pdf_info['year']}: {len(pdf_entries)} extracted, {added} new periods")

    series = sorted(by_period.values(), key=lambda x: x["period"])
    latest = next((e for e in reversed(series) if e.get("value_raw")), series[-1])

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
            "monthly":            series,
            "latest_bags":        value_bags or None,
            "as_of":              _today(),
            "source_url":         _INDEX_URL,
            "latest_post":        latest.get("post_url"),
            "latest_pdf":         latest.get("pdf_url"),
            "yearly_pdfs":        yearly_pdfs,
            "historical_periods": yearly_pdf_count,
        }),
    }]
