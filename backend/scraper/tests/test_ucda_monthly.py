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


def test_v1_totals_take_max_of_grade_sum_and_dest_sum():
    """When the grade-table extractor under-counted Robusta (e.g. picked
    the wrong cell on a Screen 15 row) but the destinations table caught
    a fuller picture, the total uses the larger reading. Avoids the
    2020-23 over-counter shape where Σ destinations was already correct
    but Σ grade-table robusta clocked in at ~half the reality."""
    text = """\
MONTHLY COFFEE REPORT - MAY 2022

Grade Breakdown:
Screen 18    50,000   12.5%
Screen 12    20,000   5.0%

Annex 3: Main Destinations
1 Italy 155,170 22,634 177,804 39.5 39.5
2 Germany 41,855 15,692 57,547 12.7 52.2
3 Sudan 48,867 48,867 10.8 63.0
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    # Grade sum: Screen 18 + Screen 12 = 70,000 robusta. No arabica grades.
    # Dest sum: 155,170 + 41,855 + 48,867 = 245,892 robusta;
    #           22,634 + 15,692 + 0       =  38,326 arabica.
    # max merge: robusta = max(70_000, 245_892) = 245_892
    #            arabica = max(0,      38_326)  =  38_326
    assert rep.robusta_bags == 245_892
    assert rep.arabica_bags == 38_326
    assert rep.total_bags   == 245_892 + 38_326


def test_v1_totals_fall_back_to_grade_sum_when_dests_under_count():
    """The opposite direction — destinations table missed some countries
    (e.g. Italy/Germany not picked up on a pptx-converted PDF) but the
    grade table is intact. The total should reflect the grade sum so the
    front-end doesn't quietly drop volume on under-extracted reports."""
    text = """\
MONTHLY COFFEE REPORT - AUGUST 2024

Grade Breakdown:
Screen 18    400,000   55.0%
Screen 15    250,000   35.0%
Bugisu AA     30,000    4.0%

Annex 3: Main Destinations
1 Belgium 10,000 5,000 15,000 5.0 5.0
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    # Grade sum: 400_000 + 250_000 = 650_000 robusta; 30_000 arabica.
    # Dest sum: 10_000 robusta; 5_000 arabica.
    # max merge: robusta = max(650_000, 10_000) = 650_000
    #            arabica = max(30_000,   5_000) =  30_000
    assert rep.robusta_bags == 650_000
    assert rep.arabica_bags == 30_000
    assert rep.total_bags   == 680_000


def test_v1_destinations_pick_month_columns_not_ctd():
    """End-to-end check that _parse_v1_recent produces the MONTH values
    when the row has a month triple AND a CTD/YTD triple side-by-side.
    Synthetic text mimics the 2020-23 era layout where both triples slip
    under the 250k cap (small destination or early-crop-year cells) and
    the previous max-as-Total rule picked the CTD triple, doubling the
    invariant total."""
    text = """\
MONTHLY COFFEE REPORT - SEPTEMBER 2021

Some narrative.

