"""
export_static_json.py
Queries the database and exports static JSON files consumed directly by the
Vercel frontend — eliminating the need for a live Render API call at page load.

Writes to frontend/public/data/:
  futures_chain.json   — Daily Quotes chain tables (arabica + robusta)
  oi_fnd_chart.json    — OI evolution to FND (both markets)
  oi_history.json      — 7-day OI tracking tables (mirrors /data/oi_history.json)
  cot.json             — COT weekly data (same shape as /api/cot)
  macro_cot.json       — Multi-commodity COT (same shape as /api/macro-cot)
  freight.json         — Freight rates + history (same shape as /api/freight)
  farmer_economics.json — Brazil Farmer Economics tab (weather, ENSO, cost, acreage, fertilizer)

Run after any scraper that updates the relevant tables:
    cd backend
    python -m scraper.export_static_json
"""

import json
import re
import sys
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cot_schema import serialize_cot_row
from database import SessionLocal
from models import NewsItem, CotWeekly, CommodityCot, CommodityPrice, FreightRate, WeatherSnapshot, FertilizerImport, PhysicalPrice
from scraper.sources.macro_cot import COMMODITY_SPECS
from scraper.validate_export import (
    safe_write_json,
    validate_futures_chain,
    validate_oi_fnd_chart,
    validate_cot,
    validate_cot_recent,
    validate_macro_cot,
    validate_freight,
    validate_farmer_economics,
    validate_health,
)

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── helpers shared with routes/futures.py ────────────────────────────────────

LETTER_TO_MONTH = {
    "F":1,"G":2,"H":3,"J":4,"K":5,"M":6,
    "N":7,"Q":8,"U":9,"V":10,"X":11,"Z":12,
}

def _first_biz_day(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d

def _sub_biz_days(d: date, n: int) -> date:
    remaining = n
    while remaining > 0:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            remaining -= 1
    return d

def _calc_fnd(symbol: str):
    m = re.match(r'^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$', symbol, re.I)
    if not m:
        return None
    product, letter, yr = m.group(1), m.group(2).upper(), int(m.group(3))
    month_num = LETTER_TO_MONTH.get(letter)
    if not month_num:
        return None
    days_before = 7 if product.upper() == "KC" else 4
    return _sub_biz_days(_first_biz_day(2000 + yr, month_num), days_before)

def _trading_days_to(d1: date, fnd: date) -> int:
    if d1 >= fnd:
        return 0
    count, cur = 0, d1
    while cur < fnd:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return -count


# ── 1. Futures chain (Daily Quotes) ──────────────────────────────────────────

def export_futures_chain(db) -> None:
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None))
        .order_by(NewsItem.pub_date.desc())
        .all()
    )

    result = {}
    for market in ("arabica", "robusta"):
        item = next(
            (i for i in all_items
             if "futures" in (i.tags or [])
             and "price"   in (i.tags or [])
             and market     in (i.tags or [])
             and "b3"   not in (i.tags or [])
             and json.loads(i.meta or "{}").get("contracts")),
            None,
        )
        if not item:
            result[market] = None
            continue
        try:
            meta     = json.loads(item.meta or "{}")
            date_str = (
                item.title.split("–")[-1].strip()
                if "–" in item.title
                else str(item.pub_date)[:10]
            )
            # quote_date (T-1) is the display date for Daily Quotes;
            # date_str from the title is the T-2 trade date used by OI history.
            pub_date = meta.get("quote_date") or date_str
            result[market] = {
                "pub_date":  pub_date,
                "contracts": meta.get("contracts", []),
            }
        except Exception:
            result[market] = None

    path = OUT_DIR / "futures_chain.json"
    written = safe_write_json(path, result, validate_futures_chain)
    print(f"  futures_chain.json → written:{written} arabica:{result['arabica'] is not None} robusta:{result['robusta'] is not None}")


# ── 2. OI FND chart ──────────────────────────────────────────────────────────

def export_oi_fnd_chart(db) -> None:
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None))
        .order_by(NewsItem.pub_date.asc())
        .all()
    )

    today     = date.today()
    cur_yr    = str(today.year)[-2:]
    prev_yr   = str(today.year - 1)[-2:]
    allowed   = {cur_yr, prev_yr}

    result = {}
    for market in ("arabica", "robusta"):
        chain_items = [
            i for i in all_items
            if "futures" in (i.tags or [])
            and "price"   in (i.tags or [])
            and market     in (i.tags or [])
        ]
        series: dict[str, list] = {}
        for item in chain_items:
            try:
                meta       = json.loads(item.meta or "{}")
                trade_date = date.fromisoformat(
                    item.title.split("–")[-1].strip()
                    if "–" in item.title
                    else str(item.pub_date)[:10]
                )
                for c in meta.get("contracts", []):
                    sym = c.get("symbol", "")
                    fnd = _calc_fnd(sym)
                    if not fnd:
                        continue
                    day_val = _trading_days_to(trade_date, fnd)
                    if day_val < -30 or day_val > 0:
                        continue
                    series.setdefault(sym, []).append({"day": day_val, "oi": c.get("oi", 0)})
            except Exception:
                pass

        candidates = []
        for sym, points in series.items():
            if sym[-2:] not in allowed:
                continue
            fnd = _calc_fnd(sym)
            if not fnd:
                continue
            candidates.append({
                "symbol": sym,
                "label":  sym.replace("RM", "").replace("KC", ""),
                "fnd":    fnd.isoformat(),
                "data":   sorted(points, key=lambda x: x["day"]),
            })
        candidates.sort(key=lambda x: x["fnd"])
        result[market] = candidates

    path = OUT_DIR / "oi_fnd_chart.json"
    written = safe_write_json(path, result, validate_oi_fnd_chart)
    print(f"  oi_fnd_chart.json → written:{written} arabica:{len(result['arabica'])} robusta:{len(result['robusta'])} series")


# ── 3. OI History (copy from /data/oi_history.json) ──────────────────────────

def export_oi_history() -> None:
    src = ROOT / "data" / "oi_history.json"
    dst = OUT_DIR / "oi_history.json"
    if src.exists():
        shutil.copy2(src, dst)
        print(f"  oi_history.json → copied from {src.name}")
    else:
        print(f"  oi_history.json → source not found ({src}), skipping")


# ── 4. COT weekly ─────────────────────────────────────────────────────────────

def export_cot(db) -> None:
    rows = db.query(CotWeekly).order_by(CotWeekly.date.asc()).all()
    merged: dict = {}
    for row in rows:
        d = row.date.isoformat()
        if d not in merged:
            merged[d] = {"date": d, "ny": None, "ldn": None}
        # include_crop_split=True keeps the NY-only old/other crop fields
        # that the CotDashboard frontend expects in cot.json.
        merged[d][row.market] = serialize_cot_row(row, include_crop_split=True)
    result = sorted(merged.values(), key=lambda x: x["date"])

    path = OUT_DIR / "cot.json"
    written = safe_write_json(path, result, validate_cot)
    print(f"  cot.json → written:{written} {len(result)} weeks")

    recent = result[-12:]
    path_r = OUT_DIR / "cot_recent.json"
    written_r = safe_write_json(path_r, recent, validate_cot_recent)
    print(f"  cot_recent.json → written:{written_r} {len(recent)} weeks (tail)")


