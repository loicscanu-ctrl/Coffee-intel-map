#!/usr/bin/env python3
"""
seed_origin_weather.py — STATIC climatology seed for per-origin weather charts.

Mirrors how Vietnam's vn_weather.json was made: a hand-curated static seed, not
a live fetch. Open-Meteo (the live source) isn't on this environment's egress
allowlist, so we synthesise realistic, internally-consistent climatology
deterministically from a compact per-region config (annual rainfall + seasonal
shape + temperature profile) and expand it into the exact shape WeatherCharts.tsx
consumes (the same shape as vn_weather.json).

Numbers are representative climatology (monthly normals, a 10yr-style min/max
band, a last-year and current-year-to-date actual, daily month-to-date
accumulation for a reference station, and a 7-day forecast) — NOT live data.
If Open-Meteo is later allowlisted, backend/scripts/build_origin_weather.py
produces the same files from real ERA5/forecast data as a drop-in replacement.

Runs anywhere (no network):
    python seed_origin_weather.py [--write] [--origins brazil colombia ...]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"

TODAY = dt.date.today()
CUR_YEAR = TODAY.year
LAST_YEAR = CUR_YEAR - 1
# "Updated through yesterday" — daily MTD series runs day 1..UPDATED.day.
UPDATED = TODAY - dt.timedelta(days=1)
CUR_MONTH_IDX = UPDATED.month - 1  # 0-indexed

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# ── Seasonal rainfall shape templates (relative monthly weights) ─────────────
SHAPES: dict[str, list[float]] = {
    # Southern-hemisphere summer rains (wet Oct–Mar, dry Jun–Aug) — Brazil.
    "sh_summer":  [17, 14, 12, 5, 3, 1.5, 1.2, 1.8, 5, 9, 13, 16.5],
    # Equatorial bimodal (Apr–May & Oct–Nov peaks) — Colombia, Uganda.
    "bimodal_eq": [5, 6, 9, 12, 11, 7, 5, 6, 9, 12, 11, 7],
    # Northern-hemisphere summer (wet May–Oct, dry Feb–Apr) — Honduras.
    "nh_summer":  [2, 2, 3, 5, 11, 15, 13, 14, 15, 11, 6, 3],
    # SE-Asia monsoon (wet Nov–Mar, dry Jun–Sep) — Indonesia (southern).
    "sea_monsoon":[16, 15, 13, 9, 5, 3, 2.5, 2.5, 4, 7, 10, 14],
    # Ethiopian belg (Mar–May) + kiremt (Jun–Sep) main rains.
    "eth_kiremt": [2, 3, 7, 9, 9, 12, 16, 15, 10, 6, 4, 2],
}


def _norm(shape: list[float]) -> list[float]:
    s = sum(shape)
    return [w / s for w in shape]


# ── Per-origin region config ────────────────────────────────────────────────
# ann = annual rainfall (mm); shape = seasonal template; t_mean = annual mean
# temp (°C); t_amp = seasonal half-amplitude; t_peak = warmest month index.
# First region is the daily-station reference. prod_mt_k = approx prod weight.
ORIGINS: dict[str, dict] = {
    "brazil": {
        "label": "Brazil", "share_label": "Brazil arabica+conilon",
        "source_production": "CONAB 2024/25 regional output (approx. weights)",
        "regions": [
            {"name": "Sul de Minas",   "station": "Varginha",   "prod_mt_k": 900, "ann": 1500, "shape": "sh_summer", "t_mean": 19.5, "t_amp": 2.6, "t_peak": 0},
            {"name": "Cerrado",        "station": "Patrocínio", "prod_mt_k": 600, "ann": 1600, "shape": "sh_summer", "t_mean": 21.5, "t_amp": 2.4, "t_peak": 0},
            {"name": "Espírito Santo", "station": "Vitória",    "prod_mt_k": 700, "ann": 1200, "shape": "sh_summer", "t_mean": 24.5, "t_amp": 2.8, "t_peak": 1},
            {"name": "Paraná",         "station": "Londrina",   "prod_mt_k": 100, "ann": 1500, "shape": "sh_summer", "t_mean": 21.0, "t_amp": 3.2, "t_peak": 0},
        ],
    },
    "colombia": {
        "label": "Colombia", "share_label": "Colombia arabica",
        "source_production": "FNC 2024 departmental output (approx. weights)",
        "regions": [
            {"name": "Huila",     "station": "Pitalito",  "prod_mt_k": 200, "ann": 1600, "shape": "bimodal_eq", "t_mean": 21.0, "t_amp": 0.9, "t_peak": 2},
            {"name": "Antioquia", "station": "Medellín",  "prod_mt_k": 180, "ann": 1750, "shape": "bimodal_eq", "t_mean": 22.0, "t_amp": 0.8, "t_peak": 2},
            {"name": "Cauca",     "station": "Popayán",   "prod_mt_k": 120, "ann": 2000, "shape": "bimodal_eq", "t_mean": 19.0, "t_amp": 0.8, "t_peak": 2},
            {"name": "Caldas",    "station": "Manizales", "prod_mt_k": 110, "ann": 2050, "shape": "bimodal_eq", "t_mean": 18.0, "t_amp": 0.7, "t_peak": 2},
            {"name": "Nariño",    "station": "Pasto",     "prod_mt_k": 60,  "ann": 950,  "shape": "bimodal_eq", "t_mean": 14.0, "t_amp": 0.7, "t_peak": 2},
        ],
    },
    "honduras": {
        "label": "Honduras", "share_label": "Honduras arabica",
        "source_production": "IHCAFE 2024 departmental output (approx. weights)",
        "regions": [
            {"name": "El Paraíso",    "station": "Danlí",      "prod_mt_k": 220, "ann": 1100, "shape": "nh_summer", "t_mean": 22.0, "t_amp": 2.0, "t_peak": 4},
            {"name": "Copán",         "station": "Copán",      "prod_mt_k": 180, "ann": 1400, "shape": "nh_summer", "t_mean": 23.0, "t_amp": 2.0, "t_peak": 4},
            {"name": "Santa Bárbara", "station": "Sta Bárbara","prod_mt_k": 160, "ann": 1300, "shape": "nh_summer", "t_mean": 24.0, "t_amp": 2.1, "t_peak": 4},
            {"name": "Montecillos",   "station": "Marcala",    "prod_mt_k": 130, "ann": 1300, "shape": "nh_summer", "t_mean": 21.0, "t_amp": 1.9, "t_peak": 4},
            {"name": "Agalta",        "station": "Juticalpa",  "prod_mt_k": 90,  "ann": 1200, "shape": "nh_summer", "t_mean": 24.0, "t_amp": 2.0, "t_peak": 4},
        ],
    },
    "indonesia": {
        "label": "Indonesia", "share_label": "Indonesia robusta+arabica",
        "source_production": "USDA/AEKI 2024 regional output (approx. weights)",
        "regions": [
            {"name": "Lampung", "station": "Bandar Lampung", "prod_mt_k": 350, "ann": 2400, "shape": "sea_monsoon", "t_mean": 26.5, "t_amp": 0.7, "t_peak": 9},
            {"name": "Gayo",    "station": "Takengon",       "prod_mt_k": 120, "ann": 1800, "shape": "bimodal_eq",  "t_mean": 20.0, "t_amp": 0.6, "t_peak": 3},
            {"name": "Java",    "station": "Bondowoso",      "prod_mt_k": 110, "ann": 2000, "shape": "sea_monsoon", "t_mean": 22.0, "t_amp": 0.9, "t_peak": 9},
            {"name": "Toraja",  "station": "Rantepao",       "prod_mt_k": 70,  "ann": 2500, "shape": "bimodal_eq",  "t_mean": 21.0, "t_amp": 0.6, "t_peak": 9},
            {"name": "Flores",  "station": "Bajawa",         "prod_mt_k": 50,  "ann": 1600, "shape": "sea_monsoon", "t_mean": 22.0, "t_amp": 1.0, "t_peak": 10},
        ],
    },
    "uganda": {
        "label": "Uganda", "share_label": "Uganda robusta+arabica",
        "source_production": "UCDA 2024 regional output (approx. weights)",
        "regions": [
            {"name": "Masaka",   "station": "Masaka",      "prod_mt_k": 220, "ann": 1200, "shape": "bimodal_eq", "t_mean": 22.0, "t_amp": 0.9, "t_peak": 1},
            {"name": "Kasese",   "station": "Kasese",      "prod_mt_k": 140, "ann": 950,  "shape": "bimodal_eq", "t_mean": 24.0, "t_amp": 1.0, "t_peak": 1},
            {"name": "Rwenzori", "station": "Fort Portal", "prod_mt_k": 120, "ann": 1500, "shape": "bimodal_eq", "t_mean": 20.0, "t_amp": 0.8, "t_peak": 1},
            {"name": "Mbale",    "station": "Mbale",       "prod_mt_k": 110, "ann": 1300, "shape": "bimodal_eq", "t_mean": 22.0, "t_amp": 0.9, "t_peak": 1},
            {"name": "Mt Elgon", "station": "Sironko",     "prod_mt_k": 90,  "ann": 1500, "shape": "bimodal_eq", "t_mean": 19.0, "t_amp": 0.8, "t_peak": 1},
        ],
    },
    "ethiopia": {
        "label": "Ethiopia", "share_label": "Ethiopia arabica",
        "source_production": "ECX/USDA 2024 regional output (approx. weights)",
        "regions": [
            {"name": "Sidama/Yirgacheffe", "station": "Yirgacheffe", "prod_mt_k": 240, "ann": 1400, "shape": "eth_kiremt", "t_mean": 19.0, "t_amp": 1.6, "t_peak": 3},
            {"name": "Jimma", "station": "Jimma", "prod_mt_k": 180, "ann": 1500, "shape": "eth_kiremt", "t_mean": 20.0, "t_amp": 1.6, "t_peak": 3},
            {"name": "Limu",  "station": "Limu",  "prod_mt_k": 120, "ann": 1500, "shape": "eth_kiremt", "t_mean": 20.0, "t_amp": 1.6, "t_peak": 3},
            {"name": "Kaffa", "station": "Bonga", "prod_mt_k": 110, "ann": 1800, "shape": "eth_kiremt", "t_mean": 19.0, "t_amp": 1.5, "t_peak": 3},
            {"name": "Harrar","station": "Harar", "prod_mt_k": 90,  "ann": 900,  "shape": "eth_kiremt", "t_mean": 18.0, "t_amp": 1.8, "t_peak": 3},
        ],
    },
}


def _det(seed: str) -> float:
    """Deterministic pseudo-random in [0,1) from a string seed."""
    h = 0
    for ch in seed:
        h = (h * 131 + ord(ch)) & 0xFFFFFFFF
    return (h % 10000) / 10000.0


def r1(x: float) -> float:
    return round(x, 1)


def temp_month(rc: dict, m: int) -> float:
    """Smooth seasonal mean temperature for month m (0-indexed)."""
    return rc["t_mean"] + rc["t_amp"] * math.cos(2 * math.pi * (m - rc["t_peak"]) / 12)


def build_region(rc: dict, total_prod: int) -> dict:
    frac = _norm(SHAPES[rc["shape"]])
    avg_rain = [rc["ann"] * frac[m] for m in range(12)]

    # 10yr-style band and last-year actual (slightly wetter), as in Vietnam's seed.
    min_rain = [a * 0.55 for a in avg_rain]
    max_rain = [a * 1.5 for a in avg_rain]
    last_year_rain = [a * 1.06 for a in avg_rain]
    # Drought-risk threshold ≈ 20th percentile of the last-30yr distribution.
    # Rainfall is right-skewed, so P20 sits well below the mean (~0.70×normal).
    dry_warn = [a * 0.70 for a in avg_rain]

    # Current-year-to-date actuals: completed months + the partial current month.
    actual_rain = []
    for m in range(CUR_MONTH_IDX + 1):
        f = 0.82 + 0.36 * _det(f"{rc['name']}-r-{m}")  # within roughly the band
        val = avg_rain[m] * f
        if m == CUR_MONTH_IDX:  # partial month → scale to date
            val *= UPDATED.day / DAYS_IN_MONTH[m]
        actual_rain.append(val)

    avg_temp = [temp_month(rc, m) for m in range(12)]
    min_temp = [t - 2.2 for t in avg_temp]
    max_temp = [t + 2.8 for t in avg_temp]
    last_year_temp = [t + 0.5 for t in avg_temp]
    actual_temp = [avg_temp[m] + (_det(f"{rc['name']}-t-{m}") - 0.4) for m in range(CUR_MONTH_IDX + 1)]

    # Forecast: next 7 days of daily rain, scaled to the current month's daily rate.
    daily_rate = avg_rain[CUR_MONTH_IDX] / DAYS_IN_MONTH[CUR_MONTH_IDX]
    fc_rain = []
    for i in range(7):
        wet = _det(f"{rc['name']}-f-{i}")
        fc_rain.append(0.0 if wet < 0.35 else daily_rate * (0.5 + 3.0 * wet))

    return {
        "name": rc["name"], "station": rc["station"],
        "prod_mt_k": rc["prod_mt_k"],
        "weight": round(rc["prod_mt_k"] / total_prod, 3) if total_prod else 0.0,
        "monthly_avg_rain":        [round(x) for x in avg_rain],
        "monthly_min_rain":        [round(x) for x in min_rain],
        "monthly_max_rain":        [round(x) for x in max_rain],
        "monthly_dry_warn":        [round(x) for x in dry_warn],
        "monthly_last_year_rain":  [round(x) for x in last_year_rain],
        "monthly_actual_cur":      [r1(x) for x in actual_rain],
        "monthly_avg_temp":        [r1(x) for x in avg_temp],
        "monthly_min_temp":        [r1(x) for x in min_temp],
        "monthly_max_temp":        [r1(x) for x in max_temp],
        "monthly_last_year_temp":  [r1(x) for x in last_year_temp],
        "monthly_actual_temp_cur": [r1(x) for x in actual_temp],
        "forecast_7d_rain":        [r1(x) for x in fc_rain],
    }, avg_rain, avg_temp


def build_daily_station(rc_name: str, avg_rain: list[float], avg_temp: list[float]) -> list[dict]:
    """Day-by-day month-to-date accumulation for the reference station, summing
    toward the current month's normal pro-rated to date."""
    m = CUR_MONTH_IDX
    dim = DAYS_IN_MONTH[m]
    last_day = UPDATED.day
    month_norm = avg_rain[m]

    # Deterministic daily rain weights for the current year (wet/dry days).
    weights = []
    for d in range(1, last_day + 1):
        w = _det(f"{rc_name}-d-{d}")
        weights.append(0.0 if w < 0.45 else w)
    wsum = sum(weights) or 1.0
    mtd_total = month_norm * (last_day / dim) * 1.0  # ~normal pace
    daily_rain = [month_norm * (last_day / dim) * (w / wsum) for w in weights]

    # Emit every day of the month so the climatology band/avg/last-year lines
    # span the whole month (incl. the forecast window). Current-year accum is
    # null after the last actual day — the chart fills that gap with the
    # forecast projection.
    rows = []
    accum = 0.0
    for d in range(1, dim + 1):
        avg_accum = month_norm * (d / dim)
        if d <= last_day:
            accum += daily_rain[d - 1]
            rain_mm = r1(daily_rain[d - 1])
            accum_mm = r1(accum)
        else:
            rain_mm = 0.0
            accum_mm = None
        rows.append({
            "day": d,
            "rain_mm": rain_mm,
            "accum_mm": accum_mm,
            "avg_accum_mm": r1(avg_accum),
            "min_accum_mm": r1(avg_accum * 0.6),
            "max_accum_mm": r1(avg_accum * 1.5),
            "last_year_accum_mm": r1(avg_accum * 1.08),
            "temp_c": r1(avg_temp[m] + 3.0 - 6.0 * _det(f"{rc_name}-dt-{d}")),
        })
    return rows, mtd_total


