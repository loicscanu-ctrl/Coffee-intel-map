"""Threshold sanity-check of the frost severity ladder against the recorded
minima of Brazil's historic frost disasters (backend/seed/frost_events.json).

This is NOT a blind ERA5 backtest — this environment can't reach the weather
archive (see scraper.backfill_frost_backtest for the harness that does the
real thing once archive access exists). What it DOES do: take each event's
REAL observed 2 m air minimum and its documented mechanism (advective vs
radiative), reconstruct a plausible night around that minimum, run the model,
and assert the severity ladder calls it 'critical'. If a future threshold
tweak stopped the model from flagging the 1975 / 1994 / 2021 disasters as
critical, this fails — a guardrail against over-loosening the ladder.
"""
from __future__ import annotations

import json
from pathlib import Path

from scraper.rules import frost_model as fm

_CATALOG = Path(__file__).resolve().parents[2] / "seed" / "frost_events.json"


def _load_events() -> list[dict]:
    return json.loads(_CATALOG.read_text(encoding="utf-8"))["events"]


def _night_from_event(ev: dict):
    """Reconstruct an hourly night (temps/clouds/winds/dews) from the event's
    observed air minimum + documented mechanism. The coldest 3 hours sit at
    the observed minimum (captures duration); the shoulder hours are milder.

    * advective → a wind-driven, cloudy sub-zero air mass (wind doesn't help).
    * radiative → clear, calm, moderately dry: the canopy decouples and drops
      well below the screen minimum.
    """
    amin = float(ev["observed_air_min_c"])
    temps = [amin + 3, amin, amin, amin, amin + 2]
    if ev["mechanism"] == "advective":
        # wind-driven cold mass: wind doesn't protect
        clouds = [80, 80, 85, 80, 70]
        winds  = [14, 15, 16, 15, 12]
        dews   = [amin, amin - 1, amin - 1, amin - 1, amin]
    else:  # radiative / black: clear, calm, dry — the canopy decouples & drops
        clouds = [0, 0, 0, 0, 10]
        winds  = [2, 1, 1, 1, 3]
        dews   = [amin - 2, amin - 3, amin - 3, amin - 3, amin - 2]
    return temps, clouds, winds, dews


def test_catalog_is_well_formed():
    events = _load_events()
    assert len(events) >= 3
    ids = {e["id"] for e in events}
    assert {"1975-black-frost", "1994-double-frost", "2021-july-frosts"} <= ids
    for e in events:
        assert e["expected_severity"] == "critical"          # all were disasters
        assert isinstance(e["observed_air_min_c"], (int, float))
        assert e["mechanism"] in ("advective", "radiative", "black")


def test_model_flags_every_historic_disaster_as_critical():
    """The core guardrail: the severity ladder must classify each recorded
    disaster as critical."""
    failures = []
    for ev in _load_events():
        a = fm.assess_night(*_night_from_event(ev))
        sev = fm.severity(a.risk, a.frost_type, a.surface_min_c, a.hours_below_0)
        if sev != ev["expected_severity"]:
            failures.append(f"{ev['id']}: got {sev} (surface {a.surface_min_c}, "
                            f"type {a.frost_type}), expected {ev['expected_severity']}")
    assert not failures, "historic frost events mis-classified:\n" + "\n".join(failures)


def test_1975_recognised_as_black_frost():
    # "Geada Negra": a −4 °C dry hard freeze. The model must flag the
    # black-frost mechanism (dry air, tissue desiccation) — its worst tier.
    ev = next(e for e in _load_events() if e["id"] == "1975-black-frost")
    a = fm.assess_night(*_night_from_event(ev))
    assert a.frost_type == "black"


def test_radiative_2021_decouples_below_the_screen_minimum():
    ev = next(e for e in _load_events() if e["id"] == "2021-july-frosts")
    a = fm.assess_night(*_night_from_event(ev))
    # Screen (2 m) min was ~-1.5 °C; the canopy surface must read colder on a
    # clear, calm night — that decoupling is exactly why -1.5 °C air still kills.
    assert a.surface_min_c < a.air_min_c
    assert a.surface_min_c < fm.HARD_FROST_C
