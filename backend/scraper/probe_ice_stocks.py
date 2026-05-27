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

import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
DEBUG_DIR = ROOT / "debug" / "ice_probe"

CANDIDATES: list[tuple[str, str]] = [
    ("arabica_shtml", "https://www.theice.com/marketdata/reports/coffee/CertifiedStocks.shtml"),
    ("reports_142",   "https://www.theice.com/marketdata/reports/142"),
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
    if raw[:4] == b"%PDF" or "application/pdf" in ctype:
        return "PDF (likely data)"
    if "csv" in ctype or "text/plain" in ctype:
        return "CSV/plain (likely data)"
    if "json" in ctype:
        return "JSON (likely data)"
    if "<html" in low:
        return "HTML page"
    return "unknown"


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
            ext = "pdf" if raw[:4] == b"%PDF" else "html"
            (DEBUG_DIR / f"{name}__{tag}.{ext}").write_bytes(raw)
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
    print("=== done — saved bodies in", DEBUG_DIR, "(artifact `ice-probe`) ===")
    sys.exit(0)


if __name__ == "__main__":
    main()
