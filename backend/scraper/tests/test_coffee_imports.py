from __future__ import annotations

from scraper.sources.coffee_imports import (
    drop_implausible_years,
    parse_country_monthly,
    parse_country_rows,
)


def _row(period, cmd, net_wgt=None, value=None):
    return {"period": period, "cmdCode": cmd, "netWgt": net_wgt, "primaryValue": value}


def test_parse_aggregates_green_roasted_decaf():
    rows = [
        _row(2023, "090111", net_wgt=1_000_000, value=5_000_000),   # green, not decaf → 1000 MT
        _row(2023, "090112", net_wgt=200_000,   value=1_200_000),   # green, decaf     → 200 MT
        _row(2023, "090121", net_wgt=300_000,   value=2_000_000),   # roasted, not decaf
        _row(2023, "090122", net_wgt=100_000,   value=900_000),     # roasted, decaf
        _row(2023, "090190", net_wgt=50_000,    value=100_000),     # husks
    ]
    out = parse_country_rows(rows)
    assert len(out) == 1
    r = out[0]
    assert r["year"] == 2023
    assert r["green_mt"] == 1200.0          # 1000 + 200
    assert r["roasted_mt"] == 400.0         # 300 + 100
    assert r["decaf_mt"] == 300.0           # 200 + 100
    assert r["husks_mt"] == 50.0
    # No explicit 0901 row → total = green + roasted + husks
    assert r["total_mt"] == 1650.0
    assert r["value_usd"] == 9_200_000


def test_parse_prefers_reported_0901_total():
    rows = [
        _row(2022, "0901",   net_wgt=2_000_000, value=10_000_000),
        _row(2022, "090111", net_wgt=900_000,   value=4_000_000),
    ]
    out = parse_country_rows(rows)
    assert out[0]["total_mt"] == 2000.0          # uses the 4-digit aggregate
    assert out[0]["value_usd"] == 10_000_000
    assert out[0]["green_mt"] == 900.0


def test_parse_value_only_country():
    # Some reporters publish value but no weight.
    rows = [_row(2021, "0901", net_wgt=0, value=3_500_000)]
    out = parse_country_rows(rows)
    assert out[0]["total_mt"] is None
    assert out[0]["value_usd"] == 3_500_000


def test_parse_sorts_years_and_skips_junk():
    rows = [
        _row(2020, "0901", net_wgt=1_000_000),
        _row("bad", "0901", net_wgt=1_000_000),     # unparseable year
        _row(2019, "0901", net_wgt=2_000_000),
        _row(2020, "999999", net_wgt=9_000_000),    # unknown HS → ignored
    ]
    out = parse_country_rows(rows)
    assert [r["year"] for r in out] == [2019, 2020]
    assert out[1]["total_mt"] == 1000.0             # junk HS not added


def test_parse_empty():
    assert parse_country_rows([]) == []


def test_parse_country_monthly():
    rows = [
        _row("202401", "0901", net_wgt=1_000_000),
        _row("202402", "090111", net_wgt=600_000),
        _row("202402", "090121", net_wgt=200_000),
        _row("bad",    "0901", net_wgt=9_000_000),   # bad period skipped
    ]
    out = parse_country_monthly(rows)
    assert out == {"2024-01": 1000.0, "2024-02": 800.0}


def test_drop_implausible_years_removes_partial_year():
    # Italy-style: a ~570 kt norm with one 8 kt partial-reporting year.
    rows = [{"year": y, "total_mt": v} for y, v in
            [(2014, 560_000), (2015, 575_000), (2016, 8_000), (2017, 580_000), (2018, 590_000)]]
    out = drop_implausible_years(rows, "ita")
    years = [r["year"] for r in out]
    assert 2016 not in years            # dropped as <20% of median
    assert years == [2014, 2015, 2017, 2018]


def test_drop_implausible_years_keeps_real_dips_and_short_series():
    # A genuine ~30% dip is kept (not an extreme outlier).
    rows = [{"year": y, "total_mt": v} for y, v in
            [(2014, 100_000), (2015, 95_000), (2016, 70_000), (2017, 98_000), (2018, 102_000)]]
    assert len(drop_implausible_years(rows, "x")) == 5
    # <4 non-zero years → no relative gates, but the ABSOLUTE floor still
    # applies: a 5 MT "year" is a token slice (e.g. Germany 2025 under the
    # 1-period preview), never a real annual import for these markets.
    short = [{"year": 2017, "total_mt": 3_116}, {"year": 2018, "total_mt": 8_000}]
    assert drop_implausible_years(short, "x") == [{"year": 2018, "total_mt": 8_000}]


def test_drop_implausible_years_robust_when_most_years_garbage():
    # Greece-style: majority of years are near-zero garbage; the upper-half
    # reference keeps the real ~15–65 kt years instead of flagging them as highs.
    rows = [{"year": y, "total_mt": v} for y, v in
            [(2014, 41_388), (2015, 44_856), (2016, 65_152), (2017, 2), (2018, 2),
             (2019, 77), (2020, 14_896)]]
    years = [r["year"] for r in drop_implausible_years(rows, "grc")]
    assert years == [2014, 2015, 2016, 2020]   # near-zero years dropped, real kept
