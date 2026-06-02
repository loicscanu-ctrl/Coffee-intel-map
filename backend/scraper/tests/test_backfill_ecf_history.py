"""Tests for backfill_ecf_history.py table parsing (no network).
Exercises both PDF table orientations and the total/port/type classification."""
from scraper.backfill_ecf_history import (
    YEARLY_PDFS,
    _classify,
    _finalise,
    _month_in,
    _parse_table,
)


def test_classify_distinguishes_total_type_port():
    assert _classify("Total") == ("total", "total")
    assert _classify("Grand Total") == ("total", "total")
    assert _classify("Robusta") == ("type", "robusta_mt")
    assert _classify("Arabica Washed") == ("type", "arabica_washed_mt")
    assert _classify("Antwerp") == ("port", "Antwerp")
    assert _classify("Le Havre") == ("port", "Le Havre")


def test_month_in_recognises_names_and_abbreviations():
    assert _month_in("Jan") == 1
    assert _month_in("February") == 2
    assert _month_in("Dec.") == 12
    assert _month_in("Port") is None


def test_orientation_a_months_in_header_ports_in_rows():
    """Pre-2020 layout: ports down the side, months across the top, plus Total."""
    table = [
        ["Port", "Jan", "Feb"],
        ["Antwerp", "120,000", "118,500"],
        ["Hamburg", "95,000", "97,200"],
        ["Total", "215,000", "215,700"],
    ]
    pm: dict = {}
    assert _parse_table(table, 2018, "u", pm) == 6
    out = {e["period"]: e for e in _finalise(pm)}
    assert out["2018-01"]["value_mt"] == 215_000
    assert out["2018-01"]["ports"] == {"Antwerp": 120_000, "Hamburg": 95_000}
    # 215,000 t / 60 kg ≈ 3,583,333 bags
    assert out["2018-01"]["value_raw"] == 3_583_333


def test_orientation_b_months_in_rows_types_in_columns():
    """2020+ layout variant: month rows, type columns."""
    table = [
        ["Month 2021", "Arabica Washed", "Robusta", "Total"],
        ["January", "200,000", "150,000", "350,000"],
        ["February", "210,000", "148,000", "358,000"],
    ]
    pm: dict = {}
    assert _parse_table(table, 2021, "u", pm) == 6
    out = {e["period"]: e for e in _finalise(pm)}
    assert out["2021-01"]["value_mt"] == 350_000
    assert out["2021-01"]["types"]["arabica_washed_mt"] == 200_000
    assert out["2021-01"]["types"]["robusta_mt"] == 150_000


def test_total_summed_from_ports_when_no_total_row():
    table = [
        ["Port", "Jan"],
        ["Antwerp", "100,000"],
        ["Hamburg", "50,000"],
    ]
    pm: dict = {}
    _parse_table(table, 2016, "u", pm)
    out = {e["period"]: e for e in _finalise(pm)}
    assert out["2016-01"]["value_mt"] == 150_000  # summed from ports


def test_pdf_list_covers_2014_to_present():
    assert min(YEARLY_PDFS) == 2014
    assert 2025 in YEARLY_PDFS and 2026 in YEARLY_PDFS
    # 2021 is the corrected "_updated" re-issue.
    assert "_updated" in YEARLY_PDFS[2021]
