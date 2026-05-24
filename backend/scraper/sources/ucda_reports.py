"""
ucda_reports.py
Side-channel scraper: downloads UCDA Monthly Coffee Report PDFs,
parses them with pdfplumber, stores each month as a NewsItem in DB.

URL pattern: https://ugandacoffee.go.ug/file-download/download/public/{id}

Stores each report as:
  source  = "UCDA_REPORT"
  title   = "Uganda UCDA Monthly Report - YYYY-MM"
  meta    = JSON with full parsed data
"""
from __future__ import annotations

import json
import re
import time
from datetime import UTC, datetime
from io import BytesIO

import requests

_BASE_URL  = "https://ugandacoffee.go.ug/file-download/download/public/"
_HEADERS   = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}
_TIMEOUT   = 30
_MAX_HTTP_FAILS = 15  # stop after this many consecutive HTTP errors (404/timeout)

# Reports newer than the legacy numeric-ID scheme are published as direct files
# under /sites/default/files/. The ID scan never reaches them (and never probes
# IDs above its hardcoded start), so list such reports here — they are fetched
# and re-parsed on every run (overwriting any stale/partial stored copy).
# Add new monthly-report URLs here as UCDA publishes them.
KNOWN_REPORT_URLS = [
    "https://ugandacoffee.go.ug/sites/default/files/2026-05/06-March%202026%20Report%20pptx%281%29_Final.pdf",
    "https://ugandacoffee.go.ug/sites/default/files/2025-07/09-June%202025%20Report%20pptx%281%29.pdf",
    "https://ugandacoffee.go.ug/sites/default/files/2025-08/10-July%202025%20Report%20pptx..pdfI_.pdf",
]

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


# ── PDF download ──────────────────────────────────────────────────────────────

def download_pdf(doc_id: int) -> bytes | None:
    try:
        r = requests.get(_BASE_URL + str(doc_id), headers=_HEADERS,
                         timeout=_TIMEOUT, allow_redirects=True)
        ct = r.headers.get("Content-Type", "")
        if r.status_code == 200 and "pdf" in ct.lower():
            return r.content
        return None
    except Exception as e:
        print(f"[ucda_reports] doc {doc_id} fetch failed: {type(e).__name__}: {e}")
        return None


def download_pdf_url(url: str) -> bytes | None:
    """Fetch a report by full URL (e.g. a /sites/default/files/ direct link)."""
    try:
        r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT, allow_redirects=True)
        ct = r.headers.get("Content-Type", "")
        if r.status_code == 200 and ("pdf" in ct.lower() or url.lower().endswith(".pdf")):
            return r.content
        print(f"[ucda_reports] {url} → HTTP {r.status_code} ({ct})")
        return None
    except Exception as e:
        print(f"[ucda_reports] url fetch failed: {type(e).__name__}: {e}")
        return None


# ── PDF parsing ───────────────────────────────────────────────────────────────

def parse_pdf(pdf_bytes: bytes) -> dict | None:
    try:
        import pdfplumber
    except ImportError:
        print("[ucda_reports] pdfplumber not installed — pip install pdfplumber")
        return None

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            pages_text = [p.extract_text() or "" for p in pdf.pages]
            full_text  = "\n".join(pages_text)

            # Must be a UCDA monthly report
            if not re.search(r"MONTHLY\s+COFFEE\s+REPORT", full_text, re.I):
                return None

            report_month = _parse_date(full_text)
            if not report_month:
                return None

            summary      = _parse_summary(full_text, report_month)
            trend_12m    = _parse_trend(pages_text[0], report_month)
            farmgate     = _parse_farmgate(full_text)
            grades       = _parse_grades(pdf, full_text)
            exporters    = _parse_exporters(pdf, full_text)
            destinations = _parse_destinations(pdf, full_text)
            buyers       = _parse_buyers(pdf, full_text)

            return {
                "month":        report_month,
                "summary":      summary,
                "trend_12m":    trend_12m,
                "farmgate":     farmgate,
                "grades":       grades,
                "exporters":    exporters,
                "destinations": destinations,
                "buyers":       buyers,
                "parsed_at":    datetime.now(UTC).isoformat(),
            }
    except Exception as e:
        print(f"[ucda_reports] parse error: {e}")
        return None


