"""Tests for the shared scraper.enso classification (deduped from 6 exporters)."""
from scraper.enso import derive_enso_phase, oni_to_dots


def _h(vals, **extra):
    return [{"value": v, **extra} for v in vals]


def test_el_nino_when_five_warm():
    phase, intensity, oni = derive_enso_phase(_h([0.6, 0.7, 0.8, 0.9, 1.0]))
    assert phase == "el-nino"
    assert intensity == "Moderate"   # |1.0| → Moderate
    assert oni == 1.0


def test_la_nina_when_five_cold():
    phase, _, _ = derive_enso_phase(_h([-0.6, -0.7, -0.8, -0.9, -1.0]))
    assert phase == "la-nina"


def test_neutral_when_mixed_or_short():
    assert derive_enso_phase(_h([0.6, 0.7, 0.8, 0.4, 0.9]))[0] == "neutral"
    assert derive_enso_phase(_h([0.6, 0.7, 0.8]))[0] == "neutral"     # < 5 entries


def test_empty_history_defaults_neutral_weak():
    assert derive_enso_phase([]) == ("neutral", "Weak", 0.0)


def test_intensity_tiers():
    assert derive_enso_phase(_h([2.1] * 5))[1] == "Extreme"
    assert derive_enso_phase(_h([1.6] * 5))[1] == "Strong"
    assert derive_enso_phase(_h([1.1] * 5))[1] == "Moderate"
    assert derive_enso_phase(_h([0.6] * 5))[1] == "Weak"


def test_legacy_forecast_entries_stripped():
    # forecast=True entries are ignored; the real 5 warm values still classify
    hist = [{"value": 0.9, "forecast": True}] * 3 + _h([0.6, 0.7, 0.8, 0.9, 1.0])
    assert derive_enso_phase(hist)[0] == "el-nino"


def test_oni_to_dots_tiers():
    assert [oni_to_dots(x) for x in (2.5, 1.7, 1.2, 0.4)] == [4, 3, 2, 1]
    assert [oni_to_dots(-x) for x in (2.5, 1.7, 1.2, 0.4)] == [4, 3, 2, 1]
