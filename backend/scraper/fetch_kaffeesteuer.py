"""
fetch_kaffeesteuer.py
Directly fetches the monthly Steuereinnahmen Excel (.xlsx) files from
bundesfinanzministerium.de by dynamically generating candidate URLs, then
extracts the Kaffeesteuer value. Incrementally updates
frontend/public/data/kaffeesteuer.json.

No HTML scraping, no PDF parsing — the file URL is deterministic except for the
publication date (which fluctuates ~15th-28th of the following month) and a
small version number, so we brute-force that narrow window and take the first
URL that returns a real workbook.

Usage:
    cd backend
    python -m scraper.fetch_kaffeesteuer
"""
import io
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import openpyxl
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT     = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "kaffeesteuer.json"

CONTENT_BASE = (
    "https://www.bundesfinanzministerium.de/Content/DE/Standardartikel/Themen/"
    "Steuern/Steuerschaetzungen_und_Steuereinnahmen/"
)

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

GERMAN_MONTHS_REV = {
    1: "januar", 2: "februar", 3: "maerz", 4: "april",
    5: "mai", 6: "juni", 7: "juli", 8: "august",
    9: "september", 10: "oktober", 11: "november", 12: "dezember",
}

# Publication day fluctuates but clusters on the 20th-21st of the following
# month — ordered best-first so a live file is found within a few requests.
PUB_DAYS = [21, 20, 22, 19, 23, 18, 24, 25, 17, 26, 16, 27, 15, 28]
# BMF re-uploads bump the version; observed files are v=2, occasionally v=1.
PUB_VERSIONS = [2, 1]

# Plausible monthly Kaffeesteuer revenue in Tsd. EUR (historically 60k-121k).
MIN_TSD, MAX_TSD = 5_000, 400_000


def generate_candidate_urls(target_year: int, target_month_num: int) -> list[str]:
    """
    Generate possible direct URLs for a given data month, most-likely-first.
    BMF publishes the data the following month and embeds the exact (variable)
    publication day in the URL.
    """
    pub_month = target_month_num + 1
    pub_year = target_year
    if pub_month > 12:
        pub_month = 1
        pub_year += 1

    month_name = GERMAN_MONTHS_REV[target_month_num]
    stem = f"steuereinnahmen-{month_name}-{target_year}"
    # BMF mistypes the extension as "-xlxs.xlsx"; also try the corrected
    # "-xlsx.xlsx" and the plain ".xlsx".
    filenames = [f"{stem}-xlxs.xlsx", f"{stem}-xlsx.xlsx", f"{stem}.xlsx"]

    urls: list[str] = []
    for day in PUB_DAYS:
        date_prefix = f"{pub_year}-{pub_month:02d}-{day:02d}"
        for fname in filenames:
            for v in PUB_VERSIONS:
                urls.append(
                    f"{CONTENT_BASE}{date_prefix}-{fname}"
                    f"?__blob=publicationFile&v={v}"
                )
    return urls


def _normalise_tsd(value: float) -> int:
    """Safety net: BMF reports in Tsd. EUR, but normalise in case a cell is
    stored in plain EUR (×1000) or Mio EUR (÷1000) so the series stays
    consistent. Leaves normal Tsd values (e.g. 74721) untouched."""
    v = abs(float(value))
    if v < 1_000:            # Mio EUR with decimals → Tsd
        v *= 1_000
    elif v >= 5_000_000:     # plain EUR → Tsd
        v /= 1_000
    return int(round(v))


def extract_kaffeesteuer_from_excel(excel_bytes: bytes) -> int | None:
    """Open the workbook in memory and return the Kaffeesteuer monthly value
    (Tsd. EUR). Scans EVERY sheet — the row isn't always on the active one —
    and takes the first plausible numeric cell to the right of the label
    (the "Ist-Monat" / current-month figure)."""
    wb = openpyxl.load_workbook(io.BytesIO(excel_bytes), data_only=True, read_only=True)
    try:
        for sheet in wb.worksheets:
            for row in sheet.iter_rows(values_only=True):
                for i, cell_val in enumerate(row):
                    if isinstance(cell_val, str) and "Kaffeesteuer" in cell_val:
                        for val in row[i + 1:]:
                            # bool is a subclass of int — exclude it.
                            if isinstance(val, (int, float)) and not isinstance(val, bool):
                                norm = _normalise_tsd(val)
                                if MIN_TSD <= norm <= MAX_TSD:
                                    return norm
    finally:
        wb.close()
    return None


def get_periods_to_check(existing_data: dict[str, int]) -> list[tuple[int, int]]:
    """Determine which months need to be fetched, up to the current date."""
    periods: list[tuple[int, int]] = []
    today = datetime.today()

    current_year = today.year - 1
    current_month = 1

    if existing_data:
        latest = max(existing_data.keys())  # format: 'YYYY-MM'
        current_year, current_month = map(int, latest.split("-"))
        current_month += 1
        if current_month > 12:
            current_month = 1
            current_year += 1

    while True:
        if current_year > today.year or (current_year == today.year and current_month > today.month):
            break
        period = f"{current_year}-{current_month:02d}"
        if period not in existing_data:
            periods.append((current_year, current_month))
        current_month += 1
        if current_month > 12:
            current_month = 1
            current_year += 1

    return periods


def _is_workbook(resp: requests.Response) -> bool:
    """Reject BMF soft-404 / WAF HTML pages: accept only a real xlsx, detected
    by content-type or the ZIP magic bytes ('PK')."""
    ctype = resp.headers.get("Content-Type", "").lower()
    if "spreadsheetml" in ctype or "octet-stream" in ctype:
        return True
    return len(resp.content) > 5_000 and resp.content[:2] == b"PK"


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    existing: dict[str, int] = {}
    if OUT_PATH.exists():
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)
    print(f"Existing records: {len(existing)}")

    session = requests.Session()
    session.headers["User-Agent"] = BROWSER_UA
    session.headers["Accept"] = "*/*"

    periods_to_check = get_periods_to_check(existing)
    if not periods_to_check:
        print("No new months to check — JSON is up to date.")
        return

    print(f"Checking {len(periods_to_check)} missing periods...")
    results = dict(existing)
    added = 0

    for year, month in periods_to_check:
        period_str = f"{year}-{month:02d}"
        print(f"\nSearching for {period_str}...")
        found = False

        for url in generate_candidate_urls(year, month):
            try:
                r = session.get(url, timeout=15)
                if r.status_code != 200 or not _is_workbook(r):
                    continue
                val = extract_kaffeesteuer_from_excel(r.content)
                if val is not None:
                    results[period_str] = val
                    added += 1
                    print(f"  [SUCCESS] {period_str}: {val} Tsd. EUR")
                    print(f"  Source: {url.split('?')[0]}")
                    found = True
                    break
            except requests.RequestException:
                pass
            time.sleep(0.2)  # polite delay between probes

        if not found:
            print(f"  [NOT FOUND] Exhausted candidates for {period_str} — "
                  "likely not published yet.")
            # Months are checked oldest-first; the first miss is the frontier,
            # so stop probing further (still-unpublished) months.
            break

    if not added:
        print("\nNo new values fetched — leaving JSON unchanged.")
        return

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"\nSaved {len(results)} total records (+{added}) → {OUT_PATH}")


if __name__ == "__main__":
    main()
