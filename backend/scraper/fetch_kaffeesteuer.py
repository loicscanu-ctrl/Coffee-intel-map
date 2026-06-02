"""
fetch_kaffeesteuer.py
Auto-discovers monthly Steuereinnahmen PDFs from bundesfinanzministerium.de
by scraping the ministry's listing page, then extracts the Kaffeesteuer value.
Incrementally updates frontend/public/data/kaffeesteuer.json.

Usage:
    cd backend
    python -m scraper.fetch_kaffeesteuer
"""
import io
import json
import re
import sys
import time
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://www.bundesfinanzministerium.de"
INDEX_URL = (
    "https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/"
    "Steuerschaetzungen_und_Steuereinnahmen/Steuereinnahmen/steuereinnahmen.html"
)

ROOT     = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "kaffeesteuer.json"

GERMAN_MONTHS = {
    "januar": "01", "februar": "02", "maerz": "03", "april": "04",
    "mai": "05", "juni": "06", "juli": "07", "august": "08",
    "september": "09", "oktober": "10", "november": "11", "dezember": "12",
}

# Matches filenames like: 2026-03-20-steuereinnahmen-februar-2026.pdf
PDF_RE = re.compile(r"steuereinnahmen-([a-z]+)-(\d{4})\.pdf", re.IGNORECASE)


def discover_pdf_urls(session: requests.Session) -> dict[str, str]:
    """Scrape the ministry index page and return {period: url} for all matching PDFs."""
    resp = session.get(INDEX_URL, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    found: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if "steuereinnahmen" not in href.lower():
            continue
        if not href.lower().endswith(".pdf"):
            continue
        m = PDF_RE.search(href)
        if not m:
            continue
        month_de = m.group(1).lower()
        year     = m.group(2)
        month_num = GERMAN_MONTHS.get(month_de)
        if not month_num:
            continue
        period = f"{year}-{month_num}"
        url = BASE + href if href.startswith("/") else href
        # Keep first occurrence (most recent version) if duplicate period
        if period not in found:
            found[period] = url

    return found


def extract_kaffeesteuer(pdf_bytes: bytes) -> int | None:
    """Open PDF in memory and return the Kaffeesteuer monthly value (Tsd. EUR)."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.splitlines():
                if "Kaffeesteuer" in line:
                    nums = re.findall(r"\d+\.\d+", line)
                    if nums:
                        return int(nums[0].replace(".", ""))
    return None


def _compute_commentary(period: str, value: int, history: dict[str, int]) -> str | None:
    """Render the news-feed badge for the latest Kaffeesteuer print.

    Returns None when the prior-month / same-month-last-year references are
    unavailable (e.g. the first month of recorded history). Pure helper so the
    wording can be pinned by a unit test without HTTP / PDF parsing.
    """
    from scraper.commentary import render, signed

    year, month = period.split("-")
    # Prior month — handle the January rollover into the previous year.
    if month == "01":
        prev_period = f"{int(year) - 1}-12"
    else:
        prev_period = f"{year}-{int(month) - 1:02d}"
    yoy_period = f"{int(year) - 1}-{month}"

    prev = history.get(prev_period)
    yoy  = history.get(yoy_period)
    if prev is None or yoy is None or prev == 0 or yoy == 0:
        return None

    mom_delta_pct = (value - prev) / prev * 100
    yoy_delta_pct = (value - yoy) / yoy * 100
    return render("kaffeesteuer", {
        "period":           period,
        "volume":           f"{value:,}",
        "mom_delta_signed": signed(mom_delta_pct, decimals=1),
        "yoy_delta_signed": signed(yoy_delta_pct, decimals=1),
    })


def _emit_news(latest_period: str, results: dict[str, int]) -> None:
    """Upsert a news_feed row carrying the commentary badge. No-op when
    DATABASE_URL is unset (local runs / smoke tests).

    Kaffeesteuer is a monthly print, so the title carries the period — that
    gives upsert_news_item's title-dedupe the right granularity (re-runs in
    the same month no-op; a new month creates a new row).
    """
    import os
    from datetime import datetime, timezone

    if not os.environ.get("DATABASE_URL"):
        print("[kaffeesteuer-news] DATABASE_URL unset — skipping news_feed upsert")
        return

    value = results.get(latest_period)
    if value is None:
        return
    text = _compute_commentary(latest_period, value, results)
    if text is None:
        print(f"[kaffeesteuer-news] {latest_period}: not enough history for MoM/YoY — skipping")
        return

    from scraper.commentary import embed_commentary
    from scraper.db import get_session, upsert_news_item

    meta_obj: dict = {"period": latest_period, "value_tsd_eur": value}
    embed_commentary(meta_obj, text=text, has_update=True, is_latest_trading_day=False)
    item = {
        "title":    f"German Kaffeesteuer Revenue – {latest_period}",
        "body":     text,
        "source":   "Bundesfinanzministerium",
        "category": "demand",
        "lat":      51.165,   # Germany centroid
        "lng":      10.452,
        "tags":     ["kaffeesteuer", "germany", "demand", "auto-commentary"],
        "meta":     json.dumps(meta_obj, ensure_ascii=False),
        "pub_date": datetime.now(timezone.utc),
    }
    db = get_session()
    try:
        upsert_news_item(db, item)
        print(f"[kaffeesteuer-news] {latest_period}: {text}")
    finally:
        db.close()


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Load existing data
    existing: dict[str, int] = {}
    if OUT_PATH.exists():
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)
    print(f"Existing records: {len(existing)}")

    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"

    # Discover all available PDFs from the index page
    print(f"Fetching index page: {INDEX_URL}")
    try:
        discovered = discover_pdf_urls(session)
    except Exception as e:
        print(f"ERROR fetching index page: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"Discovered {len(discovered)} PDFs on index page")

    # Only process months not already stored
    new_periods = {p: u for p, u in discovered.items() if p not in existing}
    if not new_periods:
        print("No new months found — JSON is up to date.")
        return

    print(f"New months to fetch: {sorted(new_periods)}")
    results = dict(existing)

    for period in sorted(new_periods):
        url = new_periods[period]
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            val = extract_kaffeesteuer(r.content)
            if val:
                results[period] = val
                print(f"  {period}: {val}")
            else:
                print(f"  {period}: NOT FOUND in PDF")
        except Exception as e:
            print(f"  {period}: ERROR — {e}", file=sys.stderr)
        time.sleep(0.5)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    print(f"\nSaved {len(results)} records → {OUT_PATH}")

    # News-feed badge for the latest month — additive, never fails the scraper.
    try:
        latest_period = max(results)
        _emit_news(latest_period, results)
    except Exception as e:  # noqa: BLE001
        print(f"[kaffeesteuer-news] FAILED: {e!r} — JSON already written")


if __name__ == "__main__":
    main()
