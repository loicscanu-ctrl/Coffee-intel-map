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


def test_month_year_title_pattern_beats_comparison_mention():
    """Regression for the `/file-download/download/public/{id}` PDFs.
    These PDFs carry no month in the URL, so YM detection falls through to
    a text scan. The actual report (November 2025) had a comparison-period
    line ("December 2024 was the peak month") appear BEFORE the title line
    in pdfplumber's extracted text — the generic first-match picked
    "December 2024" and produced wrong-year duplicate entries. The title-
    shaped pattern ("Monthly Coffee Report - November 2025") now wins."""
    text = (
        "Some narrative referencing December 2024 as last year's peak.\n"
        "MONTHLY COFFEE REPORT - NOVEMBER 2025\n"
        "Then the body of the report."
    )
    # No URL hint — the text scan must still land on the title.
    assert um._ym_from_text(text, None) == "2025-11"


def test_month_year_title_pattern_handles_for_the_month_of_phrasing():
    """Older UCDA layouts phrase the title as "Report for the month of
    January 2022". The title pattern accepts that phrasing too."""
    text = (
        "Reference to October 2023 trade volumes appears in the executive summary.\n"
        "Report for the month of January 2022\n"
        "..."
    )
    assert um._ym_from_text(text, None) == "2022-01"


def test_url_carries_month_helper():
    """Used by the content-fingerprint dedupe to pick the URL-anchored
    detection over the text-scan one. %20 → space normalization needed."""
    assert um._url_carries_month(
        "https://ugandacoffee.go.ug/sites/default/files/2025-07/09-June%202025%20Report.pdf"
    ) is True
    assert um._url_carries_month(
        "https://ugandacoffee.go.ug/sites/default/files/2024-08/July 2024.pdf"
    ) is True
    # Numeric-id URL: no month in slug.
    assert um._url_carries_month(
        "https://ugandacoffee.go.ug/file-download/download/public/1262"
    ) is False
    assert um._url_carries_month(None) is False
    assert um._url_carries_month("") is False


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


def test_split_dest_row_helper():
    """Lock down the cell-split logic across the layouts observed in UCDA's
    PDFs. R / A / T order in the helper is destinational pdfplumber-cell
    semantics, NOT sorted order."""
    # 3 cells (Italy 198,746 / India 38,833 / Germany 69,298 / Belgium 28,170)
    assert um._split_dest_row([183_308, 15_438, 198_746]) == (183_308, 15_438, 198_746)
    assert um._split_dest_row([35_233, 3_600, 38_833])    == (35_233, 3_600, 38_833)
    assert um._split_dest_row([62_875, 6_423, 69_298])    == (62_875, 6_423, 69_298)
    assert um._split_dest_row([27_820, 350, 28_170])      == (27_820, 350, 28_170)
    # 2 cells where Total == Robusta (Sudan, Tunisia — robusta-only)
    assert um._split_dest_row([51_100, 51_100]) == (51_100, 0, 51_100)
    assert um._split_dest_row([21_978, 21_978]) == (21_978, 0, 21_978)
    # 1 cell — partial row
    assert um._split_dest_row([10_000]) == (10_000, 0, 10_000)


def test_split_dest_row_prefers_month_over_ctd_triple():
    """Regression for 2020-23 over-counter pattern. When the report layout
    puts MONTH cells next to CTD/cumulative cells on the same row and both
    triples pass the 250k cap (small destination or early in the crop
    year), pdfplumber's flat-text output gives the parser 6 numbers. The
    earlier behaviour picked max(filtered) = CTD-Total, doubling the row's
    contribution. The split logic now picks the SMALLER (R, A, T) triple."""
    # Italy with month [4500, 600, 5100] + CTD [161,159, 1,310, 162,469].
    nums = [4_500, 600, 5_100, 161_159, 1_310, 162_469]
    assert um._split_dest_row(nums) == (4_500, 600, 5_100)
    # India with month [1200, 150, 1350] + CTD [35,000, 3,600, 38,600].
    nums = [1_200, 150, 1_350, 35_000, 3_600, 38_600]
    assert um._split_dest_row(nums) == (1_200, 150, 1_350)
    # Sanity-check: the existing single-triple test still picks that triple.
    assert um._split_dest_row([183_308, 15_438, 198_746]) == (183_308, 15_438, 198_746)