# ── 5. Macro COT ─────────────────────────────────────────────────────────────

def export_macro_cot(db) -> None:
    cutoff = date.today() - timedelta(weeks=52)
    cot_rows = (
        db.query(CommodityCot)
        .filter(CommodityCot.date > cutoff)
        .order_by(CommodityCot.date.asc())
        .all()
    )
    price_rows = (
        db.query(CommodityPrice)
        .filter(CommodityPrice.date > cutoff)
        .all()
    )
    price_map = {(p.date, p.symbol): p.close_price for p in price_rows}
    symbol_latest: dict = {}
    for p in price_rows:
        if p.close_price is not None:
            if p.symbol not in symbol_latest or p.date > symbol_latest[p.symbol][0]:
                symbol_latest[p.symbol] = (p.date, p.close_price)

    weeks: dict = {}
    for row in cot_rows:
        spec = COMMODITY_SPECS.get(row.symbol)
        if spec is None:
            continue
        mm_long   = row.mm_long   or 0
        mm_short  = row.mm_short  or 0
        mm_spread = row.mm_spread or 0
        close_price = price_map.get((row.date, row.symbol))
        if close_price is None:
            latest = symbol_latest.get(row.symbol)
            if latest and abs((row.date - latest[0]).days) <= 14:
                close_price = latest[1]

        cv = close_price * spec["contract_unit"] if close_price else None
        entry = {
            "symbol":             row.symbol,
            "sector":             spec["sector"],
            "name":               spec["name"],
            "mm_long":            mm_long,
            "mm_short":           mm_short,
            "mm_spread":          mm_spread,
            "oi_total":           row.oi_total or 0,
            "close_price":        close_price,
            "gross_exposure_usd": (mm_long + mm_short) * cv if cv else None,
            "net_exposure_usd":   (mm_long - mm_short) * cv if cv else None,
        }
        weeks.setdefault(row.date, []).append(entry)

    result = [
        {"date": d.isoformat(), "commodities": weeks[d]}
        for d in sorted(weeks.keys())
    ]

    path = OUT_DIR / "macro_cot.json"
    written = safe_write_json(path, result, validate_macro_cot)
    print(f"  macro_cot.json → written:{written} {len(result)} weeks")


# ── 6. Freight ───────────────────────────────────────────────────────────────

ROUTE_CONFIG = [
    ("vn-eu",  "Ho Chi Minh", "Rotterdam",   "FBX11", 1.00, False),
    ("vn-ham", "Ho Chi Minh", "Hamburg",     "FBX11", 1.02, False),
    ("vn-us",  "Ho Chi Minh", "Los Angeles", "FBX01", 1.00, False),
    ("br-eu",  "Santos",      "Rotterdam",   "FBX11", 0.58, True),
    ("co-eu",  "Cartagena",   "Rotterdam",   "FBX11", 0.55, True),
    ("et-eu",  "Djibouti",    "Rotterdam",   "FBX11", 0.70, True),
    ("br-us",  "Santos",      "New York",    "FBX03", 0.45, True),
]

def export_freight(db) -> None:
    indices   = {cfg[3] for cfg in ROUTE_CONFIG}
    cutoff_wk = date.today() - timedelta(days=7)
    cutoff_84 = date.today() - timedelta(days=84)

    latest, prev = {}, {}
    for idx in indices:
        row = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == idx)
            .order_by(FreightRate.date.desc())
            .first()
        )
        latest[idx] = row
        row2 = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == idx, FreightRate.date < cutoff_wk)
            .order_by(FreightRate.date.desc())
            .first()
        )
        prev[idx] = row2

    if all(v is None for v in latest.values()):
        result = {"updated": date.today().isoformat(), "routes": [], "history": []}
    else:
        routes = []
        for route_id, from_, to, index, mult, is_proxy in ROUTE_CONFIG:
            latest_row = latest.get(index)
            if latest_row is None:
                continue
            prev_row = prev.get(index)
            rate     = round(latest_row.rate * mult)
            prev_rate = round(prev_row.rate * mult) if prev_row else rate
            routes.append({
                "id": route_id, "from": from_, "to": to,
                "rate": rate, "prev": prev_rate, "unit": "USD/FEU", "proxy": is_proxy,
            })

        fbx11_rows = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == "FBX11", FreightRate.date >= cutoff_84)
            .order_by(FreightRate.date.asc()).all()
        )
        fbx01_rows = (
            db.query(FreightRate)
            .filter(FreightRate.index_code == "FBX01", FreightRate.date >= cutoff_84)
            .order_by(FreightRate.date.asc()).all()
        )
        history_by_date: dict = {}
        for row in fbx11_rows:
            d = row.date.isoformat()
            history_by_date.setdefault(d, {"date": d})
            history_by_date[d]["vn-eu"] = round(row.rate * 1.00)
            history_by_date[d]["br-eu"] = round(row.rate * 0.58)
            history_by_date[d]["et-eu"] = round(row.rate * 0.70)
        for row in fbx01_rows:
            d = row.date.isoformat()
            history_by_date.setdefault(d, {"date": d})
            history_by_date[d]["vn-us"] = round(row.rate * 1.00)

        updated = max(
            (r.date for r in latest.values() if r is not None),
            default=date.today()
        ).isoformat()

        result = {
            "updated": updated,
            "routes":  routes,
            "history": sorted(history_by_date.values(), key=lambda x: x["date"]),
        }

    path = OUT_DIR / "freight.json"
    written = safe_write_json(path, result, validate_freight)
    print(f"  freight.json → written:{written} {len(result.get('routes', []))} routes, {len(result.get('history', []))} history rows")


# ── 7. Farmer Economics ───────────────────────────────────────────────────────

_RISK_ORDER = {"-": 0, "L": 1, "M": 2, "H": 3}

_REGIONAL_IMPACT_BY_PHASE = {
    "el-nino": [
        {"region": "Sul de Minas",   "type": "DRY",  "note": "rainfall −18% vs norm."},
        {"region": "Cerrado",        "type": "DRY",  "note": "moisture deficit critical"},
        {"region": "Paraná",         "type": "COLD", "note": "frost window +12 days"},
        {"region": "Espírito Santo", "type": "WET",  "note": "above-avg rainfall"},
    ],
    "la-nina": [
        {"region": "Sul de Minas",   "type": "WET",  "note": "above-avg rainfall"},
        {"region": "Cerrado",        "type": "WET",  "note": "above-avg rainfall"},
        {"region": "Paraná",         "type": "WARM", "note": "reduced frost risk"},
        {"region": "Espírito Santo", "type": "DRY",  "note": "below-avg rainfall"},
    ],
    "neutral": [
        {"region": "Sul de Minas",   "type": "WARM", "note": "near-normal conditions"},
        {"region": "Cerrado",        "type": "WARM", "note": "near-normal conditions"},
        {"region": "Paraná",         "type": "WARM", "note": "near-normal conditions"},
        {"region": "Espírito Santo", "type": "WARM", "note": "near-normal conditions"},
    ],
}

