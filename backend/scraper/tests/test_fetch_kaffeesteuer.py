"""Tests for backend/scraper/fetch_kaffeesteuer.py — parser layer only
(no network). Guards against regressions in link extraction and the xlsx
Kaffeesteuer parser when BMF's HTML markup, filenames or workbook shift."""
import io

from openpyxl import Workbook

from scraper.fetch_kaffeesteuer import (
    _direct_candidates,
    _normalise_tsd,
    _parse_links,
    _target_periods,
    _to_number,
    extract_kaffeesteuer_xlsx,
)

BASE = "https://www.bundesfinanzministerium.de"


# ── direct URL construction (the primary path — straight to the file) ────────

def test_direct_candidates_match_bmf_real_urls():
    """The generator must produce BMF's actual known-good URLs for April 2026
    (publication date 2026-05-21, version 2) — both xlsx and pdf."""
    urls = {url for _, url in _direct_candidates("2026-04")}
    prefix = (
        BASE + "/Content/DE/Standardartikel/Themen/Steuern/"
        "Steuerschaetzungen_und_Steuereinnahmen/"
    )
    assert (
        prefix + "2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx"
        "?__blob=publicationFile&v=2"
    ) in urls
    assert (
        prefix + "2026-05-21-steuereinnahmen-april-2026.pdf"
        "?__blob=publicationFile&v=2"
    ) in urls


def test_direct_candidates_handle_december_year_rollover():
    """A December report is published in January of the next year."""
    urls = {url for _, url in _direct_candidates("2025-12")}
    assert any("2026-01-" in u and "steuereinnahmen-dezember-2025" in u for u in urls)


def test_target_periods_excludes_known_and_current_month():
    from datetime import date
    existing = {"2026-03": 1}
    targets = _target_periods(existing, date(2026, 6, 2), lookback=4)
    # June (current) excluded; March already known; expect Feb, Apr, May.
    assert targets == ["2026-02", "2026-04", "2026-05"]


# ── HTML link discovery ──────────────────────────────────────────────────────

def test_parse_extracts_xlsx_with_publication_date_and_query():
    """Real-world BMF xlsx link: dated prefix, '-xlxs' typo, ?__blob query."""
    html = f"""
    <ul>
      <li><a href="/Content/DE/.../2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx?__blob=publicationFile&v=2">April 2026</a></li>
      <li><a href="/Content/DE/.../2026-03-20-steuereinnahmen-februar-2026-xlxs.xlsx?__blob=publicationFile&v=2">Februar 2026</a></li>
    </ul>
    """
    found = _parse_links(html)
    assert set(found) == {"2026-04", "2026-02"}
    # Query string must be preserved or BMF serves an HTML wrapper, not the file.
    assert found["2026-04"]["xlsx"] == (
        BASE + "/Content/DE/.../2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx"
        "?__blob=publicationFile&v=2"
    )


def test_parse_handles_maerz_umlaut_and_plain_xlsx():
    """Tolerate 'märz' spelling and a plain steuereinnahmen-...-2026.xlsx name."""
    html = (
        '<a href="/x/2026-04-21-steuereinnahmen-märz-2026.xlsx">März</a>'
        '<a href="/y/2026-06-20-steuereinnahmen-mai-2026-xlsx.xlsx">Mai</a>'
    )
    found = _parse_links(html)
    assert set(found) == {"2026-03", "2026-05"}


def test_parse_prefers_xlsx_but_keeps_pdf_fallback():
    """A period offered as both xlsx and pdf records both kinds."""
    html = """
    <a href="/a/2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx">xlsx</a>
    <a href="/b/2026-05-21-steuereinnahmen-april-2026.pdf">pdf</a>
    """
    found = _parse_links(html)
    assert found["2026-04"]["xlsx"].endswith(".xlsx")
    assert found["2026-04"]["pdf"].endswith(".pdf")


def test_parse_skips_non_steuereinnahmen_and_unknown_month():
    html = """
    <a href="/foo/monatsbericht-januar-2026.xlsx">irrelevant</a>
    <a href="/bar/2026-02-20-steuereinnahmen-januar-2026-xlxs.xlsx">relevant</a>
    <a href="/x/2026-99-99-steuereinnahmen-quintilis-2026.xlsx">unknown month</a>
    """
    found = _parse_links(html)
    assert list(found) == ["2026-01"]


def test_parse_keeps_first_occurrence_on_duplicate_period():
    html = """
    <a href="/a/2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx">A</a>
    <a href="/b/2026-06-05-steuereinnahmen-april-2026-xlxs.xlsx">B (re-issue)</a>
    """
    found = _parse_links(html)
    assert found["2026-04"]["xlsx"].startswith(BASE + "/a/")


# ── numeric helpers ──────────────────────────────────────────────────────────

def test_to_number_handles_german_formatting_and_blanks():
    assert _to_number(74721) == 74721.0
    assert _to_number("74.721") == 74721.0       # '.' = thousands separator
    assert _to_number("74.721,0") == 74721.0     # ',' = decimal
    assert _to_number("-") is None
    assert _to_number("") is None


def test_normalise_tsd_unifies_units():
    assert _normalise_tsd(74721) == 74721         # already Tsd EUR
    assert _normalise_tsd(74.721) == 74721        # Mio EUR with decimals
    assert _normalise_tsd(74_721_000) == 74721    # plain EUR


# ── workbook extraction ──────────────────────────────────────────────────────

def _xlsx_bytes(rows) -> bytes:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_extract_takes_current_month_value():
    """First plausible numeric on the Kaffeesteuer row = current-month figure."""
    data = _xlsx_bytes([
        ["Steuerart", "April 2026", "April 2025", "Veränd. %", "Jan-Apr 2026"],
        ["Tabaksteuer", 1_234_567, 1_200_000, 2.9, 5_000_000],
        ["Kaffeesteuer", 91_242, 95_297, -4.3, 350_000],
        ["Biersteuer", 50_000, 49_000, 2.0, 180_000],
    ])
    assert extract_kaffeesteuer_xlsx(data) == 91_242


def test_extract_skips_footnote_marker_and_blank_cells():
    data = _xlsx_bytes([
        ["Kaffeesteuer 1)", None, "-", 74_721, 60_000],
    ])
    assert extract_kaffeesteuer_xlsx(data) == 74_721


def test_extract_returns_none_when_absent():
    data = _xlsx_bytes([["Tabaksteuer", 1_234_567], ["Biersteuer", 50_000]])
    assert extract_kaffeesteuer_xlsx(data) is None
