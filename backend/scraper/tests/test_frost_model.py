"""Tests for the deepened frost model (scraper.rules.frost_model)."""
from __future__ import annotations

from scraper.rules import frost_model as fm

# ── surface_temp: radiative decoupling physics ───────────────────────────────

def test_surface_temp_drops_below_air_on_clear_calm_night():
    # Clear (0% cloud), calm (0 wind), humid (dew 8) → full radiative drop.
    s = fm.surface_temp(air_temp_c=4.0, cloud_pct=0.0, wind_kmh=0.0, dew_point_c=8.0)
    assert s == 4.0 - fm.RADIATIVE_MAX_DROP_C          # 4 − 5 = −1.0


def test_surface_temp_cloud_and_wind_suppress_the_drop():
    # Full overcast → no radiative decoupling; surface ≈ air.
    assert fm.surface_temp(4.0, 100.0, 0.0, 8.0) == 4.0
    # Strong wind (≥ 12.5 km/h) → radiative term zeroed too.
    assert fm.surface_temp(4.0, 0.0, 20.0, 8.0) == 4.0


def test_surface_temp_dry_air_amplifies_cooling():
    humid = fm.surface_temp(4.0, 100.0, 20.0, 8.0)     # no radiative, no dry amp
    dry   = fm.surface_temp(4.0, 100.0, 20.0, -4.0)    # dry-air amplification only
    assert dry < humid
    # (2 − (−4)) × 0.25 = 1.5, capped at DRY_AIR_MAX_C.
    assert humid - dry == fm.DRY_AIR_MAX_C


# ── assess_night: mechanisms ─────────────────────────────────────────────────

def test_no_frost_on_a_mild_night():
    a = fm.assess_night([12, 11, 10, 13], [50, 40, 30, 60], [5, 5, 5, 5], [9, 9, 8, 9])
    assert a.risk == "-"
    assert a.frost_type == "none"


def test_radiative_frost_clear_calm_scores_high():
    # Air dips to 3 °C but clear+calm → surface below 0 → High, radiative.
    a = fm.assess_night(
        temps=[8, 5, 3, 3, 6], clouds=[0, 0, 0, 0, 10],
        winds=[2, 1, 1, 1, 3], dews=[6, 4, 3, 3, 5],
    )
    assert a.frost_type == "radiative"
    assert a.risk == "H"
    assert a.surface_min_c < 0


def test_advective_frost_windy_cold_mass_is_not_masked_by_wind():
    # The old model: wind reduces cooling, so air 0 °C + 15 km/h + overcast
    # → surface ≈ 0 → 'M' or '-'. The new model recognises the sub-freezing
    # AIR mass and flags High regardless of the wind.
    a = fm.assess_night(
        temps=[3, 1, -1, -1, 2], clouds=[80, 80, 80, 80, 70],
        winds=[15, 16, 18, 17, 12], dews=[1, 0, -1, -1, 0],
    )
    assert a.frost_type == "advective"
    assert a.risk == "H"
    assert a.air_min_c <= 0


def test_black_frost_dry_hard_freeze_escalates():
    # Surface below 0 with very dry air (dew ≤ −3) → black frost.
    a = fm.assess_night(
        temps=[4, 1, 0, 0], clouds=[0, 0, 0, 0],
        winds=[2, 1, 1, 1], dews=[-4, -5, -6, -6],
    )
    assert a.frost_type == "black"
    assert a.risk == "H"


def test_duration_below_zero_is_measured():
    a = fm.assess_night(
        temps=[6, 4, 4, 4, 4, 7], clouds=[0, 0, 0, 0, 0, 10],
        winds=[1, 1, 1, 1, 1, 2], dews=[4, 3, 3, 3, 3, 5],
    )
    # 4 hours at air 4 °C, clear/calm → surface ≈ −1 for those 4 hours.
    assert a.hours_below_0 == 4
    assert a.risk == "H"          # sustained (≥ SUSTAINED_HOURS) → High


def test_breezy_cold_but_not_freezing_is_medium_advective_not_high():
    # 2 m air stays just above freezing (~1 °C) while breezy/overcast: a cold
    # mass exposure (type advective) but not a proven freeze → Medium, NOT
    # over-called to High.
    a = fm.assess_night(
        temps=[4, 2, 1, 1, 3], clouds=[90, 90, 90, 90, 80],
        winds=[14, 14, 15, 15, 12], dews=[2, 1, 1, 1, 2],
    )
    assert a.frost_type == "advective"
    assert a.air_min_c > fm.FROST_ONSET_C
    assert a.risk == "M"


