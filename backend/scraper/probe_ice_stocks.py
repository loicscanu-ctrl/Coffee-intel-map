#!/usr/bin/env python3
"""probe_ice_stocks.py — egress probe + structure preview for ICE certified-stock reports.

DIAGNOSTIC ONLY. No DB, no writes to frontend/public/data. Two phases:

  Phase 1 (egress): GET each candidate URL with a bare (data-center) UA and a
  spoofed browser UA; print status / content-type / size / block-vs-data verdict.

  Phase 2 (structure): for any URL that returns 200 HTML, print enough of the
  page's shape — <title>, every <table>'s row count + sample cells, text lines
  that carry both a keyword (certified/bags/lots/grade/total/region…) and a
  number, and report-like <a href> links — to design a parser FROM THE LOGS
  alone (we can't download the artifact or reach ICE from the dev sandbox). The
  link dump is also how we hunt the correct robusta report URL (the guessed PDF
  404'd).

Run:  python backend/scraper/probe_ice_stocks.py
Saves 200 bodies under debug/ice_probe/ (gitignored; uploaded as `ice-probe`).
Always exits 0 — a red run would hide the logs we want.
"""
from __future__ import annotations

import json as _json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
DEBUG_DIR = ROOT / "debug" / "ice_probe"

# Direct file URLs (publicdocs paths). The user confirmed these bypass the
# Report Center captcha when hit directly; the captcha only gates the catalog
# /report/{id} pages. Dates / suffixes are hardcoded to known-good samples for
# this probe — the real scraper will compute or enumerate them dynamically.
#
# Suffix patterns to figure out at scraper time:
#   - Stock_Report_RC_YYYYMMDD_HHMMSS.csv   ← HHMMSS = publish time
#   - gradrc_YYMMDD-N.txt / apprc_YYMMDD-N.txt  ← -N = sequence #
CANDIDATES: list[tuple[str, str]] = [
    # Arabica — ICE Futures US (single combined daily file)
    ("arabica_daily_xls",
     "https://www.ice.com/publicdocs/futures_us_reports/coffee/coffee_cert_stock_20260527.xls"),
    # Robusta — ICE Futures Europe (split across 9 sources)
    ("robusta_stock_report_csv",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/stock_reports/Stock_Report_RC_20260527_103021.csv"),
    ("robusta_age_allowance_xlsx",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/aged_allowance_stock_report/Robusta_Coffee_Age_Allowance_20260430.xlsx"),
    ("robusta_grading_overview_pdf",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/grading_overview/GradingOverviewCoffee_260521.pdf"),
    ("robusta_gradings_txt",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/gradings/gradrc_260521-1.txt"),
    ("robusta_iss_recv_daily_txt",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/daily_issuers_receivers/irrrc_260522.txt"),
    ("robusta_iss_recv_monthly_txt",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/monthly_issuers_receivers/irrrc_m260331.txt"),
    ("robusta_grading_appeals_txt",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/grading_appeals/apprc_250923-1.txt"),
    ("robusta_tenders_txt",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/tenders/tendrc_260522.txt"),
    ("robusta_infested_warrant_pdf",
     "https://www.ice.com/marketdata/publicdocs/liffe/coffee/infested_warrant_report/INFESTEDCOFFEEWARRANT_251215.pdf"),
]

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.theice.com/",
}

BLOCK_MARKERS = (
    "access denied", "akamai", "reference&#32;#", "reference #",
    "you don't have permission", "request blocked", "errors.edgesuite.net",
)
KEYWORDS = ("certified", "grade", "bags", "lots", "total", "decrease", "increase",
            "region", "port", "tonnes", "metric", "arabica", "robusta", "warehouse")
LINK_TOKENS = ("coffee", "robusta", "arabica", "certified", "stock", "grading",
               "reports/", ".pdf", ".csv", ".shtml", "publicdocs")


def _classify(status: int, ctype: str, head: str, raw: bytes) -> str:
    low = head.lower()
    if any(m in low for m in BLOCK_MARKERS):
        return "BLOCKED (edge denial body)"
    if status == 403:
        return "BLOCKED (403)"
    if status != 200:
        return f"HTTP {status}"
    # Binary magic-byte sniffing — content-type from theice.com is often generic.
    if raw[:4] == b"%PDF" or "application/pdf" in ctype:
        return "PDF"
    if raw[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "Excel .xls (OLE2 binary)"
    if raw[:4] == b"PK\x03\x04":
        # .xlsx is a zip; could also be other zip — refine by content-type or
        # filename hint, but for our ICE candidates xlsx is the expected case.
        return "Excel .xlsx (zipped XML)"
    if "json" in ctype:
        return "JSON"
    if "csv" in ctype:
        return "CSV"
    if "<html" in low:
        return "HTML page"
    if "text" in ctype or all(32 <= b < 127 or b in (9, 10, 13) for b in raw[:256]):
        return "plain text"
    return "unknown (binary)"


_EXT_BY_VERDICT = {
    "PDF": "pdf",
    "Excel .xls (OLE2 binary)": "xls",
    "Excel .xlsx (zipped XML)": "xlsx",
    "JSON": "json",
    "CSV": "csv",
    "plain text": "txt",
    "HTML page": "html",
}


def _preview_html(name: str, html: str) -> None:
    try:
        from bs4 import BeautifulSoup
    except Exception as e:  # noqa: BLE001
        print(f"    (preview skipped — bs4 unavailable: {e})")
        return
    soup = BeautifulSoup(html, "html.parser")
    print(f"  ── structure preview: {name} ──")
    if soup.title:
        print(f"    <title>: {soup.title.get_text(strip=True)[:140]}")

    tables = soup.find_all("table")
    print(f"    <table> count: {len(tables)}")
    for ti, t in enumerate(tables[:10]):
        rows = t.find_all("tr")
        print(f"    table[{ti}] — {len(rows)} rows:")
        for r in rows[:4]:
            cells = [c.get_text(" ", strip=True) for c in r.find_all(["td", "th"])]
            if cells:
                print(f"        {' | '.join(cells[:10])[:180]}")

    print("    data-bearing text lines (keyword + a digit):")
    seen = 0
    for raw_line in soup.get_text("\n").splitlines():
        line = " ".join(raw_line.split())
        if line and any(k in line.lower() for k in KEYWORDS) and any(c.isdigit() for c in line):
            print(f"      • {line[:180]}")
            seen += 1
            if seen >= 30:
                print("      …(truncated)")
                break

    print("    report-like links:")
    shown = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        low = href.lower()
        if any(tok in low for tok in LINK_TOKENS) and href not in shown:
            shown.add(href)
            print(f"      → {href[:160]}")
            if len(shown) >= 40:
                print("      …(truncated)")
                break


def _preview_data(name: str, r: requests.Response) -> None:
    """Content-aware preview of a candidate DATA endpoint (JSON / CSV / HTML / PDF)."""
    ctype = r.headers.get("Content-Type", "")
    raw = r.content or b""
    text = r.text or ""
    low = ctype.lower()
    print(f"  ── data preview: {name} (HTTP {r.status_code}, {len(raw):,} B, {ctype}) ──")
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    stripped = text.lstrip()
    if "json" in low or stripped[:1] in "{[":
        try:
            obj = r.json()
            (DEBUG_DIR / f"{name}.json").write_bytes(raw)
            if isinstance(obj, dict):
                print(f"    JSON object — keys: {list(obj.keys())[:25]}")
            elif isinstance(obj, list):
                print(f"    JSON array — len={len(obj)}; first: {_json.dumps(obj[0])[:400] if obj else '∅'}")
            print(f"    head: {_json.dumps(obj)[:1800]}")
            return
        except Exception:  # noqa: BLE001
            pass
    if "csv" in low or "text/plain" in low or ("," in stripped[:200] and "<html" not in stripped[:200].lower()):
        (DEBUG_DIR / f"{name}.csv").write_bytes(raw)
        lines = [ln for ln in text.splitlines() if ln.strip()][:25]
        print("    first non-empty lines:")
        for ln in lines:
            print(f"      {ln[:200]}")
        return
    if raw[:4] == b"%PDF" or "pdf" in low:
        (DEBUG_DIR / f"{name}.pdf").write_bytes(raw)
        print("    PDF (saved) — would parse with pdfplumber.")
        return
    _preview_html(name, text)


def _probe_extra_url(url: str) -> None:
    """Test a user-supplied candidate data URL (captured from the DevTools Network tab),
    mimicking the page's XHR (browser UA + XHR header + Referer)."""
    print(f"\n=== USER-SUPPLIED DATA URL ===\n• {url}")
    headers = {
        **BROWSER_HEADERS,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/csv, text/plain, */*",
        "Referer": "https://www.theice.com/marketdata/reports/coffee/CertifiedStocks.shtml",
    }
    try:
        r = requests.get(url, headers=headers, timeout=25, allow_redirects=True)
        print(f"    HTTP {r.status_code} | {len(r.content or b''):,} B | {r.headers.get('Content-Type','')}")
        if r.status_code == 200 and r.content:
            _preview_data("user_data_url", r)
        else:
            head = (r.content or b"")[:500].decode("utf-8", "ignore")
            print(f"    non-200 / empty. body head: {head[:300]!r}")
    except requests.exceptions.RequestException as e:
        print(f"    ERROR: {type(e).__name__}: {str(e)[:120]}")


def _attempt(name: str, url: str, headers: dict, tag: str) -> tuple[int | None, str, str]:
    label = f"{name} [{tag}]"
    try:
        r = requests.get(url, headers=headers, timeout=25, allow_redirects=True)
        ctype = r.headers.get("Content-Type", "")
        raw = r.content or b""
        head = raw[:4096].decode("utf-8", "ignore")
        verdict = _classify(r.status_code, ctype, head, raw)
        print(f"    {label:24} HTTP {r.status_code:>3} | {len(raw):>10,} B | {ctype[:34]:34} | {verdict}")
        if r.status_code == 200 and raw:
            DEBUG_DIR.mkdir(parents=True, exist_ok=True)
            ext = _EXT_BY_VERDICT.get(verdict, "bin")
            (DEBUG_DIR / f"{name}__{tag}.{ext}").write_bytes(raw)
            # Inline preview for text-like bodies (CSV + plain .txt) so we can
            # read the structure straight from the CI logs without downloading
            # the artifact. Binary formats (.xls/.xlsx/.pdf) stay artifact-only.
            if verdict in ("plain text", "CSV") and tag == "browser":
                lines = [ln for ln in raw.decode("utf-8", "ignore").splitlines() if ln.strip()][:30]
                print(f"      first non-empty lines ({verdict}):")
                for ln in lines:
                    print(f"        {ln[:200]}")
        return r.status_code, verdict, (r.text if r.status_code == 200 else "")
    except requests.exceptions.RequestException as e:
        print(f"    {label:24} ERROR: {type(e).__name__}: {str(e)[:90]}")
        return None, "ERROR", ""


def main() -> None:
    print("=== ICE certified-stocks probe: egress + structure (diagnostic) ===\n")
    for name, url in CANDIDATES:
        print(f"• {url}")
        _attempt(name, url, {}, "bare")
        status, verdict, html = _attempt(name, url, BROWSER_HEADERS, "browser")
        if status == 200 and "HTML" in verdict and html:
            _preview_html(name, html)
        print()

    extra = (os.environ.get("ICE_DATA_URL") or "").strip()
    if extra:
        _probe_extra_url(extra)

    print("\n=== done — saved bodies in", DEBUG_DIR, "(artifact `ice-probe`) ===")
    sys.exit(0)


if __name__ == "__main__":
    main()
