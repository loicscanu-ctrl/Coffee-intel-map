"""Tests for backend/scraper/fetch_kaffeesteuer.py — no network.
Covers direct-URL generation, the multi-sheet xlsx parser, and period logic."""
import io

from openpyxl import Workbook

from scraper.fetch_kaffeesteuer import (
    extract_kaffeesteuer_from_excel,
    generate_candidate_urls,
    get_periods_to_check,
)

PREFIX = (
    "https://www.bundesfinanzministerium.de/Content/DE/Standardartikel/Themen/"
    "Steuern/Steuerschaetzungen_und_Steuereinnahmen/"
)


# ── direct URL construction ──────────────────────────────────────────────────

def test_generate_includes_bmf_real_url():
    """Must produce BMF's actual known-good April-2026 URL (pub 2026-05-21, v2)."""
    urls = generate_candidate_urls(2026, 4)
    assert (
        PREFIX + "2026-05-21-steuereinnahmen-april-2026-xlxs.xlsx"
        "?__blob=publicationFile&v=2"
    ) in urls


def test_generate_covers_typo_corrected_and_plain_extensions():
    urls = set(generate_candidate_urls(2026, 4))
    base = PREFIX + "2026-05-21-steuereinnahmen-april-2026"
    assert base + "-xlxs.xlsx?__blob=publicationFile&v=2" in urls
    assert base + "-xlsx.xlsx?__blob=publicationFile&v=2" in urls
    assert base + ".xlsx?__blob=publicationFile&v=2" in urls


def test_generate_handles_december_year_rollover():
    """A December report is published in January of the following year."""
    urls = generate_candidate_urls(2025, 12)
    assert any("2026-01-" in u and "steuereinnahmen-dezember-2025" in u for u in urls)


def test_generate_uses_maerz_ascii_spelling():
    urls = generate_candidate_urls(2026, 3)
    assert any("steuereinnahmen-maerz-2026" in u for u in urls)


# ── workbook extraction ──────────────────────────────────────────────────────

def _xlsx_bytes(sheets: dict[str, list]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(title=name)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_extract_takes_first_current_month_value():
    data = _xlsx_bytes({"Tab1": [
        ["Steuerart", "April 2026", "April 2025", "Jan-Apr 2026"],
        ["Tabaksteuer", 1_234_567, 1_200_000, 5_000_000],
        ["Kaffeesteuer", 91_242, 95_297, 350_000],
    ]})
    assert extract_kaffeesteuer_from_excel(data) == 91_242


def test_extract_scans_all_sheets_not_just_active():
    """The row living on a later sheet must still be found (the old wb.active
    bug returned None here)."""
    data = _xlsx_bytes({
        "Summary": [["Übersicht", "foo", "bar"]],
        "Steuerarten": [
            ["Steuerart", "Februar 2026"],
            ["Kaffeesteuer", 74_721],
        ],
    })
    assert extract_kaffeesteuer_from_excel(data) == 74_721


def test_extract_normalises_units_and_skips_blanks():
    # value stored in plain EUR → normalised to Tsd; leading blanks skipped.
    data = _xlsx_bytes({"T": [["Kaffeesteuer", None, 74_721_000]]})
    assert extract_kaffeesteuer_from_excel(data) == 74_721


def test_extract_returns_none_when_absent():
    data = _xlsx_bytes({"T": [["Tabaksteuer", 1_234_567]]})
    assert extract_kaffeesteuer_from_excel(data) is None


# ── period selection ─────────────────────────────────────────────────────────

def test_periods_after_latest_known():
    existing = {f"{y}-{m:02d}": 1 for y in [2025] for m in range(1, 13)}
    existing["2026-01"] = 1
    existing["2026-02"] = 1
    # From 2026-03 up to "today" — exact tail depends on run date, but must
    # start at 2026-03 and never re-list a known month.
    periods = get_periods_to_check(existing)
    assert (2026, 3) in periods
    assert (2026, 2) not in periods
    assert (2025, 12) not in periods
