from __future__ import annotations

from scraper.sources.coffee_imports import parse_country_rows


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
