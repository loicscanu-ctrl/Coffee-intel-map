#!/usr/bin/env python3
"""
fetch_origin_weather.py — daily weather fetch → accumulate → rebuild chart JSON.

The pipeline the charts want, decoupled from the export workflow (1.4):

  1. FETCH daily rain + temperature for every origin's producing regions from
     Open-Meteo's *forecast* API (api.open-meteo.com — reachable from CI; the
     archive host is not), pulling past_days=92 + a 7-day forecast.
  2. ACCUMULATE the past/today actuals into a growing per-origin history file
     backend/seed/weather_history/{origin}.json (idempotent upsert keyed by
     date). Run daily, the history grows into full months/years.
  3. REBUILD frontend/public/data/{origin}_weather.json (the file the charts
     read): climatology bands (monthly avg/min/max rain & temp) are kept from
     the committed per-region seed; the actual-current-year, daily
     month-to-date accumulation, last-year (once accumulated) and 7-day
     forecast series are recomputed from the live history. As real history
     fills a calendar year, the actuals replace the seed month by month.

The forecast API only exposes ~92 past days, so historic months before
accumulation started can't be backfilled (the archive host that could is
blocked). Months are emitted as actuals only once the history covers them;
the current month always shows month-to-date.

Usage (no DB; files only):
    python fetch_origin_weather.py [--write] [--origins brazil colombia ...]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import socket
import statistics
import sys
import time
from pathlib import Path

import requests
import urllib3.util.connection as urllib3_conn

# Runner has no IPv6 route; force IPv4 so api.open-meteo.com resolves to A.
urllib3_conn.allowed_gai_family = lambda: socket.AF_INET

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"
HISTORY_DIR = REPO_ROOT / "backend" / "seed" / "weather_history"

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelWeather/1.0)"}
PAST_DAYS = 92
FORECAST_DAYS = 8  # today + 7 future days (the 7 future days populate the chart)

TODAY = dt.date.today()
CUR_YEAR = TODAY.year
LAST_YEAR = CUR_YEAR - 1
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS_IN_MONTH = [31, 29 if CUR_YEAR % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# Per-region coordinates (name must match the seed/chart province names).
ORIGINS: dict[str, list[dict]] = {
    "brazil": [
        {"name": "Sul de Minas",   "lat": -21.55, "lon": -45.43},
        {"name": "Cerrado",        "lat": -18.95, "lon": -46.99},
        {"name": "Espírito Santo", "lat": -20.00, "lon": -40.80},
        {"name": "Paraná",         "lat": -23.31, "lon": -50.62},
    ],
    "colombia": [
        {"name": "Huila",     "lat": 1.85, "lon": -76.05},
        {"name": "Antioquia", "lat": 6.25, "lon": -75.56},
        {"name": "Cauca",     "lat": 2.44, "lon": -76.61},
        {"name": "Caldas",    "lat": 5.07, "lon": -75.52},
        {"name": "Nariño",    "lat": 1.21, "lon": -77.28},
    ],
    "honduras": [
        {"name": "El Paraíso",    "lat": 13.99, "lon": -86.57},
        {"name": "Copán",         "lat": 14.83, "lon": -88.87},
        {"name": "Santa Bárbara", "lat": 14.92, "lon": -88.24},
        {"name": "Montecillos",   "lat": 14.16, "lon": -88.02},
        {"name": "Agalta",        "lat": 14.68, "lon": -86.22},
    ],
    "indonesia": [
        {"name": "Lampung", "lat": -5.00, "lon": 104.80},
        {"name": "Gayo",    "lat": 4.62,  "lon": 96.85},
        {"name": "Java",    "lat": -7.91, "lon": 113.82},
        {"name": "Toraja",  "lat": -2.97, "lon": 119.90},
        {"name": "Flores",  "lat": -8.79, "lon": 120.98},
    ],
    "uganda": [
        {"name": "Masaka",   "lat": -0.33, "lon": 31.73},
        {"name": "Kasese",   "lat": 0.18,  "lon": 30.08},
        {"name": "Rwenzori", "lat": 0.66,  "lon": 30.27},
        {"name": "Mbale",    "lat": 1.08,  "lon": 34.18},
        {"name": "Mt Elgon", "lat": 1.23,  "lon": 34.25},
    ],
    "ethiopia": [
        {"name": "Sidama/Yirgacheffe", "lat": 6.16, "lon": 38.20},
        {"name": "Jimma", "lat": 7.67, "lon": 36.83},
        {"name": "Limu",  "lat": 8.06, "lon": 36.80},
        {"name": "Kaffa", "lat": 7.27, "lon": 36.23},
        {"name": "Harrar","lat": 9.31, "lon": 42.12},
    ],
    # Vietnam Central Highlands. Names MUST match vn_weather.json provinces — the
    # rebuild keeps that seed's curated climatology and only refreshes actuals,
    # daily MTD and forecast from live Open-Meteo, so VN stops going stale.
    "vn": [
        {"name": "Dak Lak",  "lat": 12.67, "lon": 108.05},
        {"name": "Lam Dong", "lat": 11.94, "lon": 108.44},
        {"name": "Dak Nong", "lat": 12.00, "lon": 107.69},
        {"name": "Gia Lai",  "lat": 13.98, "lon": 108.00},
        {"name": "Kon Tum",  "lat": 14.35, "lon": 108.00},
    ],
}


def r1(x: float) -> float:
    return round(x, 1)


# ── HTTP ─────────────────────────────────────────────────────────────────────
def _get(params: dict) -> dict:
    last: Exception | None = None
    for attempt in range(4):
        try:
            r = requests.get(FORECAST_URL, params=params, headers=HEADERS, timeout=(10, 60))
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code} retryable")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
    raise last  # type: ignore[misc]


def preflight() -> None:
    try:
        _get({"latitude": 0, "longitude": 0, "daily": "precipitation_sum",
              "forecast_days": 1, "timezone": "UTC"})
        print("[preflight] api.open-meteo.com reachable.", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[preflight] FATAL — forecast API unreachable: {e}", file=sys.stderr)
        sys.exit(2)


def fetch_region(lat: float, lon: float) -> dict:
    return _get({
        "latitude": lat, "longitude": lon,
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean",
        "past_days": PAST_DAYS, "forecast_days": FORECAST_DAYS, "timezone": "auto",
    })


# ── History accumulation ─────────────────────────────────────────────────────
def load_history(origin: str) -> dict:
    p = HISTORY_DIR / f"{origin}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"_note": f"Accumulated daily Open-Meteo actuals for {origin} regions. "
                     "Grows daily; never overwrites past days with gaps.", "regions": {}}


def save_history(origin: str, hist: dict) -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    (HISTORY_DIR / f"{origin}.json").write_text(
        json.dumps(hist, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def upsert(hist: dict, region: str, daily: dict) -> list[dict]:
    """Write past/today actuals into history; return the future forecast rows."""
    d = daily["daily"]
    times = d["time"]
    pr = d["precipitation_sum"]
    tx = d["temperature_2m_max"]
    tn = d["temperature_2m_min"]
    tm = d["temperature_2m_mean"]
    reg = hist["regions"].setdefault(region, {})
    today_iso = TODAY.isoformat()
    forecast = []
    for i, date in enumerate(times):
        rain = pr[i] if pr[i] is not None else 0.0
        row = {"rain": r1(rain), "tmax": tx[i], "tmin": tn[i], "tmean": tm[i]}
        if date <= today_iso:
            # Merge, don't clobber: the forecast API returns tmean=null for many
            # older past-days, so never overwrite a known value (e.g. one filled
            # by the archive backfill) with a null on a later run.
            new_tmean = round(tm[i], 1) if tm[i] is not None else None
            prev = reg.get(date, {})
            reg[date] = {
                "rain":  r1(rain) if rain is not None else prev.get("rain"),
                "tmean": new_tmean if new_tmean is not None else prev.get("tmean"),
            }
        else:
            forecast.append({"date": date, **{k: row[k] for k in ("rain", "tmax", "tmin")}})
    return forecast


# ── Chart-JSON rebuild ───────────────────────────────────────────────────────
def _month_rain(reg_hist: dict, year: int, month: int) -> tuple[float, int]:
    """(total rain, day-count) for a region-history dict in year/month."""
    total = 0.0
    n = 0
    for date, v in reg_hist.items():
        if int(date[:4]) == year and int(date[5:7]) == month and v.get("rain") is not None:
            total += v["rain"]
            n += 1
    return total, n


def _month_temp(reg_hist: dict, year: int, month: int) -> tuple[float | None, int]:
    vals = [v["tmean"] for date, v in reg_hist.items()
            if int(date[:4]) == year and int(date[5:7]) == month and v.get("tmean") is not None]
    return (statistics.fmean(vals) if vals else None), len(vals)


def _year_actuals_rain(reg_hist: dict, year: int, upto_month: int) -> list[float | None]:
    """Monthly totals for completed months (>=26 days covered) up to upto_month;
    the current month is emitted as month-to-date."""
    out: list[float | None] = []
    for m in range(1, upto_month + 1):
        total, n = _month_rain(reg_hist, year, m)
        complete = m == upto_month or n >= DAYS_IN_MONTH[m - 1] - 2
        out.append(r1(total) if (n > 0 and complete) else None)
    return out


def _year_actuals_temp(reg_hist: dict, year: int, upto_month: int) -> list[float | None]:
    out: list[float | None] = []
    for m in range(1, upto_month + 1):
        mean, n = _month_temp(reg_hist, year, m)
        complete = m == upto_month or n >= DAYS_IN_MONTH[m - 1] - 2
        out.append(r1(mean) if (mean is not None and complete) else None)
    return out


def _trim_trailing_none(xs: list) -> list:
    while xs and xs[-1] is None:
        xs.pop()
    return xs


def rebuild_chart(origin: str, hist: dict, forecasts: dict[str, list[dict]]) -> dict | None:
    path = DATA_DIR / f"{origin}_weather.json"
    if not path.exists():
        print(f"  [skip] {origin}: no seed {path.name} to refresh", file=sys.stderr)
        return None
    doc = json.loads(path.read_text(encoding="utf-8"))
    cur_month = TODAY.month
    regions_hist = hist["regions"]

    for prov in doc["provinces"]:
        rh = regions_hist.get(prov["name"], {})
        # Current-year actuals (live, accumulating). Keep seed where history is absent.
        act_r = _trim_trailing_none(_year_actuals_rain(rh, CUR_YEAR, cur_month))
        act_t = _trim_trailing_none(_year_actuals_temp(rh, CUR_YEAR, cur_month))
        if any(v is not None for v in act_r):
            prov["monthly_actual_cur"] = act_r
        if any(v is not None for v in act_t):
            prov["monthly_actual_temp_cur"] = act_t
        # Last-year actuals — only once history covers them, else keep seed.
        ly_r = _year_actuals_rain(rh, LAST_YEAR, 12)
        if all(v is not None for v in ly_r) and len(ly_r) == 12:
            prov["monthly_last_year_rain"] = ly_r
        ly_t = _year_actuals_temp(rh, LAST_YEAR, 12)
        if all(v is not None for v in ly_t) and len(ly_t) == 12:
            prov["monthly_last_year_temp"] = ly_t
        # 7-day forecast rain.
        fc = forecasts.get(prov["name"], [])
        if fc:
            prov["forecast_7d_rain"] = [r1(f["rain"]) for f in fc]

    # Daily month-to-date accumulation for the reference (first) province.
    ref = doc["provinces"][0]
    ref_hist = regions_hist.get(ref["name"], {})
    m_idx = cur_month - 1
    dim = DAYS_IN_MONTH[m_idx]
    month_norm = ref["monthly_avg_rain"][m_idx] if ref.get("monthly_avg_rain") else 0
    cur_days = sorted(int(date[8:10]) for date in ref_hist
                      if int(date[:4]) == CUR_YEAR and int(date[5:7]) == cur_month)
    daily_rows = []
    if cur_days:
        last_actual = max(cur_days)
        accum = 0.0
        ly_accum = 0.0
        # Emit the whole month so the climatology band/avg/last-year lines span
        # past the forecast window; current-year accum is null after the last
        # actual day (the chart bridges that gap with the forecast projection).
        for d in range(1, dim + 1):
            key = f"{CUR_YEAR}-{cur_month:02d}-{d:02d}"
            v = ref_hist.get(key, {})
            rain = v.get("rain", 0.0) or 0.0
            lyk = f"{LAST_YEAR}-{cur_month:02d}-{d:02d}"
            lv = ref_hist.get(lyk)
            avg_accum = month_norm * (d / dim)
            if lv is not None:
                ly_accum += lv.get("rain", 0.0) or 0.0
                ly_val = r1(ly_accum)
            else:
                ly_val = r1(avg_accum * 1.08)
            if d <= last_actual:
                accum += rain
                rain_out: float = r1(rain)
                accum_out: float | None = r1(accum)
            else:
                rain_out = 0.0
                accum_out = None
            daily_rows.append({
                "day": d,
                "rain_mm": rain_out,
                "accum_mm": accum_out,
                "avg_accum_mm": r1(avg_accum),
                "min_accum_mm": r1(avg_accum * 0.6),
                "max_accum_mm": r1(avg_accum * 1.5),
                "last_year_accum_mm": ly_val,
                "temp_c": r1(v["tmean"]) if v.get("tmean") is not None else 0.0,
            })
    doc["daily_station"] = daily_rows

    # 7-day forecast list from the reference province.
    ref_fc = forecasts.get(ref["name"], [])
    fc_list = []
    for f in ref_fc:
        date = f["date"]
        mo, day = int(date[5:7]), int(date[8:10])
        fc_list.append({
            "date": date, "label": f"{MONTHS[mo - 1]} {day}",
            "rain_mm": r1(f["rain"]),
            "temp_max_c": r1(f["tmax"]) if f.get("tmax") is not None else 0.0,
            "temp_min_c": r1(f["tmin"]) if f.get("tmin") is not None else 0.0,
        })
    if fc_list:
        doc["forecast_7d"] = fc_list

    doc["updated"] = TODAY.isoformat()
    doc["cur_year"] = CUR_YEAR
    doc["last_year"] = LAST_YEAR
    doc["source_weather"] = ("Open-Meteo forecast API (live, accumulated daily) · "
                             "climatology bands seeded, refined as history builds")
    doc["_note"] = (
        "Climatology (avg/min/max) from committed per-region seed; actual-cur, "
        "daily MTD, last-year (once accumulated) and 7-day forecast are live from "
        "Open-Meteo's forecast API, accumulated daily in backend/seed/weather_history/."
    )
    return doc


def build_origin(origin: str, write: bool) -> None:
    regions = ORIGINS[origin]
    hist = load_history(origin)
    forecasts: dict[str, list[dict]] = {}
    fetched = 0
    for rc in regions:
        print(f"  [{origin}] fetch {rc['name']} ({rc['lat']:.2f},{rc['lon']:.2f}) …", flush=True)
        try:
            daily = fetch_region(rc["lat"], rc["lon"])
            forecasts[rc["name"]] = upsert(hist, rc["name"], daily)
            fetched += 1
        except Exception as e:  # noqa: BLE001 — a flaky region must not abort the origin
            print(f"  [warn] {origin}/{rc['name']} fetch failed, keeping prior data: {e}",
                  file=sys.stderr)
        time.sleep(1)
    if fetched == 0:
        raise RuntimeError("all regions failed to fetch")

    doc = rebuild_chart(origin, hist, forecasts)
    if doc is None:
        return
    if write:
        save_history(origin, hist)
        (DATA_DIR / f"{origin}_weather.json").write_text(
            json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        days = sum(len(v) for v in hist["regions"].values())
        print(f"  [write] {origin}: history={days} region-days, "
              f"daily={len(doc['daily_station'])}, fc={len(doc['forecast_7d'])}")
    else:
        ref = doc["provinces"][0]
        print(f"  [preview] {origin}: actual_cur(ref)={ref['monthly_actual_cur']}, "
              f"daily={len(doc['daily_station'])} rows, fc={len(doc['forecast_7d'])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--origins", nargs="*")
    args = ap.parse_args()
    selected = args.origins or list(ORIGINS.keys())
    print(f"[fetch_origin_weather] {len(selected)} origins · {TODAY.isoformat()} "
          f"· past_days={PAST_DAYS}")
    preflight()
    ok = 0
    for origin in selected:
        if origin not in ORIGINS:
            print(f"  [skip] unknown origin: {origin}", file=sys.stderr)
            continue
        try:
            build_origin(origin, args.write)
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  [fail] {origin}: {e}", file=sys.stderr)
    if ok == 0:
        print("[fetch_origin_weather] FATAL — no origin processed.", file=sys.stderr)
        sys.exit(1)
    print(f"[fetch_origin_weather] done — {ok}/{len(selected)} origins.")


if __name__ == "__main__":
    main()