def _parse_date(text: str) -> str | None:
    # Handles both "REPORT-FEBRUARY 2026" and "REPORT-FEBRUARY2026"
    m = re.search(r"MONTHLY\s+COFFEE\s+REPORT[^\w]+([A-Za-z]+)\s*(\d{4})", text, re.I)
    if not m:
        return None
    mn = _MONTHS.get(m.group(1).lower())
    yr = int(m.group(2))
    return f"{yr}-{mn:02d}" if mn else None


def _clean_num(s: str) -> float | None:
    try:
        return float(re.sub(r"[,\s]", "", s))
    except (ValueError, TypeError):
        return None


def _parse_summary(text: str, month: str) -> dict:
    """Extract Table 1: robusta/arabica split for current + prior year."""
    out: dict = {"month": month}

    # Robusta row: "Robusta 476,471 138,181,685 512,237 124,659,354 7.51 -9.79"
    m = re.search(
        r"Robusta\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)"
        r"(?:\s+([-\d.]+))?\s*([-\d.]+)?",
        text,
    )
    if m:
        out["robusta_bags_py"] = _clean_num(m.group(1))
        out["robusta_value_py"] = _clean_num(m.group(2))
        out["robusta_bags"]     = _clean_num(m.group(3))
        out["robusta_value"]    = _clean_num(m.group(4))

    # Arabica row (sometimes split across lines)
    m = re.search(
        r"Arabica\s*\n?\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)",
        text,
    )
    if m:
        out["arabica_bags_py"] = _clean_num(m.group(1))
        out["arabica_value_py"] = _clean_num(m.group(2))
        out["arabica_bags"]    = _clean_num(m.group(3))
        out["arabica_value"]   = _clean_num(m.group(4))

    # Total row: match "Total\n567,226 ... 651,933 ..."  or "February Total\n..."
    m = re.search(
        r"(?:Total)\s*\n?\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)"
        r"(?:\s+([-\d.]+))?\s*([-\d.]+)?",
        text,
    )
    if m:
        out["total_bags_py"]  = _clean_num(m.group(1))
        out["total_value_py"] = _clean_num(m.group(2))
        out["total_bags"]     = _clean_num(m.group(3))
        out["total_value"]    = _clean_num(m.group(4))
        if m.group(5):
            out["yoy_qty_pct"]  = _clean_num(m.group(5))
        if m.group(6):
            out["yoy_val_pct"]  = _clean_num(m.group(6))

    # Average price from key highlights prose
    mp = re.search(
        r"average\s+(?:export\s+)?price\s+(?:was\s+)?US\$\s*([\d.]+)\s*/\s*kilo",
        text, re.I,
    )
    if mp:
        out["avg_price_usd_kg"] = float(mp.group(1))

    # YoY qty/val from highlights if not from table
    if "yoy_qty_pct" not in out:
        my = re.search(
            r"(?:increase|decrease) of ([\d.]+)%.*?(?:increase|decrease) of ([\d.]+)%.*?quantity and value",
            text, re.I | re.S,
        )
        if my:
            out["yoy_qty_pct"] = float(my.group(1))
            out["yoy_val_pct"] = float(my.group(2))

    return out


def _parse_trend(page1_text: str, report_month: str) -> list[dict]:
    """
    Extract 12-month total for current report month only from Key Highlights prose.
    Full historical series is built by _build_monthly_series() in export_uganda.py
    by aggregating Table 1 (current + prior-year) across all stored reports.
    Returns a single-entry list for the current report month.
    """
    s = re.search(r"total(?:led)?\s+(?:to\s+)?([\d,]+)\s+60.kilo\s+bags", page1_text, re.I)
    if s:
        bags = _clean_num(s.group(1))
        if bags and 100_000 <= bags <= 2_000_000:
            return [{"month": report_month, "total_bags": int(bags)}]
    return []