Annex 3: Main Destinations of Uganda Coffee by Type
1 Italy 4,500 600 5,100 1.83 1.83 161,159 1,310 162,469 32.50 32.50
2 Germany 2,000 250 2,250 0.81 2.64 69,645 2,240 71,885 14.38 46.88
3 Sudan 1,800 1,800 0.65 3.29 54,723 927 55,650 11.13 58.01
"""
    rep = um._parse_v1_recent(text, None)
    assert rep is not None
    assert rep.month == "2021-09"
    by_country = {d["country"]: d for d in rep.by_destination}
    # MONTH values land, not CTD.
    assert by_country["Italy"]["bags"]   == 5_100
    assert by_country["Italy"]["robusta_bags"] == 4_500
    assert by_country["Italy"]["arabica_bags"] == 600
    assert by_country["Germany"]["bags"] == 2_250
    assert by_country["Germany"]["robusta_bags"] == 2_000
    assert by_country["Sudan"]["bags"]   == 1_800
    # Sudan is robusta-only: no triple, falls back to T=R=1,800.
    assert by_country["Sudan"]["robusta_bags"] == 1_800
    assert by_country["Sudan"]["arabica_bags"] == 0


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
    # we exercise the dispatcher's behavior by monkey-patching _extract_pages.
    text = "no recognizable structure at all"
    original_extract = um._extract_pages
    um._extract_pages = lambda b: [text]        # type: ignore[assignment]
    try:
        rep = um.parse_pdf(b"fake", "/sites/default/files/2017-05/some.pdf")
    finally:
        um._extract_pages = original_extract    # type: ignore[assignment]
    # No month in text, no slug month in URL → "unknown" month.
    assert rep is not None
    assert rep.parser_version in ("v1_recent", "failed")
    _ = io  # unused safeguard for the import


# ── v2 destinations engine ──────────────────────────────────────────────────
# Fixture text is the operator's verbatim copy-paste from the June 2025 PDF
# (the worst under-counter before v2: 84% of volume missing). Two pages —
# the table wraps and the second page reprints the Annex header.

_JUNE_2025_PAGE_1 = (
    "Annex3:MainDestinationsofUgandaCoffeebyTypeinJune2025 "
    "DESTINATION POSITION HELDIN MAY QUANTITY(60kgbags) %AGEMARKETSHARE "
    "Robusta Arabica Total Individual Cummilative "
    "1 Italy 1 321,460 30,150 351,610 34.67 34.67 "
    "2 Germany 2 106,777 17,162 123,939 12.22 46.90 "
    "3 Sudan 3 79,080 79,080 7.80 54.69 "
    "4 Spain 5 47,914 1,290 49,204 4.85 59.55 "
    "5 India 6 38,358 5,850 44,208 4.36 63.91 "
    "6 Algeria 4 43,054 13 43,067 4.25 68.15 "
    "7 Morocco 8 30,161 999 31,160 3.07 71.23 "
    "8 China 9 27,724 2,768 30,492 3.01 74.23 "
    "9 U.S.A 12 10,675 15,270 25,945 2.56 76.79 "
    "10 Russia 14 23,318 988 24,306 2.40 79.19 "
    "11Belgium 10 13,737 9,952 23,689 2.34 81.52 "
    "12Vietnam 7 21,184 21,184 2.09 83.61 "
    "13Switzerland 33 15,459 1,470 16,929 1.67 85.28 "
    "14Netherlands 11 15,040 1,533 16,573 1.63 86.92 "
    "15Greece 20 15,555 15,555 1.53 88.45 "
    "16Poland 18 10,516 544 11,060 1.09 89.54 "
    "17France 25 9,000 1,072 10,072 0.99 90.53 "
    "18Portugal 17 9,016 653 9,669 0.95 91.49 "
    "19Mexico 42 9,280 9,280 0.92 92.40 "
    "20U.A.E 16 8,024 1,090 9,114 0.90 93.30 "
    "21Latvia 13 5,670 3,340 9,010 0.89 94.19 "
    "22Turkey 22 8,302 640 8,942 0.88 95.07 "
    "23United Kingdom 7,241 1,002 8,243 0.81 95.88 "
    "24Slovenia 26 5,260 5,260 0.52 96.40 "
    "25Egypt 15 4,250 4,250 0.42 96.82 "
    "26Tunisia 30 3,422 640 4,062 0.40 97.22 "
    "Ecuador DESTINATION POSITION QUANTITY(60kgbags) HELDIN MAY "
    "%AGEMARKETSHARE Robusta Arabica Total Individual Cummilative "
    "100 Total 907,058 107,004 1,014,062"
)
_JUNE_2025_PAGE_2 = (
    "Annex3:MainDestinationsofUgandaCoffeebyTypeinJune2025POSITION "
    "QUANTITY(60kgBags) Destination HELDIN MAY %AgeMarketShare "
    "Robusta Arabica Total Individual Cumulative "
    "28Romania 37 100 3,357 3,457 0.34 97.96 "
    "29Lebanon 3,124 3,124 0.31 98.27 "
    "30Jordan 31 2,736 2,736 0.27 98.54 "
    "31Japan 21 655 1,305 1,960 0.19 98.74 "
    "32Australia 35 960 640 1,600 0.16 98.89 "
    "33Canada 40 1,370 1,370 0.14 99.03 "
    "34Albania 29 1,336 1,336 0.13 99.16 "
    "35Saudi Arabia 32 1,280 1,280 0.13 99.29 "
    "36Singapore 39 320 960 1,280 0.13 99.41 "
    "37Austria 45 320 668 988 0.10 99.51 "
    "38 Israel 28 640 320 960 0.09 99.60 "
    "39South Korea 23 640 320 960 0.09 99.70 "
    "40Kenya 46 757 757 0.07 99.77 "
    "41Sweden 19 720 720 0.07 99.85 "
    "42Libya 660 660 0.07 99.91 "
    "43South Africa 24 660 660 0.07 99.98 "
    "44 New Zealand 251 251 0.02 100.00"
)


def test_v2_june_2025_full_fixture():
    """End-to-end on the real June-2025 layout that defeated every earlier
    parser iteration (Italy > 250k cap, rank-glued names, single-type
    pairs, page-wrapped table, mangled Ecuador row at the page break)."""
    rows, published, warnings = um._extract_destinations_v2(
        [_JUNE_2025_PAGE_1, _JUNE_2025_PAGE_2])
    by_country = {r["country"]: r for r in rows}

    # 44 table rows minus Ecuador (numbers lost to the page-break chrome).
    assert len(rows) == 43
    assert "Ecuador" not in by_country

    # Headline row — above the old 250k cap that used to reject it.
    italy = by_country["Italy"]
    assert (italy["robusta_bags"], italy["arabica_bags"], italy["bags"]) == \
        (321_460, 30_150, 351_610)
    germany = by_country["Germany"]
    assert germany["bags"] == 123_939

    # Single-type pair (Arabica column blank in the source).
    sudan = by_country["Sudan"]
    assert (sudan["robusta_bags"], sudan["arabica_bags"], sudan["bags"]) == \
        (79_080, 0, 79_080)
    assert by_country["Vietnam"]["bags"] == 21_184

    # Algeria's 13-bag Arabica cell sits below the rank cutoff — kept
    # because it comes AFTER the first big number.
    algeria = by_country["Algeria"]
    assert (algeria["robusta_bags"], algeria["arabica_bags"], algeria["bags"]) == \
        (43_054, 13, 43_067)

    # Order-based split: U.S.A has MORE arabica than robusta.
    usa = by_country["United States"]
    assert (usa["robusta_bags"], usa["arabica_bags"], usa["bags"]) == \
        (10_675, 15_270, 25_945)
    austria = by_country["Austria"]
    assert (austria["robusta_bags"], austria["arabica_bags"]) == (320, 668)

    # No prior-month rank printed for UK — row still parses.
    uk = by_country["United Kingdom"]
    assert (uk["robusta_bags"], uk["arabica_bags"], uk["bags"]) == \
        (7_241, 1_002, 8_243)

    # Arabica-only mapping.
    saudi = by_country["Saudi Arabia"]
    assert (saudi["robusta_bags"], saudi["arabica_bags"], saudi["bags"]) == \
        (0, 1_280, 1_280)

    # Page-2 rows made it across the page break.
    romania = by_country["Romania"]
    assert (romania["robusta_bags"], romania["arabica_bags"], romania["bags"]) == \
        (100, 3_357, 3_457)
    assert by_country["New Zealand"]["bags"] == 251

    # Published footer == ground truth.
    assert published == (907_058, 107_004, 1_014_062)

    # Ecuador's loss makes the sums fall short of published — the
    # cross-check must SAY so rather than silently under-report. At
    # ~4k bags of a 1.01M month it's under the 1% severity gate, so it's
    # worded as a residual (recorded in JSON, ignored by the dashboard's
    # /cross-check failed/ filter).
    assert any("cross-check residual" in w for w in warnings)
    assert not any("cross-check failed" in w for w in warnings)


def test_v2_end_to_end_published_total_becomes_monthly_total():
    pages = ["MONTHLY COFFEE REPORT - JUNE 2025\n" + _JUNE_2025_PAGE_1,
             _JUNE_2025_PAGE_2]
    rep = um._parse_v1_recent("\n".join(pages), None, pages)
    assert rep is not None
    assert rep.month == "2025-06"
    # Published totals override the grade-table / destination merges.
    assert rep.robusta_bags == 907_058
    assert rep.arabica_bags == 107_004
    assert rep.total_bags == 1_014_062
    assert any("cross-check residual" in w for w in rep.parse_warnings)
    assert {d["country"] for d in rep.by_destination} >= {"Italy", "Germany", "Sudan"}


def test_v2_scopes_to_header_pages_only():
    """A page without the destinations header — even one that mentions
    countries with plausible numbers — contributes nothing."""
    toc = "Narrative page. Italy received 999,999 bags in some year. 123,456"
    table = (
        "Annex 3: Main Destinations of Uganda Coffee by Type in May 2024\n"
        "1 Italy 1 100,000 50,000 150,000 60.0 60.0\n"
        "Total 100,000 50,000 150,000"
    )
    rows, published, warnings = um._extract_destinations_v2([toc, table])
    assert {r["country"] for r in rows} == {"Italy"}
    assert rows[0]["bags"] == 150_000
    assert published == (100_000, 50_000, 150_000)
    assert not any("cross-check failed" in w for w in warnings)


def test_v2_no_header_anywhere_returns_empty():
    pages = ["1 Italy 1 100,000 50,000 150,000"]
    assert um._extract_destinations_v2(pages) == ([], None, [])


def test_v2_single_flip_fixes_family_mismatch():
    """Kenya defaults to robusta-only; the published totals reveal it was
    arabica that month. The unique exact one-flip is applied and noted."""
    page = (
        "Annex 3: Main Destinations of Uganda Coffee by Type in May 2024\n"
        "1 Italy 1 100,000 50,000 150,000 60.0 60.0\n"
        "2 Kenya 2 4,000 4,000 1.6 61.6\n"
        "Total 100,000 54,000 154,000"
    )
    rows, published, warnings = um._extract_destinations_v2([page])
    kenya = next(r for r in rows if r["country"] == "Kenya")
    assert kenya["robusta_bags"] == 0
    assert kenya["arabica_bags"] == 4_000
    assert published == (100_000, 54_000, 154_000)
    assert any("flipped" in w for w in warnings)
    assert not any("cross-check failed" in w for w in warnings)


def test_v2_month_pair_beats_ctd_triple_on_same_row():
    """Single-type destination in a month+CTD layout: the month side is an
    equal PAIR while the CTD side forms a valid triple further right. The
    leftmost candidate (the pair) must win."""
    page = (
        "Annex 3: Main Destinations of Uganda Coffee by Type\n"
        "1 Sudan 3 1,800 1,800 0.65 3.29 54,723 927 55,650 11.13 58.01\n"
    )
    rows, _, _ = um._extract_destinations_v2([page])
    sudan = next(r for r in rows if r["country"] == "Sudan")
    assert (sudan["robusta_bags"], sudan["arabica_bags"], sudan["bags"]) == \
        (1_800, 0, 1_800)


def test_v2_south_sudan_does_not_double_count_sudan():
    page = (
        "Annex 3: Main Destinations of Uganda Coffee by Type\n"
        "1 Sudan 1 50,000 50,000 10.0 10.0\n"
        "2 South Sudan 2 7,000 7,000 1.4 11.4\n"
        "Total 57,000 0 57,000\n"
    )
    rows, published, warnings = um._extract_destinations_v2([page])
    by_country = {r["country"]: r for r in rows}
    assert by_country["Sudan"]["bags"] == 50_000
    assert by_country["South Sudan"]["bags"] == 7_000
    assert published == (57_000, 0, 57_000)
    assert not any("cross-check failed" in w for w in warnings)


def test_v2_large_shortfall_still_flags_failed():
    """A big gap (here 33% of trade missing vs published) must keep the
    dashboard-visible "failed" wording — the 1% severity gate only
    reclassifies micro-residuals."""
    page = (
        "Annex 3: Main Destinations of Uganda Coffee by Type in Feb 2020\n"
        "1 Italy 1 100,000 50,000 150,000 60.0 60.0\n"
        "Total 200,000 100,000 300,000"
    )
    rows, published, warnings = um._extract_destinations_v2([page])
    assert published == (200_000, 100_000, 300_000)
    assert any("cross-check failed" in w for w in warnings)
    assert not any("cross-check residual" in w for w in warnings)


# Synthetic text from the operator's screenshot of the Feb 2020 PDF — the
# format that defeats v2 without the year-noise filter and the typo alias.

_FEB_2020_TABLE = (
    "Annex 3: Main Destinations of Uganda Coffee by Type in February 2020 "
    "DESTINATION POSITION HELD IN JANUARY QUANTITY (60kg bags) "
    "Robusta Arabica Total Individual Cumulative "
    "Total 388,646 84,348 472,994 100.00 "
    "Annex 3: Main Destinations of Uganda Coffee by Type in February 2020 "
    "1 Italy 1 140,991 15,920 156,911 33.17 33.17 "
    "2 Sudan 3 62,270 770 63,040 13.33 46.50 "
    "3 Germany 2 37,962 21,598 59,560 12.59 59.09 "
    "4 Spain 5 51,612 1,940 53,552 11.32 70.42 "
    "5 United States 4 9,228 22,140 31,368 6.63 77.05 "
    "6 India 7 26,785 3,740 30,525 6.45 83.50 "
    "7 Belgium 6 17,882 1,880 19,762 4.18 87.68 "
    "8 Morocco 8 11,772 11,772 2.49 90.17 "
    "9 Isreal 9 7,040 1,300 8,340 1.76 91.93 "
    "10 Portugal 4,974 4,974 1.05 92.98 "
    "11 Russia 12 3,894 835 4,729 1.00 93.98 "
)


def test_v2_feb_2020_year_noise_does_not_hijack_italy():
    """Regression for 2020-02 — without year filtering the page header
    "February 2020" leaks 2020 twice into Italy's row scope and the
    leftmost-pair rule captured (2020, 2020) ahead of the real 140k Robusta
    cell. Italy is the first country on the page so this hit hardest there."""
    rows, published, _ = um._extract_destinations_v2([_FEB_2020_TABLE])
    by_country = {r["country"]: r for r in rows}
    assert published == (388_646, 84_348, 472_994)
    italy = by_country["Italy"]
    assert (italy["robusta_bags"], italy["arabica_bags"], italy["bags"]) == \
        (140_991, 15_920, 156_911)
    # Morocco is single-type robusta in this report (Arabica cell blank).
    morocco = by_country["Morocco"]
    assert (morocco["robusta_bags"], morocco["arabica_bags"], morocco["bags"]) == \
        (11_772, 0, 11_772)


def test_v2_isreal_typo_canonicalises_to_israel():
    """The 2020-02 PDF spells it "Isreal"; downstream charts aggregate by
    display name, so the canonicalised "Israel" must land on the row."""
    rows, _, _ = um._extract_destinations_v2([_FEB_2020_TABLE])
    by_country = {r["country"]: r for r in rows}
    israel = by_country.get("Israel")
    assert israel is not None
    assert israel["bags"] == 8_340
    assert israel["robusta_bags"] == 7_040
    assert israel["arabica_bags"] == 1_300


# The 2025-03 PDF blanked the table's Total row to "Total 100" and spilled
# the actual grand total into Italy's row. Operator-confirmed fixture text.

_MARCH_2025_TABLE = (
    "Annex 3: Main Destinations of Uganda Coffee by Type in March 2025 "
    "DESTINATION POSITION HELD IN FEBRUARY QUANTITY (60kg bags) "
    "%AGE MARKET SHARE Robusta Arabica Total Individual Cumulative "
    "Total 100 "
    "1 Italy 1 525,220 117,761 642,981 38.43 38.43 "
    "2 India 3 54,306 3,054 57,360 8.92 47.35 "
    "3 Germany 2 36,163 8,118 44,281 6.89 54.23 "
    "4 Spain 6 33,752 5,236 38,988 6.06 60.30 "
    "5 Sudan 5 36,750 36,750 5.72 66.01 "
    "6 China 9 30,184 5,348 35,532 5.53 71.54 "
    "7 U.S.A 8 14,348 19,209 33,557 5.22 76.76 "
    "8 Belgium 4 16,458 11,377 27,835 4.33 81.09 "
    "9 Algeria 22 14,832 14,832 2.31 83.39 "
    "10 Russia 11 8,988 1,688 10,676 1.66 85.06 "
)


def test_v2_march_2025_top_row_total_misfile_is_recovered():
    """Operator-confirmed pattern: UCDA blanked the Total row and dropped
    the table grand total into Italy's cells. Recovery treats Italy's
    cells as the published totals, then subtracts every other row from
    them to back out Italy's real contribution."""
    rows, published, warnings = um._extract_destinations_v2([_MARCH_2025_TABLE])
    by_country = {r["country"]: r for r in rows}
    # The misfiled values became the published Total — UCDA's authoritative
    # total for the month.
    assert published == (525_220, 117_761, 642_981)
    italy = by_country["Italy"]
    # Σ rows 2..10 robusta:  54_306+36_163+33_752+36_750+30_184+14_348+
    #                        16_458+14_832+8_988                     = 245_781
    # Italy recomputed = 525_220 − 245_781 = 279_439 (residual = the long
    # tail past row 10, which the fixture deliberately truncates — in the
    # real PDF those rows make the recovered Italy land ~250k).
    assert italy["robusta_bags"] == 525_220 - 245_781
    # Σ rows 2..10 arabica = 3_054 + 8_118 + 5_236 + 0 + 5_348 + 19_209
    #                       + 11_377 + 0 + 1_688 = 54_030
    assert italy["arabica_bags"] == 117_761 - 54_030
    assert italy["bags"] == italy["robusta_bags"] + italy["arabica_bags"]
    assert any("Total misfile recovered" in w for w in warnings)
    # Cross-check now matches because Σ(rows) == published by construction.
    assert not any("cross-check failed" in w for w in warnings)


