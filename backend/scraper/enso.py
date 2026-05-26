"""Shared ENSO (El Niño / La Niña) classification from a NOAA ONI history.

Previously copy-pasted (logically identical) into export_static_json.py and
every per-origin exporter (colombia/indonesia/ethiopia/uganda/honduras). Kept
here once so a threshold change lands in a single place.
"""
from __future__ import annotations


def oni_to_dots(oni: float) -> int:
    """Map an ONI value to a 1–4 intensity-dot count (by |ONI|)."""
    a = abs(oni)
    if a >= 2.0:
        return 4
    if a >= 1.5:
        return 3
    if a >= 1.0:
        return 2
    return 1


def derive_enso_phase(oni_history: list) -> tuple:
    """Derive (phase, intensity, current_oni) from an oni_history list.

    Uses all entries — both confirmed and preliminary — since NOAA ONI
    preliminary values are observation-based and reliable enough for phase
    detection. The legacy 'forecast' key is stripped for backwards compat with
    older DB data.
    """
    entries = [p for p in oni_history if not p.get("forecast")]  # strip legacy forecast entries
    if not entries:
        entries = oni_history  # fallback: use everything
    if not entries:
        return "neutral", "Weak", 0.0
    current_oni = entries[-1]["value"]
    recent = [p["value"] for p in entries[-5:]]
    if len(recent) >= 5 and all(v >= 0.5 for v in recent):
        phase = "el-nino"
    elif len(recent) >= 5 and all(v <= -0.5 for v in recent):
        phase = "la-nina"
    else:
        phase = "neutral"
    abs_oni = abs(current_oni)
    if abs_oni >= 2.0:
        intensity = "Extreme"
    elif abs_oni >= 1.5:
        intensity = "Strong"
    elif abs_oni >= 1.0:
        intensity = "Moderate"
    else:
        intensity = "Weak"
    return phase, intensity, current_oni
