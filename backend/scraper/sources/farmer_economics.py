"""
Farmer Economics daily scraper.
Fetches: weather (Open-Meteo), ENSO/ONI (NOAA CPC), fertilizer prices (World Bank).
"""
from __future__ import annotations

import io
import json
from collections import defaultdict
from datetime import date, datetime

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGIONS = [
    {"name": "Sul de Minas",   "lat": -21.76, "lon": -45.25},
    {"name": "Cerrado",        "lat": -18.50, "lon": -47.50},
    {"name": "Paraná",         "lat": -23.55, "lon": -51.17},
    {"name": "Espírito Santo", "lat": -20.08, "lon": -41.37},
]

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&hourly=temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m,precipitation_probability"
    "&forecast_days=14&timezone=America/Sao_Paulo"
)

NOAA_ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"

WORLD_BANK_URL = (
    "https://thedocs.worldbank.org/en/doc/"
    "5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx"
)

# Season code → calendar month number
_SEASON_MONTH = {
    "DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4,
    "AMJ": 5, "MJJ": 6, "JJA": 7, "JAS": 8,
    "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12,
}

_MONTH_ABBR = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}

# ---------------------------------------------------------------------------
# Pure parsing helpers (no I/O, fully testable)
# ---------------------------------------------------------------------------

def _frost_risk(min_temp: float) -> str:
    """Return H/M/L/- frost risk based on minimum temperature (°C)."""
    if min_temp < 4:
        return "H"
    if min_temp < 8:
        return "M"
    if min_temp < 12:
        return "L"
    return "-"


def _drought_risk(precip_prob: float) -> str:
    """Return H/M/L/- drought risk based on max precipitation probability (%)."""
    if precip_prob < 15:
        return "H"
    if precip_prob < 35:
        return "M"
    if precip_prob < 60:
        return "L"
    return "-"


def _aggregate_hourly_to_daily(hourly: dict) -> list[dict]:
    """
    Aggregate Open-Meteo hourly data into daily dicts.

    Expected hourly keys:
        time, temperature_2m, dew_point_2m, cloud_cover,
        wind_speed_10m, precipitation_probability

    Returns a list of dicts, one per calendar day present in the data.
    Each dict: {date, min_temp, max_temp, dew_point, cloud_cover,
                wind_speed, precip_prob, frost_risk, drought_risk}
    """
    times = hourly["time"]
    temp   = hourly["temperature_2m"]
    dew    = hourly["dew_point_2m"]
    cloud  = hourly["cloud_cover"]
    wind   = hourly["wind_speed_10m"]
    precip = hourly["precipitation_probability"]

    # Group indices by calendar date (first 10 chars of ISO timestamp)
    day_indices: dict[str, list[int]] = defaultdict(list)
    for i, ts in enumerate(times):
        day_indices[ts[:10]].append(i)

    days = []
    for day_str in sorted(day_indices):
        idxs = day_indices[day_str]
        temps_day  = [v for v in (temp[i]   for i in idxs) if v is not None]
        dew_day    = [v for v in (dew[i]    for i in idxs) if v is not None]
        cloud_day  = [v for v in (cloud[i]  for i in idxs) if v is not None]
        wind_day   = [v for v in (wind[i]   for i in idxs) if v is not None]
        precip_day = [v for v in (precip[i] for i in idxs) if v is not None]

        if not temps_day:
            continue

        min_t  = min(temps_day)
        max_t  = max(temps_day)
        pp_max = max(precip_day) if precip_day else 0.0

        days.append({
            "date":         day_str,
            "min_temp":     round(min_t, 1),
            "max_temp":     round(max_t, 1),
            "dew_point":    round(sum(dew_day)   / len(dew_day),   1) if dew_day   else 0.0,
            "cloud_cover":  round(sum(cloud_day)  / len(cloud_day), 1) if cloud_day else 0.0,
            "wind_speed":   round(max(wind_day), 1) if wind_day else 0.0,
            "precip_prob":  round(pp_max, 1),
            "frost_risk":   _frost_risk(min_t),
            "drought_risk": _drought_risk(pp_max),
        })

    return days


