"""
export_ethiopia.py
Reads DB and writes frontend/public/data/ethiopia_supply.json.

Sections:
  exports      — ICO monthly green coffee exports
  ecx_price    — ECX auction price in ETB/kg (if scraped)
  weather      — drought risk per region (WeatherSnapshot)
  enso         — NOAA ONI + Ethiopia-specific regional impact
  harvest_cal  — main + second crop calendar
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

from scraper._export_common import _badge, _worst_risk
from scraper.enso import derive_enso_phase as _derive_enso_phase
from scraper.enso import oni_to_dots as _oni_to_dots

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem, WeatherSnapshot

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

_ETHIOPIA_REGIONS = ["Sidama/Yirgacheffe", "Harrar", "Kaffa", "Limu", "Jimma"]

_ETHIOPIA_ENSO_IMPACT = {
    "el-nino": {
        "regions": [
            {"region": "Sidama/Yirgacheffe", "type": "DRY",  "note": "long rains below-avg, flowering stress"},
            {"region": "Harrar",             "type": "DRY",  "note": "eastern highlands drought, cherry shriveling"},
            {"region": "Kaffa",              "type": "DRY",  "note": "southwest moisture deficit, yield impact"},
            {"region": "Limu",               "type": "DRY",  "note": "below-avg rainfall, quality risk"},
            {"region": "Jimma",              "type": "DRY",  "note": "extended dry spells during critical growth"},
        ],
        "historical_stat": "El Nino years: Ethiopia coffee output -5 to -15% vs neutral; worst impacts in eastern highlands",
    },
    "la-nina": {
        "regions": [
            {"region": "Sidama/Yirgacheffe", "type": "WET",  "note": "above-avg long rains, good for yield"},
            {"region": "Harrar",             "type": "WET",  "note": "above-avg moisture, quality impact if excess"},
            {"region": "Kaffa",              "type": "WET",  "note": "above-avg rainfall, fungal disease risk"},
            {"region": "Limu",               "type": "WET",  "note": "good moisture conditions"},
            {"region": "Jimma",              "type": "WET",  "note": "above-avg rainfall, positive for yield"},
        ],
        "historical_stat": "La Nina brings above-average rainfall — positive for yield; fungal disease risk in humid regions",
    },
    "neutral": {
        "regions": [
            {"region": "Sidama/Yirgacheffe", "type": "WARM", "note": "near-normal bimodal rainfall"},
            {"region": "Harrar",             "type": "WARM", "note": "near-normal conditions"},
            {"region": "Kaffa",              "type": "WARM", "note": "near-normal southwest conditions"},
            {"region": "Limu",               "type": "WARM", "note": "near-normal conditions"},
            {"region": "Jimma",              "type": "WARM", "note": "near-normal conditions"},
        ],
        "historical_stat": "Neutral ENSO: near-average Ethiopia arabica output expected",
    },
}




def export_ethiopia(db) -> None:
    # 1. Exports (ICO)
    exports_out = None
    try:
        ico_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "ICO", NewsItem.title.like("Ethiopia%"))
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
        print(f"  [ethiopia] exports section error: {e}")

    # Fall back to USDA PSD annual exports when ICO monthly data is absent
    # (it never lands for this origin — see psd_country_exports).
    if exports_out is None:
        try:
            from scraper.psd_country_exports import psd_country_exports
            exports_out = psd_country_exports(db, "ethiopia")
        except Exception as e:
            print(f"  [ethiopia] PSD exports fallback error: {e}")

    # 2. ECX price
    ecx_out = None
    try:
        ecx_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "ECX")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if ecx_item:
            ecx_out = json.loads(ecx_item.meta or "{}")
    except Exception as e:
        print(f"  [ethiopia] ECX section error: {e}")

    # 3. Weather
    weather_out = None
    try:
        from scraper.sources._weather_baseline import mtd_rain_fields
        from scraper.sources.ethiopia_weather import _calc_csi

        snapshots = (
            db.query(WeatherSnapshot)
            .filter(WeatherSnapshot.region.in_(_ETHIOPIA_REGIONS))
            .order_by(WeatherSnapshot.scraped_at.desc())
            .all()
        )
        latest_by_region: dict = {}
        for snap in snapshots:
            if snap.region not in latest_by_region:
                latest_by_region[snap.region] = snap

        if latest_by_region:
            regions_out = []
            daily_drought_out = []
            scraped_at_out = None

            for region_name in _ETHIOPIA_REGIONS:
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
                if region_name == "Sidama/Yirgacheffe":
                    regions_out[-1].update(mtd_rain_fields(daily, "ethiopia"))

                drought_days = [d.get("drought_risk", "-") for d in daily]
                if any(c != "-" for c in drought_days):
                    daily_drought_out.append({"region": region_name, "days": drought_days})

            if regions_out:
                weather_out = {
                    "scraped_at":    scraped_at_out or date.today().isoformat(),
                    "regions":       regions_out,
                    "daily_drought": daily_drought_out,
                }
    except Exception as e:
        print(f"  [ethiopia] weather section error: {e}")

    # 4. ENSO
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
                impact_def = _ETHIOPIA_ENSO_IMPACT.get(phase, _ETHIOPIA_ENSO_IMPACT["neutral"])
                regional_impact = [{**r, "dots": dots} for r in impact_def["regions"]]

                recent_vals = [p["value"] for p in oni_history[-5:]]
                trend = (recent_vals[-1] - recent_vals[0]) if len(recent_vals) >= 2 else 0
                if phase == "neutral":       forecast_direction = "Neutral - No strong signal for 2026"
                elif phase == "el-nino":     forecast_direction = "El Nino weakening" if trend < -0.15 else "El Nino conditions ongoing"
                else:                        forecast_direction = "La Nina weakening toward neutral" if trend > 0.15 else "La Nina ongoing"

                confirmed = [p for p in oni_history if not p.get("preliminary")]
                history_for_peak = confirmed if confirmed else oni_history
                peak_month = max(history_for_peak, key=lambda p: abs(p["value"]))["month"] if history_for_peak else ""

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
        print(f"  [ethiopia] ENSO section error: {e}")

    # 5. Static harvest calendar
    harvest_cal = {
        "main_crop_harvest":     "Oct-Jan",
        "main_crop_flowering":   "Feb-Apr",
        "second_crop_harvest":   "Mar-May",
        "second_crop_flowering": "Jun-Aug",
        "description": (
            "Ethiopia has a main harvest from October to January across all major regions. "
            "A smaller second crop harvests March-May in some western regions (Kaffa, Limu). "
            "100% arabica; processing includes natural (Harrar, Sidama) and washed (Yirgacheffe, Limu)."
        ),
    }

    # 6. Grade structure
    grade_structure = {
        "grades": [
            {"grade": "Grade 1", "quality": "Specialty", "defects": "0-3", "regions": "Yirgacheffe, Sidama"},
            {"grade": "Grade 2", "quality": "Specialty", "defects": "4-12", "regions": "Sidama, Limu"},
            {"grade": "Grade 3", "quality": "Premium",   "defects": "13-25", "regions": "Jimma, Harrar"},
            {"grade": "Grade 4", "quality": "Commercial","defects": "26-45", "regions": "Various"},
        ],
        "processing": {
            "natural_pct": 65,
            "washed_pct":  35,
            "note": "Natural (dry) processing dominates in Harrar and Sidama; washed in Yirgacheffe and Limu.",
        },
    }

    result = {
        "country":         "ethiopia",
        "scraped_at":      datetime.utcnow().isoformat() + "Z",
        "exports":         exports_out,
        "ecx_price":       ecx_out,
        "weather":         weather_out,
        "enso":            enso_out,
        "harvest_cal":     harvest_cal,
        "grade_structure": grade_structure,
    }

    path = OUT_DIR / "ethiopia_supply.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"  ethiopia_supply.json -> "
        f"exports:{exports_out is not None} "
        f"ecx:{ecx_out is not None} "
        f"weather:{weather_out is not None} "
        f"enso:{enso_out is not None}"
    )


def main():
    print("Exporting Ethiopia supply JSON...")
    db = SessionLocal()
    try:
        export_ethiopia(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
