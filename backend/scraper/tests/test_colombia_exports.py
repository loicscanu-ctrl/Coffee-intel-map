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


def test_fnc_parse_bulletin_emits_production_for_bulletin_month_and_exports_for_named_month():
    """Real Jan-2026 bulletin sample (paraphrased from the live PDF).
    Production line names no month (it's THIS bulletin's month), exports
    bullet names December — so we must emit two rows, one for Jan and one
    for Dec, the latter dated to year-1."""
    text = (
        "• Para este mes, la producción de café alcanzó 893 mil sacos, lo que\n"
        "  representa una variación anual negativa del 34,2 %.\n"
        "• Las exportaciones definitivas de café en diciembre se ubicaron en 1,1\n"
        "  millones de sacos de 60 kg, lo que representa una caída de 19,0% frente\n"
        "  al mismo mes de 2024.\n"
    )
    url = ("https://federaciondecafeteros.org/wp-content/uploads/2026/03/"
           "1.-Informe-mensual-enero-p-1.pdf")
    entries = fnc.parse_bulletin(text, url)
    by_month = {e.month: e for e in entries}
    # Production for the bulletin month, Jan 2026: 893 mil sacos = 893 k-bags.
    # production_yoy_pct is independent of exports yoy_pct (v3+).
    assert by_month["2026-01"].production_k_bags  == 893.0
    assert by_month["2026-01"].production_yoy_pct == -34.2
    assert by_month["2026-01"].yoy_pct            is None
    # Exports for the named month December — year inferred as 2025 because
    # the bullet says "en diciembre" with no year, and Dec > Jan ⇒ prior year.
    assert by_month["2025-12"].total_k_bags == 1100.0     # 1.1 × 1000
    assert by_month["2025-12"].yoy_pct       == -19.0
    assert by_month["2025-12"].production_yoy_pct is None
    for e in entries:
        assert e.parser_version == "v2"
        assert e.source_pdf     == url


def test_fnc_parse_bulletin_accepts_se_ubico_verb_variant():
    """The March 2026 bulletin uses 'se ubicó en' instead of 'alcanzó',
    and exports drop 'de café' filler ('exportaciones definitivas de
    febrero...' instead of '...de café en febrero...'). v3 accepts both
    verb constructions and either preposition for the month."""
    text = (
        "• En marzo, la producción de café se ubicó en 754 mil sacos, un 29,1%\n"
        "  menos frente al mismo mes de 2025.\n"
        "• Las exportaciones definitivas de febrero se ubicaron en 847 mil sacos de\n"
        "  60 kg, un 28,5% menos frente al mismo mes de 2025.\n"
    )
    url = ("https://federaciondecafeteros.org/wp-content/uploads/2026/05/"
           "3.-Informe-mensual-Marzo-2026-p-1.pdf")
    by_month = {e.month: e for e in fnc.parse_bulletin(text, url)}
    assert by_month["2026-03"].production_k_bags  == 754.0
    assert by_month["2026-03"].production_yoy_pct == -29.1
    assert by_month["2026-03"].yoy_pct            is None
    assert by_month["2026-02"].total_k_bags       == 847.0
    assert by_month["2026-02"].yoy_pct            == -28.5
    assert by_month["2026-02"].production_yoy_pct is None


def test_fnc_upload_sort_key_orders_by_folder_year_month():
    """Discovered PDFs are sorted by /uploads/YYYY/MM/ ASCENDING so the
    merge's last-write-wins picks the NEWEST upload. v3 bug: a stale
    Jan-2024 bulletin (uploaded into /2024/02/) was clobbering legit
    Jan-2026 data (uploaded into /2025/12/) because the merge processed
    in discovery order. v4: sort by upload path → older bulletin runs
    first, newer one overwrites it."""
    urls = [
        "https://federaciondecafeteros.org/wp-content/uploads/2025/12/1.-Informe-mensual-enero-p-1.pdf",
        "https://federaciondecafeteros.org/wp-content/uploads/2024/02/1.-Informe-mensual-enero-p.pdf",
        "https://federaciondecafeteros.org/wp-content/uploads/2026/03/1.-Informe-mensual-Marzo-2026-p-1.pdf",
    ]
    urls_sorted = sorted(urls, key=fnc._upload_sort_key)
    # Oldest first → newest last (so it wins last-write-wins in the merge).
    assert urls_sorted[0].endswith("/2024/02/1.-Informe-mensual-enero-p.pdf")
    assert urls_sorted[1].endswith("/2025/12/1.-Informe-mensual-enero-p-1.pdf")
    assert urls_sorted[2].endswith("/2026/03/1.-Informe-mensual-Marzo-2026-p-1.pdf")


def test_fnc_merge_preserves_production_yoy_when_exports_bullet_arrives_separately(tmp_path, monkeypatch):
    """When the production bulletin (Jan 2026) lands first with its own
    YoY, and a LATER bulletin (Feb 2026) reports Jan 2026 exports + its
    own export-YoY, the merge keeps BOTH YoYs distinct: production_yoy_pct
    from the production bulletin, yoy_pct (exports) from the exports
    bulletin."""
    monkeypatch.setattr(fnc, "OUT_PATH", tmp_path / "colombia_supply.json")
    # Jan 2026 bulletin → Jan production with prod_yoy = -34.2.
    e1 = fnc.MonthlyEntry(
        month="2026-01",
        production_k_bags=893.0,
        production_yoy_pct=-34.2,
        source_pdf="u1",
    )
    # Feb 2026 bulletin → Jan exports with exports_yoy = -19.8.
    e2 = fnc.MonthlyEntry(
        month="2026-01",
        total_k_bags=925.0,
        yoy_pct=-19.8,
        source_pdf="u2",
    )
    doc = fnc._merge_into_supply([e1, e2])
    by_month = {r["month"]: r for r in doc["exports"]["monthly"]}
    row = by_month["2026-01"]
    assert row["production_k_bags"]  == 893.0
    assert row["production_yoy_pct"] == -34.2   # NOT clobbered by export merge
    assert row["total_k_bags"]       == 925.0
    assert row["yoy_pct"]            == -19.8   # exports YoY survives