def _parse_farmgate(text: str) -> dict:
    """
    Extract farm-gate prices from Key Highlights sentence:
    'Kiboko averaged UGX X; FAQ UGX Y, Arabica parchment UGX Z and Drugar UGX W'
    Uses targeted patterns to avoid cross-matching ranged values from Section 7.
    """
    out: dict = {}

    def _first_ugx(pattern: str) -> float | None:
        m = re.search(pattern, text, re.I)
        if m:
            v = _clean_num(m.group(1))
            if v and 1000 <= v <= 50000:
                return v
        return None

    out["kiboko_ugx_kg"]            = _first_ugx(r"Kiboko\s+averaged?\s+UGX\s+([\d,]+)")
    out["faq_ugx_kg"]               = _first_ugx(r"FAQ\s+UGX\s+([\d,]+)")
    out["arabica_parchment_ugx_kg"] = _first_ugx(r"Arabica\s+parchment\s+UGX\s+([\d,]+)")
    out["drugar_ugx_kg"]            = _first_ugx(r"Drugar\s+UGX\s+([\d,]+)")

    # Highest arabica price (Mt Elgon A+) — appears as "(US$ X.XX per kilogram)"
    m = re.search(r"Mt\.?\s*Elgon\s*A\+.*?US\$\s*([\d.]+)\s*per\s+kilogram", text, re.I | re.S)
    if not m:
        m = re.search(r"highest\s+price.*?US\$\s*([\d.]+)\s*per\s+kilogram", text, re.I | re.S)
    if m:
        v = float(m.group(1))
        if 5 <= v <= 30:
            out["mt_elgon_aplus_usd_kg"] = v

    return {k: v for k, v in out.items() if v is not None}


def _rows_from_pages(pdf, start_page: int, end_page: int) -> list[list]:
    """Concatenate tables from a page range."""
    rows = []
    for i in range(start_page, min(end_page, len(pdf.pages))):
        for table in (pdf.pages[i].extract_tables() or []):
            rows.extend(table)
    return rows


def _is_num_row(row: list) -> bool:
    """True if row looks like a data row (first non-None cell is a number or rank)."""
    for cell in row:
        if cell:
            return bool(re.match(r"^\d", cell.strip()))
    return False


def _parse_grades(pdf, full_text: str) -> list[dict]:
    """Table 2: grade breakdown — qty, pct, value, unit price."""
    grades = []
    # Table 2 is on page 2 (index 1)
    for table in (pdf.pages[1].extract_tables() or []):
        for row in table:
            if not row or len(row) < 4:
                continue
            name = str(row[0] or "").strip()
            if not name or name.lower() in {"coffee type", "total", ""}:
                continue
            # Skip subtotal rows
            if re.match(r"total\s+(robusta|arabica)", name, re.I):
                continue
            nums = []
            for cell in row[1:]:
                v = _clean_num(str(cell or ""))
                nums.append(v)
            if len(nums) >= 4 and nums[0] and nums[0] > 100:
                entry: dict = {"grade": name}
                if nums[0]: entry["qty_bags"]    = int(nums[0])
                if nums[1]: entry["pct_qty"]     = nums[1]
                if nums[2]: entry["value_usd"]   = int(nums[2])
                if nums[3]: entry["pct_val"]     = nums[3]
                if len(nums) >= 5 and nums[4]: entry["price_usd_kg"] = nums[4]
                grades.append(entry)
    return grades


