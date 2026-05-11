"""
export_indonesia.py
Reads DB and writes frontend/public/data/indonesia_supply.json.

Sections:
  exports      — ICO monthly green coffee exports
  weather      — drought risk per region (WeatherSnapshot)
  enso         — NOAA ONI + Indonesia-specific regional impact
  harvest_cal  — multi-island harvest calendar (static)
  mix          — static robusta/arabica production mix context
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem, WeatherSnapshot

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

_INDONESIA_REGIONS = ["Lampung", "Gayo", "Java", "Toraja", "Flores"]
_RISK_ORDER = {"-": 0, "L": 1, "M": 2, "H": 3}

# Indonesia ENSO impact: among the most sensitive coffee producers globally
_INDONESIA_ENSO_IMPACT = {
    "el-nino": {
        "regions": [
            {"region": "Lampung",  "type": "DRY",  "note": "severe moisture deficit, 1997-98 type risk in strong events"},
            {"region": "Gayo",     "type": "DRY",  "note": "highland drought stress, flowering failure risk"},
            {"region": "Java",     "type": "DRY",  "note": "monsoon weakened, irrigation-dependent areas stressed"},
            {"region": "Toraja",   "type": "DRY",  "note": "Sulawesi dry season extended, yield impact"},
            {"region": "Flores",   "type": "DRY",  "note": "NTT receives less rainfall, moisture deficit critical"},
        ],
        "historical_stat": "El Niño years: Indonesia coffee output −15 to −30% vs neutral (USDA/ICO); 1997-98 event caused >40% crop loss",
    },
    "la-nina": {
        "regions": [
            {"region": "Lampung",  "type": "WET",  "note": "above-avg rainfall, flooding risk in lowland plots"},
            {"region": "Gayo",     "type": "WET",  "note": "excess moisture, fungal (CBD) disease risk"},
            {"region": "Java",     "type": "WET",  "note": "harvest disruption, cherry rot during picking"},
            {"region": "Toraja",   "type": "WET",  "note": "above-avg rainfall, landslide risk on steep farms"},
            {"region": "Flores",   "type": "WET",  "note": "generally positive but excess can delay harvest"},
        ],
        "historical_stat": "La Niña brings above-avg rainfall — adequate moisture but harvest disruption risk",
    },
    "neutral": {
        "regions": [
            {"region": r, "type": "WARM", "note": "near-normal monsoon conditions"}
            for r in _INDONESIA_REGIONS
        ],
        "historical_stat": "Neutral ENSO: near-average Indonesia coffee output expected",
    },
}

# Static production mix
_PRODUCTION_MIX = {
    "robusta_pct": 75,
    "arabica_pct": 25,
    "note": "Indonesia is the world's 3rd largest robusta producer. Arabica is concentrated in highland regions (Gayo, Toraja, Flores).",
    "key_regions": {
        "robusta": ["Lampung (Sumatra S.)", "Bengkulu", "Java"],
        "arabica": ["Gayo/Aceh (Mandheling)", "Toraja (Sulawesi)", "Flores", "Kintamani (Bali)"],
    },
}

# Multi-island harvest windows (approximate)
_HARVEST_WINDOWS = [
    {"island": "Sumatra (Robusta)", "harvest": "Mar–Aug",  "flowering": "Oct–Dec", "crop": "robusta"},
    {"island": "Sumatra (Arabica)", "harvest": "Oct–Mar",  "flowering": "Apr–Jun", "crop": "arabica"},
    {"island": "Java",              "harvest": "Jul–Sep",   "flowering": "Nov–Jan", "crop": "mixed"},
    {"island": "Sulawesi",          "harvest": "Oct–Mar",   "flowering": "Apr–Jun", "crop": "arabica"},
    {"island": "Flores",            "harvest": "Jun–Sep",   "flowering": "Jan–Mar", "crop": "arabica"},
]


def _worst_risk(risks: list) -> str:
    return max(risks, key=lambda r: _RISK_ORDER.get(r, 0)) if risks else "-"


def _badge(code: str) -> str:
    return {"H": "HIGH", "M": "MED", "L": "LOW", "-": "NONE"}.get(code, "NONE")


def _oni_to_dots(oni: float) -> int:
    a = abs(oni)
    return 4 if a >= 2.0 else 3 if a >= 1.5 else 2 if a >= 1.0 else 1


def _derive_enso_phase(oni_history: list) -> tuple:
    entries = [p for p in oni_history if not p.get("forecast")]
    if not entries:
        entries = oni_history
    if not entries:
        return "neutral", "Weak", 0.0
    current_oni = entries[-1]["value"]
    recent = [p["value"] for p in entries[-5:]]
    phase = ("el-nino" if len(recent) >= 5 and all(v >= 0.5 for v in recent)
             else "la-nina" if len(recent) >= 5 and all(v <= -0.5 for v in recent)
             else "neutral")
    abs_oni = abs(current_oni)
    intensity = "Extreme" if abs_oni >= 2.0 else "Strong" if abs_oni >= 1.5 else "Moderate" if abs_oni >= 1.0 else "Weak"
    return phase, intensity, current_oni


def export_indonesia(db) -> None:
    # ── 1. Exports (ICO) ──────────────────────────────────────────────────────
    exports_out = None
    try:
        ico_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "ICO", NewsItem.title.like("Indonesia%"))
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if ico_item:
            meta = json.loads(ico_item.meta or "{}")
            exports_out = {
                "source":       "ICO",
                "last_updated": meta.get("last_updated", ""),
                "unit":         meta.get("unit", "thousand 60-kg bags"),
                "monthly":      meta.get("monthly", []),
            }
    except Exception as e:
        print(f"  [indonesia] exports section error: {e}")

    # ── 2. Weather ────────────────────────────────────────────────────────────
    weather_out = None
    try:
        from scraper.sources.indonesia_weather import _calc_csi

        snapshots = (
            db.query(WeatherSnapshot)
            .filter(WeatherSnapshot.region.in_(_INDONESIA_REGIONS))
            .order_by(WeatherSnapshot.scraped_at.desc())
            .all()
        )
        latest_by_region: dict = {}
        for snap in snapshots:
            if snap.region not in latest_by_region:
                latest_by_region[snap.region] = snap

        if latest_by_region:
            regions_out = []
            daily_drought_out  = []
            drought_detail_out = []
            scraped_at_out = None

            for region_name in _INDONESIA_REGIONS:
                snap = latest_by_region.get(region_name)
                if snap is None:
                    continue
                if scraped_at_out is None and snap.scraped_at:
                    scraped_at_out = snap.scraped_at.isoformat() + "Z"

                daily = snap.daily_data or []
                week  = daily[:7]
                drought_codes = [d.get("drought_risk", "-") for d in week]
                csi = _calc_csi(daily)

                regions_out.append({
                    "name":          region_name,
                    "drought":       _badge(_worst_risk(drought_codes)),
                    "csi_30d":       csi["csi_30d"],
                    "csi_60d":       csi["csi_60d"],
                    "csi_30d_level": csi["csi_30d_level"],
                    "csi_60d_level": csi["csi_60d_level"],
                })

                drought_days = [d.get("drought_risk", "-") for d in daily]
                if any(c != "-" for c in drought_days):
                    daily_drought_out.append({"region": region_name, "days": drought_days})
                    drought_detail_out.append({
                        "region": region_name,
                        "days": [
                            {
                                "date":          d.get("date", ""),
                                "precip_prob":   d.get("precip_prob", 0.0),
                                "precip_mm":     d.get("precip_mm", 0.0),
                                "soil_moisture": d.get("soil_moisture", 0.0),
                                "drought_risk":  d.get("drought_risk", "-"),
                            }
                            for d in daily
                        ],
                    })

            if regions_out:
                weather_out = {
                    "scraped_at":    scraped_at_out or date.today().isoformat(),
                    "regions":       regions_out,
                    "daily_drought": daily_drought_out,
                    "drought_detail": drought_detail_out,
                }
    except Exception as e:
        print(f"  [indonesia] weather section error: {e}")

    # ── 3. ENSO ───────────────────────────────────────────────────────────────
    enso_out = None
    try:
        enso_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "NOAA CPC")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if enso_item:
            meta = json.loads(enso_item.meta or "{}")
            oni_history = meta.get("oni_history", [])
            if oni_history:
                phase, intensity, current_oni = _derive_enso_phase(oni_history)
                dots = _oni_to_dots(current_oni)
                impact_def = _INDONESIA_ENSO_IMPACT.get(phase, _INDONESIA_ENSO_IMPACT["neutral"])
                regional_impact = [{**r, "dots": dots} for r in impact_def["regions"]]

                recent_vals = [p["value"] for p in oni_history[-5:]]
                trend = (recent_vals[-1] - recent_vals[0]) if len(recent_vals) >= 2 else 0
                forecast_direction = (
                    "Neutral · No strong signal" if phase == "neutral"
                    else ("El Niño weakening" if trend < -0.15 else "El Niño conditions ongoing") if phase == "el-nino"
                    else ("La Niña weakening toward neutral" if trend > 0.15 else "La Niña ongoing")
                )

                confirmed  = [p for p in oni_history if not p.get("preliminary")]
                peak_entry = max(confirmed or oni_history, key=lambda p: abs(p["value"]))
                peak_month = peak_entry["month"]

                enso_out = {
                    "phase":              phase,
                    "intensity":          intensity,
                    "oni":                current_oni,
                    "peak_month":         peak_month,
                    "forecast_direction": forecast_direction,
                    "oni_history":        oni_history,
                    "oni_forecast":       meta.get("oni_forecast", []),
                    "regional_impact":    regional_impact,
                    "historical_stat":    impact_def["historical_stat"],
                    "last_updated":       str(enso_item.pub_date)[:10],
                }
    except Exception as e:
        print(f"  [indonesia] ENSO section error: {e}")

    # ── Assemble ──────────────────────────────────────────────────────────────
    result = {
        "country":       "indonesia",
        "scraped_at":    datetime.utcnow().isoformat() + "Z",
        "exports":       exports_out,
        "weather":       weather_out,
        "enso":          enso_out,
        "production_mix": _PRODUCTION_MIX,
        "harvest_windows": _HARVEST_WINDOWS,
    }

    path = OUT_DIR / "indonesia_supply.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"  indonesia_supply.json → "
        f"exports:{exports_out is not None} "
        f"weather:{weather_out is not None} "
        f"enso:{enso_out is not None}"
    )


def main():
    print("Exporting Indonesia supply JSON...")
    db = SessionLocal()
    try:
        export_indonesia(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