def test_fnc_parse_bulletin_rejects_non_bulletin_pdfs():
    """v1 bug: the daily precio_cafe.pdf and FEPCafé monthly reports lived
    on the same listing URL prefix and were treated as data sources.
    v2 filters by filename so only Informe-mensual / Informe-Expos PDFs
    are parsed."""
    url = "https://federaciondecafeteros.org/wp-content/uploads/2026/03/precio_cafe.pdf"
    text = "Junio 17 / 2026 Cierre contrato C Nueva York 277.85 USCent/Lb"
    assert fnc.parse_bulletin(text, url) == ()


def test_fnc_parse_bulletin_ignores_section_numbers_and_year_tokens():
    """v1 captured '1.1 PRECIOS' as 1.1 k-bags and '2026' as 2026 k-bags.
    v2 requires an explicit 'mil sacos' / 'millones de sacos' unit so
    those tokens can't leak through."""
    text = (
        "TABLA DE CONTENIDO – INFORME MENSUAL ENERO 2026\n"
        "1. PRECIOS 4. PRODUCCIÓN\n"
        "1.1 Precio Interno 4.1 Producción Mensual\n"
        "2. VARIABLES MACRO 5. EXPORTACIONES\n"
        "2.1 Tasa de cambio 5.1 Exportaciones Definitivas\n"
        # No bullet with the explicit "mil sacos" / "millones de sacos" — should drop.
    )
    url = ("https://federaciondecafeteros.org/wp-content/uploads/2026/03/"
           "1.-Informe-mensual-enero-p-1.pdf")
    assert fnc.parse_bulletin(text, url) == ()


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


def test_dane_build_entry_from_ytd_computes_monthly_diff():
    """Cuadro 4 reports YTD-through-{title-month}, so March monthly tons
    are March YTD minus February YTD. Real numbers from the diag run:
    Apr-2026 XLS YTD = 194,432.64 t; Mar-2026 XLS YTD = 164,473.74 t
    → April monthly = 29,958.9 t."""
    ytd_april = {
        "0901119000": {"tons": 194432.64, "fob_usd_k": 1624275.14, "desc": "Los demás cafés..."},
    }
    ytd_march = {
        "0901119000": {"tons": 164473.74, "fob_usd_k": 1394668.17, "desc": "Los demás cafés..."},
    }
    entry = dane.build_entry_from_ytd(2026, 4, "u", ytd_april, ytd_march)
    assert entry is not None
    assert entry.month   == "2026-04"
    assert entry.total_t == 29958.9
    # 29958.9 t × 1000 kg / 60 kg = 499,315 bags = 499.3 k-bags.
    assert entry.total_k_bags == 499.3
    by_code = {b["code"]: b for b in entry.by_nandina}
    assert by_code["0901.11.90.00"]["tons"] == 29958.9
    # FOB USD: (1,624,275.14 − 1,394,668.17) thousand × 1000 = 229,606,970 USD.
    assert by_code["0901.11.90.00"]["fob_usd"] == 229606970.0
    assert entry.parser_version == "v2"


def test_dane_build_entry_from_ytd_january_no_prior_needed():
    """January is the first month of the YTD window — its YTD value
    equals the monthly value, no prior snapshot required."""
    ytd_jan = {
        "0901119000": {"tons": 60000.0, "fob_usd_k": 480000.0, "desc": "Los demás cafés..."},
    }
    entry = dane.build_entry_from_ytd(2026, 1, "u", ytd_jan, None)
    assert entry is not None
    assert entry.total_t == 60000.0


def test_dane_build_entry_from_ytd_drops_negative_diffs():
    """A NANDINA reclassification or a customs revision can make the
    prior YTD exceed the current YTD. The diff is meaningless then; we
    drop the line rather than ship a negative tonnage."""
    ytd_cur = {
        "0901119000": {"tons": 100000.0, "fob_usd_k": 500000.0, "desc": "demás"},
        "0901111000": {"tons": 50000.0,  "fob_usd_k": 250000.0, "desc": "suave"},
    }
    ytd_prior = {
        "0901119000": {"tons": 80000.0,  "fob_usd_k": 400000.0, "desc": "demás"},
        # suave was higher in the prior YTD → negative diff, drop.
        "0901111000": {"tons": 90000.0,  "fob_usd_k": 450000.0, "desc": "suave"},
    }
    entry = dane.build_entry_from_ytd(2026, 3, "u", ytd_cur, ytd_prior)
    assert entry is not None
    by_code = {b["code"]: b for b in entry.by_nandina}
    # Only the demás line survives; the suave diff was negative.
    assert list(by_code.keys()) == ["0901.11.90.00"]
    assert by_code["0901.11.90.00"]["tons"] == 20000.0
    assert entry.total_t == 20000.0


def test_dane_prior_month_handles_january_rollover():
    assert dane._prior_month(2026, 1) == (2025, 12)
    assert dane._prior_month(2026, 4) == (2026, 3)


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
