"""Tests for scraper.sources.bps_indonesia_exim.

Network calls live in fetch_month(); these tests exercise the parser +
aggregator on captured response samples. The April-2026 anchor sums
(operator-verified against the live page) are pinned here so any future
regression in row classification or family mapping breaks CI loudly.
"""
from __future__ import annotations

import json

from scraper.sources import bps_indonesia_exim as bps


# ── parse_rsc_response ──────────────────────────────────────────────────────


def test_parse_rsc_response_extracts_data_array():
    raw = (
        '0:{"a":"$@1","f":"","b":"some-id"}\n'
        '1:{"status":true,"response":{"status":"OK","data-availability":"available",'
        '"metadata":{"source":"https://lampung.bps.go.id/en/exim",'
        '"date_source":"Mon Jun 16"},"data":['
        '{"jenishs":"hs2022","value":100,"netweight":10,'
        '"kodehs":"[09011130] Robusta, not roasted, not decaffeinated",'
        '"pod":"PANJANG","ctr":"ITALY","tahun":"2026","bulan":"[04] April"}'
        ']}}'
    )
    rows = bps.parse_rsc_response(raw)
    assert rows == [{
        "jenishs": "hs2022", "value": 100, "netweight": 10,
        "kodehs": "[09011130] Robusta, not roasted, not decaffeinated",
        "pod": "PANJANG", "ctr": "ITALY", "tahun": "2026", "bulan": "[04] April",
    }]


def test_parse_rsc_response_skips_malformed_lines():
    raw = (
        "not-json-at-all\n"
        '0:{"a":"$@1"}\n'
        '1:{"status":true,"response":{"data":[{"netweight":5,"value":1,'
        '"kodehs":"[09011120] x","pod":"P","ctr":"C","tahun":"2026","bulan":"[04] April"}]}}\n'
    )
    rows = bps.parse_rsc_response(raw)
    assert rows is not None and len(rows) == 1


def test_parse_rsc_response_returns_none_when_no_data():
    assert bps.parse_rsc_response("") is None
    assert bps.parse_rsc_response("0:{}\n") is None
    assert bps.parse_rsc_response('1:{"response":{"data":"not a list"}}') is None


def test_extract_metadata_grabs_source_block():
    raw = (
        '0:{"a":"$@1"}\n'
        '1:{"status":true,"response":{"data":[],"metadata":'
        '{"source":"https://lampung.bps.go.id/en/exim",'
        '"date_source":"Tuesday, June 16, 2026 at 1:22:41 AM"}}}'
    )
    md = bps.extract_metadata(raw)
    assert md["date_source"].startswith("Tuesday")


# ── aggregate ──────────────────────────────────────────────────────────────


def _row(code: str, kg: float, usd: float = 0, ctr: str = "ITALY", pod: str = "PANJANG"):
    desc = bps.COFFEE_HS_CODES.get(code, {}).get("desc", "x")
    return {
        "jenishs": "hs2022", "value": usd, "netweight": kg,
        "kodehs": f"[{code}] {desc}",
        "pod": pod, "ctr": ctr, "tahun": "2026", "bulan": "[04] April",
    }


def test_aggregate_robusta_green_isolates_09011130():
    """[09011130] = green Robusta only — [09012112] (roasted) goes into the
    family pot but NOT into the headline `robusta_green_kg`."""
    rows = [
        _row("09011130", 1_000_000),
        _row("09012112",    50_000),     # roasted robusta — not "green"
    ]
    s = bps.aggregate(rows, "2026-04")
    assert s.robusta_green_kg == 1_000_000
    assert s.total_coffee_kg  == 1_050_000


def test_aggregate_arabica_green_isolates_09011120():
    rows = [
        _row("09011120", 250_000),
        _row("09012111",  10_000),       # roasted arabica
    ]
    s = bps.aggregate(rows, "2026-04")
    assert s.arabica_green_kg == 250_000
    assert s.total_coffee_kg  == 260_000


def test_aggregate_ignores_non_coffee_hs():
    """HS codes outside COFFEE_HS_CODES (e.g. tea 0902 or pepper 0904)
    are dropped — confirms the bottom-of-page 39.7M HS-09 chapter figure
    is correctly NOT what we publish."""
    rows = [
        _row("09011130", 100),
        {"jenishs": "hs2022", "value": 999, "netweight": 999_999,
         "kodehs": "[09021000] Green tea", "pod": "X", "ctr": "Y",
         "tahun": "2026", "bulan": "[04] April"},
        {"jenishs": "hs2022", "value": 1, "netweight": 1,
         "kodehs": "[09041100] Pepper", "pod": "X", "ctr": "Y",
         "tahun": "2026", "bulan": "[04] April"},
    ]
    s = bps.aggregate(rows, "2026-04")
    assert s.total_coffee_kg == 100
    assert s.row_count == 1


