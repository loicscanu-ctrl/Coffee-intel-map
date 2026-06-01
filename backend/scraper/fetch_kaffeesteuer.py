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
# BMF periodically reshuffles their URL tree (the original
# /Steuereinnahmen/steuereinnahmen.html path 404'd as of 2026-06-01). The
# scraper just needs ANY page that links the monthly steuereinnahmen-*.pdf
# files — the PDF_RE pattern matches in any HTML — so we try a list of known
# candidate landing pages in order. First 200 wins.
INDEX_URL_CANDIDATES = [
    # Parent topic page — usually survives subtree reorgs.
    "https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/"
    "Steuerschaetzungen_und_Steuereinnahmen/Steuerschaetzungen_und_Steuereinnahmen.html",
    # Original — kept first-class so we automatically recover if BMF restores it.
    "https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/"
    "Steuerschaetzungen_und_Steuereinnahmen/Steuereinnahmen/steuereinnahmen.html",
    # Alternate path seen in past BMF redesigns.
    "https://www.bundesfinanzministerium.de/Web/DE/Themen/Steuern/"
    "Steuerschaetzungen_und_Steuereinnahmen/Steuereinnahmen/"
    "Monatliche-Steuereinnahmen/monatliche-steuereinnahmen.html",
    # Monthly bulletin index — lists every monthly publication including the
    # Steuereinnahmen PDFs. Last-resort because it's bigger and slower to parse.
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
    "januar": "01", "februar": "02", "maerz": "03", "april": "04",
    "mai": "05", "juni": "06", "juli": "07", "august": "08",
    "september": "09", "oktober": "10", "november": "11", "dezember": "12",
}

# Matches filenames like: 2026-03-20-steuereinnahmen-februar-2026.pdf
PDF_RE = re.compile(r"steuereinnahmen-([a-z]+)-(\d{4})\.pdf", re.IGNORECASE)


def _parse_pdf_links(html: str) -> dict[str, str]:
    """Extract {period: pdf_url} from any BMF page HTML. Period is YYYY-MM."""
    soup = BeautifulSoup(html, "html.parser")
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
        if period not in found:
            found[period] = url
    return found


def discover_pdf_urls(session: requests.Session) -> dict[str, str]:
    """Walk the candidate index URLs and return {period: url} for any monthly
    Steuereinnahmen PDFs we can find. Each candidate is tried independently;
    we accept the first that returns a page containing PDF links — and merge
    in results from later candidates only if the first returned nothing.
    Errors on individual candidates are logged but don't abort the run."""
    aggregated: dict[str, str] = {}
    for url in INDEX_URL_CANDIDATES:
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"  [candidate] {url} → {e}", file=sys.stderr)
            continue
        found = _parse_pdf_links(resp.text)
        print(f"  [candidate] {url} → {len(found)} PDF links")
        if found and not aggregated:
            # First successful candidate carries the canonical list. We still
            # merge later candidates (in case BMF splits the listing across
            # pages), but only adding periods not already discovered so the
            # earlier candidate's URL wins on duplicates.
            aggregated = dict(found)
        else:
            for period, pdf_url in found.items():
                aggregated.setdefault(period, pdf_url)
        if len(aggregated) >= 24:
            # Two years of monthly data is plenty — we don't need to keep
            # walking older candidates.
            break
    if not aggregated:
        raise RuntimeError(
            "No PDF links found on any candidate URL. BMF likely reorganised "
            "the page tree again — investigate "
            f"{INDEX_URL_CANDIDATES[0]} and update INDEX_URL_CANDIDATES."
        )
    return aggregated


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


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Load existing data
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

    # Discover all available PDFs by walking candidate index URLs.
    print(f"Probing {len(INDEX_URL_CANDIDATES)} candidate BMF index URLs…")
    try:
        discovered = discover_pdf_urls(session)
    except Exception as e:
        print(f"ERROR fetching index page: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"Discovered {len(discovered)} PDFs across candidate index pages")

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


if __name__ == "__main__":
    main()
