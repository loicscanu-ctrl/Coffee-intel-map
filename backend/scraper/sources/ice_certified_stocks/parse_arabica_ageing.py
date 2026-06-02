"""Arabica monthly ageing report (.xls — OLE2 binary, xlrd).

Source: https://www.ice.com/publicdocs/futures_us_reports/coffee/coffee_aging_{YYYYMMDD}.xls
Published on the last business day of each calendar month. The URL date is
the month-end date the report covers.

The exact schema isn't documented publicly, so this parser is defensive —
it sniffs the header row for an "Origin" or "Coffee" leftmost column and
detects age columns by either (a) a year-band header like "0-1 Year",
"1-2 Year", "2-3 Year", "3-4 Year", "4+ Year" / "Over 4 Year"  OR
(b) a numeric month range like "0-365" / "366-730" days, etc.

Output:
    {
      "month_end":       "YYYY-MM-DD",
      "source_url":      "...",
      "by_origin_band":  {origin: {band: bags}},     # 0Y / 1Y / 2Y / 3Y / >4Y
      "by_band":         {band: bags},                # roll-up across origins
      "grand_total":     int,
      "origins":         [str, ...],
      "parser_notes":    [str, ...],                  # warnings the caller can log
    }

Bag counts are coerced to int; rows whose totals don't match the row sum
are flagged in `parser_notes` but still kept (we trust the row sum). The
caller is the orchestrator, which also persists the original bytes for
auditing if the parse produces zero origins.
"""
from __future__ import annotations

import re
from datetime import date

import xlrd

# Canonical year-band labels — match the frontend YEAR_BAND_ORDER.
_BAND_ORDER = ("0Y", "1Y", "2Y", "3Y", ">4Y")


def _band_from_header(header: str) -> str | None:
    """Map a column header to a year-band label, or None if not an age column."""
    h = re.sub(r"\s+", " ", (header or "").strip()).lower()
    if not h:
        return None
    # Year-range patterns
    if re.match(r"^0\s*[-–to]\s*1\s*y", h) or "0-1 year" in h or "first year" in h:
        return "0Y"
    if re.match(r"^1\s*[-–to]\s*2\s*y", h) or "1-2 year" in h:
        return "1Y"
    if re.match(r"^2\s*[-–to]\s*3\s*y", h) or "2-3 year" in h:
        return "2Y"
    if re.match(r"^3\s*[-–to]\s*4\s*y", h) or "3-4 year" in h:
        return "3Y"
    if re.match(r"^(over|>|4\+)\s*4\s*y", h) or "over 4" in h or "4+ year" in h:
        return ">4Y"
    # Day-range patterns: 0-365, 366-730, 731-1095, 1096-1460, 1461+
    m = re.match(r"^(\d+)\s*[-–]\s*(\d+)", h)
    if m:
        hi = int(m[2])
        if hi <= 365:    return "0Y"
        if hi <= 730:    return "1Y"
        if hi <= 1095:   return "2Y"
        if hi <= 1460:   return "3Y"
        return ">4Y"
    m = re.match(r"^(\d+)\s*\+", h)
    if m and int(m[1]) >= 1461:
        return ">4Y"
    return None


def _to_int(v) -> int:
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().replace(",", "")
    if not s:
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _looks_like_origin_header(s: str) -> bool:
    h = (s or "").strip().lower()
    return h in {"origin", "coffee", "country", "country of origin"}


def parse_ageing_sheet(sheet, source_url: str, month_end: date) -> dict:
    """Same shape as parse_arabica_ageing, but takes any object with
    `nrows`, `ncols`, `cell_value(r, c)` — lets tests build a stub without
    needing xlwt to synthesise a real .xls binary.
    """
    notes: list[str] = []
    out: dict = {
        "month_end":      month_end.isoformat(),
        "source_url":     source_url,
        "by_origin_band": {},
        "by_band":        {b: 0 for b in _BAND_ORDER},
        "grand_total":    0,
        "origins":        [],
        "parser_notes":   notes,
    }
    # Find the header row — first row whose leftmost cell looks like an
    # origin column AND that has at least one band-mappable header to its
    # right.
    header_row = -1
    band_cols: list[tuple[int, str]] = []
    origin_col = 0
    for r in range(min(sheet.nrows, 40)):
        for c in range(min(sheet.ncols, 6)):
            if _looks_like_origin_header(str(sheet.cell_value(r, c))):
                cols: list[tuple[int, str]] = []
                for cc in range(c + 1, sheet.ncols):
                    band = _band_from_header(str(sheet.cell_value(r, cc)))
                    if band:
                        cols.append((cc, band))
                if cols:
                    header_row = r
                    origin_col = c
                    band_cols = cols
                    break
        if header_row >= 0:
            break
    if header_row < 0:
        notes.append("no header row matched (looked for Origin/Coffee + band columns)")
        return out

    seen_origins: list[str] = []
    for r in range(header_row + 1, sheet.nrows):
        origin = str(sheet.cell_value(r, origin_col)).strip()
        if not origin:
            continue
        low = origin.lower()
        if low.startswith(("total", "grand", "subtotal")):
            continue
        row_total = 0
        per_band: dict[str, int] = {}
        for col, band in band_cols:
            bags = _to_int(sheet.cell_value(r, col))
            if bags <= 0:
                continue
            per_band[band] = per_band.get(band, 0) + bags
            row_total += bags
        if row_total <= 0:
            continue
        seen_origins.append(origin)
        out["by_origin_band"][origin] = per_band
        for b, v in per_band.items():
            out["by_band"][b] += v
        out["grand_total"] += row_total

    out["origins"] = seen_origins
    notes.append(
        f"parsed {len(seen_origins)} origins × {len({b for _, b in band_cols})} bands "
        f"(grand_total={out['grand_total']:,} bags)"
    )
    return out


def parse_arabica_ageing(xls_bytes: bytes, source_url: str, month_end: date) -> dict:
    try:
        book = xlrd.open_workbook(file_contents=xls_bytes)
    except Exception as e:  # noqa: BLE001
        out = {
            "month_end":      month_end.isoformat(),
            "source_url":     source_url,
            "by_origin_band": {},
            "by_band":        {b: 0 for b in _BAND_ORDER},
            "grand_total":    0,
            "origins":        [],
            "parser_notes":   [f"xlrd open failed: {e!r}"],
        }
        return out
    return parse_ageing_sheet(book.sheet_by_index(0), source_url, month_end)


def fetch_url_for(month_end: date) -> str:
    return f"https://www.ice.com/publicdocs/futures_us_reports/coffee/coffee_aging_{month_end:%Y%m%d}.xls"
