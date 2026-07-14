"""Tests for the VN Customs 5X/5N by-country coffee harvester.

The fixtures are the real June-2026 English preliminary bulletins
(files.customs.gov.vn …/2026/7/9/2026-t6-5x(ta-sb).pdf and …-5n(ta-sb).pdf),
so the parser is exercised against the genuine layout, including the
country-block page breaks and YTD-only rows.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from scraper.backfill_vn_customs_country import (
    _candidate_urls,
    _parse_en_number,
    _stems,
    parse_coffee_by_country,
)

_FX = Path(__file__).parent / "fixtures"
_PDF_5X = _FX / "vn_customs_2026-t6-5x_ta-sb.pdf"
_PDF_5N = _FX / "vn_customs_2026-t6-5n_ta-sb.pdf"


# ── number parsing (English comma-thousands — NOT the 2x Vietnamese format) ──

def test_parse_en_number():
    assert _parse_en_number("15,501,977") == 15501977.0
    assert _parse_en_number("3,667") == 3667.0
    assert _parse_en_number("77") == 77.0
    assert _parse_en_number("1,234.5") == 1234.5
    assert _parse_en_number("garbage") == 0.0


# ── URL prediction ────────────────────────────────────────────────────────────

def test_stems_cover_case_variants():
    stems = _stems(2026, 6, "5x")
    assert "2026-t6-5x(ta-sb).pdf" in stems          # modern lowercase first
    assert stems[0] == "2026-t6-5x(ta-sb).pdf"
    assert "2026-T06-5x(TA-SB).pdf" in stems         # older uppercase variants


def test_known_good_june_2026_url_is_an_early_candidate():
    # The bulletin actually published at /2026/7/9/ — the sweep must reach it
    # within the first handful of tries, not after a 31-day brute force.
    urls = _candidate_urls(2026, 6, "5x")
    known = "https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2026/7/9/2026-t6-5x(ta-sb).pdf"
    assert known in urls[:5]


# ── PDF parsing against the real bulletins ────────────────────────────────────

@pytest.fixture(scope="module")
def rows_5x():
    return parse_coffee_by_country(_PDF_5X.read_bytes())


def test_5x_finds_all_coffee_rows_with_countries(rows_5x):
    assert len(rows_5x) == 37
    assert all(r["country"] for r in rows_5x)        # page breaks resolved
    assert all(r["unit"] == "Ton" for r in rows_5x)


def test_5x_algeria_row_exact(rows_5x):
    r = next(r for r in rows_5x if r["country"] == "Algeria")
    assert r["rm_volume"] == 3667.0
    assert r["rm_value_usd"] == 15501977.0
    assert r["ytd_volume"] == 60070.0
    assert r["ytd_value_usd"] == 257173005.0


def test_5x_country_block_spanning_page_break(rows_5x):
    # Germany's block starts on the previous page; its coffee row must still
    # attribute to Germany (this was the None-country failure mode).
    r = next(r for r in rows_5x if r["country"] == "Germany")
    assert r["rm_volume"] == 14358.0
    assert r["ytd_volume"] == 160074.0


def test_5x_ytd_only_row_has_no_reporting_month(rows_5x):
    # Denmark had no June trade — YTD columns only; RM must be None, and the
    # YTD numbers must not be mis-assigned into the RM columns.
    r = next(r for r in rows_5x if r["country"] == "Denmark")
    assert r["rm_volume"] is None and r["rm_value_usd"] is None
    assert r["ytd_volume"] == 1152.0
    assert r["ytd_value_usd"] == 4626325.0


def test_5x_totals_are_plausible(rows_5x):
    # June 2026 across listed destinations ≈ 114 kt; YTD ≈ 967 kt. Guard the
    # column mapping: a vol/val mix-up would blow these sums out by 1000×.
    assert 50_000 < sum(r["rm_volume"] or 0 for r in rows_5x) < 300_000
    assert 500_000 < sum(r["ytd_volume"] or 0 for r in rows_5x) < 2_000_000


def test_5n_imports_carry_no_coffee_line():
    # Vietnam's coffee imports are folded into 'Other products' in the 5N
    # main-imports nomenclature — the parser must return an empty list, not
    # crash or hallucinate rows.
    assert parse_coffee_by_country(_PDF_5N.read_bytes()) == []