_HISTORICAL_STAT_BY_PHASE = {
    "el-nino": "El Niño years avg. Brazil arabica output −4.2% vs neutral",
    "la-nina": "La Niña years avg. Brazil arabica output +2.1% vs neutral",
    "neutral":  "Neutral ENSO: near-average Brazil arabica output expected",
}

_FERT_CONFIG = {
    "urea": {"name": "Urea (N)", "input_weight": 0.35, "base_usd_per_bag": 18.9},
    "dap":  {"name": "MAP (P)",  "input_weight": 0.20, "base_usd_per_bag": 10.8},
    "kcl":  {"name": "KCl (K)",  "input_weight": 0.25, "base_usd_per_bag": 13.5},
}


def _worst_risk(risks: list) -> str:
    """Return the worst risk code from a list (H > M > L > -)."""
    if not risks:
        return "-"
    return max(risks, key=lambda r: _RISK_ORDER.get(r, 0))


def _badge_from_risk_code(code: str) -> str:
    return {"H": "HIGH", "M": "MED", "L": "LOW", "-": "NONE"}.get(code, "NONE")


def _oni_to_dots(oni: float) -> int:
    a = abs(oni)
    if a >= 2.0:
        return 4
    if a >= 1.5:
        return 3
    if a >= 1.0:
        return 2
    return 1


def _derive_enso_phase(oni_history: list) -> tuple:
    """Derive (phase, intensity, current_oni) from oni_history list.
    Uses all entries — both confirmed and preliminary — since NOAA ONI
    preliminary values are observation-based and reliable enough for phase detection.
    The old 'forecast' key is also accepted for backwards compat with DB data."""
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


def _load_dry_bulk_cache() -> dict | None:
    """Read dry_bulk.json cache written by dry_bulk scraper."""
    try:
        from scraper.sources.dry_bulk import fetch_latest
        return fetch_latest()
    except Exception:
        return None


def _load_origins_cache() -> dict | None:
    """Read br_fert_origins.json cache written by comex_fertilizer scraper."""
    try:
        cache_path = ROOT / "backend" / "scraper" / "cache" / "br_fert_origins.json"
        if cache_path.exists():
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            return data.get("origins")
    except Exception:
        pass
    return None


