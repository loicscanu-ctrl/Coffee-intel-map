"""Tests for scraper.enso_risk — ENSO phase/intensity → crop-risk pins."""
from scraper.enso_risk import (
    _EFFECTS,
    build_risk_pins,
    risk_for_region,
    risk_summary,
)


def test_neutral_is_all_green():
    pins = build_risk_pins("neutral", "Weak")
    assert pins, "expected region pins"
    assert all(p["level"] == "low" for p in pins)
    assert all(p["driver"] == "Near-normal" for p in pins)


def test_drought_region_high_in_el_nino():
    r = risk_for_region("brazil", "Sul de Minas", "el-nino", "Moderate")
    assert r["level"] == "high"
    assert r["driver"] == "Drought"
    assert r["color"] == "#dc2626"


def test_favourable_region_stays_green_even_when_strong():
    # Sul de Minas in La Niña is favourable (sev 0) → never escalates.
    r = risk_for_region("brazil", "Sul de Minas", "la-nina", "Extreme")
    assert r["level"] == "low"


def test_intensity_escalates_moderate_to_high():
    weak = risk_for_region("colombia", "Huila", "la-nina", "Weak")
    strong = risk_for_region("colombia", "Huila", "la-nina", "Strong")
    assert weak["level"] == "moderate"
    assert strong["level"] == "high"


def test_every_region_has_valid_pin_for_every_phase():
    for phase in ("el-nino", "la-nina", "neutral"):
        pins = build_risk_pins(phase, "Strong")
        for p in pins:
            assert p["level"] in ("high", "moderate", "low")
            assert p["color"].startswith("#")
            assert isinstance(p["lat"], (int, float))
            assert p["driver"]


def test_risk_summary_counts_match_pin_count():
    pins = build_risk_pins("el-nino", "Strong")
    s = risk_summary(pins)
    assert sum(s.values()) == len(pins)
    assert s["high"] > 0   # El Niño drives drought across most origins


def test_effects_table_only_active_phase_keys():
    for origin, regions in _EFFECTS.items():
        for region, eff in regions.items():
            assert set(eff).issubset({"el-nino", "la-nina"}), (origin, region)
