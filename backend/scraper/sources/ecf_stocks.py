"""
ecf_stocks.py — European Coffee Federation green coffee port stocks.

ECF publishes monthly stock totals for European ports. Their site does
not expose the data in a structured HTML table — figures usually live
in downloadable PDF press releases under /wp-content/uploads/. This
scraper therefore:

  1. Loads the ECF statistics / news page with Playwright.
  2. Collects every link that points to a PDF / XLS(X) / CSV file whose
     URL or anchor text hints at "stocks", "statistics", or "ECF".
  3. Downloads each candidate file and extracts the stock figure with
     regex patterns ECF has used historically.
  4. Falls back to the rendered page text if no files surface.

Writes a NewsItem with source="ECF" (matching what export_stocks.py
already reads) so wiring this scraper through main.py is enough.
"""
from __future__ import annotations

import io
import json
import logging
import re
from datetime import date
from urllib.parse import urljoin

import pandas as pd
import requests

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"
}

_ECF_URLS = [
    "https://www.ecf-coffee.org/resources/statistics/",
    "https://www.ecf-coffee.org/knowledge/statistics/",
    "https://www.ecf-coffee.org/statistics/",
    "https://www.ecf-coffee.org/news/",
    "https://www.ecf-coffee.org/",
]

# ECF aggregate EU port stocks usually fall in this band (in actual bags,
# not thousands). Allow wide bounds so a tightening market doesn't break
# us — these are just sanity gates.
_STOCK_MIN_BAGS = 1_000_000
_STOCK_MAX_BAGS = 30_000_000

# Tokens that mark a link as worth downloading.
_LINK_TOKENS = ("stock", "statistic", "ecf", "port", "europe")
# File extensions we know how to parse.
_FILE_EXTS = (".pdf", ".xls", ".xlsx", ".csv")

_MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]


def _today() -> str:
    return date.today().isoformat()


# ── number / date helpers ─────────────────────────────────────────────────────

def _parse_int(raw: str) -> int | None:
    """Parse '9,235,123' / '9 235 123' / '9.235.123' / '9235123' as int.

    Heuristic on separators:
      - if both '.' and ',' appear, the rightmost-of-them is the decimal mark
      - otherwise treat '.', ',', ' ' as thousands separators
    """
    s = raw.strip()
    if not s:
        return None
    # Drop any trailing decimal portion ("9,235.4" → 9235)
    if "." in s and "," in s:
        decimal = "." if s.rindex(".") > s.rindex(",") else ","
        s = s.split(decimal)[0]
    s = re.sub(r"[^\d]", "", s)
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _looks_like_bag_count(n: int) -> bool:
    return _STOCK_MIN_BAGS <= n <= _STOCK_MAX_BAGS


def _looks_like_thousand_bags(n: int) -> bool:
    return _STOCK_MIN_BAGS // 1000 <= n <= _STOCK_MAX_BAGS // 1000


def _coerce_bags(n: int) -> int | None:
    """Return bag count or None if the value doesn't fit the expected range
    even after scaling thousands → bags."""
    if _looks_like_bag_count(n):
        return n
    if _looks_like_thousand_bags(n):
        return n * 1000
    return None


def _guess_period(text: str) -> str:
    """Pull 'Month YYYY' out of free text. Falls back to today's ISO."""
    m = re.search(
        rf"({'|'.join(_MONTH_NAMES)})\s+(20\d{{2}})",
        text, flags=re.I
    )
    if m:
        month_idx = _MONTH_NAMES.index(m.group(1).lower()) + 1
        return f"{m.group(2)}-{month_idx:02d}"
    return _today()[:7]


# ── parsers per file type ────────────────────────────────────────────────────

_TEXT_PATTERNS = [
    # "European port stocks at end of January 2026: 9.8 million bags"
    re.compile(
        r"(?:european|eu)\s+(?:port\s+)?stocks?[^\d]{0,80}?"
        r"(\d+(?:[.,]\d+)?)\s*(?:million|m\b)\s+bags?",
        re.I | re.S,
    ),
    # "ECF stocks: 9,876,543 bags"
    re.compile(
        r"(?:ecf|european)\s+stocks?[^\d]{0,80}?"
        r"([\d.,\s]{5,15})\s*bags?",
        re.I | re.S,
    ),
    # Short-form "Total: 9.8 M bags"
    re.compile(
        r"total[^\d]{0,30}?(\d+(?:[.,]\d+)?)\s*(?:million|m\b)\s*bags?",
        re.I | re.S,
    ),
]


def _extract_from_text(text: str) -> dict | None:
    for pat in _TEXT_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        raw = m.group(1)
        # Was this a "X.X million" form?
        if pat.pattern.lower().count("million"):
            try:
                bags = int(float(raw.replace(",", ".")) * 1_000_000)
            except ValueError:
                continue
        else:
            n = _parse_int(raw)
            if n is None:
                continue
            bags = _coerce_bags(n)
            if bags is None:
                continue
        if not _looks_like_bag_count(bags):
            continue
        return {
            "period":    _guess_period(text[max(0, m.start() - 120):m.end() + 60]),
            "value_raw": bags,
        }
    return None