def build_forecast_list(rc: dict, avg_rain: list[float], avg_temp: list[float]) -> list[dict]:
    m = CUR_MONTH_IDX
    daily_rate = avg_rain[m] / DAYS_IN_MONTH[m]
    out = []
    for i in range(7):
        d = UPDATED + dt.timedelta(days=i + 1)
        wet = _det(f"{rc['name']}-fl-{i}")
        rain = 0.0 if wet < 0.35 else daily_rate * (0.5 + 3.0 * wet)
        out.append({
            "date": d.isoformat(),
            "label": f"{MONTHS[d.month - 1]} {d.day}",
            "rain_mm": r1(rain),
            "temp_max_c": r1(avg_temp[m] + 4.0),
            "temp_min_c": r1(avg_temp[m] - 4.0),
        })
    return out


def build_origin(key: str) -> dict:
    cfg = ORIGINS[key]
    regions_cfg = cfg["regions"]
    total_prod = sum(r["prod_mt_k"] for r in regions_cfg)

    provinces = []
    ref_avg_rain = ref_avg_temp = None
    for i, rc in enumerate(regions_cfg):
        prov, avg_rain, avg_temp = build_region(rc, total_prod)
        provinces.append(prov)
        if i == 0:
            ref_avg_rain, ref_avg_temp = avg_rain, avg_temp
            ref_rc = rc

    daily_rows, mtd_total = build_daily_station(ref_rc["name"], ref_avg_rain, ref_avg_temp)
    # Keep the reference region's current-month actual consistent with the daily MTD.
    provinces[0]["monthly_actual_cur"][CUR_MONTH_IDX] = r1(mtd_total)
    forecast_7d = build_forecast_list(ref_rc, ref_avg_rain, ref_avg_temp)

    return {
        "_note": (
            "STATIC climatology seed (like vn_weather.json). Per-region arrays: "
            "avg=normal, min/max=10yr-style band, last_year=prior year, "
            f"actual_cur={CUR_YEAR} YTD. Daily = {ref_rc['station']} station current "
            "month. Synthesised from regional climate parameters — representative, "
            "not live. Replaceable by build_origin_weather.py (Open-Meteo) if allowlisted."
        ),
        "updated": UPDATED.isoformat(),
        "cur_year": CUR_YEAR,
        "last_year": LAST_YEAR,
        "label": cfg["label"],
        "share_label": cfg["share_label"],
        "station": ref_rc["station"],
        "source_production": cfg["source_production"],
        "source_weather": "Static climatology seed (regional normals) · synthesised",
        "provinces": provinces,
        "daily_station": daily_rows,
        "forecast_7d": forecast_7d,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--origins", nargs="*")
    args = ap.parse_args()

    selected = args.origins or list(ORIGINS.keys())
    print(f"[seed_origin_weather] {len(selected)} origins · updated {UPDATED.isoformat()}")
    for key in selected:
        if key not in ORIGINS:
            print(f"  [skip] unknown origin: {key}", file=sys.stderr)
            continue
        doc = build_origin(key)
        payload = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
        path = DATA_DIR / f"{key}_weather.json"
        if args.write:
            path.write_text(payload, encoding="utf-8")
            print(f"  [write] {path} ({len(doc['provinces'])} regions, "
                  f"{len(doc['daily_station'])} daily rows)")
        else:
            print(f"  [preview] {key}: {len(doc['provinces'])} regions, "
                  f"{len(doc['daily_station'])} daily rows")


if __name__ == "__main__":
    main()
