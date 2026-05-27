"""Tests for the ESSM (Estimated Soil Moisture) addition to fetch_origin_weather.
Pure aggregation + wiring; no live Open-Meteo call."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))

import fetch_origin_weather as f  # noqa: E402


def test_daily_essm_means_layers_then_hours():
    hourly = {
        "time": ["2026-05-26T00:00", "2026-05-26T12:00", "2026-05-27T00:00"],
        "soil_moisture_0_to_1cm":   [0.10, 0.20, 0.40],
        "soil_moisture_1_to_3cm":   [0.20, 0.20, 0.40],
        "soil_moisture_3_to_9cm":   [0.30, 0.20, 0.40],
        "soil_moisture_9_to_27cm":  [0.40, 0.20, 0.40],
        "soil_moisture_27_to_81cm": [0.50, 0.20, 0.40],
    }
    # 26th: hour means 0.30 & 0.20 → 0.25 ; 27th: 0.40
    assert f._daily_essm(hourly) == {"2026-05-26": 0.25, "2026-05-27": 0.4}


def test_daily_essm_skips_none_values():
    hourly = {
        "time": ["2026-05-26T00:00", "2026-05-26T01:00"],
        "soil_moisture_0_to_1cm":   [0.2, None],   # hour1 all-None → skipped
        "soil_moisture_1_to_3cm":   [0.4, None],
    }
    assert f._daily_essm(hourly) == {"2026-05-26": 0.3}   # only hour0 counts


def test_daily_essm_empty_or_missing():
    assert f._daily_essm(None) == {}
    assert f._daily_essm({"time": []}) == {}
    assert f._daily_essm({"time": ["2026-05-26T00:00"]}) == {}   # no soil layers


def test_fetch_region_requests_soil_layers(monkeypatch):
    captured = {}
    monkeypatch.setattr(f, "_get", lambda params: captured.update(params) or {})
    f.fetch_region(-21.5, -45.4)
    assert "hourly" in captured
    for layer in f.SOIL_LAYERS:
        assert layer in captured["hourly"]


def test_monthly_rain_returns_totals_and_counts():
    rh = {
        "2026-04-01": {"rain": 6.0}, "2026-04-02": {"rain": 4.0},
        "2026-05-01": {"rain": 2.0},
        "2026-03-01": {"rain": None},        # null rain ignored
        "bad": "not-a-dict",
    }
    totals, counts = f._monthly_rain(rh)
    assert totals == {"2026-04": 10.0, "2026-05": 2.0}
    assert counts == {"2026-04": 2, "2026-05": 1}   # day counts → SPI completeness gate


def test_spi_target_skips_zero_filled_and_partial_months():
    # Mirrors a real history: Jan/Feb real, Mar/Apr full-length but all-zero
    # (missing data), May = current/partial. SPI must target Feb, not Apr.
    cur_monthly = {"2026-01": 235.6, "2026-02": 95.5, "2026-03": 0.0,
                   "2026-04": 0.0, "2026-05": 110.0}
    month_days = {"2026-01": 31, "2026-02": 28, "2026-03": 31, "2026-04": 30, "2026-05": 26}
    assert f._spi_target_month(cur_monthly, month_days, "2026-05") == "2026-02"
    # all candidate months zero/partial → no eligible month → None
    assert f._spi_target_month({"2026-04": 0.0}, {"2026-04": 30}, "2026-05") is None


def test_upsert_stores_essm_in_history():
    past = (f.TODAY - __import__("datetime").timedelta(days=1)).isoformat()
    daily = {
        "daily": {
            "time": [past],
            "precipitation_sum": [5.0],
            "temperature_2m_max": [28.0],
            "temperature_2m_min": [16.0],
            "temperature_2m_mean": [22.0],
        },
        "hourly": {
            "time": [f"{past}T00:00", f"{past}T12:00"],
            "soil_moisture_0_to_1cm": [0.30, 0.30],
            "soil_moisture_27_to_81cm": [0.30, 0.30],
        },
    }
    hist = {"regions": {}}
    f.upsert(hist, "Cerrado", daily)
    assert hist["regions"]["Cerrado"][past]["essm"] == 0.3
    assert hist["regions"]["Cerrado"][past]["rain"] == 5.0   # existing fields intact


def test_upsert_null_rain_does_not_clobber_real_history():
    # Regression: the daily fetch used to store null precip as 0.0, zero-filling
    # real rain (the Mar/Apr all-zero months that broke SPI). A null on a past day
    # must KEEP the previously accumulated value, not overwrite it with 0.
    past = (f.TODAY - __import__("datetime").timedelta(days=1)).isoformat()
    daily = {
        "daily": {
            "time": [past],
            "precipitation_sum": [None],          # API returns null for this past day
            "temperature_2m_max": [28.0],
            "temperature_2m_min": [16.0],
            "temperature_2m_mean": [22.0],
        },
        "hourly": {"time": [], },
    }
    hist = {"regions": {"Cerrado": {past: {"rain": 12.4, "tmean": 21.0}}}}
    f.upsert(hist, "Cerrado", daily)
    assert hist["regions"]["Cerrado"][past]["rain"] == 12.4   # real rain preserved