def _parse_pdf(content: bytes) -> dict | None:
    try:
        from pypdf import PdfReader
    except ImportError:
        logger.warning("[ecf_stocks] pypdf not installed — skip PDF parse")
        return None
    try:
        reader = PdfReader(io.BytesIO(content))
        text = "\n".join(p.extract_text() or "" for p in reader.pages[:20])
    except Exception as e:
        logger.warning(f"[ecf_stocks] PDF read failed: {e}")
        return None
    return _extract_from_text(text)


def _parse_spreadsheet(content: bytes, ext: str) -> dict | None:
    """Look for a Total row across every sheet in the file."""
    try:
        if ext == ".csv":
            dfs = {"csv": pd.read_csv(io.BytesIO(content))}
        else:
            dfs = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None)
    except Exception as e:
        logger.warning(f"[ecf_stocks] spreadsheet read failed: {e}")
        return None

    best: int | None = None
    best_period: str | None = None
    for _, df in dfs.items():
        for _, row in df.iterrows():
            cells = list(row)
            label_cells = [str(c) for c in cells if isinstance(c, str)]
            label = " ".join(label_cells).lower()
            if "total" not in label and "stock" not in label:
                continue
            for c in cells:
                if isinstance(c, (int, float)) and not pd.isna(c) and float(c).is_integer():
                    bags = _coerce_bags(int(c))
                    if bags and (best is None or bags > best):
                        best = bags
                        best_period = _guess_period(label) or _today()[:7]

    if best is None:
        return None
    return {"period": best_period or _today()[:7], "value_raw": best}


def _parse_file(content: bytes, url: str) -> dict | None:
    lower = url.lower()
    if lower.endswith(".pdf"):
        return _parse_pdf(content)
    for ext in (".xlsx", ".xls", ".csv"):
        if lower.endswith(ext):
            return _parse_spreadsheet(content, ext)
    return None


# ── orchestration ─────────────────────────────────────────────────────────────

def _collect_candidate_links(html: str, base_url: str) -> list[str]:
    """Find <a href> links that look like statistical files."""
    candidates: list[tuple[int, str]] = []
    for m in re.finditer(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        html, flags=re.I | re.S,
    ):
        href = m.group(1)
        text = re.sub(r"<[^>]+>", " ", m.group(2)).strip().lower()
        lower_href = href.lower()
        if not any(lower_href.endswith(ext) for ext in _FILE_EXTS):
            continue
        score = sum(tok in text or tok in lower_href for tok in _LINK_TOKENS)
        if score == 0:
            continue
        full = urljoin(base_url, href)
        candidates.append((score, full))

    # Higher score first; dedupe while preserving order.
    candidates.sort(key=lambda x: (-x[0], x[1]))
    seen: set[str] = set()
    out: list[str] = []
    for _, url in candidates:
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out[:8]  # cap to avoid downloading everything


async def _load_page_html(page, url: str) -> str | None:
    """Try Playwright first; fall back to plain requests."""
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(2_500)
        return await page.content()
    except Exception as e:
        logger.warning(f"[ecf_stocks] playwright {url} failed: {e}")
    try:
        r = requests.get(url, headers=_HEADERS, timeout=20)
        if r.status_code == 200:
            return r.text
        logger.warning(f"[ecf_stocks] http {url}: {r.status_code}")
    except Exception as e:
        logger.warning(f"[ecf_stocks] http {url} failed: {e}")
    return None


def _download(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        return r.content
    except Exception as e:
        logger.warning(f"[ecf_stocks] download {url} failed: {e}")
        return None


async def run(page) -> list[dict]:
    file_hits: list[dict] = []
    text_hits: list[dict] = []
    tried_files: list[str] = []
    source_url: str | None = None

    for url in _ECF_URLS:
        html = await _load_page_html(page, url)
        if not html:
            continue

        # (a) Try downloadable files
        for link in _collect_candidate_links(html, url):
            tried_files.append(link)
            content = _download(link)
            if not content:
                continue
            parsed = _parse_file(content, link)
            if parsed:
                parsed["source_link"] = link
                file_hits.append(parsed)

        # (b) Page text fallback
        text = re.sub(r"<[^>]+>", " ", html)
        parsed_text = _extract_from_text(text)
        if parsed_text:
            text_hits.append(parsed_text)

        if file_hits or text_hits:
            source_url = url
            break

    monthly = file_hits or text_hits
    if not monthly:
        print(
            f"[ecf_stocks] No stock data parsed "
            f"(tried {len(tried_files)} files, {len(_ECF_URLS)} pages)"
        )
        return []

    # Deduplicate by period, keep the largest value (most likely the EU-total
    # vs a sub-table).
    by_period: dict[str, dict] = {}
    for m in monthly:
        p = m["period"]
        if p not in by_period or m["value_raw"] > by_period[p]["value_raw"]:
            by_period[p] = m
    series = sorted(by_period.values(), key=lambda x: x["period"])
    latest = series[-1]
    value_bags = latest["value_raw"]

    return [{
        "title":    f"ECF European Port Stocks – {latest['period']}",
        "body":     (
            f"ECF European green coffee stocks: {value_bags:,} bags "
            f"({value_bags / 1_000_000:.1f}M bags). Source: {source_url}"
        ),
        "source":   "ECF",
        "category": "demand",
        "lat":      51.5,
        "lng":      5.0,
        "tags":     ["stocks", "europe", "ecf", "demand"],
        "meta":     json.dumps({
            "monthly":     series,
            "latest_bags": value_bags,
            "as_of":       _today(),
            "source_url":  source_url,
        }),
    }]
