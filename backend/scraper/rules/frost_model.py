"""Physically-grounded frost model for coffee belts (Brazil, Honduras).

Replaces the old one-line `_frost_risk` (a single-hour, radiative-only
estimate that was duplicated across weather sources). Everything here is
pure and unit-testable; the weather scrapers feed it a night's hourly
slice and store the structured result.

Why the old model was wrong in two important ways
--------------------------------------------------
1. ADVECTIVE frost. The old formula was
       t_surface = air − (1 − cloud/100)·max(0, 5 − 0.4·wind) − 0.5·dry
   i.e. wind and cloud only ever *reduce* the cooling. That is correct
   for RADIATIVE frost (clear, calm nights where the canopy radiates heat
   to space and drops below the 2 m air temp). But it is exactly backwards
   for ADVECTIVE frost — a cold air mass blowing in — where the 2 m air is
   itself at or below freezing and wind does NOT protect the plant. The
   catastrophic Brazilian frosts (1975, 1994, Jul-2021) had a strong
   advective component; the old model would have under-called them.
2. DURATION. A one-hour dip to −0.5 °C and a five-hour freeze at −3 °C
   scored identically. Damage scales with how long tissue stays frozen.

What this model adds
--------------------
* Canopy/grass-minimum surface temperature (radiative + graduated dry-air
  amplification), estimated per hour so we can measure duration.
* Advective detection: sub-freezing 2 m AIR with wind ⇒ damaging regardless
  of clear sky.
* Black-frost detection: hard freeze in very dry air (no protective dew /
  hoar deposition) desiccates tissue and escalates severity.
* Structured output (surface min, air min, hours below 0 / below hard,
  frost type) that downstream alerting (Phase 2) and the UI (Phase 4) can
  use, plus the same H / M / L / - letter the current frontend expects.

Thresholds are physically motivated first-pass values; Phase 3 backtests
them against the known Brazilian frost years and tunes from there.
"""
from __future__ import annotations

from dataclasses import dataclass

# ── physical constants ───────────────────────────────────────────────────────

# Max amount the canopy/grass minimum falls below the 2 m air temperature on
# a perfectly clear, calm night (full radiative decoupling). Grass-minimum
# thermometers in frost country routinely read 4–6 °C below the screen (2 m)
# minimum on radiative nights — hence 5.
RADIATIVE_MAX_DROP_C = 5.0
# km/h of wind that erodes 1 °C of that radiative drop (mechanical mixing of
# the surface inversion). At ≥ 12.5 km/h radiative decoupling is fully gone.
WIND_MIXING_PER_KMH = 0.4

# Dry-air amplification. When the dew point is low, there's little latent
# heat released by dew/frost deposition to buffer the surface, so it cools
# further. Graduated (0 → ~1.5 °C) instead of the old flat 0.5 °C step.
DRY_AIR_ONSET_DEW_C = 2.0
DRY_AIR_GAIN = 0.25          # °C extra cooling per °C of dew point below onset
DRY_AIR_MAX_C = 1.5

# Advective frost: a cold air mass. If the 2 m AIR minimum itself is at/below
# this and it's breezy, wind won't save the plant — the whole air column is
# cold. (Radiative frost, by contrast, needs calm + clear.)
ADVECTIVE_AIR_C = 1.5
ADVECTIVE_WIND_KMH = 10.0

# Black frost: hard surface freeze in very dry air. No visible white hoar
# (air too dry to deposit), tissue desiccates — more damaging than an
# equivalent-temperature radiative "white" frost.
BLACK_FROST_DEW_C = -3.0

# Canopy-surface damage thresholds (°C at the leaf surface, NOT 2 m air).
FROST_ONSET_C = 0.0          # ice begins to form on leaf tissue
HARD_FROST_C = -2.0          # widespread canopy kill / systemic dieback

# Duration (hours at surface < FROST_ONSET_C) that escalates a borderline
# event — sustained frost is far more damaging than a brief touch.
SUSTAINED_HOURS = 3


def surface_temp(air_temp_c: float, cloud_pct: float, wind_kmh: float,
                 dew_point_c: float) -> float:
    """Estimate the canopy/grass-minimum temperature from the 2 m air temp.

    On clear (low cloud), calm (low wind) nights the surface radiates to
    space and decouples from the 2 m air, dropping below it; dry air (low
    dew point) amplifies the drop. Cloud or wind suppress the effect.
    """
    clear = 1.0 - _clamp(cloud_pct, 0.0, 100.0) / 100.0
    radiative = clear * max(0.0, RADIATIVE_MAX_DROP_C - WIND_MIXING_PER_KMH * max(0.0, wind_kmh))
    dry_amp = 0.0
    if dew_point_c < DRY_AIR_ONSET_DEW_C:
        dry_amp = min(DRY_AIR_MAX_C, (DRY_AIR_ONSET_DEW_C - dew_point_c) * DRY_AIR_GAIN)
    return air_temp_c - radiative - dry_amp


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


