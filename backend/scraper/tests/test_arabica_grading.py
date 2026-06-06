"""Arabica daily-xls grading-summary parsing.

ICE changed the "TODAY'S GRADING SUMMARY" layout in June 2026 — from a
one-line "N Bags Passed Today" to an origin×port matrix under
"BAGS PASSED/FAILED GRADING" headers — and switched the "As of:" date to an
abbreviated month. These tests pin both layouts so a future regression is
caught instead of silently reading grading as 0.
"""
from __future__ import annotations

from datetime import datetime

from scraper.sources.ice_certified_stocks.parse_arabica_xls import (
    _AS_OF,
    _parse_grading_summary,
)


class _FakeSheet:
    """Minimal xlrd-sheet stand-in: a list of rows (lists of cell values)."""

    def __init__(self, rows: list[list]):
        self.rows = rows
        self.nrows = len(rows)
        self.ncols = max((len(r) for r in rows), default=0)

    def cell_value(self, r: int, c: int):
        row = self.rows[r]
        return row[c] if c < len(row) else ""


_HEAD = [["ICE Futures U.S."]] * 55  # grading summary starts at row 55


def test_grading_matrix_action_day():
    """June-2026+ matrix layout — grand total from the 'Total in Bags' row."""
    rows = _HEAD + [
        ["TODAY'S GRADING SUMMARY"],
        ["BAGS PASSED GRADING"],
        [""],
        ["", "ANT", "BAR", "HA/BR", "HOU", "MIAMI", "NOLA", "NY", "VA", "Total"],
        ["Honduras", "825.0", "0", "0", "0", "0", "0", "0", "0", "825.0"],
        ["Total in Bags", "825.0", "0", "0", "0", "0", "0", "0", "0", "825.0"],
        [""], [""],
        ["BAGS FAILED GRADING"],
        [""],
        ["", "ANT", "BAR", "HA/BR", "HOU", "MIAMI", "NOLA", "NY", "VA", "Total"],
        ["Honduras", "275.0", "0", "0", "0", "0", "0", "0", "0", "275.0"],
        ["Total in Bags", "275.0", "0", "0", "0", "0", "0", "0", "0", "275.0"],
        ["Pending Grading Report"],
    ]
    out = _parse_grading_summary(_FakeSheet(rows), 55)
    assert out["passed_today_bags"] == 825
    assert out["failed_today_bags"] == 275
    # The full origin × port matrix is retained (not just the grand total),
    # so gradings can be attributed to (origin, port) cohorts.
    assert out["passed_detail"]["by_origin"]["Honduras"]["by_port"]["ANT"] == 825
    assert out["passed_detail"]["by_port"]["ANT"] == 825
    assert out["failed_detail"]["by_origin"]["Honduras"]["total"] == 275


def test_grading_no_action_text():
    rows = _HEAD + [
        ["TODAY'S GRADING SUMMARY"],
        ["No Bags Passed Today"],
        ["No Bags Failed Today"],
        ["Pending Grading Report"],
    ]
    out = _parse_grading_summary(_FakeSheet(rows), 55)
    assert out["passed_today_bags"] == 0
    assert out["failed_today_bags"] == 0
    # Legacy/no-action layout has no per-origin matrix.
    assert out["passed_detail"] is None and out["failed_detail"] is None


def test_grading_legacy_text():
    rows = _HEAD + [
        ["TODAY'S GRADING SUMMARY"],
        ["5,184 Bags Passed Today"],
        ["3671 Bags Failed Today"],
        ["Pending Grading Report"],
    ]
    out = _parse_grading_summary(_FakeSheet(rows), 55)
    assert out["passed_today_bags"] == 5184
    assert out["failed_today_bags"] == 3671


def test_as_of_abbreviated_and_full_month():
    cases = {
        "As of: Jun 2, 2026  1:32:33PM": "2026-06-02",
        "As of: May 27, 2026  1:34:30PM": "2026-05-27",
        "As of: April 30, 2026": "2026-04-30",
    }
    for text, expected in cases.items():
        m = _AS_OF.search(text)
        assert m, text
        iso = None
        for fmt in ("%b %d, %Y", "%B %d, %Y"):
            try:
                iso = datetime.strptime(m.group(1), fmt).date().isoformat()
                break
            except ValueError:
                continue
        assert iso == expected, (text, iso)
