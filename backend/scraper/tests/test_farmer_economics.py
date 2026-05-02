import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

def test_weather_snapshot_has_expected_columns():
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import WeatherSnapshot
    cols = {c.name for c in WeatherSnapshot.__table__.columns}
    assert {"id", "region", "scraped_at", "daily_data"}.issubset(cols)

def test_fertilizer_import_has_expected_columns():
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import FertilizerImport
    cols = {c.name for c in FertilizerImport.__table__.columns}
    assert {"id", "month", "ncm_code", "ncm_label", "net_weight_kg", "fob_usd", "scraped_at"}.issubset(cols)

def test_fertilizer_import_unique_constraint():
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import FertilizerImport
    constraints = {c.name for c in FertilizerImport.__table__.constraints}
    assert "uq_fert_import_month_ncm" in constraints


# ---------------------------------------------------------------------------
# farmer_economics.py parsing helper tests
# ---------------------------------------------------------------------------

def _import_fe():
    """Import the farmer_economics module, adjusting sys.path as needed."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sources"))
    import farmer_economics as fe
    return fe


def test_aggregate_hourly_to_daily_basic():
    fe = _import_fe()

    times = (
        [f"2026-04-15T{h:02d}:00" for h in range(24)]
        + [f"2026-04-16T{h:02d}:00" for h in range(24)]
    )
    hourly = {
        "time": times,
        # Day 1: min=15 (>= 12 → frost "-"), max precip=70 (>= 60 → drought "-")
        "temperature_2m":           [15.0] * 24 + [3.0] * 24,
        "dew_point_2m":             [5.0]  * 24 + [2.0] * 24,
        "cloud_cover":              [50.0] * 24 + [80.0] * 24,
        "wind_speed_10m":           [20.0] * 24 + [35.0] * 24,
        # Day 1 precip 70 (>= 60 → "-"), Day 2 precip 10 (< 15 → "H")
        "precipitation_probability":[70.0] * 24 + [10.0] * 24,
    }

    days = fe._aggregate_hourly_to_daily(hourly)

    assert len(days) == 2

    # Day 1: min_temp=15, precip_prob_max=70 → frost="-", drought="-"
    assert days[0]["date"] == "2026-04-15"
    assert days[0]["min_temp"] == 15.0
    assert days[0]["frost_risk"] == "-"
    assert days[0]["drought_risk"] == "-"

    # Day 2: min_temp=3, precip_prob_max=10 → frost="H", drought="H"
    assert days[1]["date"] == "2026-04-16"
    assert days[1]["min_temp"] == 3.0
    assert days[1]["frost_risk"] == "H"
    assert days[1]["drought_risk"] == "H"


def test_frost_risk_boundaries():
    fe = _import_fe()

    assert fe._frost_risk(3.9)  == "H"   # < 4
    assert fe._frost_risk(4.0)  == "M"   # == 4 → not < 4
    assert fe._frost_risk(7.9)  == "M"   # < 8
    assert fe._frost_risk(8.0)  == "L"   # == 8 → not < 8
    assert fe._frost_risk(11.9) == "L"   # < 12
    assert fe._frost_risk(12.0) == "-"   # >= 12


def test_drought_risk_boundaries():
    fe = _import_fe()

    assert fe._drought_risk(14.9) == "H"  # < 15
    assert fe._drought_risk(15.0) == "M"  # == 15 → not < 15
    assert fe._drought_risk(34.9) == "M"  # < 35
    assert fe._drought_risk(35.0) == "L"  # == 35 → not < 35
    assert fe._drought_risk(59.9) == "L"  # < 60
    assert fe._drought_risk(60.0) == "-"  # >= 60


def test_parse_oni_text_extracts_history_and_forecast():
    fe = _import_fe()

    # 6 data rows: first 3 history, last 3 forecast
    text = (
        "SEAS YR TOTAL ANOM\n"
        " DJF 2024  0.5  1.2\n"
        " JFM 2024  0.6  1.1\n"
        " FMA 2024  0.4  0.9\n"
        " MAM 2024  0.3  0.7\n"
        " AMJ 2024  0.2  0.5\n"
        " MJJ 2024  0.1  0.3\n"
        " JJA 2024  0.0  0.1\n"
        " JAS 2024 -0.1 -0.1\n"
        " ASO 2024 -0.2 -0.2\n"
        " SON 2024 -0.3 -0.3\n"
        " OND 2024 -0.4 -0.4\n"
        " NDJ 2024 -0.5 -0.5\n"
        " DJF 2025  0.1  0.2\n"   # row 13 — history
        " JFM 2025  0.2  0.3\n"   # row 14 — history
        " FMA 2025  0.3  0.4\n"   # row 15 — last history
        " MAM 2025  0.4  0.6\n"   # forecast 1
        " AMJ 2025  0.5  0.7\n"   # forecast 2
        " MJJ 2025  0.6  0.8\n"   # forecast 3
    )

    result = fe._parse_oni_text(text)

    # Should return last 15 history + up to 3 forecast = 18 max, but we only have
    # 15 history rows here so expect 15 + 3 = 18
    assert len(result) == 18

    # Last 3 should be forecasts
    assert result[-1].get("forecast") is True
    assert result[-2].get("forecast") is True
    assert result[-3].get("forecast") is True

    # History rows should NOT have "forecast" key
    assert "forecast" not in result[0]
    assert "forecast" not in result[-4]

    # Values should come from ANOM column
    assert result[-1]["value"] == pytest.approx(0.8)
    assert result[-3]["value"] == pytest.approx(0.6)


def test_parse_oni_text_month_labels():
    fe = _import_fe()

    text = (
        "SEAS YR TOTAL ANOM\n"
        " DJF 2025  0.5  1.0\n"
        " JFM 2025  0.6  0.9\n"
        " FMA 2025  0.7  0.8\n"
        " MAM 2025  0.8  0.7\n"
        " AMJ 2025  0.9  0.6\n"
        " MJJ 2025  1.0  0.5\n"
        " JJA 2025  1.1  0.4\n"
        " JAS 2025  1.2  0.3\n"
        " ASO 2025  1.3  0.2\n"
        " SON 2025  1.4  0.1\n"
        " OND 2025  1.5  0.0\n"
        " NDJ 2025  1.6 -0.1\n"
        " DJF 2026  1.7 -0.2\n"
        " JFM 2026  1.8 -0.3\n"
        " FMA 2026  1.9 -0.4\n"
        " MAM 2026  2.0 -0.5\n"  # forecast 1
        " AMJ 2026  2.1 -0.6\n"  # forecast 2
        " MJJ 2026  2.2 -0.7\n"  # forecast 3
    )

    result = fe._parse_oni_text(text)

    # DJF 2025 → month=1, year=2025 → "Jan-25"
    first = result[0]
    assert first["month"] == "Jan-25"

    # JFM 2025 → month=2, year=2025 → "Feb-25"
    assert result[1]["month"] == "Feb-25"

    # NDJ 2025 → month=12, year=2025 → "Dec-25"
    ndj_row = next(r for r in result if r["month"] == "Dec-25")
    assert ndj_row is not None
