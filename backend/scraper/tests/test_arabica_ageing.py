"""Unit tests for the Arabica ageing-report header sniffer + bag extractor."""

from datetime import date

from scraper.sources.ice_certified_stocks.parse_arabica_ageing import (
    _band_from_header,
    fetch_url_for,
    parse_ageing_sheet,
)


# ── Band-header sniffer ─────────────────────────────────────────────────────

def test_band_from_header_year_ranges():
    assert _band_from_header("0-1 Year") == "0Y"
    assert _band_from_header("1-2 Year") == "1Y"
    assert _band_from_header("2-3 Year") == "2Y"
    assert _band_from_header("3-4 Year") == "3Y"
    assert _band_from_header("Over 4 Year") == ">4Y"
    assert _band_from_header("4+ Year") == ">4Y"


def test_band_from_header_day_ranges():
    assert _band_from_header("0-365") == "0Y"
    assert _band_from_header("366-730") == "1Y"
    assert _band_from_header("731-1095") == "2Y"
    assert _band_from_header("1096-1460") == "3Y"
    assert _band_from_header("1461+") == ">4Y"


def test_band_from_header_unknown():
    assert _band_from_header("Origin") is None
    assert _band_from_header("Total") is None
    assert _band_from_header("") is None


# ── URL template ────────────────────────────────────────────────────────────

def test_fetch_url_for_month_end():
    assert fetch_url_for(date(2026, 4, 30)) == (
        "https://www.ice.com/publicdocs/futures_us_reports/coffee/coffee_aging_20260430.xls"
    )
    assert fetch_url_for(date(2026, 3, 31)) == (
        "https://www.ice.com/publicdocs/futures_us_reports/coffee/coffee_aging_20260331.xls"
    )


# ── End-to-end extraction (stub sheet — no xlwt needed) ─────────────────────

class _StubSheet:
    """Minimal xlrd sheet-protocol stub: feed it a 2D matrix of cells."""

    def __init__(self, rows: list[list]):
        self._rows = rows
        self.nrows = len(rows)
        self.ncols = max((len(r) for r in rows), default=0)

    def cell_value(self, r: int, c: int):
        row = self._rows[r]
        return row[c] if c < len(row) else ""


def test_parse_ageing_sheet_full_roundtrip():
    rows = [
        ["ICE Coffee C Ageing Report", "", "", "", "", "", ""],
        ["", "", "", "", "", "", ""],
        ["Origin",       "0-1 Year", "1-2 Year", "2-3 Year", "3-4 Year", "Over 4 Year", "Total"],
        ["Honduras",      40000,      20000,      10000,       5000,       2000,        77000],
        ["Brazil",        10000,       4000,       2000,        500,        100,        16600],
        ["Colombia",      15000,       6000,       1000,          0,          0,        22000],
        ["",                  "",         "",         "",         "",         "",          ""],
        ["Grand Total",   65000,      30000,      13000,       5500,       2100,       115600],
    ]
    data = parse_ageing_sheet(_StubSheet(rows), "http://test", date(2026, 4, 30))
    assert data["month_end"] == "2026-04-30"
    assert set(data["by_origin_band"].keys()) == {"Honduras", "Brazil", "Colombia"}
    assert data["by_origin_band"]["Honduras"] == {
        "0Y": 40000, "1Y": 20000, "2Y": 10000, "3Y": 5000, ">4Y": 2000,
    }
    assert data["by_band"]["0Y"]  == 40000 + 10000 + 15000
    assert data["by_band"][">4Y"] ==  2000 +   100 +     0
    assert data["grand_total"]    == 77000 + 16600 + 22000
    # "Grand Total" row must NOT be counted as an origin.
    assert "Grand Total" not in data["origins"]
    # parser_notes contains at least the summary line.
    assert any("origins" in n for n in data["parser_notes"])


def test_parse_ageing_sheet_no_header_returns_empty():
    rows = [["header-less filler"], ["more filler"]]
    data = parse_ageing_sheet(_StubSheet(rows), "http://test", date(2026, 4, 30))
    assert data["by_origin_band"] == {}
    assert any("no header row matched" in n for n in data["parser_notes"])


def test_parse_ageing_sheet_day_range_headers():
    # Some ICE files have used day-range column headers in the past.
    rows = [
        ["Coffee",   "0-365", "366-730", "731-1095", "1096-1460", "1461+"],
        ["Honduras",  500,     200,        100,         50,         10],
    ]
    data = parse_ageing_sheet(_StubSheet(rows), "http://test", date(2026, 4, 30))
    assert data["by_origin_band"]["Honduras"] == {
        "0Y": 500, "1Y": 200, "2Y": 100, "3Y": 50, ">4Y": 10,
    }
