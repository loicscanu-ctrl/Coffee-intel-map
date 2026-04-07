"""
fetch_kaffeesteuer.py
Auto-discovers monthly Steuereinnahmen PDFs from bundesfinanzministerium.de
by scraping the ministry's listing page, then extracts the Kaffeesteuer value.
Incrementally updates frontend/public/data/kaffeesteuer.json.

Usage:
    cd backend
    python -m scraper.fetch_kaffeesteuer
"""
import sys, re, json, time, io
import requests
import pdfplumber
from pathlib import Path
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


if __name__ == "__main__":
    main()