def test_v2_does_not_recover_when_top_only_3x_second():
    """Real months commonly have Italy 2-3× the next destination; the
    recovery must NOT fire unless top > BOTH 5× second AND 1.5× Σ others."""
    page = (
        "Annex 3: Main Destinations of Uganda Coffee by Type in May 2024\n"
        "1 Italy 1 200,000 100,000 300,000 40.0 40.0\n"
        "2 Germany 2 80,000 20,000 100,000 13.3 53.3\n"
        "3 Sudan 3 50,000 50,000 6.7 60.0\n"
        "4 Spain 5 40,000 10,000 50,000 6.7 66.7\n"
        "Total 370,000 130,000 500,000"
    )
    rows, published, warnings = um._extract_destinations_v2([page])
    by_country = {r["country"]: r for r in rows}
    # Top (300k) is 3x second (100k) and 1.5x Σ others (200k) — but the
    # ratios require >5× and >1.5×, so the recovery skips it. The
    # legitimate published Total wins instead.
    assert by_country["Italy"]["bags"] == 300_000
    assert published == (370_000, 130_000, 500_000)
    assert not any("Total misfile recovered" in w for w in warnings)


# Fixtures from the operator's 2020-03 / 2020-04 screenshots. The real PDFs
# have a tail of micro-rows below what the screenshots show; the published
# Total in each fixture is adjusted to the VISIBLE rows so the family-flip
# arithmetic is deterministic (the engine itself doesn't care — it just
# reconciles whatever rows it captured against whatever Total it found).

