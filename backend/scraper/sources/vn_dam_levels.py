"""
Vietnam Water Flow Tracker — Coffee Region Focus
Source: NCHMF (nchmf.gov.vn) daily "Bản tin dự báo nguồn nước thời hạn ngắn"
PDF URL pattern: kttv.gov.vn/upload/thuyvan1/{YYYY}/{M}/{D}/dbqg_nnhn_{YYYYMMDD}_1500.pdf

Key rivers for coffee (Central Highlands):
  - ĐắkBla at Kon Tum → Gia Lai / Kon Tum
  - Srêpôk at Giang Sơn → Đắk Lắk (main coffee province)
  - Đồng Nai tributary → Đắk Nông, Lâm Đồng

Signal: % vs TBNN (Trung bình nhiều năm = multi-year historical average)
  > +20%  → surplus (good)
  -20% to +20% → normal
  < -20%  → deficit (drought risk for irrigation)
  < -50%  → severe deficit
"""

from __future__ import annotations

import io
import json
import logging
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
}

NCHMF_BASE = "https://nchmf.gov.vn/kttv/vi-VN/1/nguon-nuoc-21-18.html"
KTTV_PDF_BASE = "https://kttv.gov.vn/upload/thuyvan1"

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "vn_water_levels.json"

# Rivers of interest and their coffee province mapping
COFFEE_RIVERS = {
    "Srêpôk":  {"label": "Srepok",    "provinces": ["Dak Lak"],           "station": "Giang Sơn"},
    "Srépôk":  {"label": "Srepok",    "provinces": ["Dak Lak"],           "station": "Giang Sơn"},
    "Srepok":  {"label": "Srepok",    "provinces": ["Dak Lak"],           "station": "Giang Sơn"},
    "ĐăkBla":  {"label": "Dak Bla",   "provinces": ["Gia Lai", "Kon Tum"], "station": "Kon Tum"},
    "Đăk Bla": {"label": "Dak Bla",   "provinces": ["Gia Lai", "Kon Tum"], "station": "Kon Tum"},
    "Đồng Trăng": {"label": "Dong Nai", "provinces": ["Dak Nong", "Lam Dong"], "station": "Cái N,T"},
}


# ── PDF URL resolution ─────────────────────────────────────────────────────────

def _pdf_url_for_date(d: date) -> str:
    return (
        f"{KTTV_PDF_BASE}/{d.year}/{d.month}/{d.day}"
        f"/dbqg_nnhn_{d.strftime('%Y%m%d')}_1500.pdf"
    )


