"""Tests for the Colombia export scrapers — FNC bulletins and DANE
NANDINA annex parsing logic. Network-dependent paths (discovery /
download) are out of scope: they need integration tests against the
real hosts (or a recorded cassette), and the WAF realities make them
flaky from CI. We exercise only the pure-Python parsing primitives
that determine output correctness."""
from __future__ import annotations

from scraper.sources import dane_colombia_exports as dane
from scraper.sources import fnc_colombia_monthly as fnc

# ── FNC ─────────────────────────────────────────────────────────────────────


def test_fnc_number_parses_colombian_locale():
    assert fnc._fnc_number("1.234,5")    == 1234.5
    assert fnc._fnc_number("1.180")      == 1180.0      # thousands sep
    assert fnc._fnc_number("-29,1")      == -29.1
    assert fnc._fnc_number("xxx")        is None
    assert fnc._fnc_number("")           is None


def test_fnc_month_from_filename_picks_spanish_month_in_slug():
    url = "https://federaciondecafeteros.org/wp-content/uploads/2026/04/3.-Informe-mensual-Marzo-2026-p.pdf"
    assert fnc._month_from_filename(url) == (2026, 3)


def test_fnc_month_from_filename_handles_lowercase_short_form():
    url = "https://federaciondecafeteros.org/wp-content/uploads/2026/02/Informe-Expos-Enero-2026.pdf"
    assert fnc._month_from_filename(url) == (2026, 1)


def test_fnc_month_from_filename_returns_none_when_unparseable():
    url = "https://federaciondecafeteros.org/wp-content/uploads/2026/02/random-doc.pdf"
    assert fnc._month_from_filename(url) is None


def test_fnc_parse_bulletin_extracts_production_exports_and_yoy():
    text = (
        "Boletín FNC — Informe Mensual\n"
        "Producción mensual de café colombiano fue de 1.095,2 miles de sacos\n"
        "Exportaciones de café del mes alcanzaron 1.180,4 miles de sacos, "
        "una variación de -29,1% frente al mismo mes del año anterior\n"
    )
    url = ("https://federaciondecafeteros.org/wp-content/uploads/2026/04/"
           "3.-Informe-mensual-Marzo-2026-p.pdf")
    entry = fnc.parse_bulletin(text, url)
    assert entry is not None
    assert entry.month             == "2026-03"
    assert entry.production_k_bags == 1095.2
    assert entry.total_k_bags      == 1180.4
    assert entry.yoy_pct           == -29.1
    assert entry.source_pdf        == url
    assert entry.parser_version    == "v1"


def test_fnc_parse_bulletin_returns_none_when_nothing_matches():
    url = "https://federaciondecafeteros.org/wp-content/uploads/2026/04/Informe-Marzo-2026.pdf"
    assert fnc.parse_bulletin("totally unrelated text\n", url) is None


# ── DANE ────────────────────────────────────────────────────────────────────


def test_dane_url_for_uses_spanish_month_abbreviation():
    assert dane._url_for(2026, 3) == (
        "https://www.dane.gov.co/files/operaciones/EXPORTACIONES/"
        "anex-EXPORTACIONES-mar2026.xls"
    )
    assert dane._url_for(2025, 12).endswith("anex-EXPORTACIONES-dic2025.xls")


def test_dane_recent_months_starts_two_back_and_walks_backward(monkeypatch):
    # Freeze date to 2026-06-17 so the window is deterministic.
    import datetime as _dt
    class _FrozenDate(_dt.date):
        @classmethod
        def today(cls):
            return _dt.date(2026, 6, 17)
    monkeypatch.setattr(dane, "date", _FrozenDate)
    months = dane._recent_months(3)
    # M-2 = April 2026, then March, then February.
    assert months == [(2026, 4), (2026, 3), (2026, 2)]


def test_dane_normalize_code_pads_dropped_leading_zero():
    assert dane._normalize_code("0901.11.10.00")  == "0901111000"
    assert dane._normalize_code("0901111000")     == "0901111000"
    assert dane._normalize_code(901111000.0)      == "0901111000"   # numeric cell w/ lost leading 0
    assert dane._normalize_code("not a code")     is None
    assert dane._normalize_code(None)             is None


def test_dane_cell_number_handles_floats_and_locale_strings():
    assert dane._cell_number(49_100.5)   == 49_100.5
    assert dane._cell_number("49.100,5") == 49_100.5    # Colombian locale string
    assert dane._cell_number("")         is None
    assert dane._cell_number(None)       is None


def test_dane_format_code_inserts_nandina_dots():
    assert dane._format_code("0901111000") == "0901.11.10.00"
    assert dane._format_code("0901119000") == "0901.11.90.00"


