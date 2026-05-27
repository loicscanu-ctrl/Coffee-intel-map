#!/usr/bin/env python3
"""probe_ice_stocks.py — egress / Akamai posture probe for ICE certified-stock reports.

DIAGNOSTIC ONLY. No DB, no parsing, no writes to frontend/public/data. It tries
each candidate ICE report URL twice — once with a bare (data-center) User-Agent
and once with a spoofed browser UA — and prints status / content-type / size /
a block-vs-data classification. The point is to learn, from a GitHub runner's
open egress, whether Akamai serves 200 OK or 403 Forbidden BEFORE we commit to
writing a parser or reshaping the CertifiedStock schema.

Run:
    python backend/scraper/probe_ice_stocks.py

Any 200 response body is saved under debug/ice_probe/ for offline inspection
(the workflow uploads that dir as the `ice-probe` artifact). debug/ is gitignored
and never committed. Always exits 0 — a red run would hide the very logs we want.
"""
from __future__ import annotations

import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
DEBUG_DIR = ROOT / "debug" / "ice_probe"

# Candidate report URLs to test Akamai's posture against (arabica + robusta).
CANDIDATES: list[tuple[str, str]] = [
    ("arabica_shtml", "https://www.theice.com/marketdata/reports/coffee/CertifiedStocks.shtml"),
    ("arabica_csv",   "https://www.theice.com/marketdata/reports/coffee/CertifiedStocks.shtml?export=csv"),
    ("reports_142",   "https://www.theice.com/marketdata/reports/142"),
    ("robusta_pdf",   "https://www.theice.com/publicdocs/clear_europe/ICE_Clear_Europe_Robusta_Coffee_Grading_Report.pdf"),
]

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.theice.com/",
}

# Substrings that mark an Akamai/edge denial page (a 200-with-block-body is the
# sneaky case — Akamai sometimes returns 200 carrying an "Access Denied" page).
BLOCK_MARKERS = (
    "access denied", "akamai", "reference&#32;#", "reference #",
    "you don't have permission", "request blocked", "errors.edgesuite.net",
)


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
        return "HTML page (inspect: data page or soft block)"
    return "unknown (inspect saved body)"


def _attempt(name: str, url: str, headers: dict, tag: str) -> tuple[int | None, str]:
    label = f"{name} [{tag}]"
    try:
        r = requests.get(url, headers=headers, timeout=25, allow_redirects=True)
        ctype = r.headers.get("Content-Type", "")
        raw = r.content or b""
        head = raw[:4096].decode("utf-8", "ignore")
        verdict = _classify(r.status_code, ctype, head, raw)
        print(f"    {label:22} HTTP {r.status_code:>3} | {len(raw):>10,} B | "
              f"{ctype[:38]:38} | {verdict}")
        if r.status_code == 200 and raw:
            DEBUG_DIR.mkdir(parents=True, exist_ok=True)
            ext = "pdf" if raw[:4] == b"%PDF" else ("csv" if "csv" in verdict.lower() else "html")
            (DEBUG_DIR / f"{name}__{tag}.{ext}").write_bytes(raw)
        return r.status_code, verdict
    except requests.exceptions.RequestException as e:
        print(f"    {label:22} ERROR: {type(e).__name__}: {str(e)[:90]}")
        return None, "ERROR"


def main() -> None:
    print("=== ICE certified-stocks egress probe (diagnostic) ===")
    print(f"Testing {len(CANDIDATES)} URLs, each bare (default UA) + browser-spoofed UA.\n")
    reachable: list[str] = []
    for name, url in CANDIDATES:
        print(f"• {url}")
        s1, v1 = _attempt(name, url, {}, "bare")
        s2, v2 = _attempt(name, url, BROWSER_HEADERS, "browser")
        for s, v in ((s1, v1), (s2, v2)):
            if s == 200 and "BLOCKED" not in v:
                reachable.append(f"{name} ({v})")
        print()

    print("=== SUMMARY ===")
    if reachable:
        print(f"REACHABLE (200, non-block): {len(reachable)}")
        for r in reachable:
            print(f"  ✓ {r}")
        print("→ Proceed to parser design against the saved artifact bodies.")
    else:
        print("No reachable non-block 200 responses — Akamai/egress blocks the data-center IP.")
        print("→ Need an alternate source/path before writing a parser.")
    print(f"\nSaved any 200 bodies under {DEBUG_DIR} (uploaded as the `ice-probe` artifact).")
    sys.exit(0)  # diagnostic: always green so the logs are readable


if __name__ == "__main__":
    main()