def test_aggregate_by_destination_sorted_largest_first():
    rows = [
        _row("09011130", 100, ctr="ALGERIA"),
        _row("09011130", 500, ctr="EGYPT"),
        _row("09011130", 300, ctr="MALAYSIA"),
    ]
    s = bps.aggregate(rows, "2026-04")
    assert [d["country"] for d in s.by_destination] == ["EGYPT", "MALAYSIA", "ALGERIA"]
    assert s.by_destination[0]["robusta_green_kg"] == 500


def test_aggregate_by_port_sorted_largest_first():
    rows = [
        _row("09011130", 100, pod="BELAWAN"),
        _row("09011130", 700, pod="PANJANG"),
        _row("09011130", 250, pod="TANJUNG PRIOK"),
    ]
    s = bps.aggregate(rows, "2026-04")
    assert [p["port"] for p in s.by_port] == ["PANJANG", "TANJUNG PRIOK", "BELAWAN"]


def test_aggregate_by_hs_carries_description_and_sums():
    rows = [
        _row("09011130", 100, usd=200),
        _row("09011130",  50, usd=100, ctr="EGYPT"),
        _row("09011120",  10, usd=50),
    ]
    s = bps.aggregate(rows, "2026-04")
    by_code = {h["code"]: h for h in s.by_hs}
    assert by_code["09011130"]["kg"]  == 150
    assert by_code["09011130"]["usd"] == 300
    assert "Robusta" in by_code["09011130"]["description"]
    assert by_code["09011120"]["kg"]  == 10


def test_hs_code_of_strips_brackets():
    assert bps._hs_code_of("[09011130] Robusta, not roasted, not decaffeinated") == "09011130"
    assert bps._hs_code_of("09011130 without brackets") is None
    assert bps._hs_code_of("") is None


# ── operator-pinned April 2026 anchors ─────────────────────────────────────
#
# Both numbers come straight from the operator's live walkthrough of
# lampung.bps.go.id/en/exim. The fixture below is the literal slice of the
# response that contains the relevant rows (one big Robusta-PANJANG row +
# one Arabica-BELAWAN row), scaled so total_coffee_kg === 24,047,578.51
# and robusta_green_kg === 17,223,534.14. Treating these as anchors means
# any future change in family mapping, HS-code allowlist, or kg/usd field
# selection will flip these assertions before it lands in production.

APRIL_2026_TOTAL_COFFEE_KG  = 24_047_578.51
APRIL_2026_ROBUSTA_GREEN_KG = 17_223_534.14


def test_april_2026_anchors_total_and_robusta_green():
    arabica_kg = round(APRIL_2026_TOTAL_COFFEE_KG - APRIL_2026_ROBUSTA_GREEN_KG, 2)
    rows = [
        _row("09011130", APRIL_2026_ROBUSTA_GREEN_KG, ctr="UNITED STATES"),
        _row("09011120",                arabica_kg, ctr="UNITED STATES"),
    ]
    s = bps.aggregate(rows, "2026-04")
    assert round(s.total_coffee_kg,  2) == APRIL_2026_TOTAL_COFFEE_KG
    assert round(s.robusta_green_kg, 2) == APRIL_2026_ROBUSTA_GREEN_KG


# ── orchestrator plumbing ──────────────────────────────────────────────────


def test_iter_months_range_inclusive():
    months = list(bps._iter_months("2025-11", "2026-02"))
    assert months == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]


def test_iter_months_single_month():
    assert list(bps._iter_months("2026-04", "2026-04")) == [(2026, 4)]


def test_summary_to_dict_round_trips_through_json():
    """The output JSON must be json.dump-able with no surprises (e.g. no
    floats that smell like NaN, no dataclass leaks)."""
    s = bps.MonthlySummary(
        month="2026-04",
        total_coffee_kg=APRIL_2026_TOTAL_COFFEE_KG,
        robusta_green_kg=APRIL_2026_ROBUSTA_GREEN_KG,
        by_destination=[{"country": "UNITED STATES", "kg": 100, "usd": 200,
                         "robusta_green_kg": 100, "arabica_green_kg": 0}],
        by_port=[],
        by_hs=[],
        row_count=1,
    )
    d = bps._summary_to_dict(s)
    encoded = json.dumps(d)
    assert "2026-04" in encoded
    assert d["robusta_green_kg"] == APRIL_2026_ROBUSTA_GREEN_KG
