"""Build frontend/public/data/enso.json + enso_risk_pins.json — the ENSO tab feed.

Consolidates the ENSO intelligence the /enso tab and the map's risk layer need,
from data the pipeline already produced (no DB):
  • current phase/intensity/ONI history + forecast plume → farmer_economics.json
  • long ONI history (1980→) → backend/seed/oni_history_full.json (built monthly
    in CI by scripts/build_oni_history.py; absent ⇒ analogs degrade gracefully)
  • per-region crop-risk pins → enso_risk.build_risk_pins(phase, intensity)

Mirrors build_country_pins.py: reads the static files the export pipeline wrote.
"""
from __future__ import annotations

import json
from pathlib import Path

from scraper.enso_analogs import aligned_series, find_analogs
from scraper.enso_risk import build_risk_pins, risk_summary
from scraper.validate_export import safe_write_json

OUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
SEED_PATH = Path(__file__).resolve().parents[1] / "seed" / "oni_history_full.json"

N_TRAJECTORY = 6   # months of trailing ONI matched against history
FWD = 6            # months of analog "what happened next" to overlay
HISTORY_TAIL = 24  # months of long ONI to plot on the analog chart


def _load_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _current_window_from_short(oni_history: list[dict]) -> list[dict]:
    """Fallback current trajectory (offsets) from the 18-mo published history."""
    tail = oni_history[-N_TRAJECTORY:]
    base = len(tail) - 1
    return [{"offset": i - base, "value": p["value"], "label": p.get("month")}
            for i, p in enumerate(tail)]


def build() -> dict:
    fe = _load_json(OUT_DIR / "farmer_economics.json") or {}
    enso = fe.get("enso") or {}
    phase = enso.get("phase", "neutral")
    intensity = enso.get("intensity", "Weak")
    oni_history = enso.get("oni_history") or []

    pins = build_risk_pins(phase, intensity)

    out: dict = {
        "phase": phase,
        "intensity": intensity,
        "oni": enso.get("oni"),
        "peak_month": enso.get("peak_month"),
        "forecast_direction": enso.get("forecast_direction"),
        "oni_history": oni_history,
        "oni_forecast": enso.get("oni_forecast") or [],
        "historical_stat": enso.get("historical_stat"),
        "analogs": [],
        "oni_history_long": [],
        "current_window": _current_window_from_short(oni_history),
        "risk": {"pins": pins, "summary": risk_summary(pins)},
        "last_updated": enso.get("last_updated"),
    }

    seed = _load_json(SEED_PATH)
    series = (seed or {}).get("oni") if seed else None
    if series:
        end = series[-1]
        out["oni_history_long"] = series[-HISTORY_TAIL:]
        out["current_window"] = aligned_series(
            series, end["year"], end["month"], back=N_TRAJECTORY - 1, fwd=0
        )
        out["analogs"] = find_analogs(series, n=N_TRAJECTORY, top=3, fwd=FWD)

    return out


def export_enso_intel() -> None:
    data = build()
    safe_write_json(OUT_DIR / "enso.json", data, ensure_ascii=False)
    pins = data["risk"]["pins"]
    safe_write_json(OUT_DIR / "enso_risk_pins.json", pins, ensure_ascii=False)
    print(f"  enso.json → phase={data['phase']} analogs={len(data['analogs'])} "
          f"risk_pins={len(pins)} forecast_seasons={len(data['oni_forecast'])}")


if __name__ == "__main__":
    export_enso_intel()
