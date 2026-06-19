from __future__ import annotations

from scraper.sources.eurostat_imports import parse_jsonstat


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
    out = parse_jsonstat(cube)
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
    out = parse_jsonstat(cube)
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
    out = parse_jsonstat(cube)
    assert out["years"] == [2023]
    assert out["origins"][0]["by_year"] == {"2023": 1500.0}   # (600+400+500)k kg → 1500 MT


def test_parse_empty_or_malformed():
    assert parse_jsonstat({})["origins"] == []
    assert parse_jsonstat({"id": [], "size": [], "dimension": {}, "value": {}})["origins"] == []