_MARCH_2020_TABLE = (
    "Annex 3: Main Destinations of Uganda Coffee by Type in March 2020 "
    "DESTINATION POSITION HELD IN FEBRUARY QUANTITY (60kg bags) "
    "Robusta Arabica Total Individual Cumulative "
    "Total 383,495 88,814 472,309 100.00 "
    "1 Italy 1 120,742 15,245 135,987 28.48 28.48 "
    "2 Sudan 2 68,900 68,900 14.43 42.90 "
    "3 Germany 3 35,601 20,568 56,169 11.76 54.66 "
    "4 Spain 4 51,205 970 52,175 10.93 65.59 "
    "5 India 6 46,244 4,938 51,182 10.72 76.31 "
    "6 United States 5 6,762 24,384 31,146 6.52 82.83 "
    "7 Belgium 7 21,848 6,205 28,053 5.87 88.70 "
    "8 Morocco 8 6,004 1,320 7,324 1.53 90.24 "
    "9 Sweden 13 680 6,318 6,998 1.47 91.70 "
    "10 Isreal 9 5,130 610 5,740 1.20 92.90 "
    "11 Russia 11 3,900 640 4,540 0.95 93.85 "
    "12 Portugal 10 4,469 4,469 0.94 94.79 "
    "13 Greece 12 1,280 1,614 2,894 0.61 95.40 "
    "14 Japan 15 2,160 300 2,460 0.52 95.91 "
    "15 Croatia 2,110 2,110 0.44 96.35 "
    "16 Mexico 22 1,790 1,790 0.37 96.73 "
    "17 Finland 26 640 1,000 1,640 0.34 97.07 "
    "18 Iran 1,600 1,600 0.34 97.41 "
    "19 Vietnam 1,500 1,500 0.31 97.72 "
    "22 Australia 16 1,499 1,499 0.31 98.03 "
    "21 United Kingdom 1,400 1,400 0.29 98.33 "
    "22 China 25 960 320 1,280 0.27 98.60 "
    "23 Kenya 23 743 743 0.16 98.75 "
    "24 Netherlands 17 360 350 710 0.15 98.90"
)


