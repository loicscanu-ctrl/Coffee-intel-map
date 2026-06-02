"""Drought-gate + wording test for weather news commentary."""
import sys
from datetime import date
from pathlib import Path

# weather_news_emit lives under backend/scripts/ — add to path so the
# test can import it directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from weather_news_emit import evaluate_origin, render_for_origin  # noqa: E402


def _weather_for(provinces):
    return {"provinces": provinces}


def _vhi_for(provs_map):
    """provs_map: {name → vhi_value}"""
    return {
        "provinces": {
            name: {"vhi_latest": {"vhi": vhi_val, "severity": "stress"}}
            for name, vhi_val in provs_map.items()
        }
    }


def test_both_gates_fire_returns_at_risk():
    """Last completed month rain < threshold AND VHI < 40 → flagged."""
    weather = _weather_for([{
        "name": "Đắk Lắk",
        # Indexed Jan..Dec — null where not yet accumulated. Index 3 (April)
        # is the last completed month if today is May.
        "monthly_actual_cur": [120, 80, 90, 42, None],
        "monthly_dry_warn":   [200, 180, 160, 100, 80, 60, 40, 50, 80, 130, 170, 200],
    }])
    vhi = _vhi_for({"Đắk Lắk": 31.0})
    today = date(2026, 5, 15)
    out = evaluate_origin(weather, vhi, today=today)
    assert len(out["at_risk"]) == 1
    name, actual, vhi_val = out["at_risk"][0]
    assert name == "Đắk Lắk"
    assert actual == 42
    assert vhi_val == 31.0


def test_only_rain_fails_not_flagged():
    """Low rain but healthy VHI → not flagged (dry month alone is normal)."""
    weather = _weather_for([{
        "name": "Sul de Minas",
        "monthly_actual_cur": [120, 80, 90, 42, None],
        "monthly_dry_warn":   [200, 180, 160, 100, 80, 60, 40, 50, 80, 130, 170, 200],
    }])
    vhi = _vhi_for({"Minas Gerais": 65.0})  # substring match works
    today = date(2026, 5, 15)
    out = evaluate_origin(weather, vhi, today=today)
    assert out["at_risk"] == []
    assert "Sul de Minas" in out["checked"]


def test_only_vhi_fails_not_flagged():
    """Adequate rain but low VHI → still not flagged (the two factors together
    are what's required)."""
    weather = _weather_for([{
        "name": "Gia Lai",
        "monthly_actual_cur": [120, 80, 90, 150, None],   # April hit threshold
        "monthly_dry_warn":   [200, 180, 160, 100, 80, 60, 40, 50, 80, 130, 170, 200],
    }])
    vhi = _vhi_for({"Gia Lai": 28.0})
    today = date(2026, 5, 15)
    out = evaluate_origin(weather, vhi, today=today)
    assert out["at_risk"] == []
    assert "Gia Lai" in out["checked"]


def test_partial_current_month_does_not_trip():
    """Current-month accumulation (May, partial) must not be evaluated — only
    completed months. Critical because partial-month is always below the
    full-month threshold."""
    weather = _weather_for([{
        "name": "Espírito Santo",
        # Indices 0..3 are Jan-Apr completed (above threshold), index 4 = May
        # is current/partial at 15mm — should NOT be the comparison row.
        "monthly_actual_cur": [220, 250, 200, 130, 15],
        "monthly_dry_warn":   [200, 180, 160, 100, 80, 60, 40, 50, 80, 130, 170, 200],
    }])
    vhi = _vhi_for({"Espírito Santo": 25.0})
    today = date(2026, 5, 15)
    out = evaluate_origin(weather, vhi, today=today)
    assert out["at_risk"] == []   # April (idx=3) is 130 vs threshold 100 → above, no flag


def test_no_vhi_match_marked_skipped_not_flagged():
    """VHI province name doesn't align to any weather province → skipped, not
    flagged. Better than falsely treating "no VHI" as "VHI fine"."""
    weather = _weather_for([{
        "name": "Asturias",   # totally unrelated names so the fuzzy matcher can't bridge
        "monthly_actual_cur": [10, 10, 10, 10, None],
        "monthly_dry_warn":   [200] * 12,
    }])
    vhi = _vhi_for({"Kyushu": 30.0})
    today = date(2026, 5, 15)
    out = evaluate_origin(weather, vhi, today=today)
    assert out["at_risk"] == []
    assert "Asturias" in out["skipped"]


def test_render_at_risk_lists_provinces_and_averages():
    """Risk wording averages numeric stats across the flagged set."""
    evaluation = {
        "at_risk":  [("Đắk Lắk", 42.0, 31.0), ("Gia Lai", 30.0, 35.0)],
        "checked":  ["Đắk Lắk", "Gia Lai", "Dak Nong"],
        "skipped":  [],
    }
    text = render_for_origin("Vietnam", evaluation)
    assert "at drought risk" in text
    assert "Đắk Lắk, Gia Lai" in text
    # Average rain = (42 + 30) / 2 = 36 → rounded
    assert "36mm" in text
    # Average VHI = (31 + 35) / 2 = 33.0
    assert "33" in text


def test_render_normal_when_nothing_flagged():
    evaluation = {"at_risk": [], "checked": ["Sul de Minas", "Cerrado"], "skipped": []}
    text = render_for_origin("Brazil", evaluation)
    assert text == "Agronomic Status Update: Brazil (Sul de Minas, Cerrado) is currently flagged as normal."


def test_render_returns_none_when_no_provinces_evaluated():
    """Nothing successfully gated → don't surface a "normal" message built on
    zero evidence."""
    evaluation = {"at_risk": [], "checked": [], "skipped": ["foo", "bar"]}
    assert render_for_origin("Vietnam", evaluation) is None
