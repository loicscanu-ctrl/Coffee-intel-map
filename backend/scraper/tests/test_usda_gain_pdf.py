"""Tests for scraper.sources.usda_gain_pdf.

The PDF download path requires network; tests focus on the text parser
(`parse_psd_text`) and the reshaper, since the PDF text layout is the
brittle part. A synthetic text block modelled after the BR2026-0025
Brazil Coffee Annual PSD table exercises the realistic case (two
sub-columns per year, three years on the right of the table).
"""
from __future__ import annotations

from scraper.sources import usda_gain_pdf as gain

# Synthetic PSD-table text — mirrors the BR2026-0025 layout the parser
# actually has to handle. Numbers are USDA's native "1000 60-kg bags".
# Three Market Years (MY24/25, MY25/26, MY26/27) × two sub-columns each
# (USDA Official, New Post) = six values per row.
_BR_PSD = """\
Coffee, Green             Brazil

Market Year Begin: Jul 2024    Market Year Begin: Jul 2025    Market Year Begin: Jul 2026
                  USDA Official  New Post  USDA Official  New Post  USDA Official  New Post

Beginning Stocks       4250        4250        4810        4810           0        2150
Production            54500       54500       66200       63000           0       71900
Bean Imports              0           0           0           0           0           0
Bean Exports          33500       33500       36500       38000           0       45000
Soluble Exports        4250        4250        4500        4500           0        4000
Roast & Ground Exports   70          70          70          70           0          70
Domestic Consumption  22000       22000       22500       22500           0       22500
Ending Stocks          4810        4810        2150        2150           0        2980
"""


def test_parser_extracts_three_marketing_years():
    parsed = gain.parse_psd_text(_BR_PSD)
    # USDA labels MYs by ending year — Jul 2024 begin → "2025" label.
    assert set(parsed) == {"2025", "2026", "2027"}


def test_parser_picks_new_post_when_zero_in_official_column():
    """USDA leaves "USDA Official" at 0 for an unrevised forecast year and
    publishes the projection in "New Post" — the parser must pick the
    rightmost non-zero cell within each year's sub-columns."""
    parsed = gain.parse_psd_text(_BR_PSD)
    # MY26/27 (Jul 2026 begin → "2027" label):
    #   USDA Official = 0, New Post = 45000 → should pick 45000.
    assert parsed["2027"]["exports_mt"] == 45000 * 60   # → 2,700,000 MT


def test_parser_picks_realized_value_when_both_columns_match():
    """For a realized year both sub-columns carry the same number; parser
    just picks one (rightmost). Verify the canonical realized year."""
    parsed = gain.parse_psd_text(_BR_PSD)
    # MY24/25 → "2025": Production both columns 54500.
    assert parsed["2025"]["production_mt"] == 54500 * 60


def test_parser_handles_zero_cells_in_legitimate_rows():
    """Some attributes (Roast & Ground Exports, Bean Imports) are zero
    across all sub-columns — the parser must still emit them as 0 rather
    than dropping the row."""
    parsed = gain.parse_psd_text(_BR_PSD)
    # Bean Imports is 0 across the board.
    assert parsed["2027"]["imports_mt"] == 0
    # Roast & Ground Exports forecast is 70 (× 60 → 4200 MT).
    assert parsed["2027"]["roast_exports_mt"] == 70 * 60


def test_parser_returns_empty_when_no_year_header_found():
    """Defensive — if USDA's layout drifts beyond recognition, return {}
    so the merger silently skips this origin."""
    junk = "this is not a PSD table\nthere are no Market Year markers here"
    assert gain.parse_psd_text(junk) == {}


def test_parser_handles_comma_thousands():
    """USDA mixes 'Production 54,500' and 'Production 54500' across reports.
    Both must parse to the same value."""
    with_commas = _BR_PSD.replace("54500", "54,500").replace("63000", "63,000").replace("71900", "71,900")
    parsed = gain.parse_psd_text(with_commas)
    assert parsed["2026"]["production_mt"] == 63_000 * 60