def test_v2_march_2020_multi_row_family_flip():
    """Mexico (1,790), Australia (1,499) and Kenya (743) are arabica-only
    in this report — their blank cell sits in the ROBUSTA column, which
    flat text can't see, so the default guesses robusta. The published
    totals reveal a 4,032-bag imbalance whose unique subset across the
    single-type rows is exactly those three — the engine flips them all."""
    rows, published, warnings = um._extract_destinations_v2([_MARCH_2020_TABLE])
    by_country = {r["country"]: r for r in rows}
    assert published == (383_495, 88_814, 472_309)
    for c, bags in [("Mexico", 1_790), ("Australia", 1_499), ("Kenya", 743)]:
        row = by_country[c]
        assert (row["robusta_bags"], row["arabica_bags"], row["bags"]) == \
            (0, bags, bags), c
    # Robusta-only single-type rows stay put.
    for c, bags in [("Sudan", 68_900), ("Portugal", 4_469), ("Croatia", 2_110),
                    ("Iran", 1_600), ("Vietnam", 1_500), ("United Kingdom", 1_400)]:
        row = by_country[c]
        assert (row["robusta_bags"], row["arabica_bags"]) == (bags, 0), c
    # After the flip the books balance — no cross-check warning at all.
    assert any("flipped" in w for w in warnings)
    assert not any("cross-check" in w for w in warnings)
    # Iran (new to the country list) + Isreal-typo both captured.
    assert by_country["Israel"]["bags"] == 5_740