def export_farmer_economics(db) -> None:
    _REGIONS_ORDER = ["Sul de Minas", "Cerrado", "Paraná", "Espírito Santo"]

    # ── Weather ──────────────────────────────────────────────────────────────
    weather_out = None
    try:
        snapshots = db.query(WeatherSnapshot).order_by(WeatherSnapshot.scraped_at.desc()).all()
        latest_by_region = {}
        for snap in snapshots:
            if snap.region not in latest_by_region:
                latest_by_region[snap.region] = snap

        if latest_by_region:
            regions_out           = []
            daily_frost_out       = []
            daily_drought_out     = []
            drought_detail_out    = []
            current_conditions_out= []
            scraped_at_out        = None

            for region_name in _REGIONS_ORDER:
                snap = latest_by_region.get(region_name)
                if snap is None:
                    continue
                if scraped_at_out is None and snap.scraped_at:
                    scraped_at_out = snap.scraped_at.isoformat() + "Z"

                daily = snap.daily_data or []
                week  = daily[:7]

                frost_codes   = [d.get("frost_risk",   "-") for d in week]
                drought_codes = [d.get("drought_risk", "-") for d in week]
                frost_badge   = _badge_from_risk_code(_worst_risk(frost_codes))
                drought_badge = _badge_from_risk_code(_worst_risk(drought_codes))

                from scraper.sources.farmer_economics import _calc_csi
                csi = _calc_csi(daily)

                regions_out.append({
                    "name":           region_name,
                    "frost":          frost_badge,
                    "drought":        drought_badge,
                    "csi_30d":        csi["csi_30d"],
                    "csi_60d":        csi["csi_60d"],
                    "csi_30d_level":  csi["csi_30d_level"],
                    "csi_60d_level":  csi["csi_60d_level"],
                })

                frost_days   = [d.get("frost_risk",   "-") for d in daily]
                drought_days = [d.get("drought_risk", "-") for d in daily]
                if any(c != "-" for c in frost_days):
                    daily_frost_out.append({"region": region_name, "days": frost_days})
                if any(c != "-" for c in drought_days):
                    daily_drought_out.append({"region": region_name, "days": drought_days})
                    drought_detail_out.append({
                        "region": region_name,
                        "days": [
                            {
                                "date":          d.get("date", ""),
                                "vpd":           d.get("vpd", 0.0),
                                "precip_prob":   d.get("precip_prob", 0.0),
                                "soil_moisture": d.get("soil_moisture", 0.0),
                                "drought_risk":  d.get("drought_risk", "-"),
                            }
                            for d in daily
                        ],
                    })

                today = daily[0] if daily else {}
                current_conditions_out.append({
                    "region":          region_name,
                    "temp_c":          today.get("max_temp", 0),
                    "dew_point_c":     today.get("dew_point", 0),
                    "cloud_cover_pct": today.get("cloud_cover", 0),
                    "wind_speed_kmh":  today.get("wind_speed", 0),
                })

            if regions_out:
                weather_out = {
                    "scraped_at":         scraped_at_out or date.today().isoformat(),
                    "regions":            regions_out,
                    "daily_frost":        daily_frost_out,
                    "daily_drought":      daily_drought_out,
                    "drought_detail":     drought_detail_out,
                    "current_conditions": current_conditions_out,
                }
    except Exception as e:
        print(f"  [farmer_economics] weather section error: {e}")

    # ── ENSO ─────────────────────────────────────────────────────────────────
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

                regional_impact = []
                for entry in _REGIONAL_IMPACT_BY_PHASE.get(phase, []):
                    regional_impact.append({**entry, "dots": dots})

                # Forecast direction: trend-based sentence (NOAA ONI file is
                # all historical — no real future forecasts available).
                confirmed = [p for p in oni_history if not p.get("preliminary")]
                recent_vals = [p["value"] for p in oni_history[-5:]]
                trend = (recent_vals[-1] - recent_vals[0]) if len(recent_vals) >= 2 else 0
                if phase == "neutral":
                    forecast_direction = "Neutral · No strong signal for 2026"
                elif phase == "el-nino":
                    forecast_direction = "El Niño weakening" if trend < -0.15 else "El Niño conditions ongoing"
                else:  # la-nina
                    forecast_direction = "La Niña weakening toward neutral" if trend > 0.15 else "La Niña ongoing"

                # Peak month: confirmed (non-preliminary) point with highest |value|
                history_for_peak = confirmed if confirmed else oni_history
                if history_for_peak:
                    peak_pt    = max(history_for_peak, key=lambda p: abs(p["value"]))
                    peak_month = peak_pt["month"]
                else:
                    peak_month = ""

                oni_forecast = meta.get("oni_forecast", [])
                enso_out = {
                    "phase":              phase,
                    "intensity":          intensity,
                    "oni":                current_oni,
                    "peak_month":         peak_month,
                    "forecast_direction": forecast_direction,
                    "oni_history":        oni_history,
                    "oni_forecast":       oni_forecast,
                    "regional_impact":    regional_impact,
                    "historical_stat":    _HISTORICAL_STAT_BY_PHASE.get(phase, ""),
                    "last_updated":       str(enso_item.pub_date)[:10],
                }
    except Exception as e:
        print(f"  [farmer_economics] ENSO section error: {e}")

    # ── Fertilizer prices ─────────────────────────────────────────────────────
    fert_items_out = []
    fert_prices_as_of = None
    try:
        wb_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "World Bank")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if wb_item:
            meta = json.loads(wb_item.meta or "{}")
            fert_prices_as_of = meta.get("last_data_month")  # e.g. "Feb-2026"
            for key, cfg in _FERT_CONFIG.items():
                monthly = meta.get(f"{key}_monthly", [])
                if len(monthly) < 2:
                    continue
                current_price = monthly[-1]
                prev_price    = monthly[-2]
                mom_pct = (current_price - prev_price) / prev_price * 100 if prev_price else 0.0
                fert_items_out.append({
                    "name":              cfg["name"],
                    "price_usd_mt":      round(current_price, 0),
                    "mom_pct":           round(mom_pct, 1),
                    "sparkline":         monthly[:6],
                    "input_weight":      cfg["input_weight"],
                    "base_usd_per_bag":  cfg["base_usd_per_bag"],
                })
    except Exception as e:
        print(f"  [farmer_economics] fertilizer prices section error: {e}")

    # ── Fertilizer imports ────────────────────────────────────────────────────
    imports_out = None
    comex_price_items: list = []
    comex_prices_as_of: str | None = None
    try:
        today = date.today()
        cutoff_date = date(today.year - 3, today.month, 1)

        import_rows = (
            db.query(FertilizerImport)
            .filter(FertilizerImport.month >= cutoff_date)
            .order_by(FertilizerImport.month.asc())
            .all()
        )
        if import_rows:
            # NCM code → fertilizer type bucket (handles both old wrong codes + new correct codes)
            _CODE_TO_TYPE: dict[str, str] = {
                # Urea
                "31021010": "urea", "31021090": "urea", "31028000": "urea",
                # KCl — 31042010 was old wrong code kept for compat with existing DB rows
                "31042010": "kcl",  "31042090": "kcl",
                # MAP (monoammonium phosphate) — 31052000 was old wrong code
                "31052000": "map",  "31054000": "map",
                # DAP (diammonium phosphate)
                "31053000": "dap",
                # AN (ammonium nitrate)
                "31023000": "an",
                # AS (ammonium sulphate)
                "31022100": "as",
                # Superphosphate
                "31031020": "superp", "31031030": "superp",
                "31031100": "superp", "31031900": "superp",
            }

            def _row_type(row) -> str | None:
                t = _CODE_TO_TYPE.get((row.ncm_code or "")[:8])
                if t:
                    return t
                # Label fallback for old "NCM XXXXX" entries
                lc = (row.ncm_label or "").lower()
                if "urea" in lc or "ureia" in lc:
                    return "urea"
                if "kcl" in lc or "cloreto de pot" in lc:
                    return "kcl"
                if lc == "map":
                    return "map"
                if "dap" in lc or "diamônio" in lc or "diamonio" in lc:
                    return "dap"
                if lc == "an" or "nitrato" in lc:
                    return "an"
                if lc == "as" or "sulfato de amônio" in lc:
                    return "as"
                if "superphosphate" in lc or "superfosfato" in lc:
                    return "superp"
                return None

            # Group by month string "YYYY-MM", tracking volume + FOB per type
            months_data: dict = {}
            for row in import_rows:
                m_str = row.month.strftime("%Y-%m")
                if m_str not in months_data:
                    months_data[m_str] = {
                        "month":       m_str,
                        "urea_kt":     0.0, "urea_fob":   0.0,
                        "kcl_kt":      0.0, "kcl_fob":    0.0,
                        "map_kt":      0.0, "map_fob":    0.0,
                        "dap_kt":      0.0, "dap_fob":    0.0,
                        "an_kt":       0.0, "an_fob":     0.0,
                        "as_kt":       0.0, "as_fob":     0.0,
                        "superp_kt":   0.0, "superp_fob": 0.0,
                        "total_kt":    0.0,
                        "total_fob_usd_m": 0.0,
                    }
                ftype = _row_type(row)
                kt    = (row.net_weight_kg or 0) / 1_000_000
                fob_m = (row.fob_usd or 0) / 1_000_000
                if ftype:
                    months_data[m_str][f"{ftype}_kt"]  += kt
                    months_data[m_str][f"{ftype}_fob"] += fob_m
                months_data[m_str]["total_kt"]         += kt
                months_data[m_str]["total_fob_usd_m"]  += fob_m

            # Compute implied FOB price (USD/mt) per type per month
            def _implied_price(fob_m: float, kt: float) -> float | None:
                """fob_m = millions USD, kt = kilotons → USD/mt"""
                if kt < 0.5:   # ignore months with negligible volume
                    return None
                return round(fob_m * 1_000 / kt, 0)

            sorted_months = sorted(months_data.values(), key=lambda x: x["month"])

            # Round volume/value fields for output, include implied price per type
            monthly_out = []
            for entry in sorted_months:
                map_dap_kt  = entry["map_kt"]  + entry["dap_kt"]
                map_dap_fob = entry["map_fob"] + entry["dap_fob"]
                monthly_out.append({
                    "month":              entry["month"],
                    "urea_kt":            round(entry["urea_kt"],   1),
                    "kcl_kt":             round(entry["kcl_kt"],    1),
                    "map_kt":             round(entry["map_kt"],    1),
                    "dap_kt":             round(entry["dap_kt"],    1),
                    "an_kt":              round(entry["an_kt"],     1),
                    "as_kt":              round(entry["as_kt"],     1),
                    "superp_kt":          round(entry["superp_kt"], 1),
                    "map_dap_kt":         round(map_dap_kt,         1),  # backward compat
                    "total_kt":           round(entry["total_kt"],  1),
                    "total_fob_usd_m":    round(entry["total_fob_usd_m"], 2),
                    "urea_price_usd_mt":    _implied_price(entry["urea_fob"], entry["urea_kt"]),
                    "kcl_price_usd_mt":     _implied_price(entry["kcl_fob"],  entry["kcl_kt"]),
                    "map_dap_price_usd_mt": _implied_price(map_dap_fob,       map_dap_kt),
                })

            # Build price sparklines (last 7 months with valid data) per type
            _COMEX_FERT = {
                "urea":    {"name": "Urea (N)", "kt_key": "urea_kt", "fob_key": "urea_fob", **_FERT_CONFIG["urea"]},
                "map_dap": {"name": "MAP (P)",  "kt_key": "map_kt",  "fob_key": "map_fob",  **_FERT_CONFIG["dap"]},
                "kcl":     {"name": "KCl (K)",  "kt_key": "kcl_kt",  "fob_key": "kcl_fob",  **_FERT_CONFIG["kcl"]},
            }
            for key, cfg in _COMEX_FERT.items():
                prices_by_month = [
                    (e["month"], _implied_price(e[cfg["fob_key"]], e[cfg["kt_key"]]))
                    for e in sorted_months
                ]
                valid = [(m, p) for m, p in prices_by_month if p is not None]
                if len(valid) < 2:
                    continue
                sparkline     = [p for _, p in valid[-7:]]
                current_price = sparkline[-1]
                prev_price    = sparkline[-2]
                mom_pct = (current_price - prev_price) / prev_price * 100 if prev_price else 0.0
                comex_prices_as_of = valid[-1][0]  # "YYYY-MM"
                comex_price_items.append({
                    "name":             cfg["name"],
                    "price_usd_mt":     current_price,
                    "mom_pct":          round(mom_pct, 1),
                    "sparkline":        sparkline,
                    "input_weight":     cfg["input_weight"],
                    "base_usd_per_bag": cfg["base_usd_per_bag"],
                })

            if comex_prices_as_of:
                yr, mo = comex_prices_as_of.split("-")
                _M = {"01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun",
                      "07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec"}
                comex_prices_as_of = f"{_M.get(mo, mo)}-{yr}"

            last_import = max(import_rows, key=lambda r: r.scraped_at)
            imports_out = {
                "last_updated": last_import.scraped_at.strftime("%Y-%m-%d"),
                "monthly":      monthly_out,
            }
    except Exception as e:
        print(f"  [farmer_economics] fertilizer imports section error: {e}")

    # ── Acreage / Yield ───────────────────────────────────────────────────────
    acreage_out = None
    yield_out   = None
    season      = None
    try:
        safra_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "CONAB Safra")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if safra_item:
            meta   = json.loads(safra_item.meta or "{}")
            season = meta.get("season")

            area_cur  = meta.get("harvested_area_kha")
            area_prev = meta.get("prev_area_kha")
            yld_cur   = meta.get("yield_bags_ha")
            yld_prev  = meta.get("prev_yield_bags_ha")

            if area_cur is not None:
                area_yoy = (area_cur - area_prev) / area_prev * 100 if area_prev else 0.0
                acreage_out = {
                    "thousand_ha":  area_cur,
                    "yoy_pct":      round(area_yoy, 1),
                    "source_label": meta.get("source_label", "CONAB Safra"),
                }
            if yld_cur is not None:
                yld_yoy = (yld_cur - yld_prev) / yld_prev * 100 if yld_prev else 0.0
                yield_out = {
                    "bags_per_ha":  yld_cur,
                    "yoy_pct":      round(yld_yoy, 1),
                    "source_label": meta.get("source_label", "CONAB Safra"),
                }
    except Exception as e:
        print(f"  [farmer_economics] acreage/yield section error: {e}")

    # ── Cost helper ───────────────────────────────────────────────────────────
    def _build_cost_out(db_source: str, spot_price: float | None, spot_field: str) -> dict | None:
        item = (
            db.query(NewsItem)
            .filter(NewsItem.source == db_source)
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if not item:
            return None
        meta          = json.loads(item.meta or "{}")
        total_brl     = meta.get("total_brl_per_bag")
        prev_total_brl= meta.get("prev_total_brl_per_bag")
        brl_usd       = meta.get("brl_usd", 5.0)
        components    = meta.get("components_brl", [])
        inputs_detail = meta.get("inputs_detail_brl", [])
        if total_brl is None:
            return None

        total_usd      = total_brl / brl_usd if brl_usd else None
        total_comp_brl = sum(c.get("brl", 0) for c in components)
        components_out = [
            {
                "label": c.get("label"),
                "color": c.get("color"),
                "brl":   c.get("brl", 0),
                "usd":   round(c.get("brl", 0) / brl_usd, 2) if brl_usd else None,
                "share": round(c.get("brl", 0) / total_comp_brl, 4) if total_comp_brl else 0.0,
            }
            for c in components
        ]
        inputs_total_brl  = sum(d.get("brl", 0) for d in inputs_detail)
        inputs_detail_out = [
            {
                "label": d.get("label"),
                "brl":   d.get("brl", 0),
                "usd":   round(d.get("brl", 0) / brl_usd, 2) if brl_usd else None,
                "share": round(d.get("brl", 0) / inputs_total_brl, 4) if inputs_total_brl else 0.0,
            }
            for d in inputs_detail
        ]
        yoy_pct = 0.0
        if prev_total_brl:
            yoy_pct = round((total_brl - prev_total_brl) / prev_total_brl * 100, 1)
        return {
            "total_usd_per_bag": round(total_usd, 1) if total_usd is not None else None,
            "yoy_pct":           yoy_pct,
            "season_label":      meta.get("source_label", db_source),
            "components":        components_out,
            "inputs_detail":     inputs_detail_out,
            spot_field:          spot_price,
            "last_updated":      str(item.pub_date)[:10],
        }

    # ── Cost ──────────────────────────────────────────────────────────────────
    cost_arabica_out = None
    cost_conilon_out = None
    try:
        # KC spot from arabica futures
        kc_spot = None
        try:
            arabica_item = next(
                (i for i in
                 db.query(NewsItem)
                 .filter(NewsItem.meta.isnot(None))
                 .order_by(NewsItem.pub_date.desc())
                 .all()
                 if "futures" in (i.tags or []) and "arabica" in (i.tags or [])),
                None
            )
            if arabica_item:
                ar_meta = json.loads(arabica_item.meta or "{}")
                contracts = ar_meta.get("contracts", [])
                if contracts:
                    kc_spot = contracts[0].get("lastPrice")
        except Exception:
            pass

        # RC spot from robusta futures ($/MT → $/bag: ×0.06)
        rc_spot_per_bag = None
        try:
            robusta_item = next(
                (i for i in
                 db.query(NewsItem)
                 .filter(NewsItem.meta.isnot(None))
                 .order_by(NewsItem.pub_date.desc())
                 .all()
                 if "futures" in (i.tags or []) and "robusta" in (i.tags or [])),
                None
            )
            if robusta_item:
                rc_meta = json.loads(robusta_item.meta or "{}")
                contracts = rc_meta.get("contracts", [])
                if contracts:
                    rc_usd_mt = contracts[0].get("lastPrice")
                    if rc_usd_mt:
                        rc_spot_per_bag = round(float(rc_usd_mt) * 0.06, 1)
        except Exception:
            pass

        cost_arabica_out = _build_cost_out("CONAB Custos",         kc_spot,        "kc_spot")
        cost_conilon_out = _build_cost_out("CONAB Custos Conilon", rc_spot_per_bag, "rc_spot")

        # Keep season from arabica item
        if cost_arabica_out and not season:
            arabica_item_c = (db.query(NewsItem).filter(NewsItem.source == "CONAB Custos")
                               .order_by(NewsItem.pub_date.desc()).first())
            if arabica_item_c:
                season = json.loads(arabica_item_c.meta or "{}").get("season")
    except Exception as e:
        print(f"  [farmer_economics] cost section error: {e}")

    # ── Assemble & write ──────────────────────────────────────────────────────
    if season is None:
        _today = date.today()
        _y = _today.year if _today.month >= 7 else _today.year - 1
        season = f"{_y}/{str(_y + 1)[-2:]}"

    result = {
        "country":    "brazil",
        "season":     season,
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "cost":         cost_arabica_out,
        "cost_arabica": cost_arabica_out,
        "cost_conilon": cost_conilon_out,
        "acreage":    acreage_out,
        "yield":      yield_out,
        "weather":    weather_out,
        "enso":       enso_out,
        "fertilizer": {
            # Prefer Comex-derived prices (same source as import volume, FOB Brazil)
            # Fall back to World Bank if Comex data is insufficient
            "items":            comex_price_items if comex_price_items else fert_items_out,
            "prices_as_of":     comex_prices_as_of if comex_prices_as_of else fert_prices_as_of,
            "imports":          imports_out,
            "import_origins":   _load_origins_cache(),
            "dry_bulk":         _load_dry_bulk_cache(),
            "next_application": "May–Jun",
        },
    }

    path = OUT_DIR / "farmer_economics.json"
    written = safe_write_json(path, result, validate_farmer_economics)
    print(f"  farmer_economics.json → written:{written} cost:{cost_arabica_out is not None} weather:{weather_out is not None} enso:{enso_out is not None}")


# ── 8. Farmer Selling (Safras & Mercado) ─────────────────────────────────────

def export_farmer_selling() -> None:
    from scraper.sources.farmer_selling import build_farmer_selling
    try:
        result = build_farmer_selling()
        if result:
            ar = result.get("arabica", {}).get("brazil", {})
            rb = result.get("robusta", {}).get("brazil", {})
            print(f"  farmer_selling_brazil.json → arabica:{ar.get('current')}% robusta:{rb.get('current')}%")
        else:
            print("  farmer_selling_brazil.json → no update (parse failed or no change)")
    except Exception as e:
        print(f"  farmer_selling_brazil.json → FAILED: {e}")


# ── 9a. Vietnam Local Prices (Cecafe/acaphe fallback) ────────────────────────

def export_vietnam_last() -> None:
    """Read latest VN local prices from DB and write vietnam_last.json.
    This persists morning prices that Cecafe/acaphe remove each afternoon."""
    from scraper.db import get_latest_vn_local_price
    path = OUT_DIR / "vietnam_last.json"
    try:
        snapshot = get_latest_vn_local_price()
        if not snapshot:
            print("  vietnam_last.json → no data in DB yet — skipped")
            return
        path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        saved_at = snapshot.get("saved_at", "?")
        bmt_bid  = snapshot.get("bmt_bid", "?")
        print(f"  vietnam_last.json → BMT bid={bmt_bid}, recorded {saved_at}")
    except Exception as e:
        print(f"  vietnam_last.json → FAILED: {e}")


# ── 9. Vietnam Supply ────────────────────────────────────────────────────────

def export_vietnam_supply() -> None:
    """Fetch ICO Vietnam export data and write vietnam_supply.json."""
    from scraper.sources.vietnam_supply import build_vietnam_supply
    try:
        data = build_vietnam_supply()
        path = OUT_DIR / "vietnam_supply.json"
        safe_write_json(
            path, data,
            lambda d: (True, "ok") if d.get("country") == "vietnam" else (False, "country != vietnam"),
        )
        exports = data.get("exports") or {}
        n = len(exports.get("monthly", []))
        print(f"  vietnam_supply.json → {n} export months")
    except Exception as e:
        print(f"  vietnam_supply.json → FAILED: {e}")


# ── 10. Latest Prices (MarketTicker) ─────────────────────────────────────────

def export_latest_prices(db) -> None:
    """Pre-compute all ticker display values → latest_prices.json.
    Primary source: physical_prices table (typed columns, indexed).
    Fallback: NewsItem body parsing (used until physical_prices is populated)."""
    import re as _re
    import json as _json
    from sqlalchemy import func

    # ── Primary: PhysicalPrice table ─────────────────────────────────────────
    cutoff = (datetime.utcnow() - timedelta(days=7)).date()
    subq = (
        db.query(PhysicalPrice.symbol, func.max(PhysicalPrice.price_date).label("max_date"))
        .filter(PhysicalPrice.price_date >= cutoff)
        .group_by(PhysicalPrice.symbol)
        .subquery()
    )
    rows = (
        db.query(PhysicalPrice)
        .join(subq, (PhysicalPrice.symbol == subq.c.symbol) &
                    (PhysicalPrice.price_date == subq.c.max_date))
        .all()
    )
    pp = {r.symbol: r for r in rows}

    # Also need the KC/RC chain meta (symbol label + change) which lives in NewsItem.meta
    recent_news = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date > datetime.utcnow() - timedelta(days=7),
                NewsItem.meta.isnot(None))
        .order_by(NewsItem.pub_date.desc())
        .all()
    )
    def _chain_item(market: str) -> dict | None:
        for it in recent_news:
            t = set(it.tags or [])
            if "futures" in t and "price" in t and market in t and "b3" not in t:
                try:
                    return _json.loads(it.meta).get("contracts", [{}])[0]
                except Exception:
                    pass
        return None

    def _b3_item():
        for it in recent_news:
            t = set(it.tags or [])
            if "futures" in t and "price" in t and "arabica" in t and "b3" in t:
                return it
        return None

    tickers: list[dict] = []

    # KC front month — symbol label + change from meta; price from PhysicalPrice if available
    kc = _chain_item("arabica")
    if kc:
        last = pp["KC_FRONT"].price if "KC_FRONT" in pp else kc.get("last")
        chg  = kc.get("chg", 0) or 0
        sym  = kc.get("symbol", "KC")
        if last is not None:
            sign = "+" if chg >= 0 else ""
            tickers.append({"label": sym, "value": f"{float(last):.2f} ({sign}{chg:.2f})", "category": "futures"})

    # RC front month
    rc = _chain_item("robusta")
    if rc:
        last = pp["RC_FRONT"].price if "RC_FRONT" in pp else rc.get("last")
        chg  = rc.get("chg", 0) or 0
        sym  = rc.get("symbol", "RC")
        if last is not None:
            sign = "+" if chg >= 0 else ""
            tickers.append({"label": sym, "value": f"{int(last):,} ({sign}{int(chg)})", "category": "futures"})

    # B3 ICF
    b3it = _b3_item()
    if b3it:
        price = pp["B3_ICF"].price if "B3_ICF" in pp else None
        ms = _re.search(r"settlement:\s*([\d.]+)\s*USD/sac", b3it.body or "", _re.I)
        mt = _re.search(r"B3 ICF Arabica \(([^)]+)\)", b3it.title or "")
        val = f"{price:.2f}" if price is not None else (ms.group(1) if ms else None)
        if val:
            lbl = f"B3 4/5 {mt.group(1)}" if mt else "B3 4/5"
            tickers.append({"label": lbl, "value": f"{val} USD/sac", "category": "futures"})

    # VN FAQ — primary: PhysicalPrice; fallback: most recent NewsItem (no meta filter)
    import re as _re2
    usd_vnd = pp["USD_VND"].price if "USD_VND" in pp else None
    vn_faq_vnd: int | None = None
    if "VN_FAQ" in pp:
        vn_faq_vnd = int(pp["VN_FAQ"].price)
    else:
        vn_news = (
            db.query(NewsItem)
            .filter(NewsItem.pub_date > datetime.utcnow() - timedelta(days=30))
            .order_by(NewsItem.pub_date.desc())
            .all()
        )
        for it in vn_news:
            if {"price", "vietnam"} <= set(it.tags or []) and "futures" not in (it.tags or []):
                m = _re2.search(r"price:\s*([\d.]+)\s*VND/kg", it.body or "", _re2.I)
                if m:
                    raw = m.group(1)
                    vn_faq_vnd = int(raw.replace(".", "")) if _re2.match(r"^\d{2,3}\.\d{3}$", raw) else int(float(raw))
                    break
    if vn_faq_vnd and usd_vnd:
        usd_mt = round(vn_faq_vnd / usd_vnd * 1000)
        fmt_vnd = f"{vn_faq_vnd:,}".replace(",", ".")
        tickers.append({"label": "VN FAQ", "value": f"{fmt_vnd} VND (${usd_mt:,})", "category": "physical"})

    # CON T7
    usd_brl = pp["USD_BRL"].price if "USD_BRL" in pp else None
    if "CON_T7" in pp and usd_brl:
        brl = pp["CON_T7"].price
        usd_mt = round(brl / usd_brl / 60 * 1000)
        # Reformat BRL float to Brazilian "1.280,50" style
        brl_str = f"{brl:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        tickers.append({"label": "CON T7", "value": f"{brl_str} BRL (${usd_mt:,})", "category": "physical"})

    # UGA S15
    if "UGA_S15" in pp:
        cwt = pp["UGA_S15"].price
        usd_mt = round(cwt * 22.046)
        tickers.append({"label": "UGA S15", "value": f"{cwt:.2f} (${usd_mt:,})", "category": "physical"})

    # FX rates
    for sym, lbl in [("USD_BRL", "USD/BRL"), ("USD_VND", "USD/VND"),
                     ("USD_IDR", "USD/IDR"), ("USD_HNL", "USD/HNL"), ("USD_UGX", "USD/UGX")]:
        if sym in pp:
            rate = pp[sym].price
            value = str(int(round(rate))) if rate > 100 else f"{rate:.4f}"
            tickers.append({"label": lbl, "value": value, "category": "fx"})

    # ── Fallback to NewsItem parsing if PhysicalPrice has no data ────────────
    if not tickers:
        print("  latest_prices.json → physical_prices empty, falling back to NewsItem parsing")
        tickers = _build_tickers_from_news(db)

    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "tickers": tickers,
    }
    path = OUT_DIR / "latest_prices.json"
    written = safe_write_json(path, result, lambda d: (len(d.get("tickers", [])) > 0, "no tickers"))
    print(f"  latest_prices.json → written:{written} {len(tickers)} items "
          f"({'PhysicalPrice' if pp else 'NewsItem fallback'})")


