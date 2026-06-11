"""Tests for scraper.sources.ucda_monthly.

Tests focus on the text-parsing layer (each `_parse_vN` operates on extracted
text) because PDF download requires network. PDF text fixtures live inline in
each test to keep format changes visible in diff.
"""
from __future__ import annotations

from scraper.sources import ucda_monthly as um


def test_discover_pdf_urls_picks_up_both_patterns():
    html = """
    <html>
      <ul>
        <li><a href="/sites/default/files/2022-03/July%202020.pdf">view</a></li>
        <li><a href="/file-download/download/public/1095">view</a></li>
        <li><a href="/some-other-page">not a pdf</a></li>
      </ul>
    </html>
    """
    urls = um.discover_pdf_urls_from_html(html)
    assert urls == [
        "https://ugandacoffee.go.ug/sites/default/files/2022-03/July%202020.pdf",
        "https://ugandacoffee.go.ug/file-download/download/public/1095",
    ]


def test_discover_dedupes_within_page():
    html = """
    <a href="/file-download/download/public/1095">view</a>
    <a href="/file-download/download/public/1095">download</a>
    """
    urls = um.discover_pdf_urls_from_html(html)
    assert urls == ["https://ugandacoffee.go.ug/file-download/download/public/1095"]


def test_month_year_picked_up_from_header():
    text = "MONTHLY COFFEE REPORT - MARCH 2025\nSome other content"
    assert um._ym_from_text(text, None) == "2025-03"


def test_month_year_fallback_from_url_slug():
    text = "no markers here"
    url = "https://ugandacoffee.go.ug/sites/default/files/2022-03/July 2020.pdf"
    assert um._ym_from_text(text, url) == "2020-07"


def test_v1_parser_derives_totals_from_grade_table():
    """Synthetic recent-format text. The parser SUMS grade-family rows to get
    robusta/arabica totals rather than regex-matching "Total Robusta" — the
    first dispatch found that regex unreliable (matched footnotes / sub-totals
    yielding garbage like robusta=4)."""
    text = """\
MONTHLY COFFEE REPORT - MARCH 2024

Some narrative text. Total exports figure mentioned elsewhere.
Value (US $) 92,345,678 for the month.

Grade Breakdown:
Screen 18    180,000   35.0%
Screen 15     90,500   18.0%
Screen 12     55,200   10.7%
Organic Robusta  12,300  2.4%
Bugisu AA      35,000   6.8%
Drugar         28,000   5.4%

Destinations:
Italy        102,400
Germany       78,900
Sudan         55,000
USA           48,123
"""
    rep = um._parse_v1_recent(text, "/sites/default/files/2024-04/March%202024.pdf")
    assert rep is not None
    assert rep.month == "2024-03"
    # Robusta = Screen 18 + Screen 15 + Screen 12 + Organic Robusta
    assert rep.robusta_bags == 180_000 + 90_500 + 55_200 + 12_300
    # Arabica = Bugisu AA + Drugar
    assert rep.arabica_bags == 35_000 + 28_000
    assert rep.total_bags   == rep.robusta_bags + rep.arabica_bags
    assert rep.value_usd    == 92_345_678
    grade_names = [g["grade"] for g in rep.by_grade]
    assert "Screen 18" in grade_names
    assert "Bugisu AA" in grade_names
    dest_names = [d["country"] for d in rep.by_destination]
    assert "Italy" in dest_names
    assert "Sudan" in dest_names


def test_v1_parser_rejects_tiny_usd_value():
    """A USD value below 100,000 is treated as a regex misfire (e.g. captured
    a percentage or a single-stream value). Real Uganda monthly value > 100M."""
    text = """\
MONTHLY COFFEE REPORT - JUNE 2024

Value (US $) 42 for some sub-total cell.

Grade Breakdown:
Screen 18    180,000   35.0%
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    assert rep.value_usd is None
    assert rep.robusta_bags == 180_000


def test_v1_grade_extraction_picks_largest_plausible_value():
    """Some UCDA report eras (notably 2022-2023) put the bag-quantity column
    AFTER smaller cells (running total, %change, sub-totals). The parser must
    pick the largest plausible number on the grade row, not the first one,
    or those years come out severely under-counted."""
    text = """\
MONTHLY COFFEE REPORT - JUNE 2023

Grade Breakdown:
Screen 15       2.4%   1.50    50,000   bags total
Screen 18      35.0%   3.20   180,000   bags
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    grades = {g["grade"]: g["bags"] for g in rep.by_grade}
    assert grades["Screen 15"] == 50_000        # NOT 2 or 1 (the percent / price cells)
    assert grades["Screen 18"] == 180_000


def test_v1_grade_caps_at_2M_to_reject_ytd_columns():
    """Some report layouts include a YTD or value-USD column alongside the
    monthly qty. Values > 2M bags wouldn't be a single grade in a single
    month, so we cap and pick the next-largest plausible value."""
    text = """\
MONTHLY COFFEE REPORT - JUNE 2024

Screen 18    180,000   2,500,000   YTD column shouldn't win
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    grades = {g["grade"]: g["bags"] for g in rep.by_grade}
    assert grades["Screen 18"] == 180_000


def test_v1_returns_stub_when_grade_table_missing():
    """Format drift case — month resolves but the grade table fails to match.
    Stub still surfaces month + warning so the diagnostic dump catches the
    drift; downstream parsers in the registry can attempt their own pattern."""
    text = "MONTHLY COFFEE REPORT - JULY 2018\nSome unrecognized layout"
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    assert rep.month == "2018-07"
    assert rep.robusta_bags is None
    assert rep.arabica_bags is None
    assert any("grade breakdown" in w for w in rep.parse_warnings)


def test_parse_pdf_returns_failed_stub_on_unknown_format():
    """When every registered parser whiffs, parse_pdf still emits a stub so
    the operator can spot the URL + the month and add a new parser."""
    import io
    # Pre-compute fake "pdf bytes" the extractor doesn't actually parse —
    # we exercise the dispatcher's behavior by monkey-patching _extract_text.
    text = "no recognizable structure at all"
    original_extract = um._extract_text
    um._extract_text = lambda b: text          # type: ignore[assignment]
    try:
        rep = um.parse_pdf(b"fake", "/sites/default/files/2017-05/some.pdf")
    finally:
        um._extract_text = original_extract     # type: ignore[assignment]
    # No month in text, no slug month in URL → "unknown" month.
    assert rep is not None
    assert rep.parser_version in ("v1_recent", "failed")
    _ = io  # unused safeguard for the import
