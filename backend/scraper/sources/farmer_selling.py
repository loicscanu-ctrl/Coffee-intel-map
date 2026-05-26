"""
Farmer Selling Scraper — Safras & Mercado
Source: https://safras.com.br/eng/commodity/coffee/

Scrapes:
  - Brazil national % sold for Arabica and Conilon/Robusta
  - Survey date, 5-year average, MoM change

Updates farmer_selling_brazil.json:
  - arabica.brazil + robusta.brazil headline numbers
  - arabica/robusta chart y2526 point for current month
  - Adds new progression row (Brazil column only — regional data is paywalled)
  - report_date

Regional breakdown (SMG, CER, ZMT, etc.) is NOT publicly available — stays static.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
}

LISTING_URL = "https://safras.com.br/eng/commodity/coffee/"

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "farmer_selling_brazil.json"

# Crop-year chart x-labels in order (Apr of year1 → Apr of year2)
CHART_X_ORDER = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr*"]

MONTH_TO_CHART_X = {
    4: "Apr", 5: "May", 6: "Jun", 7: "Jul", 8: "Aug", 9: "Sep",
    10: "Oct", 11: "Nov", 12: "Dec", 1: "Jan", 2: "Feb", 3: "Mar",
}

MONTH_ABBR = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


# ── Listing page: collect candidate sales articles ────────────────────────────

SALES_KEYWORDS   = ["sold", "sales", "commerciali", "negotiated", "selling", "growers"]
HARVEST_KEYWORDS = ["harvest", "harvesting", "colheita", "crop progress", "harvest in brazil"]

# Safras is WordPress — derive the coffee-category RSS feed (server-rendered,
# reliably lists the most recent posts) from the listing URL, plus the site feed.
RSS_FEEDS = [LISTING_URL.rstrip("/") + "/feed/", "https://safras.com.br/eng/feed/"]


def _is_sales(title: str) -> bool:
    t = title.lower()
    if any(kw in t for kw in HARVEST_KEYWORDS):
        return False
    return any(kw in t for kw in SALES_KEYWORDS)


def _rss_sales_urls(session: requests.Session) -> list[str]:
    """Sales-article URLs from the WordPress RSS feed (the reliable source of the
    newest posts — the HTML listing only renders a few featured/older links)."""
    for feed in RSS_FEEDS:
        try:
            r = session.get(feed, headers=HEADERS, timeout=20)
            r.raise_for_status()
        except Exception as e:
            log.info("RSS feed %s failed: %s", feed, e)
            continue
        items = re.findall(r"<item\b.*?</item>", r.text, re.S | re.I)
        urls: list[str] = []
        for it in items:
            lm = re.search(r"<link>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</link>", it, re.S | re.I)
            tm = re.search(r"<title>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</title>", it, re.S | re.I)
            if not lm:
                continue
            href = lm.group(1).strip()
            title = tm.group(1).strip() if tm else ""
            if href.startswith("http") and _is_sales(title) and href not in urls:
                urls.append(href)
        if items:
            log.info("RSS %s → %d items, %d sales article(s)", feed, len(items), len(urls))
            if urls:
                return urls
    return []


def _find_sales_article_urls(session: requests.Session) -> list[str]:
    """Candidate 'sales/% sold' article URLs — RSS feed first (newest posts),
    then the HTML listing as a fallback. Deduped. The caller fetches each and
    picks the most recent by crop-year + survey date."""
    urls: list[str] = list(_rss_sales_urls(session))

    try:
        r = session.get(LISTING_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup.find_all("a", href=True):
            href = str(tag.get("href", ""))
            title = tag.get_text(strip=True)
            if href.startswith("http") and _is_sales(title) and href not in urls:
                urls.append(href)
    except Exception as e:
        log.error("Failed to fetch listing: %s", e)

    log.info("Found %d candidate sales article(s) total", len(urls))
    return urls


def _crop_month_index(month_num: int) -> int:
    """Brazilian crop year starts in July — map calendar month to crop-month
    (Jul=1 … Jun=12) so within a crop year a later survey ranks as more recent."""
    return ((month_num - 7) % 12) + 1 if month_num else 0


def _recency_key(parsed: dict[str, Any]) -> tuple[str, int, int]:
    """Sort key for 'most recent' = (crop_year, crop-month, survey day)."""
    cy = parsed.get("crop_year") or "0000/00"
    m = _month_name_to_number(parsed.get("survey_month_name", "")) or 0
    return (cy, _crop_month_index(m), int(parsed.get("survey_day") or 0))


# ── Article parsing ───────────────────────────────────────────────────────────

def _extract_pct(text: str, *patterns: str) -> int | None:
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE | re.DOTALL)
        if m:
            try:
                return int(m.group(1))
            except (IndexError, ValueError):
                pass
    return None


def _parse_article(html: str) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "html.parser")

    # Get article body text — try common content selectors
    body_el = (
        soup.find("div", class_=re.compile(r"entry.content|post.content|article.body", re.I))
        or soup.find("article")
        or soup.find("main")
    )
    if not body_el:
        log.warning("No article body found")
        return None

    text = body_el.get_text(separator=" ")
    text = re.sub(r"\s+", " ", text)

    log.debug("Article text snippet: %s", text[:500])

    result: dict[str, Any] = {}

    # ── Crop year ─────────────────────────────────────────────────────────────
    cy_m = re.search(r"\b(\d{4}/\d{2})\b", text)
    if cy_m:
        result["crop_year"] = cy_m.group(1)

    # ── Survey date  ("as of July 9", "through February 11") ─────────────────
    date_m = re.search(
        r"(?:as of|through)\s+([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?",
        text, re.IGNORECASE,
    )
    if date_m:
        result["survey_month_name"] = date_m.group(1)
        result["survey_day"]        = int(date_m.group(2))
        if date_m.group(3):
            result["survey_year"] = int(date_m.group(3))

    # ── Overall % sold ────────────────────────────────────────────────────────
    result["overall_pct"] = _extract_pct(
        text,
        r"(\d{1,3})%\s+of\s+(?:the\s+)?\d{4}/\d{2}\s+crop",
        r"growers\s+(?:sold|negotiated)\s+(\d{1,3})%",
        r"(\d{1,3})%\s+of\s+(?:Brazil'?s?\s+)?\d{4}/\d{2}",
        r"already\s+(?:sold|negotiated)\s+(\d{1,3})%",
        r"(\d{1,3})%\s+of\s+production\s+had\s+already\s+been\s+sold",
    )

    # ── Arabica % ─────────────────────────────────────────────────────────────
    result["arabica_pct"] = _extract_pct(
        text,
        # "Arabica ... 85% ... Canephora" pattern — capture first % after Arabica
        r"[Aa]rabica[^.!?]{0,120}?(\d{1,3})%",
        r"(\d{1,3})%[^.!?]{0,60}?[Aa]rabica",
    )

    # ── Conilon / Robusta / Canephora % ──────────────────────────────────────
    result["robusta_pct"] = _extract_pct(
        text,
        r"[Cc]oni(?:l|ll)on[^.!?]{0,120}?(\d{1,3})%",
        r"[Cc]anephora[^.!?]{0,120}?(\d{1,3})%",
        r"[Rr]obusta[^.!?]{0,120}?(\d{1,3})%",
        r"(\d{1,3})%[^.!?]{0,60}?[Cc]oni(?:l|ll)on",
        r"(\d{1,3})%[^.!?]{0,60}?[Cc]anephora",
    )

    # ── 5-year average ────────────────────────────────────────────────────────
    result["avg_5y"] = _extract_pct(
        text,
        r"five.year\s+average[^.!?]{0,80}?(\d{1,3})%",
        r"(\d{1,3})%[^.!?]{0,60}?five.year\s+average",
        r"5.year\s+average[^.!?]{0,80}?(\d{1,3})%",
        r"historical\s+average[^.!?]{0,80}?(\d{1,3})%",
    )

    # ── MoM change ────────────────────────────────────────────────────────────
    result["mom_change"] = _extract_pct(
        text,
        r"up\s+(\d{1,2})%?\s+(?:percentage\s+points?\s+)?from\s+the\s+previous\s+month",
        r"(\d{1,2})\s+(?:percentage\s+)?points?\s+(?:from|vs\.?)\s+(?:the\s+)?previous\s+month",
    )

    log.info("Parsed article: %s", result)
    return result


# ── JSON update helpers ───────────────────────────────────────────────────────

def _month_name_to_number(name: str) -> int | None:
    months = {
        "january": 1, "february": 2, "march": 3, "april": 4,
        "may": 5, "june": 6, "july": 7, "august": 8,
        "september": 9, "october": 10, "november": 11, "december": 12,
    }
    return months.get(name.lower())


def _survey_month_label(month_num: int, crop_year: str, survey_year: int | None) -> str:
    """Return e.g. 'Mar-26' label for the progression table."""
    abbr = MONTH_ABBR.get(month_num, "???")
    if survey_year:
        return f"{abbr}-{str(survey_year)[2:]}"
    # Infer year from crop_year — supports both "25/26" and "2025/26" formats.
    # months Jul-Dec → first year; Jan-Jun → second year
    try:
        parts = crop_year.split("/")
        y1_str = parts[0][-2:]   # last 2 digits: "25" from "2025" or "25"
        y2_str = parts[1][-2:]   # last 2 digits: "26" from "2026" or "26"
        yr2 = y1_str if month_num >= 7 else y2_str
        return f"{abbr}-{yr2}"
    except Exception:
        return f"{abbr}-??"


def _update_chart(chart: list[dict], month_num: int, new_val: int) -> None:
    """Set the y2526 value for the matching x-label."""
    x_label = MONTH_TO_CHART_X.get(month_num)
    if not x_label:
        return
    for point in chart:
        if point.get("x") == x_label:
            point["y2526"] = new_val
            return
    log.warning("Chart x-label '%s' not found — not updating chart", x_label)


def _apply_to_json(data: dict, parsed: dict[str, Any]) -> bool:
    """Apply parsed article values to the loaded JSON. Returns True if anything changed."""
    changed = False

    month_num = None
    if "survey_month_name" in parsed:
        month_num = _month_name_to_number(parsed["survey_month_name"])

    for variety in ("arabica", "robusta"):
        pct_key = "arabica_pct" if variety == "arabica" else "robusta_pct"
        new_pct = parsed.get(pct_key)

        # Fall back to overall if variety-specific not extracted
        if new_pct is None and variety == "arabica":
            new_pct = parsed.get("overall_pct")

        if new_pct is None:
            continue

        brazil = data[variety]["brazil"]
        old_current = brazil.get("current", 0)
        stored_crop = brazil.get("crop_year")
        parsed_crop = parsed.get("crop_year")
        # A new crop year legitimately resets % sold to a low value. Only apply the
        # "within a season % sold only rises" guard when we're in the SAME season;
        # accept the reset when the article's crop year is newer than the stored one.
        new_season = bool(parsed_crop and stored_crop and parsed_crop > stored_crop)

        if new_pct != old_current or new_season:
            # Guard: skip a much-lower value only within the same season (likely an
            # older article); a newer crop year is a real reset, not a regression.
            if new_pct < old_current - 5 and not new_season:
                log.info(
                    "%s: scraped %d%% << stored %d%% (crop %s) — likely older article, skipping",
                    variety, new_pct, old_current, stored_crop,
                )
                continue
            brazil["prev_month"] = new_pct if new_season else old_current
            brazil["current"]    = new_pct
            if parsed_crop:
                brazil["crop_year"] = parsed_crop
            changed = True
            log.info("%s: %d%% → %d%%%s", variety, old_current, new_pct,
                     f" (new crop {parsed_crop})" if new_season else "")

        if parsed.get("avg_5y") is not None:
            old_avg = brazil.get("avg_5y")
            if old_avg != parsed["avg_5y"]:
                brazil["avg_5y"] = parsed["avg_5y"]
                changed = True

        # Update seasonal chart
        if month_num:
            _update_chart(data[variety]["chart"], month_num, new_pct)
            changed = True

    # Add progression row if new month
    if month_num and "crop_year" in parsed:
        crop_year = parsed["crop_year"]
        survey_year = parsed.get("survey_year")
        label = _survey_month_label(month_num, crop_year, survey_year)

        for variety in ("arabica", "robusta"):
            prog = data[variety]["progression"]
            existing_months = [r["month"] for r in prog]
            if label not in existing_months:
                brazil_val = data[variety]["brazil"]["current"]
                new_row: dict[str, Any] = {"month": label, "Brazil": brazil_val}
                prog.append(new_row)
                log.info("%s: added progression row %s", variety, label)
                changed = True

    return changed


# ── Main ──────────────────────────────────────────────────────────────────────

def build_farmer_selling(db=None) -> dict:
    if not HAS_BS4:
        log.error("beautifulsoup4 not installed — skipping farmer selling scrape")
        return {}

    if not OUT_PATH.exists():
        log.error("farmer_selling_brazil.json not found at %s", OUT_PATH)
        return {}

    with open(OUT_PATH, encoding="utf-8") as f:
        data = json.load(f)

    session = requests.Session()

    urls = _find_sales_article_urls(session)
    if not urls:
        log.warning("No sales article found on Safras listing page")
        return data

    # Fetch the candidates and keep the genuinely most-recent one (the listing
    # links featured/older posts high in the DOM, so first-match isn't newest).
    best: tuple[tuple[str, int, int], dict[str, Any], str] | None = None
    for url in urls[:8]:
        try:
            r = session.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
        except Exception as e:
            log.warning("Fetch failed %s: %s", url, e)
            continue
        parsed = _parse_article(r.text)
        if not parsed:
            continue
        key = _recency_key(parsed)
        log.info("candidate crop=%s %s %s arabica=%s%% robusta=%s%% key=%s — %s",
                 parsed.get("crop_year"), parsed.get("survey_month_name"), parsed.get("survey_day"),
                 parsed.get("arabica_pct"), parsed.get("robusta_pct"), key, url)
        if best is None or key > best[0]:
            best = (key, parsed, url)

    if best is None:
        log.warning("No parseable sales article among %d candidate(s)", len(urls))
        return data

    _, parsed, article_url = best
    log.info("Selected most-recent article (key=%s): %s", best[0], article_url)

    if not _apply_to_json(data, parsed):
        log.info("No changes detected — JSON unchanged")
        return data

    data["report_date"]   = datetime.utcnow().strftime("%Y-%m-%d")
    data["source_article"] = article_url

    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("farmer_selling_brazil.json updated (%d bytes)", OUT_PATH.stat().st_size)
    return data


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = build_farmer_selling()
    if result:
        print(f"Arabica:  {result['arabica']['brazil']}")
        print(f"Robusta:  {result['robusta']['brazil']}")
        print(f"Reported: {result.get('report_date')}")
        print(f"Source:   {result.get('source_article', 'n/a')}")
