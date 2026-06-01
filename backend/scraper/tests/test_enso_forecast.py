"""Fixture + mock tests for the ENSO probability fallback chain.

Sandbox blocks egress to iri.columbia.edu and cpc.ncep.noaa.gov, so the
parsers are validated against saved fixtures and the orchestrator against
mocked HTTP responses. CI proves the live fetches.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from scraper import enso_forecast

FIXTURES = Path(__file__).parent / "fixtures"


# ── CPC discussion parser ─────────────────────────────────────────────────────

def _load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_parse_cpc_discussion_extracts_nine_seasons():
    out = enso_forecast.parse_cpc_discussion(_load_fixture("cpc_enso_discussion.html"))
    seasons = [r["season"] for r in out]
    assert seasons == ["AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ", "DJF"]


def test_parse_cpc_discussion_row_values_correct():
    out = enso_forecast.parse_cpc_discussion(_load_fixture("cpc_enso_discussion.html"))
    amj = next(r for r in out if r["season"] == "AMJ")
    assert amj == {"season": "AMJ", "la_nina": 8, "neutral": 78, "el_nino": 14}
    djf = next(r for r in out if r["season"] == "DJF")
    assert djf["la_nina"] == 31 and djf["neutral"] == 51 and djf["el_nino"] == 18


def test_parse_cpc_discussion_handles_plain_text():
    text = """\
Season    La Niña    Neutral    El Niño
AMJ 2026      8         78         14
MJJ 2026     15         70         15
"""
    out = enso_forecast.parse_cpc_discussion(text)
    assert len(out) == 2
    assert out[0] == {"season": "AMJ", "la_nina": 8, "neutral": 78, "el_nino": 14}


def test_parse_cpc_discussion_rejects_non_season_rows():
    text = """\
Season    La Niña    Neutral    El Niño
AMJ 2026      8         78         14
"the chance of a transition is XYZ"
MJJ 2026     15         70         15
"""
    out = enso_forecast.parse_cpc_discussion(text)
    # Stops at the prose line — the second data row is dropped.
    assert [r["season"] for r in out] == ["AMJ"]


def test_parse_cpc_discussion_empty_when_no_header():
    assert enso_forecast.parse_cpc_discussion("") == []
    assert enso_forecast.parse_cpc_discussion(
        "Random text with no table header anywhere."
    ) == []


def test_parse_cpc_discussion_handles_unicode_n_tilde():
    # CPC sometimes writes "Niño" / "Niña" with the tilde; the parser must
    # still match because we normalise before reading.
    text = """\
Season    La Niña    Neutral    El Niño
JJA 2026     23         63         14
"""
    out = enso_forecast.parse_cpc_discussion(text)
    assert len(out) == 1
    assert out[0]["season"] == "JJA"


def test_parse_cpc_discussion_handles_html_entities():
    # The .gov pages sometimes ship the same text with HTML entities and
    # full markup. The parser strips tags first.
    raw = """\
<html><pre>
Season    La Niña    Neutral    El Niño
ASO 2026     32         53         15
</pre></html>
"""
    out = enso_forecast.parse_cpc_discussion(raw)
    assert out == [{"season": "ASO", "la_nina": 32, "neutral": 53, "el_nino": 15}]


# ── Orchestrator: fallback chain ─────────────────────────────────────────────

def _ok_response(text: str) -> MagicMock:
    r = MagicMock()
    r.ok = True
    r.status_code = 200
    r.text = text
    return r


def _bad_response() -> MagicMock:
    r = MagicMock()
    r.ok = False
    r.status_code = 503
    r.text = ""
    return r


def test_fetch_returns_iri_when_iri_succeeds():
    iri_html = """<html><body>
<table>
<tr><th>Season</th><th>La Nina</th><th>Neutral</th><th>El Nino</th></tr>
<tr><td>MAM</td><td>0</td><td>91</td><td>9</td></tr>
</table></body></html>"""
    session = MagicMock()
    session.get.return_value = _ok_response(iri_html)
    forecast, source = enso_forecast.fetch_enso_forecast(session=session)
    assert source == "iri"
    assert forecast and forecast[0]["season"] == "MAM"
    # CPC should NOT have been called.
    assert session.get.call_count == 1


def test_fetch_falls_back_to_cpc_when_iri_empty():
    # IRI returns HTML with no probability table → empty parse → fallback.
    iri_empty = "<html><body><img src='enso_plume.png'/></body></html>"
    cpc_text = _load_fixture("cpc_enso_discussion.html")

    session = MagicMock()
    session.get.side_effect = [_ok_response(iri_empty), _ok_response(cpc_text)]
    forecast, source = enso_forecast.fetch_enso_forecast(session=session)
    assert source == "cpc"
    assert len(forecast) == 9
    assert session.get.call_count == 2
    # First call IRI, second CPC.
    assert session.get.call_args_list[0][0][0] == enso_forecast.IRI_FORECAST_URL
    assert session.get.call_args_list[1][0][0] == enso_forecast.CPC_DISCUSSION_URL


def test_fetch_falls_back_to_cpc_when_iri_errors():
    import requests
    session = MagicMock()
    session.get.side_effect = [
        requests.ConnectionError("DNS fail"),
        _ok_response(_load_fixture("cpc_enso_discussion.html")),
    ]
    forecast, source = enso_forecast.fetch_enso_forecast(session=session)
    assert source == "cpc"
    assert len(forecast) == 9


def test_fetch_returns_empty_when_both_sources_fail():
    session = MagicMock()
    session.get.side_effect = [
        _ok_response("<html>no table</html>"),
        _bad_response(),
    ]
    forecast, source = enso_forecast.fetch_enso_forecast(session=session)
    assert forecast == []
    assert source is None


def test_iri_parser_is_re_exported_from_module():
    # backwards-compat: the existing test_farmer_economics.py imports the
    # old name via the farmer_economics module, and that re-export must work.
    from scraper.sources import farmer_economics as fe
    assert fe.parse_iri_probability_table is enso_forecast.parse_iri_html
    assert fe.IRI_FORECAST_URL == enso_forecast.IRI_FORECAST_URL
