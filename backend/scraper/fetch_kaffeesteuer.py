"""
fetch_kaffeesteuer.py
Downloads the monthly "Kassenmäßige Steuereinnahmen nach Steuerarten und
Gebietskörperschaften" workbook from bundesfinanzministerium.de and extracts
the Kaffeesteuer value for the reported month.

How we locate the file
----------------------
BMF publishes the monthly tax-revenue table as an Excel workbook whose URL is
fully deterministic except for the leading publication date (and a version
number). The filenames look like (note BMF's own "xlxs" typo):

    .../2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx?__blob=publicationFile&v=2
    .../2026-04-21-steuereinnahmen-maerz-2026-xlxs.xlsx?__blob=publicationFile&v=2
    .../2026-03-20-steuereinnahmen-februar-2026-xlxs.xlsx?__blob=publicationFile&v=2

The German month name + 4-digit data year are derivable from the period, and
the report for month M is published ~20th-21st of month M+1. The *only* thing
we can't compute is the exact publication day and the version, so we go STRAIGHT
to the file by probing a small window of plausible publication dates × versions
against the stable URL path and take the first one that returns a real file.
At each candidate date we try the xlsx first, then the pdf at the same date
(BMF ships both, e.g. .../2026-05-21-steuereinnahmen-april-2026.pdf), so a
pdf-only month still resolves. Scraping a listing page is no longer required —
BMF's index pages return 404 / no links to bots — but we keep it as a
best-effort, self-healing fallback.

Inside the workbook we find the "Kaffeesteuer" row and take the current-month
figure (Tsd. EUR), which is what the existing series stores.

Output: incrementally updates frontend/public/data/kaffeesteuer.json
        ({ "YYYY-MM": <Tsd EUR int>, ... }).

Usage:
    cd backend
    python -m scraper.fetch_kaffeesteuer
"""
import io
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from openpyxl import load_workbook

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://www.bundesfinanzministerium.de"

# Stable path that all monthly Steuereinnahmen files live under. Only the
# leading "YYYY-MM-DD-" publication-date prefix and the "?v=N" version vary.
CONTENT_BASE = (
    BASE + "/Content/DE/Standardartikel/Themen/Steuern/"
    "Steuerschaetzungen_und_Steuereinnahmen/"
)

# Best-effort HTML fallback: pages that have historically linked the monthly
# files. BMF tends to serve these without the links to bots, so the direct
# probe below is the real workhorse — these only help us auto-recover if BMF
# ever exposes a clean listing again.
INDEX_URL_CANDIDATES = [
    CONTENT_BASE + "1-kassenmaessige-steuereinnahmen-nach-steuerarten-und-"
    "gebietskoerperschaften.html",
    BASE + "/Web/DE/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/"
    "Steuerschaetzungen_und_Steuereinnahmen.html",
    BASE + "/Web/DE/Themen/Steuern/Steuerschaetzungen_und_Steuereinnahmen/"
    "Steuereinnahmen/steuereinnahmen.html",
]

ROOT     = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "kaffeesteuer.json"

# Realistic browser UA — the generic "Mozilla/5.0" string was getting flagged
# by BMF's bot-protection layer (added in their 2025 redesign).
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# German month names exactly as they appear in BMF filenames (ASCII "maerz").
GERMAN_MONTH_NAMES = {
    1: "januar", 2: "februar", 3: "maerz", 4: "april", 5: "mai", 6: "juni",
    7: "juli", 8: "august", 9: "september", 10: "oktober", 11: "november",
    12: "dezember",
}
GERMAN_MONTHS = {  # reverse map, incl. the "märz" umlaut spelling, for HTML hrefs
    **{name: f"{num:02d}" for num, name in GERMAN_MONTH_NAMES.items()},
    "märz": "03",
}

# Publication-day window (report for month M lands ~20th-21st of M+1) and version
# numbers, ordered most-likely-first so a real file is found within a few hits.
PUB_DAYS     = [21, 20, 22, 19, 23, 18, 24, 25, 17, 26, 16, 27, 15, 14]
PUB_VERSIONS = [2, 1, 3]

# Matches xlsx hrefs in HTML, e.g. 2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx
XLSX_RE = re.compile(
    r"steuereinnahmen-([a-zä]+)-(\d{4})(?:-xl[a-z]{2})?\.xlsx", re.IGNORECASE
)
PDF_RE = re.compile(r"steuereinnahmen-([a-zä]+)-(\d{4})\.pdf", re.IGNORECASE)

# Plausible monthly Kaffeesteuer revenue (Tsd. EUR). Historically 60k–121k;
# guard band catches a stray header/year/forecast cell landing in the row.
MIN_TSD, MAX_TSD = 5_000, 400_000


