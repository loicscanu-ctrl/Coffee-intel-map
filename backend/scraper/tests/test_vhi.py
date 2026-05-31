"""Fixture + mocked-network tests for the NOAA STAR VHI parser & fetcher.

Sandbox blocks egress to star.nesdis.noaa.gov; the parser is validated
against a saved fixture (Minas Gerais 2023 weeks 1–50) and the fetch
wrapper against mocked HTTP responses.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from scraper import vhi

FIXTURE = Path(__file__).parent / "fixtures" / "noaa_star_vhi_sample.txt"


def _fixture_text() -> str:
    return FIXTURE.read_text(encoding="utf-8")


# ── Province metadata header parsing ─────────────────────────────────────────

def test_parse_extracts_province_metadata():
    out = vhi.parse_vhi_text(_fixture_text())
    assert out["province_id"]   == 13
    assert out["province_name"] == "Minas Gerais"


def test_parse_handles_headerless_body():
    # A future NOAA tweak could omit the "13 Minas Gerais" line. The parser
    # should still extract rows but leave the metadata fields None.
    body = "\n".join(_fixture_text().splitlines()[1:])
    out = vhi.parse_vhi_text(body)
    assert out["province_id"] is None
    assert out["province_name"] is None
    assert len(out["rows"]) == 50


# ── Row parsing ──────────────────────────────────────────────────────────────

def test_parse_extracts_fifty_weeks():
    rows = vhi.parse_vhi_text(_fixture_text())["rows"]
    assert len(rows) == 50
    assert rows[0].year == 2023 and rows[0].week == 1
    assert rows[-1].year == 2023 and rows[-1].week == 50


def test_parse_row_values_match_fixture():
    rows = vhi.parse_vhi_text(_fixture_text())["rows"]
    first = rows[0]
    assert first.vhi == 48.06
    assert first.vci == 67.58
    assert first.tci == 28.53
    # Spot-check a mid-year row.
    week_30 = next(r for r in rows if r.week == 30)
    assert week_30.vhi == 62.81


def test_parse_drops_trailing_empty_column():
    # The trailing comma → empty 8th column. Parser should not blow up
    # and should land 7 numeric columns cleanly.
    text = "13 Minas Gerais\nyear, week, SMN, SMT, VCI, TCI, VHI, empty\n2024,  5, 0.18, 297.5, 60.0, 40.0, 50.0,\n"
    rows = vhi.parse_vhi_text(text)["rows"]
    assert len(rows) == 1
    assert rows[0].vhi == 50.0


def test_parse_skips_sentinel_values():
    # NOAA marks unavailable weeks with -999 or values outside 0–100.
    text = (
        "13 Minas Gerais\n"
        "year, week, SMN, SMT, VCI, TCI, VHI, empty\n"
        "2024,  5, 0.18, 297.5, 60.0, 40.0, 50.0,\n"
        "2024,  6, -999, -999, -999, -999, -999,\n"
        "2024,  7, 0.17, 297.6, 55.0, 45.0, 50.0,\n"
    )
    rows = vhi.parse_vhi_text(text)["rows"]
    assert [r.week for r in rows] == [5, 7]


def test_parse_skips_malformed_rows():
    text = (
        "13 Minas Gerais\n"
        "year, week, SMN, SMT, VCI, TCI, VHI, empty\n"
        "2024,  5, 0.18, 297.5, 60.0, 40.0, 50.0,\n"
        "not a row at all\n"
        "2024,  6, foo, bar, baz, qux, quux,\n"
        "2024,  7, 0.17, 297.6, 55.0, 45.0, 50.0,\n"
    )
    rows = vhi.parse_vhi_text(text)["rows"]
    assert [r.week for r in rows] == [5, 7]


def test_parse_clamps_unreasonable_weeks():
    text = (
        "13 Minas Gerais\n"
        "year, week, SMN, SMT, VCI, TCI, VHI, empty\n"
        "2024,  5, 0.18, 297.5, 60.0, 40.0, 50.0,\n"
        "2024, 99, 0.18, 297.5, 60.0, 40.0, 50.0,\n"
    )
    rows = vhi.parse_vhi_text(text)["rows"]
    assert [r.week for r in rows] == [5]


def test_parse_empty_input():
    assert vhi.parse_vhi_text("")["rows"] == []
    assert vhi.parse_vhi_text("   \n\n  ")["rows"] == []


# ── Severity bins ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("v,expected", [
    (10.0, "stress"),
    (39.9, "stress"),
    (40.0, "fair"),
    (50.0, "fair"),
    (60.0, "fair"),
    (60.1, "healthy"),
    (90.0, "healthy"),
    (None, "unknown"),
])
def test_severity_bins(v, expected):
    assert vhi.vhi_severity(v) == expected


# ── Headline helper ──────────────────────────────────────────────────────────

def test_latest_and_recent_picks_last_row():
    rows = vhi.parse_vhi_text(_fixture_text())["rows"]
    out = vhi.latest_and_recent(rows, n_recent=4)
    assert out["vhi_latest"]["year"] == 2023
    assert out["vhi_latest"]["week"] == 50
    assert out["vhi_latest"]["iso_week"] == "2023-W50"
    assert out["vhi_latest"]["vhi"] == 53.64
    assert out["vhi_latest"]["severity"] == "fair"
    assert len(out["vhi_recent"]) == 4
    assert out["vhi_recent"][-1]["iso_week"] == "2023-W50"


def test_latest_and_recent_handles_empty():
    out = vhi.latest_and_recent([], n_recent=4)
    assert out == {"vhi_latest": None, "vhi_recent": []}


def test_iso_week_key_format():
    r = vhi.VhiRow(year=2026, week=7, vhi=55.0)
    assert r.iso_week_key() == "2026-W07"


# ── fetch_vhi wrapper (mocked network) ───────────────────────────────────────

def _ok_response(text: str) -> MagicMock:
    r = MagicMock()
    r.ok = True
    r.status_code = 200
    r.text = text
    r.raise_for_status = MagicMock()
    return r


def test_fetch_threads_country_into_response():
    session = MagicMock()
    session.get.return_value = _ok_response(_fixture_text())
    out = vhi.fetch_vhi("BRA", 13, 2023, 2026, session=session)
    assert out["country"] == "BRA"
    assert out["query_province_id"] == 13
    assert out["province_id"] == 13
    assert len(out["rows"]) == 50
    # Verify the request was built with the documented params.
    _, kwargs = session.get.call_args
    assert kwargs["params"]["country"] == "BRA"
    assert kwargs["params"]["provinceID"] == 13
    assert kwargs["params"]["year1"] == 2023
    assert kwargs["params"]["year2"] == 2026
    assert kwargs["params"]["type"] == "Mean"


def test_fetch_propagates_http_errors():
    import requests
    err = MagicMock()
    err.ok = False
    err.status_code = 503
    err.raise_for_status.side_effect = requests.HTTPError("503")
    session = MagicMock()
    session.get.return_value = err
    with pytest.raises(requests.HTTPError):
        vhi.fetch_vhi("BRA", 13, 2023, 2026, session=session)


# ── Defensive header sanitization (regression for the 2026-05-30 CI crash) ──

def test_sanitize_header_value_passes_ascii_through():
    s = vhi._sanitize_header_value("Mozilla/5.0 (compatible; CoffeeIntelVHI/1.0)")
    assert s == "Mozilla/5.0 (compatible; CoffeeIntelVHI/1.0)"


def test_sanitize_header_value_strips_em_dash():
    """Em-dash (U+2014) is the character that crashed CI on 2026-05-30."""
    s = vhi._sanitize_header_value("foo — bar")
    # Replaces with ? per ASCII errors='replace', leaving a latin-1-clean value.
    assert "—" not in s
    s.encode("latin-1")  # must not raise


def test_sanitize_header_value_strips_en_dash_and_smart_quotes():
    """All the typographic Unicode that sneaks into copy-pasted strings."""
    s = vhi._sanitize_header_value("a–b 'c' \"d\" • e")
    s.encode("latin-1")   # must not raise


def test_safe_session_wipes_default_headers_and_sets_baseline():
    """Even if a runner-injected default header had non-latin-1 chars,
    _safe_session resets them before our request goes out."""
    import requests
    s = requests.Session()
    # Inject something non-latin-1 to simulate the CI condition.
    s.headers["User-Agent"] = "python-requests/2.32.3 — corrupted by some hook"
    cleaned = vhi._safe_session(s)
    ua = cleaned.headers.get("User-Agent")
    assert ua is not None
    ua.encode("latin-1")   # must not raise
    assert "—" not in ua   # the bad default was replaced, not inherited
    # And our intended User-Agent is what's set.
    assert "CoffeeIntelVHI" in ua


def test_safe_session_creates_new_session_when_none_passed():
    s = vhi._safe_session(None)
    assert s is not None
    assert "CoffeeIntelVHI" in s.headers["User-Agent"]
    assert s.headers["Accept"] == "text/plain, */*"
    assert s.headers["Connection"] == "keep-alive"


def test_safe_session_preserves_all_baseline_headers():
    """All four baseline headers we explicitly set must end up on the session."""
    s = vhi._safe_session(None)
    for k in ("User-Agent", "Accept", "Accept-Encoding", "Connection"):
        assert k in s.headers
        s.headers[k].encode("latin-1")   # all latin-1-encodable
