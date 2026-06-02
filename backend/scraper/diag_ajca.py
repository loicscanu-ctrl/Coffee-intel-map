"""
diag_ajca.py — one-off AJCA structure probe.

AJCA blocks datacenter sandbox IPs (403) but is reachable from GitHub Actions.
This dumps, to stdout:
  1. EVERY .pdf link on the data hub (to discover any stocks/inventory file we
     don't already know about), and the known pdf_index kinds.
  2. For the key data PDFs (supply-demand + per-type imports + by-origin
     imports), the page count and a sample of each page's tables + text so we
     can see whether AJCA exposes monthly stocks, by type, and/or by origin.

Run via .github/workflows/diag-ajca.yml (workflow_dispatch). Read the run log.
"""
from __future__ import annotations

import io
import re
import sys

import pdfplumber
import requests

sys.path.insert(0, "backend")
from scraper.sources.ajca import (  # noqa: E402
    _HEADERS,
    _collect_pdf_index,
    _fetch_hub,
    _latest_pdf_by_kind,
)

_ANY_PDF = re.compile(r'href="(https?://[^"]+\.pdf)"', re.I)
# Filename tokens that would flag a stocks/inventory report.
_STOCK_HINTS = ("zaiko", "stock", "在庫", "zai", "inv")


def dump_pdf(url: str, max_pages: int = 4) -> None:
    try:
        r = requests.get(url, headers=_HEADERS, timeout=60)
    except Exception as e:
        print(f"    download ERROR: {e}")
        return
    if r.status_code != 200 or len(r.content) < 2000:
        print(f"    download HTTP {r.status_code}, {len(r.content)} bytes")
        return
    try:
        with pdfplumber.open(io.BytesIO(r.content)) as pdf:
            print(f"    pages={len(pdf.pages)}")
            for pno, page in enumerate(pdf.pages[:max_pages], 1):
                text = (page.extract_text() or "").replace("\n", " | ")
                tables = page.extract_tables() or []
                print(f"    -- p{pno}: text_chars={len(text)} tables={len(tables)}")
                if text:
                    print(f"       text: {text[:360]}")
                for ti, t in enumerate(tables[:2]):
                    dims = f"{len(t)}x{max((len(row) for row in t), default=0)}"
                    print(f"       table{ti} {dims}:")
                    for row in t[:6]:
                        print("         ", [(str(c)[:16] if c is not None else None)
                                            for c in row[:12]])
    except Exception as e:
        print(f"    parse ERROR: {e}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    html = _fetch_hub()
    if not html:
        print("HUB UNREACHABLE")
        sys.exit(1)

    all_pdfs = sorted(set(_ANY_PDF.findall(html)))
    print(f"===== ALL PDF links on hub ({len(all_pdfs)}) =====")
    for u in all_pdfs:
        name = u.rsplit("/", 1)[-1]
        flag = "  <-- STOCK?" if any(h in u.lower() for h in _STOCK_HINTS) else ""
        print(f"  {name}{flag}   {u}")

    idx = _collect_pdf_index(html)
    kinds = sorted({p["kind"] for p in idx})
    print(f"\n===== known pdf_index kinds: {kinds} =====")

    for kind in ["data-jukyu", "data-yunyu-suii", "data-24", "data7-import-nama",
                 "data7-import-gc", "data7-import-rc", "data7-import-ic",
                 "data7-import-other", "j-import", "j-export"]:
        u = _latest_pdf_by_kind(idx, kind)
        print(f"\n===== {kind}: {u} =====")
        if u:
            dump_pdf(u)

    # Stocks PDFs (j-zaiko…) aren't in the known kinds — dump the latest couple
    # directly so we can see whether stocks split by type and/or by port/origin.
    stock_pdfs = sorted(u for u in all_pdfs if any(h in u.lower() for h in _STOCK_HINTS))
    for u in stock_pdfs[-2:]:
        print(f"\n===== STOCK PDF: {u} =====")
        dump_pdf(u, max_pages=6)

    # ── Probe A: historical j-zaiko (only current year is linked on the hub) ───
    print("\n===== HISTORICAL j-zaiko PROBE =====")
    base = "https://coffee.ajca.or.jp/wordpress/wp-content/uploads"
    hits = []
    for yr in range(2018, 2027):
        for mo in range(1, 13):
            for uy, um in [(yr, mo), (yr, mo + 1), (yr + (mo // 12), (mo % 12) + 1)]:
                url = f"{base}/{uy}/{um:02d}/j-zaiko{yr}{mo:02d}.pdf"
                try:
                    rr = requests.head(url, headers=_HEADERS, timeout=15)
                    if rr.status_code == 200:
                        hits.append(url); break
                except Exception:
                    pass
    print(f"  resolved {len(hits)} j-zaiko URLs:")
    for u in hits:
        print("   ", u)

    # ── Probe B: data7 per-type import totals (find the grand-total / 合計 row) ─
    print("\n===== data7 TYPE-TOTAL PROBE =====")
    for kind in ["data7-import-nama", "data7-import-rc", "data7-import-ic"]:
        u = _latest_pdf_by_kind(idx, kind)
        print(f"\n  --- {kind}: {u}")
        if not u:
            continue
        try:
            r = requests.get(u, headers=_HEADERS, timeout=60)
            with pdfplumber.open(io.BytesIO(r.content)) as pdf:
                for pno, page in enumerate(pdf.pages, 1):
                    for line in (page.extract_text() or "").split("\n"):
                        if re.search(r"合計|総合計|総計", line) or re.search(r"20\d\d\s+20\d\d", line):
                            print(f"     p{pno}: {line[:200]}")
        except Exception as e:
            print(f"     ERROR: {e}")


if __name__ == "__main__":
    main()
