"""Tests for backfill_ecf_history.py parsing (no network).
Uses the REAL ECF table shapes confirmed from the yearly PDFs: end-of-month
date headers ('31-Dec-17') with spacer columns that offset values from their
header cell, port labels pre-2020 and coffee-type labels from 2020 on."""
from scraper.backfill_ecf_history import (
    YEARLY_PDFS,
    _classify,
    _date_to_period,
    _ecf_tonnes,
    _finalise,
    _parse_table,
)


def test_date_header_parsing():
    assert _date_to_period("31-Dec-17") == "2017-12"
    assert _date_to_period("29-Feb-20") == "2020-02"
    assert _date_to_period("31-Jan-2026") == "2026-01"
    assert _date_to_period("Antwerp") is None
    assert _date_to_period("Port") is None


def test_ecf_tonnes_strips_separators():
    assert _ecf_tonnes("321.519") == 321519   # dot thousands (older PDFs)
    assert _ecf_tonnes("346,220") == 346220   # comma thousands (newer PDFs)
    assert _ecf_tonnes(None) is None
    assert _ecf_tonnes("Antwerp") is None


def test_classify_port_type_total():
    assert _classify("Antwerp") == ("port", "Antwerp")
    assert _classify("Robusta") == ("type", "robusta_mt")
    assert _classify("Natural Arabica") == ("type", "arabica_unwashed_mt")
    assert _classify("Washed Arabica") == ("type", "arabica_washed_mt")
    assert _classify("Total") == ("total", "total")


def test_parse_real_by_port_table_offset_values():
    """Pre-2020 layout: values sit one cell left of their date header; ordered
    zip must still line them up."""
    table = [
        ["", "Port", "", "", "31-Dec-17", "", "", "31-Jan-18"],
        ["Antwerp", None, None, "321.519", None, None, "313.109", None],
        ["Hamburg", None, None, "112.379", None, None, "115.997", None],
    ]
    pm: dict = {}
    assert _parse_table(table, 2018, "u", pm) == 4
    out = {e["period"]: e for e in _finalise(pm)}
    assert out["2017-12"]["ports"] == {"Antwerp": 321_519, "Hamburg": 112_379}
    assert out["2018-01"]["ports"]["Antwerp"] == 313_109
    # total falls back to sum of ports
    assert out["2017-12"]["value_mt"] == 321_519 + 112_379


def test_parse_real_by_type_table():
    """2020+ layout: coffee-type rows → type breakdown; total = sum of types."""
    table = [
        ["", "Type of coffee", "", "", "31-Jan-20", "", "", "29-Feb-20"],
        ["Robusta", None, None, "312.468", None, None, "308.197", None],
        ["Natural Arabica", None, None, "202.536", None, None, "202.652", None],
    ]
    pm: dict = {}
    assert _parse_table(table, 2020, "u", pm) == 4
    out = {e["period"]: e for e in _finalise(pm)}
    # Type fields are emitted FLAT (the shape StocksPanel reads).
    assert out["2020-01"]["robusta_mt"] == 312_468
    assert out["2020-01"]["arabica_unwashed_mt"] == 202_536
    assert out["2020-01"]["value_mt"] == 312_468 + 202_536


def test_implausible_total_dropped_but_breakdown_kept():
    """A mis-parsed total outside the European band is dropped; ports kept."""
    table = [
        ["", "Port", "", "", "31-Feb-14"],   # single bad value → tiny total
        ["Antwerp", None, None, "874", None],
    ]
    pm: dict = {}
    _parse_table(table, 2014, "u", pm)
    out = {e["period"]: e for e in _finalise(pm)}
    e = out["2014-02"]
    assert "value_mt" not in e          # 874 t dropped
    assert e["ports"] == {"Antwerp": 874}  # breakdown still retained


def test_parse_ignores_non_date_tables():
    table = [["Disclaimer:", "text"], ["more", "text"]]
    pm: dict = {}
    assert _parse_table(table, 2019, "u", pm) == 0


def test_pdf_list_covers_2014_to_present():
    assert min(YEARLY_PDFS) == 2014
    assert 2025 in YEARLY_PDFS and 2026 in YEARLY_PDFS
    assert "_updated" in YEARLY_PDFS[2021]
