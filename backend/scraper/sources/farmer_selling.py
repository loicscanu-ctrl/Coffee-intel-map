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
from urllib.parse import quote_plus

import requests

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False

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


# ── Listing/feed: collect candidate sales + harvest articles (EN + PT) ─────────

SALES_KEYWORDS   = ["sold", "sales", "commerciali", "negotiated", "selling", "growers",
                    "comerciali", "vendid", "negociad", "vendas"]
HARVEST_KEYWORDS = ["harvest", "harvesting", "reaped", "colheita", "colhid", "colher"]
# Other commodities that share the site/feeds — reject so corn/soy "harvest" or
# soybean "commercialization" headlines don't leak in.
OTHER_CROPS = ["soybean", "soja", "corn", "milho", "sugar", "açúcar", "acucar",
               "wheat", "trigo", "cotton", "algod", "ethanol", "etanol", "cattle", "boi", "suíno"]
# Coffee-category RSS feeds only (the all-commodity site feeds are full of noise).
RSS_FEEDS = [
    LISTING_URL.rstrip("/") + "/feed/",            # /eng/commodity/coffee/feed/ (EN)
    "https://safras.com.br/commodity/cafe/feed/",  # PT coffee category
]

# "Echo" discovery — Safras numbers reliably re-publish through Brazilian
# agribusiness outlets within hours, so we mine Google News (pt-BR) for those
# secondary reports. This sidesteps the Safras portal's bot/paywall blocks while
# still sourcing their gold-standard commercialization figures.
def _gnews(query: str) -> str:
    return (
        "https://news.google.com/rss/search?q="
        + quote_plus(query)
        + "&hl=pt-BR&gl=BR&ceid=BR:pt-419"
    )

GOOGLE_NEWS_FEEDS = [
    _gnews('"Safras & Mercado" comercialização café'),
    _gnews('"Safras" café "vendas antecipadas" safra'),
    _gnews('comercialização café arábica conilon safra Safras'),
]


def _is_harvest(title: str) -> bool:
    return any(kw in title.lower() for kw in HARVEST_KEYWORDS)


def _is_sales(title: str) -> bool:
    t = title.lower()
    if _is_harvest(t):           # harvest-progress articles aren't sales surveys
        return False
    return any(kw in t for kw in SALES_KEYWORDS)


def _is_candidate(title: str) -> bool:
    """A pace/survey article: about coffee, carries a % in the headline (price/
    market commentary and production-estimate posts don't), and isn't another crop."""
    t = title.lower()
    if "%" not in title:
        return False
    if not any(c in t for c in ("coffee", "café", "cafe")):
        return False
    if any(c in t for c in OTHER_CROPS):
        return False
    return _is_sales(title) or _is_harvest(title)


def _rss_sales_urls(session: requests.Session) -> list[str]:
    """Candidate (sales OR harvest) article URLs from the WordPress RSS feeds —
    the reliable source of the newest posts (the HTML listing only renders a few
    featured/older links). Aggregates across ALL feeds (EN + PT) so a newer PT
    survey isn't hidden behind the English feed; deduped by URL."""
    urls: list[str] = []
    for feed in RSS_FEEDS:
        try:
            r = session.get(feed, headers=HEADERS, timeout=20)
            r.raise_for_status()
        except Exception as e:
            log.info("RSS feed %s failed: %s", feed, e)
            continue
        items = re.findall(r"<item\b.*?</item>", r.text, re.S | re.I)
        n_cand = 0
        for it in items:
            lm = re.search(r"<link>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</link>", it, re.S | re.I)
            tm = re.search(r"<title>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</title>", it, re.S | re.I)
            dm = re.search(r"<pubDate>\s*(.*?)\s*</pubDate>", it, re.S | re.I)
            if not lm:
                continue
            href = lm.group(1).strip()
            title = tm.group(1).strip() if tm else ""
            kind = "harvest" if _is_harvest(title) else ("sales" if _is_sales(title) else "—")
            log.info("RSS item: %s | %s | %s", (dm.group(1).strip() if dm else "?"), kind, title[:90])
            if href.startswith("http") and _is_candidate(title) and href not in urls:
                urls.append(href)
                n_cand += 1
        log.info("RSS %s → %d items, %d new candidate(s)", feed, len(items), n_cand)
    return urls


def _is_echo_candidate(title: str) -> bool:
    """Looser than _is_candidate: Google-News echo headlines often carry the %
    in the body rather than the title, so accept any coffee sales/harvest item
    (or one mentioning comercialização/safra) that isn't another crop."""
    t = title.lower()
    if not any(c in t for c in ("coffee", "café", "cafe")):
        return False
    if any(c in t for c in OTHER_CROPS):
        return False
    return _is_sales(title) or _is_harvest(title) or "comercializ" in t or "safra" in t