def test_dane_build_entry_aggregates_two_nandina_rows():
    rows = [
        dane.NandinaRow(code="0901111000", tons=49_100.0, fob_usd=312_000_000.0),
        dane.NandinaRow(code="0901119000", tons=13_900.0, fob_usd=88_000_000.0),
    ]
    url = "https://www.dane.gov.co/files/operaciones/EXPORTACIONES/anex-EXPORTACIONES-mar2026.xls"
    entry = dane.build_entry(2026, 3, url, rows)
    assert entry is not None
    assert entry.month        == "2026-03"
    assert entry.total_t      == 63_000.0
    # 63_000 t / 60 kg per bag = 1,050,000 bags = 1,050.0 k-bags
    assert entry.total_k_bags == 1050.0
    codes = {b["code"] for b in entry.by_nandina}
    assert codes == {"0901.11.10.00", "0901.11.90.00"}


def test_dane_build_entry_returns_none_when_no_rows():
    assert dane.build_entry(2026, 3, "u", []) is None
    # Even rows that sum to zero tons are dropped (no half-rows).
    zero_rows = [dane.NandinaRow(code="0901111000", tons=0.0, fob_usd=None)]
    assert dane.build_entry(2026, 3, "u", zero_rows) is None


def test_fnc_merge_preserves_dane_breakdown_for_same_month(tmp_path, monkeypatch):
    """When DANE runs first (writing NANDINA breakdown for 2026-03), then
    FNC runs and parses 2026-03 from the bulletin (writing the headline
    production + exports + YoY), the DANE-specific keys must survive."""
    import json
    seed = {
        "country": "colombia",
        "exports": {
            "source":       "DANE Comercio Exterior — monthly NANDINA annexes",
            "unit":         "thousand 60-kg bags",
            "last_updated": "2026-03",
            "monthly": [
                {
                    "month":        "2026-03",
                    "total_t":      63_000.0,
                    "total_k_bags": 1050.0,
                    "by_nandina":   [{"code": "0901.11.10.00", "tons": 49_100.0, "fob_usd": 312_000_000.0}],
                    "source_xls":   "https://www.dane.gov.co/.../anex-EXPORTACIONES-mar2026.xls",
                },
            ],
            "annual": [{"year": "2024", "total_k_bags": 12_200.0}],
        },
        "fnc_price": {"as_of": "2026-06-01"},
    }
    out = tmp_path / "colombia_supply.json"
    out.write_text(json.dumps(seed))
    monkeypatch.setattr(fnc, "OUT_PATH", out)

    fnc_entry = fnc.MonthlyEntry(
        month="2026-03",
        total_k_bags=1180.4,
        production_k_bags=1095.2,
        yoy_pct=-29.1,
        source_pdf="https://federaciondecafeteros.org/.../Marzo-2026.pdf",
    )
    doc = fnc._merge_into_supply([fnc_entry])

    march = next(r for r in doc["exports"]["monthly"] if r["month"] == "2026-03")
    # FNC headline overwrites the existing total_k_bags (newer / authoritative for the
    # headline) and adds production_k_bags + yoy_pct + source_pdf.
    assert march["total_k_bags"]      == 1180.4
    assert march["production_k_bags"] == 1095.2
    assert march["yoy_pct"]           == -29.1
    # DANE-specific keys still present.
    assert march["total_t"]    == 63_000.0
    assert march["by_nandina"] == [{"code": "0901.11.10.00", "tons": 49_100.0, "fob_usd": 312_000_000.0}]
    assert march["source_xls"].endswith("mar2026.xls")
    # Source label gains an "+ FNC …" suffix without losing DANE attribution.
    assert "DANE" in doc["exports"]["source"]
    assert "FNC"  in doc["exports"]["source"]
    # Top-level siblings untouched.
    assert doc["fnc_price"] == {"as_of": "2026-06-01"}
    assert doc["exports"]["annual"] == seed["exports"]["annual"]


def test_dane_merge_into_supply_preserves_annual_and_existing_months(tmp_path, monkeypatch):
    import json
    seed = {
        "country": "colombia",
        "fnc_price": {"as_of": "2026-06-01"},   # untouched block
        "exports": {
            "source":  "USDA FAS PSD",
            "annual":  [{"year": "2024", "exports_k_60kg_bags": 12_700}],
            "monthly": [
                {"month": "2026-01", "total_k_bags": 1100.0, "_legacy": True},
            ],
        },
    }
    out = tmp_path / "colombia_supply.json"
    out.write_text(json.dumps(seed))
    monkeypatch.setattr(dane, "OUT_PATH", out)

    entry = dane.MonthlyEntry(
        month="2026-02",
        total_t=60_000.0,
        total_k_bags=1000.0,
        by_nandina=[{"code": "0901.11.10.00", "tons": 60_000.0, "fob_usd": None}],
        source_xls="https://example/anex.xls",
    )
    doc = dane._merge_into_supply([entry])

    # Annual USDA block + sibling fnc_price preserved.
    assert doc["exports"]["annual"] == seed["exports"]["annual"]
    assert doc["fnc_price"]         == {"as_of": "2026-06-01"}
    # Old Jan row left alone; new Feb row added; chronological.
    months = [r["month"] for r in doc["exports"]["monthly"]]
    assert months == ["2026-01", "2026-02"]
    feb = next(r for r in doc["exports"]["monthly"] if r["month"] == "2026-02")
    assert feb["total_k_bags"] == 1000.0
    assert feb["by_nandina"][0]["code"] == "0901.11.10.00"