def _build_tickers_from_news(db) -> list[dict]:
    """Fallback: parse tickers from NewsItem.body (used before PhysicalPrice is populated)."""
    import re as _re
    import json as _json

    recent = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date > datetime.utcnow() - timedelta(days=7))
        .order_by(NewsItem.pub_date.desc())
        .all()
    )

    def _first(must, exclude=None):
        exc = set(exclude or [])
        for it in recent:
            t = set(it.tags or [])
            if all(m in t for m in must) and not (exc & t):
                return it
        return None

    def _fx(country):
        it = _first(["fx", country])
        if not it:
            return None
        m = _re.search(r"price:\s*([\d.,]+)", it.body or "", _re.I)
        return float(m.group(1).replace(",", "")) if m else None

    usd_brl = _fx("brazil")
    usd_vnd = _fx("vietnam")
    tickers = []

    for market, prefix, int_price in [("arabica", "KC", False), ("robusta", "RC", True)]:
        it = _first(["futures", "price", market], exclude=["b3"])
        if it and it.meta:
            try:
                c = _json.loads(it.meta).get("contracts", [{}])[0]
                sym, last, chg = c.get("symbol", prefix), c.get("last"), c.get("chg", 0) or 0
                if last is not None:
                    sign = "+" if chg >= 0 else ""
                    val = f"{int(last):,} ({sign}{int(chg)})" if int_price else f"{last:.2f} ({sign}{chg:.2f})"
                    tickers.append({"label": sym, "value": val, "category": "futures"})
            except Exception:
                pass

    it = _first(["futures", "price", "arabica", "b3"])
    if it:
        ms = _re.search(r"settlement:\s*([\d.]+)\s*USD/sac", it.body or "", _re.I)
        mt = _re.search(r"B3 ICF Arabica \(([^)]+)\)", it.title or "")
        if ms:
            tickers.append({"label": f"B3 4/5 {mt.group(1)}" if mt else "B3 4/5",
                            "value": f"{ms.group(1)} USD/sac", "category": "futures"})

    it = _first(["price", "vietnam"], exclude=["futures"])
    if it and usd_vnd:
        m = _re.search(r"price:\s*([\d.]+)\s*VND/kg", it.body or "", _re.I)
        if m:
            raw = m.group(1)
            vnd_kg = int(raw.replace(".", "")) if _re.match(r"^\d{2,3}\.\d{3}$", raw) else int(float(raw))
            usd_mt = round(vnd_kg / usd_vnd * 1000)
            tickers.append({"label": "VN FAQ",
                            "value": f"{raw} VND (${usd_mt:,})", "category": "physical"})

    it = _first(["price", "brazil", "conilon"], exclude=["futures"])
    if it and usd_brl:
        m = _re.search(r"R\$\s*([\d.,]+)/saca", it.body or "", _re.I)
        if m:
            brl_str = m.group(1)
            brl_val = float(brl_str.replace(".", "").replace(",", "."))
            usd_mt  = round(brl_val / usd_brl / 60 * 1000)
            tickers.append({"label": "CON T7", "value": f"{brl_str} BRL (${usd_mt:,})", "category": "physical"})

    it = _first(["price", "uganda"], exclude=["futures"])
    if it:
        m = _re.search(r"price:\s*([\d.]+)\s*USD/cwt", it.body or "", _re.I)
        if m:
            cwt = float(m.group(1))
            tickers.append({"label": "UGA S15", "value": f"{cwt:.2f} (${round(cwt * 22.046):,})", "category": "physical"})

    for country, lbl in [("brazil", "USD/BRL"), ("vietnam", "USD/VND"),
                         ("indonesia", "USD/IDR"), ("honduras", "USD/HNL"), ("uganda", "USD/UGX")]:
        it = _first(["fx", country])
        if not it:
            continue
        m = _re.search(r"price:\s*([\d.,]+)", it.body or "", _re.I)
        if m:
            tickers.append({"label": lbl, "value": m.group(1), "category": "fx"})

    return tickers


