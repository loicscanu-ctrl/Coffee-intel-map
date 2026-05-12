"""
test_stocks_fetch.py — quick smoke test for the new stocks scrapers.

Run from the backend/ directory:

    python -m scraper.test_stocks_fetch

It hits each upstream source with a 30 s timeout and prints, per source:
  1. HTTP status / error
  2. Bytes received
  3. Content-Type header
  4. Whether the parser extracted a usable value

Exits 0 if any source worked, non-zero only if every source failed.
No DB, no Playwright, no GitHub Actions — just enough to answer
"does the URL respond from my machine?"
"""
from __future__ import annotations

import io
import sys
import zipfile

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

PSD_URL = "https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip"

OK   = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
DIM  = "\033[2m"
RST  = "\033[0m"


def hr(c="─"):
    print(c * 60)


# ── USDA PSD ─────────────────────────────────────────────────────────────────

def test_psd() -> bool:
    print(f"\n[USDA PSD] {PSD_URL}")
    try:
        r = requests.get(PSD_URL, headers=HEADERS, timeout=60)
    except Exception as e:
        print(f"  {FAIL} network error: {e}")
        return False

    print(f"  status     : {r.status_code}")
    print(f"  bytes      : {len(r.content):,}")
    print(f"  Content-Type: {r.headers.get('Content-Type', '?')}")

    if r.status_code != 200 or len(r.content) < 1000:
        print(f"  {FAIL} bad response. Body preview:")
        print(DIM + r.text[:200].replace("\n", " ") + RST)
        return False

    # Extract the CSV
    try:
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            names = zf.namelist()
            print(f"  zip contents: {names}")
            csv_name = next((n for n in names if n.lower().endswith(".csv")), None)
            if not csv_name:
                print(f"  {FAIL} no CSV inside zip")
                return False
            csv_bytes = zf.read(csv_name)
    except Exception as e:
        print(f"  {FAIL} zip extraction failed: {e}")
        return False

    text = csv_bytes.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    print(f"  csv rows    : {len(lines):,}")

    japan_rows = [ln for ln in lines if ',"Japan",' in ln]
    eu_rows    = [ln for ln in lines if ',"European Union",' in ln]
    print(f"  Japan rows  : {len(japan_rows)}")
    print(f"  EU rows     : {len(eu_rows)}")

    if not japan_rows and not eu_rows:
        print(f"  {FAIL} no Japan or EU rows — CSV schema may have changed")
        print(f"  header     : {lines[0][:200] if lines else '(empty)'}")
        return False

    if japan_rows:
        print(f"  {OK} sample Japan row:")
        print(DIM + "    " + japan_rows[0][:200] + RST)
    if eu_rows:
        print(f"  {OK} sample EU row:")
        print(DIM + "    " + eu_rows[0][:200] + RST)
    return True


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    hr("═")
    print(" Stocks-scraper connectivity check ".center(60))
    hr("═")

    psd_ok = test_psd()

    hr("═")
    print(f"  USDA PSD coffee (EU + Japan) : {OK if psd_ok else FAIL}")
    hr("═")

    if not psd_ok:
        print(
            "USDA PSD failed. If 403, the IP is blocked — try from a different "
            "network. If 200 but parser rejected, the CSV schema has drifted."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