@dataclass
class FrostAssessment:
    risk: str               # "-" | "L" | "M" | "H"  (frontend grid letter)
    frost_type: str         # "none" | "radiative" | "advective" | "black"
    surface_min_c: float    # coldest estimated canopy-surface temp of the night
    air_min_c: float        # coldest 2 m air temp of the night
    hours_below_0: int      # hours the surface spent below FROST_ONSET_C
    hours_below_hard: int   # hours the surface spent below HARD_FROST_C


def _risk_letter(surface_min: float, air_min: float, hours_below_0: int,
                 frost_type: str) -> str:
    """Map the night's physics to the H/M/L/- tier the frontend renders.

    Surface-temperature banding is the backbone; advective and black frost
    escalate, and a sustained sub-zero spell floors the tier at High.
    """
    if surface_min < FROST_ONSET_C:
        base = "H"                       # any canopy ice → High
    elif surface_min < 3.0:
        base = "M"                       # marginal — light touch possible
    elif surface_min < 6.0:
        base = "L"
    else:
        base = "-"
    # Escalations the surface band alone misses. (surface_min ≤ air_min
    # always — the surface only ever cools *below* the 2 m air — so a cold
    # air mass is already reflected in `base`; these handle the mechanisms
    # that make an equal-temperature event more damaging.)
    if frost_type == "black":
        return "H"                       # dry hard freeze desiccates tissue
    if frost_type == "advective" and air_min <= FROST_ONSET_C:
        return "H"                       # sub-freezing wind-driven cold mass
    if hours_below_0 >= SUSTAINED_HOURS:
        return "H"                       # sustained freeze, not a brief touch
    return base


def _classify(surface_min: float, air_min: float, wind_at_min: float,
              dew_at_min: float) -> str:
    """Name the dominant frost mechanism (priority: black > advective >
    radiative > none)."""
    freezing = surface_min < FROST_ONSET_C
    advective = air_min <= ADVECTIVE_AIR_C and wind_at_min >= ADVECTIVE_WIND_KMH
    if freezing and dew_at_min <= BLACK_FROST_DEW_C:
        return "black"
    if advective and air_min <= FROST_ONSET_C:
        return "advective"
    if freezing:
        return "radiative"
    # A marginal-but-breezy cold mass still counts as advective exposure even
    # if the modelled surface hasn't crossed 0 (keeps the type honest for the
    # UI / alerts even when risk is only M).
    if advective:
        return "advective"
    return "none"


def assess_night(temps: list[float | None], clouds: list[float | None],
                 winds: list[float | None], dews: list[float | None],
                 ) -> FrostAssessment:
    """Assess one night from its hourly 2 m air temp / cloud / wind / dew
    slices (already restricted to the local day whose pre-dawn hours carry
    the minimum). Returns the structured assessment + frontend letter.

    Missing hours are skipped; a fully-empty night returns a no-frost
    assessment (the caller had no data, not "no frost proven").
    """
    hourly: list[tuple[float, float, float, float]] = []
    for t, c, w, d in zip(temps, clouds, winds, dews):
        if t is None:
            continue
        hourly.append((
            float(t),
            float(c) if c is not None else 0.0,
            float(w) if w is not None else 0.0,
            float(d) if d is not None else float(t),   # dew ≤ temp; fall back to temp
        ))
    if not hourly:
        return FrostAssessment("-", "none", 99.0, 99.0, 0, 0)

    surfaces = [surface_temp(t, c, w, d) for (t, c, w, d) in hourly]
    surface_min = min(surfaces)
    air_min = min(t for (t, _c, _w, _d) in hourly)
    hours_below_0 = sum(1 for s in surfaces if s < FROST_ONSET_C)
    hours_below_hard = sum(1 for s in surfaces if s < HARD_FROST_C)

    # Conditions at the coldest surface hour drive the classification.
    cold_idx = min(range(len(surfaces)), key=lambda i: surfaces[i])
    _t, _c, wind_at_min, dew_at_min = hourly[cold_idx]
    frost_type = _classify(surface_min, air_min, wind_at_min, dew_at_min)
    risk = _risk_letter(surface_min, air_min, hours_below_0, frost_type)

    return FrostAssessment(
        risk=risk,
        frost_type=frost_type,
        surface_min_c=round(surface_min, 1),
        air_min_c=round(air_min, 1),
        hours_below_0=hours_below_0,
        hours_below_hard=hours_below_hard,
    )


def risk_letter(min_temp: float, cloud_cover: float, wind_kmh: float,
                dew_point: float) -> str:
    """Back-compat single-hour wrapper for callers that only have the
    conditions at the minimum-temperature hour (no hourly slice). Uses the
    same physics as assess_night but can't measure duration."""
    return assess_night([min_temp], [cloud_cover], [wind_kmh], [dew_point]).risk
