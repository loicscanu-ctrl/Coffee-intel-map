"""diag_arabica.py — one-off probe of the ICE arabica daily cert-stock .xls.

Dumps, for the last several business days, the raw sheet rows so we can see
the exact text of the "As of:" header and the "TODAY'S GRADING SUMMARY"
section (passed/failed bags). The parser misses grading when those labels
change wording, so this reveals the live format.

Run via .github/workflows/diag-arabica.yml (workflow_dispatch); read the log.
"""
from __future__ import annotations

import io
import sys
from datetime import date, timedelta

import requests
import xlrd

sys.path.insert(0, "backend")
from scraper.sources.ice_certified_stocks import fetch as F  # noqa: E402


def biz_days_back(n: int) -> list[date]:
    out, d = [], date.today()
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


def dump(d: date) -> None:
    url = F.ARABICA_DAILY_XLS.format(yyyymmdd=F.yyyymmdd(d))
    try:
        r = requests.get(url, headers=F.HEADERS, timeout=30, allow_redirects=True)
    except Exception as e:  # noqa: BLE001
        print(f"  {d}: GET error {e}")
        return
    print(f"\n===== {d}  HTTP {r.status_code}  {len(r.content)} bytes  {url}")
    if r.status_code != 200 or r.content[:4] not in (b"\xd0\xcf\x11\xe0", b"PK\x03\x04"):
        print(f"  not an OLE2/xlsx body (head={r.content[:8]!r})")
        return
    try:
        sheet = xlrd.open_workbook(file_contents=r.content).sheet_by_index(0)
    except Exception as e:  # noqa: BLE001
        print(f"  xlrd open error {e}")
        return
    print(f"  rows={sheet.nrows} cols={sheet.ncols}")
    # Rows of interest: header (first 5) + anything mentioning the keywords.
    kw = ("as of", "grading", "passed", "failed", "graded", "rebagging", "pending", "certified")
    for rr in range(sheet.nrows):
        cells = [str(sheet.cell_value(rr, c)).strip() for c in range(min(sheet.ncols, 12))]
        joined = " | ".join(c for c in cells if c)
        low = joined.lower()
        if rr < 5 or any(k in low for k in kw):
            print(f"   r{rr:>3}: {joined[:200]}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    for d in biz_days_back(6):
        dump(d)


if __name__ == "__main__":
    main()
