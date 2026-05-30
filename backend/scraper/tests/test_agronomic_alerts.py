"""Pure-rule tests for the IPHM agronomic alert engine."""
from __future__ import annotations

import pytest

from scraper import agronomic_alerts as ae
from scraper.rules.iphm_thresholds import IPHM_RULES


# ── Rule lookup helpers (so tests don't drift when the rule order changes) ───

def _rule(threat_id: str) -> dict:
    for r in IPHM_RULES:
        if r["threat_id"] == threat_id:
            return r
    raise KeyError(threat_id)


# ── fungal_rust_outbreak: SPI-1 high AND temp_mean in band ───────────────────

class TestFungalRust:
    RULE = _rule("fungal_rust_outbreak")

    def test_fires_when_all_conditions_met(self):
        out = ae.evaluate_rule(self.RULE, {"spi_1": 2.0, "temp_mean": 23.0}, "COL", 5)
        assert out is not None
        assert out["threat_id"] == "fungal_rust_outbreak"
        assert out["severity"] == "Alert"
        assert out["timeframe"] == "current"
        assert out["triggers"] == {"spi_1": 2.0, "temp_mean": 23.0}

    def test_skips_when_spi_too_low(self):
        # SPI-1 = 1.4 fails the >= 1.5 floor
        assert ae.evaluate_rule(self.RULE, {"spi_1": 1.4, "temp_mean": 23.0}, "COL", 5) is None

    def test_skips_when_temp_outside_band(self):
        assert ae.evaluate_rule(self.RULE, {"spi_1": 2.0, "temp_mean": 19.0}, "COL", 5) is None
        assert ae.evaluate_rule(self.RULE, {"spi_1": 2.0, "temp_mean": 28.0}, "COL", 5) is None

    def test_skips_when_field_missing(self):
        # No false fires when we lack the data — better silent than wrong.
        assert ae.evaluate_rule(self.RULE, {"spi_1": 2.0}, "COL", 5) is None
        assert ae.evaluate_rule(self.RULE, {"temp_mean": 23.0}, "COL", 5) is None
        assert ae.evaluate_rule(self.RULE, {}, "COL", 5) is None


# ── severe_defoliation: VHI low AND SPEI-3 deep negative ─────────────────────

class TestSevereDefoliation:
    RULE = _rule("severe_defoliation")

    def test_fires_on_double_stress(self):
        out = ae.evaluate_rule(self.RULE, {"vhi": 30.0, "spei_3": -2.0}, "VNM", 5)
        assert out is not None
        assert out["severity"] == "Critical"
        assert out["timeframe"] == "current"
        assert out["triggers"] == {"vhi": 30.0, "spei_3": -2.0}

    def test_does_not_fire_on_vhi_alone(self):
        # VHI is stressed but SPEI-3 only mild deficit
        assert ae.evaluate_rule(self.RULE, {"vhi": 30.0, "spei_3": -0.5}, "VNM", 5) is None

    def test_does_not_fire_on_spei_alone(self):
        assert ae.evaluate_rule(self.RULE, {"vhi": 60.0, "spei_3": -2.0}, "VNM", 5) is None


# ── brazil_frost_risk: BRA-only, May–Aug, temp_min ≤ 3 °C ────────────────────

class TestBrazilFrost:
    RULE = _rule("brazil_frost_risk")

    def test_fires_for_brazil_in_winter(self):
        # May/Jun/Jul/Aug all eligible
        for m in (5, 6, 7, 8):
            out = ae.evaluate_rule(self.RULE, {"temp_min": 1.5}, "BRA", m)
            assert out is not None
            assert out["timeframe"] == "forecast"   # temp_min is forecast-only
            assert out["severity"] == "Critical"

    def test_skips_other_origins_even_when_cold(self):
        for iso in ("COL", "HND", "VNM", "ETH"):
            assert ae.evaluate_rule(self.RULE, {"temp_min": 1.0}, iso, 6) is None

    def test_skips_outside_winter_months(self):
        # Dec/Jan/Mar/Sep are outside the May-Aug window
        for m in (1, 3, 9, 12):
            assert ae.evaluate_rule(self.RULE, {"temp_min": 1.0}, "BRA", m) is None

    def test_skips_when_warm_enough(self):
        assert ae.evaluate_rule(self.RULE, {"temp_min": 5.0}, "BRA", 6) is None


# ── blossom_drop: drought THEN sudden heavy rain ─────────────────────────────

class TestBlossomDrop:
    RULE = _rule("blossom_drop")

    def test_fires_on_drought_then_rain(self):
        out = ae.evaluate_rule(
            self.RULE, {"spei_3": -1.2, "forecast_7d_rain": 78.0}, "BRA", 9,
        )
        assert out is not None
        assert out["severity"] == "Watch"
        assert out["timeframe"] == "forecast"   # forecast_7d_rain is a forecast field

    def test_does_not_fire_without_drought(self):
        assert ae.evaluate_rule(
            self.RULE, {"spei_3": 0.5, "forecast_7d_rain": 78.0}, "BRA", 9,
        ) is None

    def test_does_not_fire_without_heavy_rain(self):
        assert ae.evaluate_rule(
            self.RULE, {"spei_3": -1.5, "forecast_7d_rain": 20.0}, "BRA", 9,
        ) is None