def test_v2_april_2020_equal_valued_twins_stay_ambiguous():
    """April 2020 has Estonia (arabica-only, 640) and Finland (robusta-only,
    640) — equal-valued single-type twins. The 8,480-bag imbalance has TWO
    exact subsets (one per twin), so the engine must refuse to guess:
    no flip, residual warning recorded, published totals still land."""
    table = (
        "Annex 3: Main Destinations of Uganda Coffee by Type in April 2020 "
        "Robusta Arabica Total Individual Cumulative "
        "Total 262,144 96,339 358,483 100.00 "
        "1 Italy 1 76,238 15,588 91,826 25.51 25.51 "
        "2 Germany 3 38,487 24,690 63,177 17.55 43.06 "
        "3 Sudan 2 53,900 320 54,220 15.06 58.12 "
        "4 India 5 33,667 4,235 37,902 10.53 68.65 "
        "5 Spain 4 28,094 320 28,414 7.89 76.54 "
        "6 United States 6 1,280 24,789 26,069 7.24 83.79 "
        "7 Belgium 7 10,894 8,310 19,204 5.33 89.12 "
        "8 Morocco 8 4,240 986 5,226 1.45 90.57 "
        "9 South Korea 32 320 4,048 4,368 1.21 91.79 "
        "10 Sweden 9 4,130 4,130 1.15 92.93 "
        "11 Russia 11 2,894 640 3,534 0.98 93.92 "
        "12 Israel 10 2,240 1,280 3,520 0.98 94.89 "
        "13 Australia 22 1,332 1,313 2,645 0.73 95.63 "
        "14 Japan 14 2,434 2,434 0.68 96.30 "
        "15 Poland 1,430 350 1,780 0.49 96.80 "
        "16 Greece 13 960 640 1,600 0.44 97.24 "
        "17 Mexico 16 1,500 1,500 0.42 97.66 "
        "18 Portugal 12 1,344 1,344 0.37 98.03 "
        "19 Kenya 23 960 960 0.27 98.30 "
        "22 South Sudan 28 900 900 0.25 98.55 "
        "21 Croatia 15 700 700 0.19 98.74 "
        "22 Netherlands 24 350 350 700 0.19 98.94 "
        "23 Slovenia 36 700 700 0.19 99.13 "
        "24 Estonia 640 640 0.18 99.31 "
        "25 Finland 17 640 640 0.18 99.49 "
        "26 Romania 35 350 350 0.10 99.59"
    )
    rows, published, warnings = um._extract_destinations_v2([table])
    by_country = {r["country"]: r for r in rows}
    assert published == (262_144, 96_339, 358_483)
    # Netherlands' 350+350=700 row is a TRIPLE (R == A), not a pair.
    nl = by_country["Netherlands"]
    assert (nl["robusta_bags"], nl["arabica_bags"], nl["bags"]) == (350, 350, 700)
    # Ambiguous → nothing flipped, imbalance recorded as a residual (net
    # volume matches published, so the dashboard is NOT flagged).
    assert not any("flipped" in w for w in warnings)
    assert any("cross-check residual" in w for w in warnings)
    assert not any("cross-check failed" in w for w in warnings)