def _parse_oni_text(text: str) -> list[dict]:
    """
    Parse the NOAA CPC ONI plain-text file.

    Format:
        SEAS YR TOTAL ANOM
        DJF 2024 0.5 1.2
        ...

    The last 3 data rows are treated as forecasts.
    Returns last 15 history rows + up to 3 forecast rows.
    """
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("SEAS"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        seas, yr, _total, anom = parts[0], parts[1], parts[2], parts[3]
        if seas not in _SEASON_MONTH:
            continue
        month_num = _SEASON_MONTH[seas]
        year_2d   = int(yr) % 100
        label     = f"{_MONTH_ABBR[month_num]}-{year_2d:02d}"
        rows.append({"month": label, "value": float(anom)})

    if not rows:
        return []

    # Last 3 = forecast
    N_FORECAST = 3
    if len(rows) <= N_FORECAST:
        # Too few rows to split — return all as history
        return [{"month": r["month"], "value": r["value"]} for r in rows]
    history_rows  = rows[:-N_FORECAST][-15:]
    forecast_rows = rows[-N_FORECAST:]

    for r in forecast_rows:
        r["forecast"] = True

    return history_rows + forecast_rows


# ---------------------------------------------------------------------------
# DB-writing functions
# ---------------------------------------------------------------------------

def _scrape_weather(db) -> None:
    """Fetch 14-day hourly forecast for each region, aggregate to daily, upsert."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from models import WeatherSnapshot
    from sqlalchemy import delete

    for region in REGIONS:
        url = OPEN_METEO_URL.format(lat=region["lat"], lon=region["lon"])
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            hourly = data.get("hourly", {})
            daily_data = _aggregate_hourly_to_daily(hourly)

            db.execute(delete(WeatherSnapshot).where(WeatherSnapshot.region == region["name"]))
            db.add(WeatherSnapshot(region=region["name"], daily_data=daily_data, scraped_at=datetime.utcnow()))
            db.commit()
            print(f"[farmer_economics] weather OK: {region['name']} ({len(daily_data)} days)")
        except Exception as e:
            db.rollback()
            print(f"[farmer_economics] weather FAILED for {region['name']}: {e}")


def _scrape_enso(db) -> None:
    """Fetch NOAA ONI text, parse, store in NewsItem."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from models import NewsItem
    from sqlalchemy import delete

    try:
        resp = requests.get(NOAA_ONI_URL, timeout=30)
        resp.raise_for_status()
        oni_history = _parse_oni_text(resp.text)

        db.execute(delete(NewsItem).where(NewsItem.source == "NOAA CPC"))
        db.add(NewsItem(
            title=f"ENSO ONI – {date.today():%Y-%m}",
            source="NOAA CPC",
            category="supply",
            tags=["enso", "supply", "brazil"],
            meta=json.dumps({"oni_history": oni_history}),
            pub_date=datetime.utcnow(),
        ))
        db.commit()
        print(f"[farmer_economics] ENSO OK ({len(oni_history)} rows)")
    except Exception as e:
        db.rollback()
        print(f"[farmer_economics] ENSO FAILED: {e}")


def _parse_world_bank_excel(content: bytes) -> dict:
    """Parse World Bank CMO Pink Sheet Excel.

    The sheet is wide-format:
      - Row 4 (0-indexed): commodity header labels across columns
      - Column A (index 0): month strings like "2024M12"
      - Data at intersections

    Returns {"urea_monthly": [...7 vals...], "dap_monthly": [...], "kcl_monthly": [...]}.
    """
    import re
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)

    if "Monthly Prices" not in wb.sheetnames:
        raise ValueError(f"Sheet 'Monthly Prices' not found. Available: {wb.sheetnames}")

    ws = wb["Monthly Prices"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # Step 1: find the header row — the row that contains "DAP" somewhere
    header_row_idx = None
    for i, row in enumerate(rows):
        for cell in row:
            if isinstance(cell, str) and cell.strip().upper() == "DAP":
                header_row_idx = i
                break
        if header_row_idx is not None:
            break

    if header_row_idx is None:
        return {"urea_monthly": [], "dap_monthly": [], "kcl_monthly": []}

    header = rows[header_row_idx]

    # Step 2: find column indices for Urea, DAP, KCl
    col_map: dict[str, int] = {}
    for i, cell in enumerate(header):
        if not isinstance(cell, str):
            continue
        s = cell.strip().lower()
        if s == "urea" and "urea" not in col_map:
            col_map["urea"] = i
        elif s == "dap" and "dap" not in col_map:
            col_map["dap"] = i
        elif s.startswith("potassium chloride") and "kcl" not in col_map:
            col_map["kcl"] = i

    if not col_map:
        return {"urea_monthly": [], "dap_monthly": [], "kcl_monthly": []}

    # Step 3: collect data rows — column A matches "YYYYMxx"
    month_re = re.compile(r"^\d{4}M\d{2}$")
    data_rows = [
        row for row in rows[header_row_idx + 1:]
        if row and isinstance(row[0], str) and month_re.match(row[0].strip())
    ]

    # Step 4: extract last 7 numeric values per commodity
    def _extract(key: str) -> list[float]:
        if key not in col_map:
            return []
        col = col_map[key]
        vals = []
        for row in data_rows:
            v = row[col] if col < len(row) else None
            if isinstance(v, (int, float)) and v is not None:
                vals.append(float(v))
        return vals[-7:] if len(vals) >= 7 else vals

    return {
        "urea_monthly": _extract("urea"),
        "dap_monthly":  _extract("dap"),
        "kcl_monthly":  _extract("kcl"),
    }


def _scrape_fertilizer_prices(db) -> None:
    """Download World Bank Excel, extract last 7 monthly values for urea/DAP/KCl."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from models import NewsItem
    from sqlalchemy import delete

    try:
        resp = requests.get(WORLD_BANK_URL, timeout=120)
        resp.raise_for_status()
        parsed = _parse_world_bank_excel(resp.content)

        db.execute(delete(NewsItem).where(NewsItem.source == "World Bank"))
        db.add(NewsItem(
            title=f"Fertilizer Prices – {date.today():%Y-%m}",
            source="World Bank",
            category="supply",
            tags=["fertilizer", "price", "supply", "brazil"],
            meta=json.dumps(parsed),
            pub_date=datetime.utcnow(),
        ))
        db.commit()
        print(f"[farmer_economics] fertilizer OK — keys: {[k for k, v in parsed.items() if v]}")
    except Exception as e:
        db.rollback()
        print(f"[farmer_economics] fertilizer FAILED: {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def run(page, db) -> None:
    """
    Entry point called from main.py.
    `page` is a Playwright page (unused here; kept for signature consistency).
    """
    _scrape_weather(db)
    _scrape_enso(db)
    _scrape_fertilizer_prices(db)