# ── helpers ───────────────────────────────────────────────────────────────────

def _period_from(month_de: str, year: str) -> str | None:
    month_num = GERMAN_MONTHS.get(month_de.lower())
    return f"{year}-{month_num}" if month_num else None


def _abs_url(href: str) -> str:
    """Absolutise a BMF href, preserving the ?__blob=publicationFile query
    string — without it BMF serves an HTML wrapper instead of the file."""
    return BASE + href if href.startswith("/") else href


def _direct_candidates(period: str):
    """Yield (kind, url) for plausible direct file URLs for a data-month
    'YYYY-MM', most-likely-first. The report is published ~20th-21st of the
    FOLLOWING month; the filename embeds that publication date, which we probe.
    xlsx and pdf share the same publication date, so we try both at each date
    (xlsx first) — that finds a pdf-only month without rescanning every date.

    Verified against BMF's real URLs, e.g. period 2026-04 yields
    .../2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx?__blob=publicationFile&v=2
    .../2026-05-21-steuereinnahmen-april-2026.pdf?__blob=publicationFile&v=2"""
    year, month = (int(x) for x in period.split("-"))
    de_name = GERMAN_MONTH_NAMES[month]
    pub_year  = year + (1 if month == 12 else 0)
    pub_month = 1 if month == 12 else month + 1
    for v in PUB_VERSIONS:
        for day in PUB_DAYS:
            stem = (
                f"{CONTENT_BASE}{pub_year}-{pub_month:02d}-{day:02d}-"
                f"steuereinnahmen-{de_name}-{year}"
            )
            q = f"?__blob=publicationFile&v={v}"
            yield "xlsx", f"{stem}-xlxs.xlsx{q}"
            yield "pdf",  f"{stem}.pdf{q}"


def _looks_like(kind: str, content: bytes) -> bool:
    """Validate by magic bytes; BMF 404s return short HTML/text.
    xlsx = zip archive ('PK'), pdf = '%PDF'."""
    if len(content) < 5_000:
        return False
    return content[:2] == b"PK" if kind == "xlsx" else content[:4] == b"%PDF"


# ── HTML fallback discovery ─────────────────────────────────────────────────

def _parse_links(html: str) -> dict[str, dict[str, str]]:
    """Extract {period: {"xlsx": url, "pdf": url}} from any BMF page HTML."""
    soup = BeautifulSoup(html, "html.parser")
    found: dict[str, dict[str, str]] = {}
    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        low = href.lower()
        if "steuereinnahmen" not in low:
            continue
        if ".xlsx" in low:
            m, kind = XLSX_RE.search(href), "xlsx"
        elif ".pdf" in low:
            m, kind = PDF_RE.search(href), "pdf"
        else:
            continue
        if not m:
            continue
        period = _period_from(m.group(1), m.group(2))
        if not period:
            continue
        found.setdefault(period, {}).setdefault(kind, _abs_url(href))
    return found


def discover_links(session: requests.Session) -> dict[str, dict[str, str]]:
    """Best-effort: merge {period: {kind: url}} from candidate index pages.
    Never raises — returns {} if BMF exposes nothing (the common case now)."""
    aggregated: dict[str, dict[str, str]] = {}
    for url in INDEX_URL_CANDIDATES:
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"  [html] {url} → {e}", file=sys.stderr)
            continue
        found = _parse_links(resp.text)
        print(f"  [html] {url} → {len(found)} periods")
        for period, links in found.items():
            slot = aggregated.setdefault(period, {})
            for kind, link in links.items():
                slot.setdefault(kind, link)
    return aggregated


# ── workbook / pdf extraction ─────────────────────────────────────────────────

def _to_number(cell) -> float | None:
    """Coerce an Excel cell to a float, accepting German-formatted strings
    ('74.721', '74.721,0'). Returns None for blanks/placeholders ('-', '.')."""
    if isinstance(cell, (int, float)):
        return float(cell)
    if isinstance(cell, str):
        s = cell.strip()
        if not s or s in {"-", ".", "–", "—", "x", "X"}:
            return None
        s = s.replace(".", "").replace(",", ".")  # de grouping → float
        try:
            return float(re.sub(r"[^\d.\-]", "", s) or "x")
        except ValueError:
            return None
    return None


def _normalise_tsd(v: float) -> int:
    """Normalise a raw cell value to thousands of EUR regardless of whether the
    workbook stored it in Tsd EUR (74721), Mio EUR (74.721) or EUR (74721000)."""
    v = abs(v)
    if v < 1_000:            # Mio EUR with decimals → Tsd
        v *= 1_000
    elif v >= 5_000_000:     # plain EUR → Tsd
        v /= 1_000
    return int(round(v))


