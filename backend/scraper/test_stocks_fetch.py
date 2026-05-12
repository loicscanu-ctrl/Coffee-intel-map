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

ICE_URL = "https://www.theice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls"
PSD_URL = "https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip"

OK   = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
DIM  = "\033[2m"
RST  = "\033[0m"


def hr(c="─"):
    print(c * 60)


# ── ICE ──────────────────────────────────────────────────────────────────────

def test_ice() -> bool:
    print(f"\n[ICE] {ICE_URL}")
    try:
        r = requests.get(ICE_URL, headers=HEADERS, timeout=30)
    except Exception as e:
        print(f"  {FAIL} network error: {e}")
        return False

    print(f"  status     : {r.status_code}")
    print(f"  bytes      : {len(r.content):,}")
    print(f"  Content-Type: {r.headers.get('Content-Type', '?')}")

    if r.status_code != 200:
        print(f"  {FAIL} non-200 — ICE likely blocked this IP. Body preview:")
        print(DIM + r.text[:200].replace("\n", " ") + RST)
        return False

    if len(r.content) < 1000:
        print(f"  {FAIL} response too small to be a valid Excel file")
        return False

    # Try to parse
    try:
        import pandas as pd
        df = pd.read_excel(io.BytesIO(r.content), header=None)
        print(f"  sheet shape: {df.shape[0]} rows × {df.shape[1]} cols")
    except Exception as e:
        print(f"  {FAIL} pandas read_excel failed: {e}")
        print(f"  (file may be HTML — first 200 chars: {r.content[:200]!r})")
        return False

    # Look for a Total row
    found_total = False
    found_port  = False
    for _, row in df.iterrows():
        cells = [c for c in row if c is not None]
        if not cells:
            continue
        label = str(cells[0]).strip().lower() if isinstance(cells[0], str) else ""
        if "total" in label:
            found_total = True
        if any(p in label for p in ("antwerp", "hamburg", "bremen", "trieste", "new orleans", "new york")):
            found_port = True

    if found_total and found_port:
        print(f"  {OK} parse looks valid — found Total row + at least one port row")
        return True
    print(f"  {FAIL} no Total + port rows recognised (parser tweak needed)")
    return False


# ── PSD Japan ────────────────────────────────────────────────────────────────

def test_psd() -> bool:
    print(f"\n[PSD Japan] {PSD_URL}")
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

    japan_rows = [ln for ln in lines if "japan" in ln.lower()]
    print(f"  Japan rows  : {len(japan_rows)}")

    if not japan_rows:
        print(f"  {FAIL} no Japan rows — CSV schema may have changed")
        print(f"  header     : {lines[0][:200] if lines else '(empty)'}")
        return False

    # Sample one row
    print(f"  {OK} sample Japan row:")
    print(DIM + "    " + japan_rows[0][:200] + RST)
    return True


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    hr("═")
    print(" Stocks-scraper connectivity check ".center(60))
    hr("═")

    ice_ok = test_ice()
    psd_ok = test_psd()

    hr("═")
    print(f"  ICE Arabica certified : {OK if ice_ok else FAIL}")
    print(f"  USDA PSD Japan        : {OK if psd_ok else FAIL}")
    hr("═")

    if not (ice_ok or psd_ok):
        print(
            "Both sources failed. If you got 403s, the issue is bot protection — "
            "the production scraper will retry via Playwright. If you got 200 but "
            "the parser rejected the content, the schema has drifted (paste the "
            "output and I'll adjust)."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