def _google_news_urls(limit_per_feed: int = 8) -> list[str]:
    """Echo discovery: candidate article URLs from Google News (pt-BR) RSS.
    Requires feedparser (in requirements); a no-op if it's unavailable. Google
    News `link`s are redirects — the caller fetches+parses them like any other
    candidate and simply finds nothing if a redirect doesn't resolve."""
    if not HAS_FEEDPARSER:
        log.info("feedparser unavailable — skipping Google News echo discovery")
        return []
    urls: list[str] = []
    for feed in GOOGLE_NEWS_FEEDS:
        try:
            parsed = feedparser.parse(feed)
        except Exception as e:  # noqa: BLE001
            log.info("Google News feed failed: %s", e)
            continue
        n = 0
        for entry in getattr(parsed, "entries", [])[:limit_per_feed]:
            title = getattr(entry, "title", "") or ""
            link = getattr(entry, "link", "") or ""
            if link.startswith("http") and _is_echo_candidate(title) and link not in urls:
                urls.append(link)
                n += 1
        log.info("GNews %s → %d candidate(s)", feed[:55], n)
    return urls


def _find_sales_article_urls(session: requests.Session) -> list[str]:
    """Candidate sales + harvest article URLs — Safras RSS feeds first (newest
    posts), then the Google-News echo feeds, then the HTML listing as a
    fallback. Deduped. The caller fetches each and routes/picks the most recent
    by crop-year + survey date."""
    urls: list[str] = list(_rss_sales_urls(session))
    for u in _google_news_urls():
        if u not in urls:
            urls.append(u)

    try:
        r = session.get(LISTING_URL, headers=HEADERS, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup.find_all("a", href=True):
            href = str(tag.get("href", ""))
            title = tag.get_text(strip=True)
            if href.startswith("http") and _is_candidate(title) and href not in urls:
                urls.append(href)
    except Exception as e:
        log.error("Failed to fetch listing: %s", e)

    log.info("Found %d candidate article(s) total", len(urls))
    return urls


def _crop_month_index(month_num: int) -> int:
    """Coffee survey timeline within a crop-year label runs ~May→Apr (harvest
    starts in May), so map May=1 … Apr=12 to order surveys chronologically."""
    return ((month_num - 5) % 12) + 1 if month_num else 0


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


# ── Dual-crop commercialization parsing ───────────────────────────────────────
# Safras reports two crop years at once: the current/old crop's overall
# commercialization and the new crop's *advance* sales (split arabica/conilon).
# We locate each crop-year token (e.g. "2026/27") and read the percentages in
# the text window that follows it — the breakdown sits next to its crop-year.

_CROP_YEAR_RE = re.compile(r"\b(20\d{2})/(\d{2})\b")


def _pct_in_range(val: int | None) -> int | None:
    return val if val is not None and 0 <= val <= 100 else None


def _kw_pct_span(window: str, keyword: str) -> tuple[int | None, tuple[int, int] | None]:
    """Percentage tied to a keyword (value, digit-span) in either order within a
    short span: '20% do arábica' or 'arábica soma 20%'. Returns the matched
    digits' span so the caller can consume it before reading the next variety —
    that's what stops 'conilon' from grabbing arabica's figure."""
    kw = f"(?:{keyword})"  # group the keyword so a '|' alternation can't swallow the pattern
    m = (re.search(r"(\d{1,3})\s*%[^%]{0,30}?" + kw, window, re.I)
         or re.search(kw + r"[^%]{0,30}?(\d{1,3})\s*%", window, re.I))
    if not m:
        return None, None
    return _pct_in_range(int(m.group(1))), m.span(1)


def _first_pct(window: str) -> int | None:
    m = re.search(r"(\d{1,3})\s*%", window)
    return _pct_in_range(int(m.group(1))) if m else None


def _parse_dual_crop(text: str) -> dict[str, dict[str, int]] | None:
    """Parse {crop_year: {overall/arabica/conilon _sold_pct}} from article text.

    Heuristic: for each crop-year token, scan the window up to the next crop
    year (or ~400 chars). The first % is the overall figure; arabica/conilon
    are read by keyword proximity. Calibrated to typical Safras-echo phrasing;
    refined against live CI articles over time.
    """
    t = re.sub(r"\s+", " ", text or "")
    years = list(_CROP_YEAR_RE.finditer(t))
    if not years:
        return None
    crops: dict[str, dict[str, int]] = {}
    for i, m in enumerate(years):
        cy = f"{m.group(1)}/{m.group(2)}"
        start = m.end()
        end = years[i + 1].start() if i + 1 < len(years) else min(len(t), start + 400)
        win = t[start:end]
        rec: dict[str, int] = {}
        ov = _first_pct(win)
        ar, ar_span = _kw_pct_span(win, r"ar[aá]bica")
        # Consume arabica's digits before reading conilon, so an adjacent
        # "20% … arábica e 10% … conilon" doesn't let conilon match the 20.
        co_win = win
        if ar_span:
            co_win = win[:ar_span[0]] + " " * (ar_span[1] - ar_span[0]) + win[ar_span[1]:]
        co, _ = _kw_pct_span(co_win, r"conil?l?on|robusta")
        if ov is not None:
            rec["overall_sold_pct"] = ov
        if ar is not None:
            rec["arabica_sold_pct"] = ar
        if co is not None:
            rec["conilon_sold_pct"] = co
        if rec:
            crops.setdefault(cy, {}).update(rec)
    return crops or None


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

    # ── Article kind (harvest-progress vs sales survey) from its own headline ──
    headline = ""
    h1 = soup.find("h1")
    if h1:
        headline = h1.get_text(" ", strip=True)
    elif soup.title:
        headline = soup.title.get_text(" ", strip=True)
    result["headline"] = headline
    result["kind"] = "harvest" if _is_harvest(headline) else "sales"

    # ── Crop year ─────────────────────────────────────────────────────────────
    cy_m = re.search(r"\b(\d{4}/\d{2})\b", text)
    if cy_m:
        result["crop_year"] = cy_m.group(1)

    # ── Survey date  (EN "as of July 9" / "through February 11"; PT "em 9 de julho") ──
    date_m = re.search(
        r"(?:as of|through)\s+([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?",
        text, re.IGNORECASE,
    )
    if date_m:
        result["survey_month_name"] = date_m.group(1)
        result["survey_day"]        = int(date_m.group(2))
        if date_m.group(3):
            result["survey_year"] = int(date_m.group(3))
    else:
        pt_m = re.search(r"(?:em|at[ée])\s+(\d{1,2})\s+de\s+([A-Za-zçÇ]+)(?:\s+de\s+(\d{4}))?", text, re.IGNORECASE)
        if pt_m:
            result["survey_day"]        = int(pt_m.group(1))
            result["survey_month_name"] = pt_m.group(2)
            if pt_m.group(3):
                result["survey_year"] = int(pt_m.group(3))

    # ── Overall % sold (EN + PT) ───────────────────────────────────────────────
    result["overall_pct"] = _extract_pct(
        text,
        r"(\d{1,3})%\s+of\s+(?:the\s+)?\d{4}/\d{2}\s+crop",
        r"growers\s+(?:sold|negotiated)\s+(\d{1,3})%",
        r"(\d{1,3})%\s+of\s+(?:Brazil'?s?\s+)?\d{4}/\d{2}",
        r"already\s+(?:sold|negotiated)\s+(\d{1,3})%",
        r"(\d{1,3})%\s+of\s+production\s+had\s+already\s+been\s+sold",
        r"comercializ\w*[^.!?]{0,40}?(\d{1,3})%",          # PT "comercializou 31%"
        r"(\d{1,3})%\s+(?:da|do)\s+(?:safra|caf[ée])\s+\d{4}/\d{2}",  # PT "31% da safra 2025/26"
        r"vendid\w*[^.!?]{0,40}?(\d{1,3})%",
    )

    # ── Harvest progress % (used only when kind == 'harvest') ──────────────────
    # Prefer the HEADLINE — it carries the clean national total ("reaching 77% of
    # production"); the body has regional sub-figures (e.g. conilon 93%) that the
    # regex would otherwise grab. Fall back to the body only if the headline lacks it.
    _harvest_pats = (
        r"(\d{1,3})%\s+of\s+production",
        r"(\d{1,3})%\s+of\s+(?:the\s+)?\d{4}/\d{2}\s+(?:season|crop)",
        r"(?:reaching|reached|hits?|at)\s+(\d{1,3})%",
        r"(\d{1,3})%\s+of\s+(?:the\s+)?(?:\d{4}/\d{2}\s+)?(?:coffee\s+)?(?:crop|season|production)\s+(?:is\s+|has\s+been\s+|was\s+)?(?:reaped|harvested)",
        r"colheita\w*[^.!?]{0,80}?(\d{1,3})%",             # PT
        r"(\d{1,3})%\s+colhid",                             # PT "X% colhido"
    )
    result["harvest_pct"] = _extract_pct(headline, *_harvest_pats) or _extract_pct(text, *_harvest_pats)

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
        # Portuguese
        "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4,
        "maio": 5, "junho": 6, "julho": 7, "agosto": 8,
        "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
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
        log.warning("No candidate article found on Safras listing/feeds")
        return data

    # Fetch candidates, route each by kind, and keep the most-recent sales AND
    # harvest article (the listing links featured/older posts high, so first
    # match isn't newest; recency = crop_year, crop-month, survey day).
    best_sales: tuple[tuple[str, int, int], dict[str, Any], str] | None = None
    best_harvest: tuple[tuple[str, int, int], dict[str, Any], str] | None = None
    # Dual-crop "echo" read: keep the single most-complete two-crop-year report
    # (scored by how many overall/arabica/conilon cells it fills), so we don't
    # splice stale and fresh figures across different articles.
    best_dual: tuple[int, dict[str, dict[str, int]]] | None = None
    for url in urls[:20]:
        try:
            r = session.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
        except Exception as e:
            log.warning("Fetch failed %s: %s", url, e)
            continue
        # Run BEFORE _parse_article (which is Safras-structure-specific and
        # returns None for echo outlets): dual-crop parsing works on any text.
        dual = _parse_dual_crop(r.text)
        if dual:
            score = sum(1 for rec in dual.values() for v in rec.values() if v is not None)
            if best_dual is None or score > best_dual[0]:
                best_dual = (score, dual)
        parsed = _parse_article(r.text)
        if not parsed:
            continue
        key = _recency_key(parsed)
        log.info("candidate kind=%s crop=%s %s %s a=%s%% r=%s%% harvest=%s%% key=%s — %s",
                 parsed.get("kind"), parsed.get("crop_year"), parsed.get("survey_month_name"),
                 parsed.get("survey_day"), parsed.get("arabica_pct"), parsed.get("robusta_pct"),
                 parsed.get("harvest_pct"), key, url)
        if parsed.get("kind") == "harvest":
            if parsed.get("harvest_pct") is not None and (best_harvest is None or key > best_harvest[0]):
                best_harvest = (key, parsed, url)
        else:
            if best_sales is None or key > best_sales[0]:
                best_sales = (key, parsed, url)

    changed = False

    if best_harvest is not None:
        _, hp, hurl = best_harvest
        new_h = {
            "current": hp["harvest_pct"],
            "crop_year": hp.get("crop_year"),
            "survey_label": (f"{hp.get('survey_month_name','')} {hp.get('survey_day','')}".strip()),
            "report_date": datetime.utcnow().strftime("%Y-%m-%d"),
            "source_article": hurl,
        }
        if data.get("harvest") != new_h:
            data["harvest"] = new_h
            changed = True
            log.info("harvest: %s%% (crop %s, %s)", new_h["current"], new_h["crop_year"], hurl)

    # Additive dual-crop block (current crop's overall commercialization + new
    # crop's advance sales). Kept alongside the existing rich single-crop fields
    # so the live panel is unaffected; the UI sprint will read data["crops"].
    if best_dual is not None:
        current_cy = ((data.get("arabica") or {}).get("brazil") or {}).get("crop_year") or ""
        crops_out: dict[str, dict[str, Any]] = {}
        for cy, pcts in best_dual[1].items():
            crops_out[cy] = {
                "status": "new_crop_advance" if (current_cy and cy > current_cy) else "current_crop",
                "overall_sold_pct": pcts.get("overall_sold_pct"),
                "arabica_sold_pct": pcts.get("arabica_sold_pct"),
                "conilon_sold_pct": pcts.get("conilon_sold_pct"),
            }
        if crops_out and data.get("crops") != crops_out:
            data["crops"] = crops_out
            data["crops_meta"] = {
                "updated": datetime.utcnow().strftime("%Y-%m-%d"),
                "source": "Safras & Mercado (via News Echo)",
            }
            changed = True
            log.info("crops (dual): %s", crops_out)

    if best_sales is not None:
        _, parsed, article_url = best_sales
        log.info("Selected most-recent SALES article (key=%s): %s", best_sales[0], article_url)
        if _apply_to_json(data, parsed):
            data["report_date"]    = datetime.utcnow().strftime("%Y-%m-%d")
            data["source_article"] = article_url
            changed = True

    if not changed:
        log.info("No changes detected — JSON unchanged")
        return data

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
