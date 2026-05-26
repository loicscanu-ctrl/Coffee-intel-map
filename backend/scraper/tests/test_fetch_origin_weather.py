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