def extract_kaffeesteuer_xlsx(xlsx_bytes: bytes) -> int | None:
    """Find the 'Kaffeesteuer' row and return the current-month revenue
    (Tsd. EUR) — the first plausible numeric cell after the label."""
    wb = load_workbook(io.BytesIO(xlsx_bytes), data_only=True, read_only=True)
    try:
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                label_idx = next(
                    (i for i, c in enumerate(row)
                     if isinstance(c, str) and "kaffeesteuer" in c.lower()),
                    None,
                )
                if label_idx is None:
                    continue
                for cell in row[label_idx + 1:]:
                    num = _to_number(cell)
                    if num is None:
                        continue
                    val = _normalise_tsd(num)
                    if MIN_TSD <= val <= MAX_TSD:
                        return val
    finally:
        wb.close()
    return None


def extract_kaffeesteuer_pdf(pdf_bytes: bytes) -> int | None:
    """Legacy fallback: extract Kaffeesteuer from a Steuereinnahmen PDF."""
    import pdfplumber  # lazy — only needed when no xlsx is available
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.splitlines():
                if "Kaffeesteuer" in line:
                    nums = re.findall(r"\d+\.\d+", line)
                    if nums:
                        val = _normalise_tsd(int(nums[0].replace(".", "")))
                        if MIN_TSD <= val <= MAX_TSD:
                            return val
    return None


# ── fetch orchestration ─────────────────────────────────────────────────────

def fetch_period(session: requests.Session, period: str,
                 html_links: dict[str, str]) -> int | None:
    """Resolve one month's Kaffeesteuer value. Strategy:
       1. direct probe of xlsx/pdf URLs (primary — straight to the file);
       2. xlsx link discovered from HTML, if any;
       3. legacy pdf link discovered from HTML, if any."""
    extractors = {"xlsx": extract_kaffeesteuer_xlsx, "pdf": extract_kaffeesteuer_pdf}

    # 1. Direct probe (xlsx and pdf at each candidate publication date).
    for kind, url in _direct_candidates(period):
        try:
            r = session.get(url, timeout=60)
        except requests.RequestException:
            continue
        if r.status_code == 200 and _looks_like(kind, r.content):
            val = extractors[kind](r.content)
            if val:
                print(f"    direct-{kind}: {url.split('/')[-1].split('?')[0]}")
                return val

    # 2./3. HTML-discovered links.
    for kind, extract in (("xlsx", extract_kaffeesteuer_xlsx),
                          ("pdf", extract_kaffeesteuer_pdf)):
        url = html_links.get(kind)
        if not url:
            continue
        try:
            r = session.get(url, timeout=60)
            r.raise_for_status()
            val = extract(r.content)
            if val:
                print(f"    html-{kind}: {url}")
                return val
        except Exception as e:
            print(f"    html-{kind}: ERROR — {e}", file=sys.stderr)
    return None


def _target_periods(existing: dict[str, int], today: date, lookback: int = 12) -> list[str]:
    """Months we should try to fetch: the `lookback` months ending with last
    month (the current month's report isn't published yet), minus what we
    already have. Oldest first."""
    periods: list[str] = []
    y, m = today.year, today.month
    for _ in range(lookback):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        p = f"{y}-{m:02d}"
        if p not in existing:
            periods.append(p)
    return sorted(periods)


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    existing: dict[str, int] = {}
    if OUT_PATH.exists():
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)
    print(f"Existing records: {len(existing)}")

    session = requests.Session()
    session.headers["User-Agent"] = BROWSER_UA
    session.headers["Accept-Language"] = "de-DE,de;q=0.9,en;q=0.5"
    session.headers["Accept"] = (
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    )

    targets = _target_periods(existing, date.today())
    if not targets:
        print("No recent months missing — JSON is up to date.")
        return
    print(f"Months to fetch: {targets}")

    # Best-effort HTML discovery (used only as a fallback per period).
    html = discover_links(session)

    results = dict(existing)
    added = 0
    for period in targets:
        val = fetch_period(session, period, html.get(period, {}))
        if val:
            results[period] = val
            added += 1
            print(f"  {period}: {val}")
        else:
            # Most likely the report for this month isn't published yet.
            print(f"  {period}: not found (probably not published yet)")
        time.sleep(0.5)

    if not added:
        print("No new values fetched — leaving JSON unchanged.")
        return

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"\nSaved {len(results)} records (+{added}) → {OUT_PATH}")


if __name__ == "__main__":
    main()
