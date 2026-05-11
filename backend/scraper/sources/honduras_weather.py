"""
honduras_weather.py — Open-Meteo weather scraper for Honduran coffee regions.

Regions: Copán, Santa Bárbara, Montecillos, El Paraíso, Agalta.
Risk focus: drought (El Niño = drier = bad). Minor frost risk at high-altitude plots.
Soil: Andisol (volcanic) in western belt, similar to Colombian coffee soils.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

import requests

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

REGIONS = [
    {"name": "Copán",        "lat": 14.84, "lon": -89.15},
    {"name": "Santa Bárbara","lat": 14.92, "lon": -88.23},
    {"name": "Montecillos",  "lat": 14.33, "lon": -87.90},
    {"name": "El Paraíso",   "lat": 14.00, "lon": -86.80},
    {"name": "Agalta",       "lat": 14.82, "lon": -86.50},
]

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&hourly=temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m"
    ",precipitation,precipitation_probability,et0_fao_evapotranspiration"
    ",soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm"
    ",soil_moisture_9_to_27cm,soil_moisture_27_to_81cm"
    "&forecast_days=14&past_days=60&timezone=America%2FTegucigalpa"
)

# Andisol / volcanic soil (western Honduras coffee belt)
_PWP = 0.22
_AWC = 0.18

# Frost: rare but possible at highest plots (>1800m) in Copán / Montecillos
_FROST_REGIONS = {"Copán", "Montecillos"}


def _root_zone_moisture(sm_0_9: float, sm_9_27: float, sm_27_81: float) -> float:
    return sm_0_9 * 0.10 + sm_9_27 * 0.25 + sm_27_81 * 0.65


def _effective_rain(precip_mm: float) -> float:
    if precip_mm < 3.0:   return precip_mm * 0.20
    elif precip_mm < 10.0: return precip_mm * 0.60
    else:                  return precip_mm * 0.90


def _drought_score(precip_mm: float, et0_mm: float, root_zone_sm: float) -> float:
    rwc = max(0.0, (root_zone_sm - _PWP) / _AWC * 100.0)
    base = 0.0 if rwc >= 80 else 0.5 if rwc >= 60 else 1.0 if rwc >= 40 else 2.0 if rwc >= 20 else 3.0
    et0_adj = 0.5 if et0_mm > 6.0 else 0.25 if et0_mm > 4.0 else 0.0
    relief = min(1.5, _effective_rain(precip_mm) / 5.0)
    return max(0.0, base + et0_adj - relief)


def _frost_risk(min_temp: float, cloud_cover: float, wind_kmh: float, dew_point: float) -> str:
    """Light frost assessment for high-altitude Honduras plots."""
    radiation_cooling = (1 - cloud_cover / 100) * max(0.0, 5.0 - 0.4 * wind_kmh)
    dew_correction    = 0.5 if dew_point < 2.0 else 0.0
    t_surface = min_temp - radiation_cooling - dew_correction
    if t_surface < 0:   return "H"
    if t_surface < 3:   return "M"
    if t_surface < 6:   return "L"
    return "-"


def _apply_drought_modifiers(days: list[dict]) -> list[dict]:
    """Honduras phenology: Sep–Nov (flowering + early fruit) ×1.2; Dec–Jan (main harvest) ×1.0."""
    PHENO = {9: 1.2, 10: 1.2, 11: 1.2, 4: 1.15, 5: 1.15, 6: 1.15}
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

    days = []
    check_frost = region_name in _FROST_REGIONS

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
        mean_surface = sum(surface_vals) / len(surface_vals) if surface_vals else 0.28
        mean_sm3     = sum(sm3_day) / len(sm3_day) if sm3_day else 0.28
        mean_sm4     = sum(sm4_day) / len(sm4_day) if sm4_day else 0.30
        root_zone    = _root_zone_moisture(mean_surface, mean_sm3, mean_sm4)

        daily_precip = sum(pm_day) if pm_day else 0.0
        daily_et0    = sum(et0_day) if et0_day else 0.0

        # Frost: only checked for high-altitude regions
        frost = "-"
        if check_frost:
            min_t = min(temps_day)
            min_idx  = min(idxs, key=lambda i: temp[i] if temp[i] is not None else float("inf"))
            cloud_at = cloud[min_idx] if cloud[min_idx] is not None else (sum(cloud_day)/len(cloud_day) if cloud_day else 0.0)
            wind_at  = wind[min_idx]  if wind[min_idx]  is not None else (max(wind_day) if wind_day else 0.0)
            dew_at   = dew[min_idx]   if dew[min_idx]   is not None else (sum(dew_day)/len(dew_day) if dew_day else 0.0)
            frost = _frost_risk(min_t, cloud_at, wind_at, dew_at)

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
            "frost_risk":         frost,
            "drought_risk":       "-",
            "_drought_score_raw": _drought_score(daily_precip, daily_et0, root_zone),
        })

    _apply_drought_modifiers(days)
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
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from models import WeatherSnapshot
    from sqlalchemy import delete

    for region in REGIONS:
        url = OPEN_METEO_URL.format(lat=region["lat"], lon=region["lon"])
        try:
            resp = requests.get(url, headers=_HEADERS, timeout=30)
            resp.raise_for_status()
            daily_data = _aggregate_hourly_to_daily(resp.json().get("hourly", {}), region["name"])

            db.execute(delete(WeatherSnapshot).where(WeatherSnapshot.region == region["name"]))
            db.add(WeatherSnapshot(region=region["name"], daily_data=daily_data, scraped_at=datetime.utcnow()))
            db.commit()
            print(f"[honduras_weather] OK: {region['name']} ({len(daily_data)} days)")
        except Exception as e:
            db.rollback()
            print(f"[honduras_weather] FAILED {region['name']}: {e}")


async def run(page, db) -> None:
    scrape(db)