def test_split_dest_row_rejects_spurious_tiny_triple():
    """A coincidental low-value triple like (33, 12, 45) — e.g. from a row
    number or footnote artifact — must not hijack the real R/A/T. The
    `c >= 500` cutoff filters those out."""
    # Real triple is Italy 183,308/15,438/198,746 — junk triple (10+22=32).
    nums = [10, 22, 32, 183_308, 15_438, 198_746]
    assert um._split_dest_row(nums) == (183_308, 15_438, 198_746)


def test_v1_destination_emits_robusta_arabica_total_split():
    """Each destination row now carries R/A/Total instead of only Total —
    matches the layout the source PDFs publish (Robusta col + Arabica col +
    Total col + %share cols)."""
    text = """\
MONTHLY COFFEE REPORT - AUGUST 2022

Annex 3: Destinations
1 Italy 1 183,308 15,438 198,746 39.67 39.67
2Germany 3 62,875 6,423 69,298 13.83 53.50
3Sudan 2 51,100 51,100 10.20 63.69
4 India 4 35,233 3,600 38,833 7.75 71.44
5Belgium 5 27,820 350 28,170 5.62 77.07
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    by_country = {d["country"]: d for d in rep.by_destination}
    italy = by_country["Italy"]
    assert italy["robusta_bags"] == 183_308
    assert italy["arabica_bags"] == 15_438
    assert italy["bags"]         == 198_746
    germany = by_country["Germany"]
    assert germany["robusta_bags"] == 62_875
    assert germany["arabica_bags"] == 6_423
    assert germany["bags"]         == 69_298
    india = by_country["India"]
    assert india["robusta_bags"] == 35_233
    assert india["arabica_bags"] == 3_600
    assert india["bags"]         == 38_833
    belgium = by_country["Belgium"]
    assert belgium["robusta_bags"] == 27_820
    assert belgium["arabica_bags"] == 350
    assert belgium["bags"]         == 28_170
    # Sudan is robusta-only: total = robusta, arabica = 0
    sudan = by_country["Sudan"]
    assert sudan["robusta_bags"] == 51_100
    assert sudan["arabica_bags"] == 0
    assert sudan["bags"]         == 51_100


def test_v1_destination_matches_country_after_rank_without_space():
    """Regression: "2Germany 3 62,875 ..." with no space between the rank
    number and the country name didn't match `\\bgermany\\b` (digit→letter
    is not a word boundary). Switched to a negative lookbehind on letters
    so both layouts work."""
    text = """\
MONTHLY COFFEE REPORT - AUGUST 2022

1 Italy 1 100,000 50,000 150,000
2Germany 3 62,875 6,423 69,298 13.83 53.50
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    dests = {d["country"]: d["bags"] for d in rep.by_destination}
    assert "Germany" in dests
    assert dests["Germany"] == 69_298
    # The lookbehind still rejects mid-word matches (e.g. "Mauritania"
    # shouldn't trigger "Mauritania"-not-in-list, but neither would a
    # false positive on "germanypoint"). Easy to check Italy stays clean.
    assert "Italy" in dests


