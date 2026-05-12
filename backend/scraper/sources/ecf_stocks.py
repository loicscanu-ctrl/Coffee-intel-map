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

import json
import re
from datetime import date
from urllib.parse import urljoin

import requests

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)",
    "Accept-Language": "en-US,en;q=0.9",
}

_INDEX_URL = "https://www.ecf-coffee.org/category/publications/stocks/"
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

# Headline-figure patterns ECF has used in posts + PDFs.
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


def _post_to_entry(url: str) -> dict | None:
    html = _fetch(url)
    if not html:
        return None
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    period_info = _period_from_slug(slug)
    text = _strip_html(html)
    bags = _figure_from_text(text)
    pdf = _post_pdf(html, url)
    if not period_info and not bags:
        return None
    period_label = period_info[0] if period_info else _today()[:7]
    entry = {
        "period":     period_label,
        "value_raw":  bags,
        "post_url":   url,
        "pdf_url":    pdf,
    }
    # Drop None to keep the cache slim, but keep period_label.
    return {k: v for k, v in entry.items() if v is not None or k == "period"}


async def run(page) -> list[dict]:
    index_html = _fetch(_INDEX_URL)
    if not index_html:
        print("[ecf_stocks] index page unreachable")
        return []

    post_urls = _collect_posts(index_html)
    if not post_urls:
        print("[ecf_stocks] no stocks posts found at category index")
        return []

    # Latest 12 posts ~= last 2 years of bi-monthly reports — plenty.
    entries: list[dict] = []
    for url in post_urls[:12]:
        e = _post_to_entry(url)
        if e:
            entries.append(e)

    if not entries:
        print("[ecf_stocks] no parseable entries from posts")
        return []

    # Keep one entry per period (latest wins if duplicates).
    by_period: dict[str, dict] = {}
    for e in entries:
        prev = by_period.get(e["period"])
        if not prev or (e.get("value_raw") and not prev.get("value_raw")):
            by_period[e["period"]] = e
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
            "monthly":     series,
            "latest_bags": value_bags or None,
            "as_of":       _today(),
            "source_url":  _INDEX_URL,
            "latest_post": latest.get("post_url"),
            "latest_pdf":  latest.get("pdf_url"),
        }),
    }]