def test_to_psd_coffee_shape_promotes_total_to_exports_mt():
    """The shaper must sum bean+soluble+roast into a single `exports_mt`
    so demand_stocks's downstream consumers (brazil_export_forecast) see
    the Cecafé-comparable total instead of green-only. Bean exports are
    preserved separately as `bean_exports_mt` for traceability."""
    parsed = gain.parse_psd_text(_BR_PSD)
    shaped = gain.to_psd_coffee_shape(parsed, "brazil")
    assert shaped is not None
    assert shaped["latest_year"] == "2027"
    # MY 26/27: 45k + 4k + 0.07k = 49.07k thousand-bags → ×60 = 2,944,200 MT.
    assert shaped["latest_exports_mt"] == (45000 + 4000 + 70) * 60
    last = shaped["annual"][-1]
    assert last["bean_exports_mt"]    == 45000 * 60   # green-only, retained
    assert last["soluble_exports_mt"] == 4000  * 60
    assert last["roast_exports_mt"]   == 70    * 60
    # Sanity: bags-equivalent total matches the BR2026-0025 published 49.07M.
    total_export_kbags = last["exports_mt"] / 60
    assert total_export_kbags == 49_070               # 49.07M bags
    # Production unaffected by export totaling.
    assert shaped["latest_production_mt"] == 71900 * 60


def test_to_psd_coffee_shape_returns_none_on_empty_parse():
    assert gain.to_psd_coffee_shape({}, "brazil") is None


def test_market_year_label_uses_ending_year():
    """USDA's PSD convention: MY that begins Jul 2026 → labelled "2027"
    (the ending year). The label downstream of `parse_psd_text` and the
    label coming out of `psd_coffee.py` (Market_Year column) must match
    exactly for the export_stocks merger to dedupe correctly."""
    assert gain._market_year_label(2024) == "2025"
    assert gain._market_year_label(2026) == "2027"


# ── merger (in export_stocks.py) ─────────────────────────────────────────────

def test_merge_appends_only_forward_years():
    """The merger must NOT overwrite years the PSD CSV already publishes —
    the CSV is the canonical realized series. Only forward years (not in
    the CSV's `annual`) get appended from the GAIN block."""
    from scraper.export_stocks import _merge_gain_into_producer

    psd_producer = {
        "latest_year": "2025",
        "latest_exports_mt": 2_220_000,
        "annual": [
            {"year": "2024", "exports_mt": 2_460_000},
            {"year": "2025", "exports_mt": 2_220_000},
        ],
    }
    gain_block = {
        "annual": [
            # GAIN reports typically carry the three relevant years.
            {"year": "2025", "exports_mt": 2_269_200},   # should be IGNORED (CSV wins)
            {"year": "2026", "exports_mt": 2_550_000},
            {"year": "2027", "exports_mt": 2_944_200},   # 49.07M bags × 60
        ],
    }
    merged = _merge_gain_into_producer(psd_producer, gain_block)
    years = [row["year"] for row in merged["annual"]]
    assert years == ["2024", "2025", "2026", "2027"]
    # CSV's 2025 value is intact, NOT GAIN's revision:
    row_2025 = next(r for r in merged["annual"] if r["year"] == "2025")
    assert row_2025["exports_mt"] == 2_220_000
    # latest_year is now the forward forecast:
    assert merged["latest_year"] == "2027"
    assert merged["latest_exports_mt"] == 2_944_200


def test_merge_is_noop_when_gain_block_missing():
    from scraper.export_stocks import _merge_gain_into_producer

    psd_producer = {"latest_year": "2025", "annual": [{"year": "2025"}]}
    assert _merge_gain_into_producer(psd_producer, None) == psd_producer
    assert _merge_gain_into_producer(psd_producer, {}) == psd_producer
