"""Tests for backend/scraper/fetch_kaffeesteuer.py — parser layer only
(no network). Guards against regressions in PDF-link extraction when BMF's
HTML markup or PDF naming convention shifts."""
from scraper.fetch_kaffeesteuer import _parse_pdf_links


def test_parse_extracts_period_from_canonical_filename():
    """Standard BMF filename: YYYY-MM-DD-steuereinnahmen-{de-month}-YYYY.pdf."""
    html = """
    <html><body>
      <ul>
        <li><a href="/Web/SharedDocs/Downloads/DE/Steuern/2026-03-20-steuereinnahmen-februar-2026.pdf">Februar 2026</a></li>
        <li><a href="/Web/SharedDocs/Downloads/DE/Steuern/2026-02-20-steuereinnahmen-januar-2026.pdf">Januar 2026</a></li>
      </ul>
    </body></html>
    """
    found = _parse_pdf_links(html)
    assert found == {
        "2026-02": "https://www.bundesfinanzministerium.de/Web/SharedDocs/Downloads/DE/Steuern/2026-03-20-steuereinnahmen-februar-2026.pdf",
        "2026-01": "https://www.bundesfinanzministerium.de/Web/SharedDocs/Downloads/DE/Steuern/2026-02-20-steuereinnahmen-januar-2026.pdf",
    }


def test_parse_skips_non_steuereinnahmen_pdfs():
    """Other PDFs on the same page (Monatsbericht, etc.) shouldn't leak in."""
    html = """
    <a href="/foo/monatsbericht-januar-2026.pdf">irrelevant</a>
    <a href="/bar/2026-02-20-steuereinnahmen-januar-2026.pdf">relevant</a>
    <a href="/baz/steuerreformen-2026.pdf">also irrelevant — no month/year tail</a>
    """
    found = _parse_pdf_links(html)
    assert list(found) == ["2026-01"]


def test_parse_skips_unknown_german_month():
    """Defensive: a typo or future-month name we don't know shouldn't crash."""
    html = '<a href="/x/2026-99-99-steuereinnahmen-quintilis-2026.pdf">odd</a>'
    found = _parse_pdf_links(html)
    assert found == {}


def test_parse_keeps_first_occurrence_on_duplicate_period():
    """If a page lists the same month twice, the earlier link wins."""
    html = """
    <a href="/a/2026-03-20-steuereinnahmen-februar-2026.pdf">A</a>
    <a href="/b/2026-04-05-steuereinnahmen-februar-2026.pdf">B (re-issue)</a>
    """
    found = _parse_pdf_links(html)
    assert found["2026-02"].startswith("https://www.bundesfinanzministerium.de/a/")


def test_parse_handles_absolute_urls():
    """Some BMF templates emit fully-qualified URLs; passthrough should work."""
    html = '<a href="https://www.bundesfinanzministerium.de/x/2026-03-20-steuereinnahmen-februar-2026.pdf">Feb</a>'
    found = _parse_pdf_links(html)
    assert found == {
        "2026-02": "https://www.bundesfinanzministerium.de/x/2026-03-20-steuereinnahmen-februar-2026.pdf",
    }