def test_v1_destination_rejects_pdfplumber_outliers():
    """Regression for the Feb-2024 India = 20,242,023 outlier. pdfplumber's
    text extraction occasionally concatenates two adjacent cells across rows
    (the "20"-prefix from a row number sticking to the value cell from the
    line below), producing impossible single-month destinations of ~20M bags.
    The 250k cap rejects that and the next plausible cell wins."""
    text = """\
MONTHLY COFFEE REPORT - FEBRUARY 2024

Annex 4: Destinations
Italy        149,362    14,648    164,010   37.74
India   3    20,242,023            48,303   11.11
Germany      34,355      5,090    39,445    9.08
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    dests = {d["country"]: d["bags"] for d in rep.by_destination}
    # The 20.2M outlier is capped out; the parser falls back to the next
    # plausible cell on the row (in pdfplumber's flattened text that's
    # whichever cell ≤ 250k it found first).
    assert "India" in dests
    assert dests["India"] <= 250_000


def test_v1_destination_dedup_keeps_largest_not_first():
    """Sanity-check from main surfaced an August 2022 Germany row of 2,022
    bags because a narrative comparison line ("…exports to Germany of 2,022
    bags reached…") fired the regex BEFORE the real Annex 3 table row
    (69,298 bags). The dedupe pass now keeps max(bags) per country instead
    of first-seen, so the table row wins."""
    text = """\
MONTHLY COFFEE REPORT - AUGUST 2022

Narrative paragraph mentioning Germany 2,022 bags as a prior-month note.
…etc…

Annex 3: Destinations
1 Italy 1 183,308 15,438 198,746 39.67 39.67
2Germany 3 62,875 6,423 69,298 13.83 53.50
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    dests = {d["country"]: d["bags"] for d in rep.by_destination}
    # The table row wins; the narrative 2,022 gets discarded.
    assert dests["Germany"] == 69_298
    # Italy is still correctly captured.
    assert dests["Italy"] == 198_746


def test_extract_destinations_table_slices_at_annex_headers():
    """The table-slicing path scopes the destinations search between the
    Annex header and the next major section, so narrative mentions of
    country names outside that window don't pollute the result."""
    # Tunisia is mentioned in the narrative ("declined to Tunisia 1,500
    # bags") and then again in the table at 21,978. The slicer should pick
    # up the table value only because the narrative is BEFORE the Annex
    # header.
    text = """\
MONTHLY COFFEE REPORT - AUGUST 2022
The month saw declined sales to Tunisia 1,500 bags as wholesalers paused.

Annex 3: Main Destinations of Uganda Coffee by Type
1 Italy 1 183,308 15,438 198,746 39.67 39.67
2Germany 3 62,875 6,423 69,298 13.83 53.50
3Sudan 2 51,100 51,100 10.20 63.69
6Tunisia 21,978 21,978 4.39 81.45

Annex 4: Top Coffee Exporters
The exporter group from Italy held the largest share of 18,000 bags.
"""
    countries = ("italy", "germany", "sudan", "tunisia")
    rows = um._extract_destinations_table(text, countries)
    by_country = {r["country"]: r for r in rows}
    # All four table rows are captured even though they're on consecutive
    # lines (the slicer doesn't care about line breaks within the scope).
    assert by_country["Italy"]["bags"]   == 198_746
    assert by_country["Germany"]["bags"] == 69_298
    assert by_country["Sudan"]["bags"]   == 51_100
    # Tunisia's table value wins; the 1,500 narrative mention BEFORE the
    # Annex header isn't captured because it's outside the slicer's scope.
    assert by_country["Tunisia"]["bags"] == 21_978
    # The "Italy 18,000" mention AFTER "Annex 4" is also excluded.
    assert by_country["Italy"]["bags"] != 18_000


def test_extract_destinations_table_handles_one_line_table():
    """pdfplumber sometimes collapses an entire table onto one physical
    line. The slicer walks country positions within the scope rather than
    splitting by line breaks, so this case works just like multi-line."""
    text = (
        "MONTHLY COFFEE REPORT - JUNE 2025\n"
        "Annex 4: Main Destinations of Uganda Coffee\n"
        "1 Italy 1 100,000 50,000 150,000 30.00 30.00 "
        "2Germany 2 80,000 5,000 85,000 17.00 47.00 "
        "3Sudan 3 60,000 60,000 12.00 59.00 "
        "4 India 4 40,000 5,000 45,000 9.00 68.00\n"
        "End of report."
    )
    countries = ("italy", "germany", "sudan", "india")
    rows = um._extract_destinations_table(text, countries)
    by_country = {r["country"]: r for r in rows}
    assert by_country["Italy"]["bags"]   == 150_000
    assert by_country["Germany"]["bags"] == 85_000
    assert by_country["Sudan"]["bags"]   == 60_000
    assert by_country["India"]["bags"]   == 45_000


def test_extract_destinations_table_falls_back_when_no_marker():
    """No Annex header → return [] so the caller falls back to the
    line-by-line scan (older report formats)."""
    text = """\
MONTHLY COFFEE REPORT - JUNE 2020
Some narrative paragraph without an Annex section header.
1 Italy 100,000
"""
    countries = ("italy",)
    rows = um._extract_destinations_table(text, countries)
    assert rows == []


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