def test_empty_night_returns_no_frost_not_a_crash():
    a = fm.assess_night([None, None], [None, None], [None, None], [None, None])
    assert a.risk == "-"
    assert a.frost_type == "none"


def test_assess_night_tolerates_missing_hourly_fields():
    # Temps present, everything else None → dew falls back to temp, cloud/wind 0.
    a = fm.assess_night([4, 3, 3], [None, None, None], [None, None, None], [None, None, None])
    assert a.risk in {"H", "M", "L", "-"}
    assert a.surface_min_c <= 3


# ── risk_letter back-compat wrapper ──────────────────────────────────────────

def test_risk_letter_matches_single_hour_assessment():
    # Clear/calm, air 3, humid → surface −2 → High.
    assert fm.risk_letter(3.0, 0.0, 0.0, 3.0) == "H"
    # Mild, overcast, breezy → no frost.
    assert fm.risk_letter(12.0, 90.0, 15.0, 10.0) == "-"


def test_risk_letter_advective_case_now_high_where_old_model_said_low():
    # air −1 °C, cloudy, windy: old formula → surface ≈ −1+~0 ⇒ actually the
    # old model returned 'H' only via the radiative path; with wind+cloud it
    # under-called. New model → advective High.
    assert fm.risk_letter(-1.0, 80.0, 16.0, -1.0) == "H"


# ── severity ladder (Phase 2 alerting) ───────────────────────────────────────

def test_severity_critical_for_advective_black_deep_or_prolonged():
    assert fm.severity("H", "advective", -0.5, 1) == "critical"   # cold air mass
    assert fm.severity("H", "black",     -0.5, 1) == "critical"   # dry hard freeze
    assert fm.severity("H", "radiative", -2.5, 1) == "critical"   # deep (< −2)
    assert fm.severity("H", "radiative", -0.5, 4) == "critical"   # prolonged (≥4h)


def test_severity_alert_for_shallow_brief_radiative_freeze():
    # surface just below 0, short duration, not advective/black → alert.
    assert fm.severity("H", "radiative", -0.5, 2) == "alert"


def test_severity_watch_for_marginal_and_none_below():
    assert fm.severity("M", "none", 1.5, 0) == "watch"
    assert fm.severity("L", "none", 4.0, 0) is None
    assert fm.severity("-", "none", 8.0, 0) is None


def test_severity_handles_missing_surface_temp():
    # No surface temp known → don't fabricate a deep-freeze critical.
    assert fm.severity("M", "none", None, 0) == "watch"


# ── worst_forecast_frost: selects the most severe upcoming day ────────────────

def _fday(date, risk, surface=None, ftype="radiative", air=None, hrs=0):
    return {"date": date, "frost_risk": risk, "frost_type": ftype,
            "frost_surface_c": surface, "frost_air_min_c": air, "frost_hours_below_0": hrs}


def test_worst_forecast_frost_ignores_past_and_picks_severest():
    daily = [
        _fday("2026-06-01", "H", -3.0),        # past — ignored even though severe
        _fday("2026-06-11", "L", 4.0),
        _fday("2026-06-12", "H", -1.0, hrs=2),
        _fday("2026-06-13", "M", 1.0),
    ]
    got = fm.worst_forecast_frost(daily, today_iso="2026-06-10")
    assert got["date"] == "2026-06-12"          # severest FUTURE day
    assert got["risk"] == "H"


def test_worst_forecast_frost_tiebreak_by_coldest_surface():
    daily = [
        _fday("2026-06-12", "H", -1.0),
        _fday("2026-06-13", "H", -4.0),         # same letter, colder → wins
    ]
    got = fm.worst_forecast_frost(daily, today_iso="2026-06-10")
    assert got["date"] == "2026-06-13"


def test_worst_forecast_frost_none_when_no_upcoming_frost():
    daily = [_fday("2026-06-12", "-", 8.0), _fday("2026-06-13", "-", 7.0)]
    assert fm.worst_forecast_frost(daily, today_iso="2026-06-10") is None