# ── 11. VN Physical Prices ───────────────────────────────────────────────────

def export_vn_physical_prices(db) -> None:
    """Compute and write vn_physical_prices.json from latest VN FAQ + FX news items."""
    import re as _re

    recent = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date > (datetime.utcnow() - timedelta(days=30)))
        .order_by(NewsItem.pub_date.desc())
        .all()
    )

    vn_item = next(
        (i for i in recent
         if "price"   in (i.tags or [])
         and "robusta" in (i.tags or [])
         and "vietnam" in (i.tags or [])
         and "futures" not in (i.tags or [])),
        None,
    )
    fx_item = next(
        (i for i in recent
         if "fx"      in (i.tags or [])
         and "vietnam" in (i.tags or [])),
        None,
    )

    if not vn_item or not fx_item:
        print(f"  vn_physical_prices.json → skipped (vn:{vn_item is not None} fx:{fx_item is not None})")
        return

    m1 = _re.search(r"price:\s*([\d.]+)\s*VND/kg", vn_item.body or "", _re.I)
    if not m1:
        print("  vn_physical_prices.json → skipped (vnd parse failed)")
        return
    raw = m1.group(1)
    vnd_per_kg = int(raw.replace(".", "")) if _re.match(r"^\d{2,3}\.\d{3}$", raw) else int(float(raw))

    m2 = _re.search(r"price:\s*([\d.,]+)", fx_item.body or "", _re.I)
    if not m2:
        print("  vn_physical_prices.json → skipped (fx parse failed)")
        return
    usd_vnd = float(m2.group(1).replace(",", ""))

    usd_per_mt = round(vnd_per_kg / usd_vnd * 1000)

    result = {
        "updated": datetime.utcnow().isoformat() + "Z",
        "vn_faq": {
            "vnd_per_kg": vnd_per_kg,
            "usd_per_mt": usd_per_mt,
            "usd_vnd":    round(usd_vnd),
        },
    }

    path = OUT_DIR / "vn_physical_prices.json"
    written = safe_write_json(path, result, lambda d: (d.get("vn_faq") is not None, "no vn_faq"))
    print(f"  vn_physical_prices.json → written:{written} {vnd_per_kg} VND/kg = ${usd_per_mt}/MT (rate:{round(usd_vnd)})")