def _parse_annex_table(pdf, full_text: str, annex_keyword: str,
                        col_map: dict, pages_range: tuple) -> list[dict]:
    """Generic annex table parser — finds tables in page range, maps columns."""
    results = []
    for i in range(pages_range[0], min(pages_range[1], len(pdf.pages))):
        page_text = pdf.pages[i].extract_text() or ""
        if annex_keyword.lower() not in page_text.lower() and i > pages_range[0]:
            break
        for table in (pdf.pages[i].extract_tables() or []):
            for row in table:
                if not row:
                    continue
                cells = [str(c or "").strip() for c in row]
                # Skip header rows
                if any(h in " ".join(cells).upper()
                       for h in ["COMPANY", "BUYERS", "DESTINATION", "POSITION", "EXPORTING"]):
                    continue
                # Must start with a rank number
                if not cells[0].isdigit():
                    continue
                entry: dict = {"rank": int(cells[0])}
                for col_idx, field_name in col_map.items():
                    if col_idx < len(cells):
                        v = _clean_num(cells[col_idx])
                        if v is not None:
                            entry[field_name] = int(v) if "bags" in field_name else v
                        else:
                            entry[field_name] = cells[col_idx] if cells[col_idx] else None
                results.append(entry)
    return results


def _parse_annex_rows(pdf, start_idx: int, end_idx: int,
                      stop_annex: str, name_field: str) -> list[dict]:
    """
    Parse UCDA annex tables.

    Known row structure (8 cols):
      [rank, name, py_rank, robusta_bags, arabica_bags, total_bags, indiv_pct, cumul_pct]

    Notes:
    - The PDF uses a 2-column visual layout so pdfplumber captures every other rank
      (odd for Annex1, even for Annex3). No way around this without word-level parsing.
    - cells[2] = previous-year rank (integer, NOT a bag count) — must skip.
    """
    results: list[dict] = []
    skip_headers = {"ROBUSTA", "ARABICA", "TOTAL", "INDIVIDUAL", "CUMULATIVE",
                    "POSITION", "DESTINATION", "EXPORTING", "BUYERS", "%AGE", "CUMMILATIVE"}
    for i in range(start_idx, min(end_idx, len(pdf.pages))):
        page_text = pdf.pages[i].extract_text() or ""
        # Stop if we've moved past the target annex
        if i > start_idx and stop_annex and stop_annex.lower() not in page_text.lower():
            break
        for table in (pdf.pages[i].extract_tables() or []):
            for row in table:
                if not row or len(row) < 4:
                    continue
                cells = [str(c or "").strip() for c in row]
                # Skip header / total rows
                if not cells[0].isdigit():
                    continue
                if any(tok in " ".join(cells[:3]).upper() for tok in skip_headers):
                    continue
                rank = int(cells[0])
                name = " ".join((cells[1] if len(cells) > 1 else "").split())  # collapse newlines
                # cells[2] = py_rank — skip by starting numeric extraction at index 3
                robusta   = _clean_num(cells[3]) if len(cells) > 3 else None
                arabica   = _clean_num(cells[4]) if len(cells) > 4 else None
                total     = _clean_num(cells[5]) if len(cells) > 5 else None
                indiv_pct = _clean_num(cells[6]) if len(cells) > 6 else None
                if not name or not total:
                    continue
                entry: dict = {"rank": rank, name_field: name,
                               "total_bags": int(total)}
                if robusta and robusta > 0:
                    entry["robusta_bags"] = int(robusta)
                if arabica and arabica > 0:
                    entry["arabica_bags"] = int(arabica)
                if indiv_pct and 0 < indiv_pct <= 100:
                    entry["pct_individual"] = indiv_pct
                results.append(entry)
    return results


def _parse_exporters(pdf, full_text: str) -> list[dict]:
    """Annex 1: current-month exporters (page idx 4). Stop before Annex 2."""
    rows = _parse_annex_rows(pdf, 4, 6, stop_annex="Annex 2", name_field="company")
    return rows[:50]


def _parse_destinations(pdf, full_text: str) -> list[dict]:
    """Annex 3: current-month destinations (page idx 7-8). Stop before Annex 4."""
    rows = _parse_annex_rows(pdf, 7, 9, stop_annex="Annex 4", name_field="country")
    return rows[:50]


def _parse_buyers(pdf, full_text: str) -> list[dict]:
    """Annex 4: foreign buyers (page idx 9)."""
    rows = _parse_annex_rows(pdf, 9, 11, stop_annex="", name_field="company")
    return rows[:30]


# ── DB helpers ────────────────────────────────────────────────────────────────