# ── extract_region_values: shape correctness on synthetic data ──────────────

def test_extract_picks_spi_spei_vhi_and_temps():
    prov = {
        "name": "Sul de Minas",
        "spi_1": 1.7, "spi_3": 0.9, "spei_1": -0.4, "spei_3": -1.2,
        "monthly_actual_temp_cur": [22.0, 23.0, 24.0, 23.5, 22.0, 19.0,
                                    18.0, 19.0, 21.0, 22.5, 23.5, 24.5],
        "forecast_7d_rain": [10.0, 0.0, 5.5, 12.0, 0.0, 0.0, 3.5],
    }
    wx = {"forecast_7d": [
        {"date": "2026-06-01", "temp_min_c": 4.5, "temp_max_c": 18.0, "rain_mm": 0.0},
        {"date": "2026-06-02", "temp_min_c": 2.0, "temp_max_c": 17.0, "rain_mm": 0.0},
        {"date": "2026-06-03", "temp_min_c": 6.0, "temp_max_c": 20.0, "rain_mm": 5.0},
    ]}
    vhi_prov = {"vhi_latest": {"vhi": 58.9, "iso_week": "2026-W22", "severity": "fair"}}

    values = ae.extract_region_values(prov, wx, vhi_prov, cur_month_idx=5)  # June
    assert values["spi_1"] == 1.7
    assert values["spei_3"] == -1.2
    assert values["vhi"] == 58.9
    assert values["temp_mean"] == 19.0          # June index in the array
    assert values["temp_min"] == 2.0            # worst forecast across 3 days
    assert values["forecast_7d_rain"] == 31.0   # sum of the per-province array


def test_extract_skips_absent_fields():
    # Region with thin data — only some fields available
    values = ae.extract_region_values(
        {"name": "X", "spi_1": 0.2}, {}, None, cur_month_idx=0,
    )
    assert values == {"spi_1": 0.2}


# ── Flatten into signals.json shape ──────────────────────────────────────────

def test_flatten_lowercases_severity_and_tags_timeframe():
    payload = {
        "origins": {
            "brazil": {
                "Sul de Minas": [{
                    "threat_id": "brazil_frost_risk",
                    "name": "Critical Frost Threat",
                    "severity": "Critical",
                    "timeframe": "forecast",
                    "market_impact": "…",
                    "triggers": {"temp_min": 1.5},
                }],
            },
        },
    }
    rows = ae.flatten_for_signals(payload)
    assert len(rows) == 1
    r = rows[0]
    assert r["severity"] == "critical"             # lowercase
    assert r["category"] == "AGRO"
    assert r["market"] == "PHYS"
    assert "(forecast)" in r["text"]               # timeframe surfaced
    assert "temp_min=1.5" in r["text"]
    assert r["id"] == "AGRO_brazil_Sul_de_Minas_brazil_frost_risk"


def test_flatten_marks_current_timeframe_without_forecast_suffix():
    payload = {
        "origins": {
            "colombia": {
                "Huila": [{
                    "threat_id": "fungal_rust_outbreak",
                    "name": "Elevated Fungal / Leaf Rust Risk",
                    "severity": "Alert",
                    "timeframe": "current",
                    "market_impact": "…",
                    "triggers": {"spi_1": 1.8, "temp_mean": 22.5},
                }],
            },
        },
    }
    rows = ae.flatten_for_signals(payload)
    assert "(forecast)" not in rows[0]["text"]
    assert rows[0]["severity"] == "alert"


# ── evaluate_region: stacks alerts ───────────────────────────────────────────

def test_evaluate_region_returns_all_fired_rules():
    values = {
        "spi_1": 2.0, "temp_mean": 23.0,       # fires fungal_rust_outbreak
        "vhi": 30.0, "spei_3": -2.0,           # fires severe_defoliation
        "forecast_7d_rain": 80.0,              # blossom_drop needs spei_3 max ≤ -1.0 too — satisfied
    }
    fired = ae.evaluate_region(values, "COL", 5)
    threat_ids = {a["threat_id"] for a in fired}
    assert "fungal_rust_outbreak" in threat_ids
    assert "severe_defoliation" in threat_ids
    assert "blossom_drop" in threat_ids
    # brazil_frost_risk filtered out for non-BRA
    assert "brazil_frost_risk" not in threat_ids


def test_evaluate_region_returns_empty_on_clear_data():
    values = {"spi_1": 0.2, "temp_mean": 24.0, "vhi": 70.0, "spei_3": 0.3,
              "forecast_7d_rain": 5.0, "temp_min": 12.0}
    assert ae.evaluate_region(values, "BRA", 6) == []
