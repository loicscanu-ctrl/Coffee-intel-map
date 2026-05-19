"""
colombia_weather.py — Open-Meteo weather scraper for Colombian coffee regions.

Regions: Huila, Nariño, Antioquia, Cauca, Caldas.
Risk focus: drought (El Niño = drier = bad). No frost risk in Colombian coffee belt.
Soil: Andisol (volcanic origin, higher PWP than Brazilian Oxisol).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

REGIONS = [
    {"name": "Huila",     "lat":  2.53, "lon": -75.53},
    {"name": "Nariño",    "lat":  1.21, "lon": -77.28},
    {"name": "Antioquia", "lat":  6.18, "lon": -75.57},
    {"name": "Cauca",     "lat":  2.45, "lon": -76.61},
    {"name": "Caldas",    "lat":  5.07, "lon": -75.51},
]

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&hourly=temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m"
    ",precipitation,precipitation_probability,et0_fao_evapotranspiration"
    ",soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm"
    ",soil_moisture_9_to_27cm,soil_moisture_27_to_81cm"
    "&forecast_days=14&past_days=60&timezone=America%2FBogota"
)

# Andisol (volcanic): higher water retention than Brazilian Oxisol
_PWP = 0.25  # Permanent Wilting Point (m³/m³)
_AWC = 0.18  # Available Water Capacity


def _root_zone_moisture(sm_0_9: float, sm_9_27: float, sm_27_81: float) -> float:
    return sm_0_9 * 0.10 + sm_9_27 * 0.25 + sm_27_81 * 0.65


def _effective_rain(precip_mm: float) -> float:
    if precip_mm < 3.0:
        return precip_mm * 0.20
    elif precip_mm < 10.0:
        return precip_mm * 0.60
    else:
        return precip_mm * 0.90


def _drought_score(precip_mm: float, et0_mm: float, root_zone_sm: float) -> float:
    rwc = max(0.0, (root_zone_sm - _PWP) / _AWC * 100.0)
    if rwc >= 80:
        base = 0.0
    elif rwc >= 60:
        base = 0.5
    elif rwc >= 40:
        base = 1.0
    elif rwc >= 20:
        base = 2.0
    else:
        base = 3.0

    if et0_mm > 6.0:
        et0_adj = 0.5
    elif et0_mm > 4.0:
        et0_adj = 0.25
    else:
        et0_adj = 0.0

    relief = min(1.5, _effective_rain(precip_mm) / 5.0)
    return max(0.0, base + et0_adj - relief)


def _apply_drought_modifiers(days: list[dict]) -> list[dict]:
    """Colombia phenology: Aug–Oct (Mitaca flowering + main crop dev) ×1.2; Mar–May (main flowering) ×1.15."""
    from ._weather_baseline import seasonal_z_score, has_baseline

    PHENO = {8: 1.2, 9: 1.2, 10: 1.2, 3: 1.15, 4: 1.15, 5: 1.15}

    for day in days:
        month = int(day["date"][5:7])
        score = day.get("_drought_score_raw", 0.0) * PHENO.get(month, 1.0)
        day["_drought_score"] = score

    stressed = sum(1 for d in days if d["_drought_score"] > 1.0)
    penalty = 0.5 if len(days) >= 14 and stressed >= 10 else 0.0

    # Aggregate the current period's precip by calendar month so we can ask
    # the baseline whether it's anomalous for the season. Without this,
    # Colombia's natural Dec-Feb dry season flags drought every year.
    precip_by_month: dict[int, float] = {}
    for day in days:
        m = int(day["date"][5:7])
        p = day.get("precip_mm")
        if p is not None:
            precip_by_month[m] = precip_by_month.get(m, 0.0) + p

    seasonal_overrides_active = has_baseline("colombia")

    for day in days:
        score = day["_drought_score"] + penalty
        if score >= 2.5:
            risk = "H"
        elif score >= 1.5:
            risk = "M"
        elif score >= 0.5:
            risk = "L"
        else:
            risk = "-"

        # Seasonal-baseline downgrade: a HIGH (or MEDIUM) reading is the
        # NORM for this region × month when current precip sits within 1σ
        # of the historical mean. Downgrade by one notch in that case.
        # Only fires if the baseline JSON has been populated for Colombia.
        if seasonal_overrides_active and risk in ("H", "M"):
            month = int(day["date"][5:7])
            cur_precip = precip_by_month.get(month, 0.0)
            z = seasonal_z_score("colombia", month, cur_precip, metric="precip")
            if z is not None and z > -1.0:
                # Current precip is within (or above) the normal range for
                # this calendar month — not an anomaly. Downgrade one notch.
                risk = "M" if risk == "H" else "L"
                day["_seasonal_downgrade"] = True

        day["drought_risk"] = risk
        day.pop("_drought_score_raw", None)
        day.pop("_drought_score", None)

    return days


def _aggregate_hourly_to_daily(hourly: dict) -> list[dict]:
    times     = hourly["time"]
    temp      = hourly["temperature_2m"]
    dew       = hourly["dew_point_2m"]
    cloud     = hourly["cloud_cover"]
    wind      = hourly["wind_speed_10m"]
    pp_arr    = hourly.get("precipitation_probability", [])
    pm_arr    = hourly.get("precipitation", [])
    et0_arr   = hourly.get("et0_fao_evapotranspiration", [])
    sm0 = hourly.get("soil_moisture_0_to_1cm",  [])
    sm1 = hourly.get("soil_moisture_1_to_3cm",  [])
    sm2 = hourly.get("soil_moisture_3_to_9cm",  [])
    sm3 = hourly.get("soil_moisture_9_to_27cm", [])
    sm4 = hourly.get("soil_moisture_27_to_81cm",[])

    def _safe(arr, i):
        return arr[i] if i < len(arr) else None

    day_indices: dict[str, list[int]] = defaultdict(list)
    for i, ts in enumerate(times):
        day_indices[ts[:10]].append(i)

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
        pp_max       = max(pp_day)  if pp_day  else 0.0

        days.append({
            "date":               day_str,
            "min_temp":           round(min(temps_day), 1),
            "max_temp":           round(max(temps_day), 1),
            "dew_point":          round(sum(dew_day) / len(dew_day), 1) if dew_day else 0.0,
            "cloud_cover":        round(sum(cloud_day) / len(cloud_day), 1) if cloud_day else 0.0,
            "wind_speed":         round(max(wind_day), 1) if wind_day else 0.0,
            "precip_prob":        round(pp_max, 1),
            "precip_mm":          round(daily_precip, 1),
            "et0_mm":             round(daily_et0, 2),
            "soil_moisture":      round(root_zone, 3),
            "frost_risk":         "-",   # no frost in Colombian coffee belt
            "drought_risk":       "-",
            "_drought_score_raw": _drought_score(daily_precip, daily_et0, root_zone),
        })

    _apply_drought_modifiers(days)
    return days


def _calc_csi(daily_rows: list[dict]) -> dict:
    today = date.today().isoformat()
    past = sorted(
        [d for d in daily_rows if d.get("date", "") < today],
        key=lambda d: d["date"],
    )
    deficits = [
        max(0.0, d.get("et0_mm", 0.0) - _effective_rain(d.get("precip_mm", 0.0)))
        for d in past
    ]

    def _level(val: float, n: int) -> str:
        per30 = val * (30 / n) if n else 0
        if per30 < 20:   return "-"
        elif per30 < 40: return "L"
        elif per30 < 60: return "M"
        else:            return "H"

    csi_30 = round(sum(deficits[-30:]), 1)
    csi_60 = round(sum(deficits[-60:]), 1)
    return {
        "csi_30d": csi_30, "csi_60d": csi_60,
        "csi_30d_level": _level(csi_30, len(deficits[-30:])),
        "csi_60d_level": _level(csi_60, len(deficits[-60:])),
    }


def scrape(db) -> None:
    """Fetch Open-Meteo for each Colombian region, store as WeatherSnapshot."""
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
            daily_data = _aggregate_hourly_to_daily(data.get("hourly", {}))

            db.execute(delete(WeatherSnapshot).where(WeatherSnapshot.region == region["name"]))
            db.add(WeatherSnapshot(
                region=region["name"],
                daily_data=daily_data,
                scraped_at=datetime.utcnow(),
            ))
            db.commit()
            print(f"[colombia_weather] OK: {region['name']} ({len(daily_data)} days)")
        except Exception as e:
            db.rollback()
            print(f"[colombia_weather] FAILED {region['name']}: {e}")


async def run(page, db) -> None:
    scrape(db)
