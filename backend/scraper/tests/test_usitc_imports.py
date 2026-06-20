from __future__ import annotations

from scraper.sources.usitc_imports import (
    build_query,
    parse_monthly,
    parse_monthly_by_origin,
    parse_report,
)


def _resp(columns, rows):
    """Build a DataWeb-shaped response: columns = flat labels, rows = list of
    value-lists, matching dto.tables[0].column_groups / row_groups[0].rowsNew."""
    return {"dto": {"tables": [{
        "column_groups": [
            {"columns": [{"label": columns[0]}]},
            {"columns": [{"label": c} for c in columns[1:]]},
        ],
        "row_groups": [{"rowsNew": [
            {"rowEntries": [{"value": v} for v in row]} for row in rows
        ]}],
    }]}}


def test_parse_by_origin_with_total_row():
    resp = _resp(
        ["Country", "2022", "2023"],
        [["Brazil", "1,000,000", "1,100,000"],
         ["Colombia", "500,000", "450,000"],
         ["Total", "1,500,000", "1,550,000"]],
    )
    out = parse_report(resp)
    assert out["years"] == [2022, 2023]
    assert [o["name"] for o in out["origins"]] == ["Brazil", "Colombia"]   # sorted desc by latest
    brazil = out["origins"][0]
    assert brazil["by_year"] == {"2022": 1000.0, "2023": 1100.0}           # kg → MT
    assert brazil["latest_mt"] == 1100.0
    assert out["total_by_year"] == {"2022": 1500.0, "2023": 1550.0}        # from Total row


def test_parse_derives_total_when_absent():
    resp = _resp(
        ["Country", "2023"],
        [["Vietnam", "800,000"], ["Brazil", "1,200,000"]],
    )
    out = parse_report(resp)
    assert out["total_by_year"] == {"2023": 2000.0}     # summed
    assert out["origins"][0]["name"] == "Brazil"        # 1200 > 800


def test_parse_skips_blanks_and_bad_numbers():
    resp = _resp(
        ["Country", "2022", "2023"],
        [["Brazil", "", "1,100,000"], ["Junk", "-", "--"]],
    )
    out = parse_report(resp)
    names = [o["name"] for o in out["origins"]]
    assert "Junk" not in names                          # no usable values → dropped
    assert out["origins"][0]["by_year"] == {"2023": 1100.0}


def test_parse_malformed_returns_empty():
    assert parse_report({})["origins"] == []
    assert parse_report({"dto": {"tables": []}})["origins"] == []


def test_build_query_targets_coffee_imports_by_country():
    q = build_query(["2022", "2023", "2024"])
    assert q["reportOptions"]["tradeType"] == "Import"
    assert q["reportOptions"]["classificationSystem"] == "HTS"
    com = q["searchOptions"]["commodities"]
    assert com["commodities"] == ["0901"]
    assert com["granularity"] == "4"
    assert q["searchOptions"]["countries"]["aggregation"] == "Break Out Countries"
    cs = q["searchOptions"]["componentSettings"]
    assert cs["dataToReport"] == ["CONS_FIR_UNIT_QUANT"]
    assert cs["years"] == ["2022", "2023", "2024"]
    assert cs["yearsTimeline"] == "Annual"


def _resp_monthly(columns, row):
    return {"dto": {"tables": [{
        "column_groups": [
            {"columns": [{"label": columns[0]}]},
            {"columns": [{"label": c} for c in columns[1:]]},
        ],
        "row_groups": [{"rowsNew": [{"rowEntries": [{"value": v} for v in row]}]}],
    }]}}


def _resp_crosstab(columns, rows):
    return {"dto": {"tables": [{
        "column_groups": [
            {"columns": [{"label": columns[0]}]},
            {"columns": [{"label": c} for c in columns[1:]]},
        ],
        "row_groups": [{"rowsNew": [{"rowEntries": [{"value": v} for v in r]} for r in rows]}],
    }]}}


def test_parse_monthly_crosstab_year_plus_month_names():
    # Real USITC layout: a 'Year' column + bare month-name columns, one row/year.
    resp = _resp_crosstab(
        ["Year", "Quantity Description", "January", "February", "March"],
        [["2024", "First Unit of Quantity", "1,000,000", "1,100,000", "900,000"],
         ["2025", "First Unit of Quantity", "1,050,000", "950,000", "--"]],
    )
    out = parse_monthly(resp)
    assert out == {"2024-01": 1000.0, "2024-02": 1100.0, "2024-03": 900.0,
                   "2025-01": 1050.0, "2025-02": 950.0}


def test_parse_monthly_fallback_mon_year_labels():
    resp = _resp_monthly(
        ["Country", "Jan 2024", "February 2024", "2024-03", "202404"],
        ["All Countries", "1,000,000", "1,100,000", "900,000", "950,000"],
    )
    out = parse_monthly(resp)
    assert out == {"2024-01": 1000.0, "2024-02": 1100.0, "2024-03": 900.0, "2024-04": 950.0}


def test_parse_monthly_empty():
    assert parse_monthly({}) == {}


def test_build_query_monthly_aggregates_countries():
    q = build_query(["2024"], timeline="Monthly", break_countries=False)
    assert q["searchOptions"]["componentSettings"]["yearsTimeline"] == "Monthly"
    assert q["searchOptions"]["countries"]["aggregation"] == "Aggregate Countries"


def test_parse_monthly_by_origin_crosstab():
    # Country column + Year column + bare month names; one row per (country, year).
    resp = _resp_crosstab(
        ["Country", "Year", "January", "February"],
        [["Brazil", "2024", "1,000,000", "1,100,000"],
         ["Brazil", "2025", "1,050,000", "--"],
         ["Colombia", "2024", "500,000", "600,000"],
         ["Total", "2024", "1,500,000", "1,700,000"]],
    )
    out = parse_monthly_by_origin(resp)
    assert out["Brazil"] == {"2024-01": 1000.0, "2024-02": 1100.0, "2025-01": 1050.0}
    assert out["Colombia"] == {"2024-01": 500.0, "2024-02": 600.0}
    assert "Total" not in out          # total row excluded


def test_parse_monthly_by_origin_empty():
    assert parse_monthly_by_origin({}) == {}