def _find_latest_pdf_url() -> tuple[str, date] | tuple[None, None]:
    """
    Try today and up to 7 days back to find the most recent available PDF.
    Falls back to scraping the bulletin listing page for the link.
    """
    # Try date-based guessing first (fast path)
    for delta in range(8):
        d = date.today() - timedelta(days=delta)
        url = _pdf_url_for_date(d)
        try:
            r = requests.head(url, headers=HEADERS, timeout=10)
            if r.status_code == 200:
                log.info("Found PDF for %s: %s", d, url)
                return url, d
        except Exception:
            pass

    # Fallback: scrape the bulletin listing page
    try:
        from bs4 import BeautifulSoup
        r = requests.get(NCHMF_BASE, headers=HEADERS, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.content, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            txt  = a.get_text()
            if "nguon-nuoc-thoi-han-ngan" in href or "NGUỒN NƯỚC THỜI HẠN NGẮN" in txt.upper():
                article_url = href if href.startswith("http") else f"https://nchmf.gov.vn{href}"
                # Fetch the article to get the PDF attachment link
                r2 = requests.get(article_url, headers=HEADERS, timeout=15)
                soup2 = BeautifulSoup(r2.content, "html.parser")
                for a2 in soup2.find_all("a", href=True):
                    h = a2.get("href", "")
                    if h.endswith(".pdf") and "dbqg_nnhn" in h:
                        return h, date.today()
    except Exception as e:
        log.error("Fallback scrape failed: %s", e)

    return None, None


# ── PDF parsing ────────────────────────────────────────────────────────────────

def _parse_tbnn_pct(cell: str) -> float | None:
    """Extract % vs TBNN from cells like '< 68' or '> 34' or '~ TBNN'."""
    cell = (cell or "").strip()
    if "~" in cell or "tbnn" in cell.lower():
        return 0.0
    m = re.search(r"([<>])\s*(\d+(?:[.,]\d+)?)", cell)
    if m:
        sign = -1 if m.group(1) == "<" else 1
        return sign * float(m.group(2).replace(",", "."))
    # Try bare number from "So sanh TBNN (%)" column
    m2 = re.search(r"([+-]?\d+(?:[.,]\d+)?)", cell)
    if m2:
        return float(m2.group(1).replace(",", "."))
    return None


def _extract_flow_table(pdf) -> list[dict]:
    """
    Parse "Bảng 1.2: Tổng lượng nước" (flow volume table) from appendix pages.
    Columns: Sông | Trạm | Thực đo 7 ngày | So sánh TBNN (%) | forecast days | Tổng | So sánh TBNN (%)
    Returns list of {river, station, actual_mm3, tbnn_pct, forecast_total_mm3, forecast_tbnn_pct}
    """
    results = []
    in_table = False

    for page in pdf.pages:
        text = page.extract_text() or ""
        if "Bảng 1.2" in text or "Tổng lượng nước" in text:
            in_table = True

        if not in_table:
            continue

        rows = page.extract_table() or []
        if not rows:
            # Parse from text as fallback using line patterns
            lines = text.split("\n")
            for line in lines:
                # Pattern: "River Station  actual_value  </>  NN  ...  total  </>  NN"
                # e.g. "ĐăkBla KonTum 6,17 < 68  1  0,84 ..."
                # Skip header lines
                if any(k in line for k in ["Sông", "Trạm", "Dự báo", "Đơn vị", "Bảng"]):
                    continue
                parts = line.split()
                if len(parts) < 4:
                    continue
                # Check if first few tokens match a known river name pattern
                for river_key in COFFEE_RIVERS:
                    if river_key in line:
                        # Extract numbers from line
                        nums = re.findall(r"\d+(?:[,\.]\d+)?", line)
                        actual = float(nums[0].replace(",", ".")) if nums else None
                        # Find the < or > before a number
                        pct_match = re.search(r"([<>])\s*(\d+)", line)
                        tbnn_pct = None
                        if pct_match:
                            tbnn_pct = (-1 if pct_match.group(1) == "<" else 1) * float(pct_match.group(2))
                        results.append({
                            "river":           COFFEE_RIVERS[river_key]["label"],
                            "river_vn":        river_key,
                            "provinces":       COFFEE_RIVERS[river_key]["provinces"],
                            "station":         COFFEE_RIVERS[river_key]["station"],
                            "actual_mm3":      actual,
                            "tbnn_pct":        tbnn_pct,
                        })
                        break
            continue

        # Table parsing
        for row in rows:
            if not row or not any(row):
                continue
            cells = [str(c or "").strip() for c in row]
            line  = " ".join(cells)
            for river_key in COFFEE_RIVERS:
                if river_key in line:
                    # Cells: river | station | actual | tbnn_pct | day1..day9 | total | forecast_tbnn_pct
                    actual_str  = cells[2] if len(cells) > 2 else ""
                    tbnn1_str   = cells[3] if len(cells) > 3 else ""
                    tbnn2_str   = cells[-1] if len(cells) > 1 else ""
                    try:
                        actual = float(actual_str.replace(",", ".").replace(" ", ""))
                    except (ValueError, AttributeError):
                        actual = None
                    results.append({
                        "river":           COFFEE_RIVERS[river_key]["label"],
                        "river_vn":        river_key,
                        "provinces":       COFFEE_RIVERS[river_key]["provinces"],
                        "station":         COFFEE_RIVERS[river_key]["station"],
                        "actual_mm3":      actual,
                        "tbnn_pct":        _parse_tbnn_pct(tbnn1_str),
                        "forecast_tbnn_pct": _parse_tbnn_pct(tbnn2_str),
                    })
                    break

    return results


def _extract_narrative_signals(pdf) -> dict[str, str]:
    """
    Parse narrative text pages for qualitative signals per river basin.
    Returns {river_label: signal} where signal is "low|normal|high|critical".
    """
    signals: dict[str, str] = {}
    full_text = ""
    for page in pdf.pages[:5]:
        full_text += (page.extract_text() or "") + "\n"

    # Srepok section
    srepok_match = re.search(
        r"Srê[pP]ôk[^\n]*?\n(.{0,500})",
        full_text, re.DOTALL
    )
    if srepok_match:
        chunk = srepok_match.group(1)
        if "thấp hơn" in chunk and re.search(r"thấp hơn.*?(\d+)%", chunk):
            pct = int(re.search(r"thấp hơn.*?(\d+)%", chunk).group(1))
            signals["Srepok"] = "low" if pct < 30 else "slightly_low"
        elif "cao hơn" in chunk:
            signals["Srepok"] = "high"
        else:
            signals["Srepok"] = "normal"

    return signals


def _signal_from_pct(pct: float | None) -> str:
    if pct is None:
        return "unknown"
    if pct <= -50:
        return "critical"
    if pct <= -20:
        return "low"
    if pct <= 20:
        return "normal"
    return "high"


# ── Static fallback ────────────────────────────────────────────────────────────

STATIC_SEED: dict[str, Any] = {
    "note": "Static seed — updated when NCHMF PDF fetch succeeds",
    "rivers": [
        {"river": "Srepok",   "river_vn": "Srêpôk", "provinces": ["Dak Lak"],
         "station": "Giang Son", "tbnn_pct": -8,  "signal": "normal"},
        {"river": "Dak Bla",  "river_vn": "ĐăkBla", "provinces": ["Gia Lai", "Kon Tum"],
         "station": "Kon Tum",  "tbnn_pct": -68, "signal": "critical"},
        {"river": "Dong Nai", "river_vn": "Đồng Trăng", "provinces": ["Dak Nong", "Lam Dong"],
         "station": "Cai N,T",  "tbnn_pct": 34,  "signal": "high"},
    ],
}


# ── Main build ─────────────────────────────────────────────────────────────────

def build_vn_water_levels(db=None) -> dict:
    now = datetime.utcnow()
    out: dict[str, Any] = {
        "updated":    now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":     "NCHMF – Bản tin dự báo nguồn nước thời hạn ngắn",
        "source_url": "https://nchmf.gov.vn/kttv/vi-VN/1/nguon-nuoc-21-18.html",
        "rivers":     [],
        "bulletin_date": None,
        "has_live_data": False,
    }

    if not HAS_PDFPLUMBER:
        log.warning("pdfplumber not installed — returning static seed")
        out.update(STATIC_SEED)
        out["rivers"] = STATIC_SEED["rivers"]
        OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        return out

    pdf_url, bulletin_date = _find_latest_pdf_url()
    if not pdf_url:
        log.warning("Could not find NCHMF PDF — returning static seed")
        out.update(STATIC_SEED)
        out["rivers"] = STATIC_SEED["rivers"]
        OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        return out

    out["pdf_url"] = pdf_url
    out["bulletin_date"] = bulletin_date.isoformat() if bulletin_date else None

    try:
        r = requests.get(pdf_url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        pdf_bytes = io.BytesIO(r.content)

        with pdfplumber.open(pdf_bytes) as pdf:
            rivers = _extract_flow_table(pdf)
            narrative = _extract_narrative_signals(pdf)

        # Add signal classification
        for rv in rivers:
            rv["signal"] = _signal_from_pct(rv.get("tbnn_pct"))
            # Override with narrative if quantitative missing
            if rv["signal"] == "unknown" and rv["river"] in narrative:
                rv["signal"] = narrative[rv["river"]]

        if rivers:
            out["rivers"] = rivers
            out["has_live_data"] = True
            log.info("vn_water_levels: extracted %d rivers from PDF", len(rivers))
        else:
            log.warning("PDF parsed but no coffee rivers found — using static seed")
            out["rivers"] = STATIC_SEED["rivers"]

    except Exception as e:
        log.error("PDF fetch/parse failed: %s", e)
        out["rivers"] = STATIC_SEED["rivers"]

    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("vn_water_levels.json written (%d bytes)", OUT_PATH.stat().st_size)
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = build_vn_water_levels()
    print(f"Rivers found: {len(result['rivers'])}")
    for r in result["rivers"]:
        pct = r.get("tbnn_pct")
        pct_str = f"{pct:+.0f}%" if pct is not None else "n/a"
        print(f"  {r['river']:12} | {r['station']:12} | vs TBNN: {pct_str:8} | {r.get('signal','?')}")
    print(f"Live data: {result['has_live_data']}")