# ── 9. Health ─────────────────────────────────────────────────────────────────

def export_health(db) -> None:
    """Write health.json: last successful DB write timestamp per scraper."""

    def _ts(val) -> str | None:
        if val is None:
            return None
        return val.isoformat() if isinstance(val, (date, datetime)) else str(val)

    scrapers: dict[str, str | None] = {}

    # Futures (Barchart)
    items = db.query(NewsItem).filter(NewsItem.meta.isnot(None)).order_by(NewsItem.pub_date.desc()).limit(50).all()
    fi = next((i for i in items if "futures" in (i.tags or []) and "price" in (i.tags or [])), None)
    scrapers["futures"] = _ts(fi.pub_date) if fi else None

    # COT (coffee)
    row = db.query(CotWeekly).order_by(CotWeekly.date.desc()).first()
    scrapers["cot"] = _ts(row.date) if row else None

    # Macro COT
    row = db.query(CommodityCot).order_by(CommodityCot.date.desc()).first()
    scrapers["macro_cot"] = _ts(row.date) if row else None

    # Freight
    row = db.query(FreightRate).order_by(FreightRate.date.desc()).first()
    scrapers["freight"] = _ts(row.date) if row else None

    # Weather (Brazil regions)
    row = db.query(WeatherSnapshot).order_by(WeatherSnapshot.scraped_at.desc()).first()
    scrapers["weather"] = _ts(row.scraped_at) if row else None

    # ENSO / ONI
    item = db.query(NewsItem).filter(NewsItem.source == "NOAA CPC").order_by(NewsItem.pub_date.desc()).first()
    scrapers["enso"] = _ts(item.pub_date) if item else None

    # Fertilizer — World Bank
    item = db.query(NewsItem).filter(NewsItem.source == "World Bank").order_by(NewsItem.pub_date.desc()).first()
    scrapers["fertilizer_wb"] = _ts(item.pub_date) if item else None

    # Fertilizer — Comex imports
    row = db.query(FertilizerImport).order_by(FertilizerImport.scraped_at.desc()).first()
    scrapers["fertilizer_comex"] = _ts(row.scraped_at) if row else None

    healthy = sum(1 for v in scrapers.values() if v)
    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "scrapers":     scrapers,
    }

    path = OUT_DIR / "health.json"
    safe_write_json(path, result, validate_health)
    print(f"  health.json → {healthy}/{len(scrapers)} scrapers have data")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Exporting static JSON files...")
    db = SessionLocal()
    try:
        export_futures_chain(db)
        export_oi_fnd_chart(db)
        export_oi_history()
        export_cot(db)
        export_macro_cot(db)
        export_freight(db)
        export_farmer_economics(db)
        export_farmer_selling()
        export_vietnam_last()
        export_vietnam_supply()
        export_latest_prices(db)
        export_vn_physical_prices(db)
        export_health(db)
    finally:
        db.close()
    print(f"Done → {OUT_DIR}")


if __name__ == "__main__":
    main()
