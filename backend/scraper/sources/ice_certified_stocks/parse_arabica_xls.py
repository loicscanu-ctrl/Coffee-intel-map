"""Arabica daily certified-stock report (.xls — OLE2 binary, parsed via xlrd).

Source: …/coffee_cert_stock_YYYYMMDD.xls — single sheet, 5 sections:
  • TOTAL BAGS CERTIFIED       (origin × 8 ports: ANT/BAR/HA-BR/HOU/MIAMI/NOLA/NY/VA)
  • TRANSITION BAGS CERTIFIED  (origin × 3 ports: ANT/BAR/HA-BR)
  • TODAY'S GRADING SUMMARY    (passed/failed bags — text or table)
  • Pending Grading Report     (origin × 8 ports)
  • Flagged for Rebagging      (origin × 8 ports, often empty)

Each origin row is bucketed into its ICE C-contract group (Group 0–4) via
ice_arabica_groups for the by_group rollups the certified-stocks panel needs.
"""
from __future__ import annotations

import io
import re
from datetime import datetime

import xlrd

from ..ice_arabica_groups import group_of

_AS_OF = re.compile(r"As of:\s*([A-Za-z]+ \d{1,2}, \d{4})")
_BAG_COUNT = re.compile(r"^\s*(\d[\d,]*|No)\s+Bags\s+(Passed|Failed)", re.IGNORECASE)

_SECTION_TITLES = (
    ("total_certified", "TOTAL BAGS CERTIFIED"),
    ("transition",      "TRANSITION BAGS CERTIFIED"),
    ("grading_summary", "TODAY'S GRADING SUMMARY"),
    ("pending_grading", "PENDING GRADING REPORT"),
    ("rebagging",       "FLAGGED FOR REBAGGING"),
)


def _to_int(v) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _find_sections(sheet) -> dict[str, int]:
    """First occurrence of each section title (file body later mentions a
    "Transition Bags Certified data is..." explainer row that would otherwise
    overwrite the real section anchor)."""
    found: dict[str, int] = {}
    for r in range(sheet.nrows):
        cell = str(sheet.cell_value(r, 0)).strip().upper()
        for key, title in _SECTION_TITLES:
            if key in found:
                continue
            if cell.startswith(title):
                found[key] = r
                break
    return found


def _find_header_row(sheet, start_row: int, max_skip: int = 6) -> int | None:
    """First row after `start_row` whose row has 'Total' in some column (the
    "...|ANT|BAR|...|Total" header). Returns None if not found within max_skip."""
    for r in range(start_row + 1, min(start_row + 1 + max_skip, sheet.nrows)):
        cells = [str(sheet.cell_value(r, c)).strip() for c in range(sheet.ncols)]
        if any(c.lower() == "total" for c in cells):
            return r
    return None


def _parse_matrix(sheet, section_row: int) -> dict:
    """Parse an origin × port matrix section. Returns a rich roll-up:
        {ports, by_origin, by_port, by_group, grand_total}
    """
    header_row = _find_header_row(sheet, section_row)
    if header_row is None:
        return {"ports": [], "by_origin": {}, "by_port": {}, "by_group": {}, "grand_total": 0}

    headers = [str(sheet.cell_value(header_row, c)).strip() for c in range(sheet.ncols)]
    port_cols: list[tuple[int, str]] = []   # (col_idx, port_code)
    total_col: int | None = None
    for c, h in enumerate(headers):
        if c == 0 or not h:
            continue
        if h.lower() == "total":
            total_col = c
        else:
            port_cols.append((c, h))

    by_origin: dict[str, dict] = {}
    r = header_row + 1
    while r < sheet.nrows:
        label = str(sheet.cell_value(r, 0)).strip()
        low = label.lower()
        if not label:
            r += 1; continue
        if low.startswith("total in bags") or low.startswith("total"):
            break
        ports = {p: _to_int(sheet.cell_value(r, c)) for c, p in port_cols}
        origin_total = _to_int(sheet.cell_value(r, total_col)) if total_col is not None else sum(ports.values())
        grp = group_of(label) or "Unknown"
        by_origin[label] = {"by_port": ports, "group": grp, "total": origin_total}
        r += 1

    by_port = {p: sum(o["by_port"].get(p, 0) for o in by_origin.values()) for _, p in port_cols}
    by_group: dict[str, int] = {}
    for o in by_origin.values():
        by_group[o["group"]] = by_group.get(o["group"], 0) + o["total"]
    grand_total = sum(o["total"] for o in by_origin.values())

    return {
        "ports":       [p for _, p in port_cols],
        "by_origin":   by_origin,
        "by_port":     by_port,
        "by_group":    by_group,
        "grand_total": grand_total,
    }


def _parse_grading_summary(sheet, section_row: int) -> dict:
    """The "TODAY'S GRADING SUMMARY" section is text on no-action days
    ("No Bags Passed Today" / "No Bags Failed Today") and likely a table or
    counted text on action days — we parse a leading integer ("123 Bags
    Passed…") or fall back to 0 for "No"."""
    passed = failed = 0
    passed_text = failed_text = None
    for r in range(section_row + 1, min(section_row + 12, sheet.nrows)):
        text = str(sheet.cell_value(r, 0)).strip()
        if not text:
            continue
        if "pending grading" in text.lower() or "flagged for rebagging" in text.lower():
            break
        m = _BAG_COUNT.match(text)
        if not m:
            continue
        token, kind = m.group(1), m.group(2).lower()
        n = 0 if token.lower() == "no" else int(token.replace(",", ""))
        if kind == "passed":
            passed = n; passed_text = text
        else:
            failed = n; failed_text = text
    return {
        "passed_today_bags": passed,
        "failed_today_bags": failed,
        "passed_text":       passed_text,
        "failed_text":       failed_text,
    }


def parse_arabica_xls(content: bytes) -> dict:
    wb = xlrd.open_workbook(file_contents=content)
    sheet = wb.sheet_by_index(0)

    # Report date — "As of: May 27, 2026  1:34:30PM" lives in the first ~4 rows.
    report_date_iso: str | None = None
    for r in range(min(5, sheet.nrows)):
        v = str(sheet.cell_value(r, 0))
        m = _AS_OF.search(v)
        if m:
            try:
                report_date_iso = datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat()
            except ValueError:
                pass
            break

    sections = _find_sections(sheet)
    out = {
        "report_date":    report_date_iso,
        "total_certified": _parse_matrix(sheet, sections["total_certified"]) if "total_certified" in sections else None,
        "transition":      _parse_matrix(sheet, sections["transition"])      if "transition"      in sections else None,
        "pending_grading": _parse_matrix(sheet, sections["pending_grading"]) if "pending_grading" in sections else None,
        "rebagging":       _parse_matrix(sheet, sections["rebagging"])      if "rebagging"      in sections else None,
        "grading_today":   _parse_grading_summary(sheet, sections["grading_summary"]) if "grading_summary" in sections else None,
    }
    return out
