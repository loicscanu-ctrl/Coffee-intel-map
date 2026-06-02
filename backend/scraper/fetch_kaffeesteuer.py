"""
fetch_kaffeesteuer.py
Auto-discovers the monthly "Kassenmäßige Steuereinnahmen nach Steuerarten und
Gebietskörperschaften" workbooks from bundesfinanzministerium.de and extracts
the Kaffeesteuer value for the reported month.

Why XLSX instead of PDF
-----------------------
BMF publishes the monthly tax-revenue table as an Excel workbook linked from:

    https://www.bundesfinanzministerium.de/Content/DE/Standardartikel/Themen/
    Steuern/Steuerschaetzungen_und_Steuereinnahmen/
    1-kassenmaessige-steuereinnahmen-nach-steuerarten-und-gebietskoerperschaften.html

The xlsx links on that page look like (note BMF's own "xlxs" typo in the
filename) — the German month + 4-digit year always vary, the rest is stable:

    .../2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx?__blob=publicationFile&v=2
    .../2026-04-21-steuereinnahmen-maerz-2026-xlxs.xlsx?__blob=publicationFile&v=2
    .../2026-03-20-steuereinnahmen-februar-2026-xlxs.xlsx?__blob=publicationFile&v=2

The leading YYYY-MM-DD is the *publication* date (~20th-23rd of the following
month) and is not predictable, so we still discover the links by scraping the
landing page rather than hard-coding URLs. Inside the workbook we find the
"Kaffeesteuer" row and take the current-month figure (Tsd. EUR), which is what
the existing series stores.

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
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from openpyxl import load_workbook

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://www.bundesfinanzministerium.de"

# Primary source: the dedicated landing page for table 1 (the one that carries
# the monthly xlsx links). The older candidates are kept as fallbacks in case
# BMF reshuffles its URL tree again — _parse_links matches xlsx/pdf hrefs on
# ANY of them, first page that yields links wins.
INDEX_URL_CANDIDATES = [
    # Current canonical page (verbatim from the task) — lists the monthly xlsx.
    "https://www.bundesfinanzministerium.de/Content/DE/Standardartikel/Themen/"
    "Steuern/Steuerschaetzungen_und_Steuereinnahmen/"
    "1-kassenmaessige-steuereinnahmen-nach-steuerarten-und-"
    "gebietskoerperschaften.html",
    # Parent topic page — usually survives subtree reorgs.
    "https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/"
    "Steuerschaetzungen_und_Steuereinnahmen/Steuerschaetzungen_und_Steuereinnahmen.html",
    # Older paths kept first-class so we auto-recover if BMF restores them.
    "https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/"
    "Steuerschaetzungen_und_Steuereinnahmen/Steuereinnahmen/steuereinnahmen.html",
    "https://www.bundesfinanzministerium.de/Web/DE/Service/Publikationen/"
    "Monatsberichte/Monatsberichte.html",
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

GERMAN_MONTHS = {
    "januar": "01", "februar": "02", "maerz": "03", "märz": "03", "april": "04",
    "mai": "05", "juni": "06", "juli": "07", "august": "08",
    "september": "09", "oktober": "10", "november": "11", "dezember": "12",
}

# Matches xlsx links like: 2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx
# The "-xlxs"/"-xlsx" suffix is optional so we also tolerate a plain
# steuereinnahmen-april-2026.xlsx should BMF ever fix the filename.
XLSX_RE = re.compile(
    r"steuereinnahmen-([a-zä]+)-(\d{4})(?:-xl[a-z]{2})?\.xlsx",
    re.IGNORECASE,
)
# Legacy PDF fallback — only used for a period if no xlsx link is available.
PDF_RE = re.compile(r"steuereinnahmen-([a-zä]+)-(\d{4})\.pdf", re.IGNORECASE)

# Plausible monthly Kaffeesteuer revenue (Tsd. EUR). Historically 60k–121k;
# guard band catches a stray header/year/forecast cell landing in the row.
MIN_TSD, MAX_TSD = 5_000, 400_000


def _period_from(month_de: str, year: str) -> str | None:
    month_num = GERMAN_MONTHS.get(month_de.lower())
    return f"{year}-{month_num}" if month_num else None


def _abs_url(href: str) -> str:
    """Absolutise a BMF href, preserving the ?__blob=publicationFile query
    string — without it BMF serves an HTML wrapper instead of the file."""
    return BASE + href if href.startswith("/") else href


def _parse_links(html: str) -> dict[str, dict[str, str]]:
    """Extract {period: {"xlsx": url, "pdf": url}} from any BMF page HTML.
    period is YYYY-MM. A format key is present only if a link was found."""
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
        # First link of each kind per period wins (the page lists newest first).
        found.setdefault(period, {}).setdefault(kind, _abs_url(href))
    return found


def discover_links(session: requests.Session) -> dict[str, dict[str, str]]:
    """Walk the candidate index URLs and merge {period: {kind: url}} for every
    monthly Steuereinnahmen file we can find. Errors on individual candidates
    are logged but never abort the run."""
    aggregated: dict[str, dict[str, str]] = {}
    for url in INDEX_URL_CANDIDATES:
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"  [candidate] {url} → {e}", file=sys.stderr)
            continue
        found = _parse_links(resp.text)
        n_xlsx = sum("xlsx" in v for v in found.values())
        print(f"  [candidate] {url} → {len(found)} periods ({n_xlsx} with xlsx)")
        for period, links in found.items():
            slot = aggregated.setdefault(period, {})
            for kind, link in links.items():
                slot.setdefault(kind, link)
        if sum("xlsx" in v for v in aggregated.values()) >= 24:
            break  # two years of xlsx is plenty
    if not aggregated:
        raise RuntimeError(
            "No Steuereinnahmen links found on any candidate URL. BMF likely "
            "reorganised the page tree again — investigate "
            f"{INDEX_URL_CANDIDATES[0]} and update INDEX_URL_CANDIDATES."
        )
    return aggregated


def _to_number(cell) -> float | None:
    """Coerce an Excel cell to a float, accepting German-formatted strings
    ('74.721', '74.721,0'). Returns None for blanks/placeholders ('-', '.')."""
    if isinstance(cell, (int, float)):
        return float(cell)
    if isinstance(cell, str):
        s = cell.strip()
        if not s or s in {"-", ".", "–", "—", "x", "X"}:
            return None
        # German grouping: '.' = thousands, ',' = decimal.
        s = s.replace(".", "").replace(",", ".")
        try:
            return float(re.sub(r"[^\d.\-]", "", s) or "x")
        except ValueError:
            return None
    return None


def _normalise_tsd(v: float) -> int:
    """Normalise a raw cell value to thousands of EUR regardless of whether the
    workbook stored it in Tsd EUR (74721), Mio EUR (74.721) or EUR (74721000)."""
    v = abs(v)
    if v < 1_000:            # given in Mio EUR with decimals → to Tsd
        v *= 1_000
    elif v >= 5_000_000:     # given in plain EUR → to Tsd
        v /= 1_000
    return int(round(v))


def extract_kaffeesteuer_xlsx(xlsx_bytes: bytes) -> int | None:
    """Find the 'Kaffeesteuer' row in the workbook and return the current-month
    revenue (Tsd. EUR) — the first numeric cell on that row that falls in the
    plausible monthly range. Searches every sheet; first plausible match wins."""
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


def fetch_value(session: requests.Session, links: dict[str, str]) -> int | None:
    """Download and parse a period, preferring the xlsx over the legacy pdf."""
    for kind, extract in (("xlsx", extract_kaffeesteuer_xlsx),
                          ("pdf", extract_kaffeesteuer_pdf)):
        url = links.get(kind)
        if not url:
            continue
        try:
            r = session.get(url, timeout=60)
            r.raise_for_status()
            val = extract(r.content)
            if val:
                return val
            print(f"    {kind}: Kaffeesteuer not found in file", file=sys.stderr)
        except Exception as e:
            print(f"    {kind}: ERROR — {e}", file=sys.stderr)
    return None


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

    print(f"Probing {len(INDEX_URL_CANDIDATES)} candidate BMF index URLs…")
    try:
        discovered = discover_links(session)
    except Exception as e:
        print(f"ERROR fetching index page: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"Discovered {len(discovered)} periods across candidate index pages")

    new_periods = {p: l for p, l in discovered.items() if p not in existing}
    if not new_periods:
        print("No new months found — JSON is up to date.")
        return

    print(f"New months to fetch: {sorted(new_periods)}")
    results = dict(existing)

    for period in sorted(new_periods):
        val = fetch_value(session, new_periods[period])
        if val:
            results[period] = val
            print(f"  {period}: {val}")
        else:
            print(f"  {period}: NOT FOUND")
        time.sleep(0.5)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"\nSaved {len(results)} records → {OUT_PATH}")


if __name__ == "__main__":
    main()