def _stored_months(db) -> set[str]:
    """Return set of already-stored YYYY-MM strings."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from models import NewsItem
    rows = db.query(NewsItem.title).filter(NewsItem.source == "UCDA_REPORT").all()
    months = set()
    for (title,) in rows:
        m = re.search(r"(\d{4}-\d{2})$", title)
        if m:
            months.add(m.group(1))
    return months


def _upsert_report(db, data: dict) -> None:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

    from models import NewsItem

    month = data["month"]
    title = f"Uganda UCDA Monthly Report - {month}"
    meta  = json.dumps(data, ensure_ascii=False)

    existing = db.query(NewsItem).filter(
        NewsItem.source == "UCDA_REPORT",
        NewsItem.title  == title,
    ).first()

    yr, mo = int(month[:4]), int(month[5:])
    pub    = datetime(yr, mo, 1)

    if existing:
        existing.meta       = meta
        existing.pub_date   = pub
    else:
        db.add(NewsItem(
            title    = title,
            body     = f"Uganda coffee exports {month}: {data['summary'].get('total_bags', '?')} bags",
            source   = "UCDA_REPORT",
            category = "supply",
            lat      = 1.3733,
            lng      = 32.2903,
            tags     = ["uganda", "exports", "ucda"],
            meta     = meta,
            pub_date = pub,
        ))
    db.commit()


# ── Public run function ───────────────────────────────────────────────────────

async def run(page, db, start_id: int = 1319, scan_back: int = 60,
              scan_forward: int = 250) -> None:
    """Side-channel: download and parse UCDA PDFs, store new months in DB.

    Discovery has three passes:
      1. backward ID scan  (start_id → start_id-scan_back) — recent legacy IDs;
      2. forward ID scan   (start_id+1 → start_id+scan_forward) — newer reports
         get *higher* IDs, which the original backward-only scan never reached;
      3. KNOWN_REPORT_URLS — explicit direct-file links, always re-parsed.
    """
    stored = _stored_months(db)
    print(f"[ucda_reports] already stored: {len(stored)} months")
    new_count = 0

    def _scan(ids) -> int:
        n = 0
        http_fails = 0  # only count HTTP errors (404/timeout), not wrong-type PDFs
        for doc_id in ids:
            pdf_bytes = download_pdf(doc_id)
            if pdf_bytes is None:
                http_fails += 1
                if http_fails >= _MAX_HTTP_FAILS:
                    print(f"[ucda_reports] {_MAX_HTTP_FAILS} consecutive HTTP errors — stopping scan")
                    break
                continue
            http_fails = 0
            data = parse_pdf(pdf_bytes)
            if data is None:
                continue  # not a monthly report (e.g. daily analysis PDF)
            month = data["month"]
            if month in stored:
                continue
            _upsert_report(db, data)
            stored.add(month)
            n += 1
            bags = data["summary"].get("total_bags", "?")
            print(f"[ucda_reports] ID {doc_id} ({month}): {bags} bags — stored")
            time.sleep(0.4)
        return n

    new_count += _scan(range(start_id, start_id - scan_back - 1, -1))
    new_count += _scan(range(start_id + 1, start_id + scan_forward + 1))

    # Explicit direct-file reports (newer hosting scheme / known gaps).
    # Always re-parse and upsert so corrected parses overwrite partial copies.
    for url in KNOWN_REPORT_URLS:
        pdf_bytes = download_pdf_url(url)
        if pdf_bytes is None:
            continue
        data = parse_pdf(pdf_bytes)
        if data is None:
            print(f"[ucda_reports] known URL parsed to non-report: {url}")
            continue
        month = data["month"]
        was_new = month not in stored
        _upsert_report(db, data)
        stored.add(month)
        if was_new:
            new_count += 1
        bags = data["summary"].get("total_bags", "?")
        print(f"[ucda_reports] URL ({month}): {bags} bags — {'stored' if was_new else 're-parsed'}")
        time.sleep(0.4)

    print(f"[ucda_reports] Done. {new_count} new reports stored.")
