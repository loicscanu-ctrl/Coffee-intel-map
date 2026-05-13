"""
indonesia_weather.py — Open-Meteo weather scraper for Indonesian coffee regions.

Regions: Lampung (Sumatra S, robusta), Gayo (Aceh, arabica),
         Java, Toraja (Sulawesi, arabica), Flores (arabica).
Risk focus: drought (El Niño = severe drought = very bad).
No frost risk (equatorial).
Soil: volcanic Andisol in highland regions, clay loam in lowland Lampung.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

REGIONS = [
    {"name": "Lampung",  "lat": -5.45, "lon": 105.26},   # S. Sumatra robusta
    {"name": "Gayo",     "lat":  4.67, "lon":  96.77},   # Aceh arabica
    {"name": "Java",     "lat": -7.55, "lon": 110.80},   # East Java
    {"name": "Toraja",   "lat": -3.00, "lon": 119.90},   # Sulawesi arabica
    {"name": "Flores",   "lat": -8.67, "lon": 121.08},   # NTT arabica
]

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&hourly=temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m"
    ",precipitation,precipitation_probability,et0_fao_evapotranspiration"
    ",soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm"
    ",soil_moisture_9_to_27cm,soil_moisture_27_to_81cm"
    "&forecast_days=14&past_days=60&timezone=Asia%2FJakarta"
)

# Andisol for highland regions; clay loam (higher PWP) for Lampung lowland
_PWP_DEFAULT = 0.22
_PWP_LAMPUNG  = 0.28   # clay-heavier lowland soil, water retention higher but less available
_AWC = 0.16


def _pwp_for(region_name: str) -> float:
    return _PWP_LAMPUNG if region_name == "Lampung" else _PWP_DEFAULT


def _root_zone_moisture(sm_0_9: float, sm_9_27: float, sm_27_81: float) -> float:
    return sm_0_9 * 0.10 + sm_9_27 * 0.25 + sm_27_81 * 0.65


def _effective_rain(precip_mm: float) -> float:
    if precip_mm < 3.0:   return precip_mm * 0.20
    elif precip_mm < 10.0: return precip_mm * 0.60
    else:                  return precip_mm * 0.90


def _drought_score(precip_mm: float, et0_mm: float, root_zone_sm: float, pwp: float) -> float:
    awc = _AWC
    rwc = max(0.0, (root_zone_sm - pwp) / awc * 100.0)
    base = 0.0 if rwc >= 80 else 0.5 if rwc >= 60 else 1.0 if rwc >= 40 else 2.0 if rwc >= 20 else 3.0
    et0_adj = 0.5 if et0_mm > 6.0 else 0.25 if et0_mm > 4.0 else 0.0
    relief = min(1.5, _effective_rain(precip_mm) / 5.0)
    return max(0.0, base + et0_adj - relief)


def _apply_drought_modifiers(days: list[dict], region_name: str) -> list[dict]:
    """
    Indonesia phenology varies by island/crop but broadly:
      Dry season (Jun–Sep): all regions — critical moisture period ×1.2
      Flowering (Oct–Nov for Java/Sulawesi): ×1.15
    """
    PHENO = {6: 1.2, 7: 1.2, 8: 1.2, 9: 1.2, 10: 1.15, 11: 1.15}

    for day in days:
        month = int(day["date"][5:7])
        day["_drought_score"] = day.get("_drought_score_raw", 0.0) * PHENO.get(month, 1.0)

    stressed = sum(1 for d in days if d["_drought_score"] > 1.0)
    penalty  = 0.5 if len(days) >= 14 and stressed >= 10 else 0.0

    for day in days:
        score = day["_drought_score"] + penalty
        day["drought_risk"] = "H" if score >= 2.5 else "M" if score >= 1.5 else "L" if score >= 0.5 else "-"
        day.pop("_drought_score_raw", None)
        day.pop("_drought_score", None)

    return days


def _aggregate_hourly_to_daily(hourly: dict, region_name: str = "") -> list[dict]:
    times   = hourly["time"]
    temp    = hourly["temperature_2m"]
    dew     = hourly["dew_point_2m"]
    cloud   = hourly["cloud_cover"]
    wind    = hourly["wind_speed_10m"]
    pp_arr  = hourly.get("precipitation_probability", [])
    pm_arr  = hourly.get("precipitation", [])
    et0_arr = hourly.get("et0_fao_evapotranspiration", [])
    sm0 = hourly.get("soil_moisture_0_to_1cm",  [])
    sm1 = hourly.get("soil_moisture_1_to_3cm",  [])
    sm2 = hourly.get("soil_moisture_3_to_9cm",  [])
    sm3 = hourly.get("soil_moisture_9_to_27cm", [])
    sm4 = hourly.get("soil_moisture_27_to_81cm",[])

    def _safe(arr, i): return arr[i] if i < len(arr) else None

    day_indices: dict[str, list[int]] = defaultdict(list)
    for i, ts in enumerate(times):
        day_indices[ts[:10]].append(i)

    pwp  = _pwp_for(region_name)
    days = []

    for day_str in sorted(day_indices):
        idxs = day_indices[day_str]

        temps_day = [v for v in (temp[i]  for i in idxs) if v is not None]
        dew_day   = [v for v in (dew[i]   for i in idxs) if v is not None]
        cloud_day = [v for v in (cloud[i] for i in idxs) if v is not None]
        wind_day  = [v for v in (wind[i]  for i in idxs) if v is not None]
        pp_day    = [v for v in (_safe(pp_arr, i)  for i in idxs) if v is not None]
        pm_day    = [v for v in (_safe(pm_arr, i)  for i in idxs) if v is not None]
        et0_day   = [v for v in (_safe(et0_arr, i) for i in idxs) if v is not None]
        sm0_day   = [v for v in (_safe(sm0, i) for i in idxs) if v is not None]
        sm1_day   = [v for v in (_safe(sm1, i) for i in idxs) if v is not None]
        sm2_day   = [v for v in (_safe(sm2, i) for i in idxs) if v is not None]
        sm3_day   = [v for v in (_safe(sm3, i) for i in idxs) if v is not None]
        sm4_day   = [v for v in (_safe(sm4, i) for i in idxs) if v is not None]

        if not temps_day:
            continue

        surface_vals = sm0_day + sm1_day + sm2_day
        mean_surface = sum(surface_vals) / len(surface_vals) if surface_vals else 0.30
        mean_sm3     = sum(sm3_day) / len(sm3_day) if sm3_day else 0.30
        mean_sm4     = sum(sm4_day) / len(sm4_day) if sm4_day else 0.32
        root_zone    = _root_zone_moisture(mean_surface, mean_sm3, mean_sm4)

        daily_precip = sum(pm_day)  if pm_day  else 0.0
        daily_et0    = sum(et0_day) if et0_day else 0.0

        days.append({
            "date":               day_str,
            "min_temp":           round(min(temps_day), 1),
            "max_temp":           round(max(temps_day), 1),
            "dew_point":          round(sum(dew_day)/len(dew_day), 1) if dew_day else 0.0,
            "cloud_cover":        round(sum(cloud_day)/len(cloud_day), 1) if cloud_day else 0.0,
            "wind_speed":         round(max(wind_day), 1) if wind_day else 0.0,
            "precip_prob":        round(max(pp_day), 1) if pp_day else 0.0,
            "precip_mm":          round(daily_precip, 1),
            "et0_mm":             round(daily_et0, 2),
            "soil_moisture":      round(root_zone, 3),
            "frost_risk":         "-",   # no frost in Indonesian coffee belt
            "drought_risk":       "-",
            "_drought_score_raw": _drought_score(daily_precip, daily_et0, root_zone, pwp),
        })

    _apply_drought_modifiers(days, region_name)
    return days


def _calc_csi(daily_rows: list[dict]) -> dict:
    today = date.today().isoformat()
    past  = sorted([d for d in daily_rows if d.get("date", "") < today], key=lambda d: d["date"])
    deficits = [max(0.0, d.get("et0_mm", 0.0) - _effective_rain(d.get("precip_mm", 0.0))) for d in past]

    def _level(val: float, n: int) -> str:
        per30 = val * (30 / n) if n else 0
        return "-" if per30 < 20 else "L" if per30 < 40 else "M" if per30 < 60 else "H"

    csi_30 = round(sum(deficits[-30:]), 1)
    csi_60 = round(sum(deficits[-60:]), 1)
    return {
        "csi_30d": csi_30, "csi_60d": csi_60,
        "csi_30d_level": _level(csi_30, len(deficits[-30:])),
        "csi_60d_level": _level(csi_60, len(deficits[-60:])),
    }


def scrape(db) -> None:
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from sqlalchemy import delete

    from models import WeatherSnapshot
    from scraper.sources._open_meteo import get_json
    for region in REGIONS:
        url = OPEN_METEO_URL.format(lat=region["lat"], lon=region["lon"])
        try:
            data = get_json(url, headers=_HEADERS)
            daily_data = _aggregate_hourly_to_daily(data.get("hourly", {}), region["name"])

            db.execute(delete(WeatherSnapshot).where(WeatherSnapshot.region == region["name"]))
            db.add(WeatherSnapshot(region=region["name"], daily_data=daily_data, scraped_at=datetime.utcnow()))
            db.commit()
            print(f"[indonesia_weather] OK: {region['name']} ({len(daily_data)} days)")
        except Exception as e:
            db.rollback()
            print(f"[indonesia_weather] FAILED {region['name']}: {e}")


async def run(page, db) -> None:
    scrape(db)
