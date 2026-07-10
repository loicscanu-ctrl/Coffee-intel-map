from __future__ import annotations

from scraper.sources.eurostat_imports import (
    _month_code,
    clean_name,
    parse_jsonstat,
    parse_monthly_origins,
    parse_monthly_total,
)


def _cube(partners, years, values, labels):
    """Minimal JSON-stat cube: dims freq/reporter/partner/product/flow/indicators/time,
    only partner & time vary. `values` keyed by flat index."""
    return {
        "id": ["freq", "reporter", "partner", "product", "flow", "indicators", "time"],
        "size": [1, 1, len(partners), 1, 1, 1, len(years)],
        "dimension": {
            "partner": {"category": {
                "index": {p: i for i, p in enumerate(partners)},
                "label": labels,
            }},
            "time": {"category": {"index": {y: i for i, y in enumerate(years)}}},
        },
        "value": values,
    }


def test_parse_basic_two_partners_two_years():
    # strides → flat = partner_pos*2 + time_pos
    cube = _cube(
        ["BR", "CO"], ["2022", "2023"],
        {"0": 1_000_000, "1": 1_100_000, "2": 500_000, "3": 450_000},
        {"BR": "Brazil", "CO": "Colombia"},
    )
    out = parse_jsonstat(cube, kg_per_unit=1)
    assert out["years"] == [2022, 2023]
    assert [o["name"] for o in out["origins"]] == ["Brazil", "Colombia"]   # sorted desc
    assert out["origins"][0]["by_year"] == {"2022": 1000.0, "2023": 1100.0}  # kg→MT
    assert out["origins"][0]["latest_mt"] == 1100.0
    assert out["total_by_year"] == {"2022": 1500.0, "2023": 1550.0}


def test_parse_excludes_eu_members_and_aggregates():
    cube = _cube(
        ["BR", "CO", "DE", "WORLD"], ["2023"],
        {"0": 800_000, "1": 600_000, "2": 999_000, "3": 9_000_000},
        {"BR": "Brazil", "CO": "Colombia", "DE": "Germany", "WORLD": "World"},
    )
    out = parse_jsonstat(cube, kg_per_unit=1)
    names = [o["name"] for o in out["origins"]]
    assert names == ["Brazil", "Colombia"]          # DE (intra-EU) + WORLD dropped
    assert out["total_by_year"] == {"2023": 1400.0}


def test_parse_aggregates_monthly_to_year():
    # Monthly time codes for one partner → summed into the calendar year.
    cube = _cube(
        ["BR"], ["2023-01", "2023-02", "2023-03"],
        {"0": 600_000, "1": 400_000, "2": 500_000},
        {"BR": "Brazil"},
    )
    out = parse_jsonstat(cube, kg_per_unit=1)
    assert out["years"] == [2023]
    assert out["origins"][0]["by_year"] == {"2023": 1500.0}   # (600+400+500)k kg → 1500 MT


def test_parse_empty_or_malformed():
    assert parse_jsonstat({})["origins"] == []
    assert parse_jsonstat({"id": [], "size": [], "dimension": {}, "value": {}})["origins"] == []


def test_parse_100kg_units_to_mt():
    # Comext quantity is in 100-kg units → MT = value * 100 / 1000 = value/10.
    cube = _cube(["BR"], ["2023"], {"0": 10_000}, {"BR": "Brazil"})
    out = parse_jsonstat(cube)            # default kg_per_unit=100
    assert out["origins"][0]["by_year"] == {"2023": 1000.0}


def test_clean_name_strips_parentheticals_and_renames():
    assert clean_name("Viet Nam (incl. North Viet Nam 'VD' from 1977)") == "Vietnam"
    assert clean_name("Ethiopia (incl. Eritrea 'ER' -> 1993)") == "Ethiopia"
    assert clean_name("Brazil") == "Brazil"


def test_month_code_formats():
    assert _month_code("202401") == "2024-01"
    assert _month_code("2024-01") == "2024-01"
    assert _month_code("2024M03") == "2024-03"
    assert _month_code("2024") is None


def test_parse_member_keeps_intra_eu_drops_self():
    # For an individual member, intra-EU origins (e.g. NL re-exports) are kept;
    # only the member's own code is dropped. (Bloc behaviour is unchanged.)
    cube = _cube(["BR", "DE", "NL"], ["2023"],
                 {"0": 800_000, "1": 600_000, "2": 700_000},
                 {"BR": "Brazil", "DE": "Germany", "NL": "Netherlands"})
    out = parse_jsonstat(cube, kg_per_unit=1, reporter_code="DE")
    names = [o["name"] for o in out["origins"]]
    assert "Brazil" in names and "Netherlands" in names   # intra-EU NL kept
    assert "Germany" not in names                          # self dropped


def test_parse_monthly_origins_top_n_and_total():
    cube = _cube(["BR", "CO", "DE"], ["2024-01", "2024-02"],
                 {"0": 10_000, "1": 11_000, "2": 5_000, "3": 6_000, "4": 99_999, "5": 88_888},
                 {"BR": "Brazil", "CO": "Colombia", "DE": "Germany"})
    out = parse_monthly_origins(cube, reporter_code="EU27_2020", top_n=1)
    assert set(out) == {"Brazil", "__total__"}            # bloc drops DE; top_n=1 keeps Brazil
    assert out["Brazil"] == {"2024-01": 1000.0, "2024-02": 1100.0}   # 100kg→MT (/10)
    assert out["__total__"] == {"2024-01": 1500.0, "2024-02": 1700.0}  # BR+CO, DE excluded


def test_parse_monthly_total_sums_extra_eu_partners():
    # BR kept (extra-EU); DE excluded (EU member). 100-kg units → /10 MT.
    cube = _cube(["BR", "DE"], ["2024-01", "2024-02"],
                 {"0": 10_000, "1": 11_000, "2": 99_999, "3": 88_888},
                 {"BR": "Brazil", "DE": "Germany"})
    out = parse_monthly_total(cube)
    assert out == {"2024-01": 1000.0, "2024-02": 1100.0}


def test_parse_monthly_origins_sums_product_dim_keeps_intra_eu_for_member():
    # DE-trade fetches pass multiple HS6 codes in one cube (product dim size 2);
    # the stride decoder must sum across them, and a member reporter keeps
    # intra-EU partners (German re-exports go mostly to EU neighbours).
    cube = {
        "id": ["freq", "reporter", "partner", "product", "flow", "indicators", "time"],
        "size": [1, 1, 2, 2, 1, 1, 2],
        "dimension": {
            "partner": {"category": {"index": {"BR": 0, "NL": 1},
                                     "label": {"BR": "Brazil", "NL": "Netherlands"}}},
            "time": {"category": {"index": {"2024-01": 0, "2024-02": 1}}},
        },
        # strides: partner=4, product=2, time=1 → flat = p*4 + prod*2 + t
        "value": {"0": 10_000, "2": 5_000, "4": 2_000, "6": 1_000},
    }
    out = parse_monthly_origins(cube, reporter_code="DE")
    assert out["Brazil"] == {"2024-01": 1500.0}        # 090111+090112 summed
    assert out["Netherlands"] == {"2024-01": 300.0}    # intra-EU kept for DE
    assert out["__total__"] == {"2024-01": 1800.0}
