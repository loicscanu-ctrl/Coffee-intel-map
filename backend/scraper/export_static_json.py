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

from database import SessionLocal
from models import NewsItem, CotWeekly, CommodityCot, CommodityPrice, FreightRate, WeatherSnapshot, FertilizerImport
from scraper.sources.macro_cot import COMMODITY_SPECS
from scraper.validate_export import (
    safe_write_json,
    validate_futures_chain,
    validate_oi_fnd_chart,
    validate_cot,
    validate_macro_cot,
    validate_freight,
    validate_farmer_economics,
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
             and market     in (i.tags or [])),
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

def _cot_row_to_dict(row: CotWeekly) -> dict:
    return {
        "oi_total":       row.oi_total,
        "pmpu_long":      row.pmpu_long,      "pmpu_short":     row.pmpu_short,
        "swap_long":      row.swap_long,       "swap_short":     row.swap_short,
        "swap_spread":    row.swap_spread,
        "mm_long":        row.mm_long,         "mm_short":       row.mm_short,
        "mm_spread":      row.mm_spread,
        "other_long":     row.other_long,      "other_short":    row.other_short,
        "other_spread":   row.other_spread,
        "nr_long":        row.nr_long,         "nr_short":       row.nr_short,
        "t_pmpu_long":    row.t_pmpu_long,     "t_pmpu_short":   row.t_pmpu_short,
        "t_swap_long":    row.t_swap_long,     "t_swap_short":   row.t_swap_short,
        "t_swap_spread":  row.t_swap_spread,
        "t_mm_long":      row.t_mm_long,       "t_mm_short":     row.t_mm_short,
        "t_mm_spread":    row.t_mm_spread,
        "t_other_long":   row.t_other_long,    "t_other_short":  row.t_other_short,
        "t_other_spread": row.t_other_spread,
        "t_nr_long":      row.t_nr_long,       "t_nr_short":     row.t_nr_short,
        # Old/Other crop split — NY (Arabica) only
        "pmpu_long_old":     row.pmpu_long_old,    "pmpu_short_old":    row.pmpu_short_old,
        "swap_long_old":     row.swap_long_old,    "swap_short_old":    row.swap_short_old,   "swap_spread_old":   row.swap_spread_old,
        "mm_long_old":       row.mm_long_old,      "mm_short_old":      row.mm_short_old,     "mm_spread_old":     row.mm_spread_old,
        "other_long_old":    row.other_long_old,   "other_short_old":   row.other_short_old,  "other_spread_old":  row.other_spread_old,
        "nr_long_old":       row.nr_long_old,      "nr_short_old":      row.nr_short_old,
        "pmpu_long_other":   row.pmpu_long_other,  "pmpu_short_other":  row.pmpu_short_other,
        "swap_long_other":   row.swap_long_other,  "swap_short_other":  row.swap_short_other, "swap_spread_other": row.swap_spread_other,
        "mm_long_other":     row.mm_long_other,    "mm_short_other":    row.mm_short_other,   "mm_spread_other":   row.mm_spread_other,
        "other_long_other":  row.other_long_other, "other_short_other": row.other_short_other,"other_spread_other":row.other_spread_other,
        "nr_long_other":     row.nr_long_other,    "nr_short_other":    row.nr_short_other,
        "price_ny":       row.price_ny,        "price_ldn":      row.price_ldn,
        "structure_ny":   row.structure_ny,    "structure_ldn":  row.structure_ldn,
        "exch_oi_ny":     row.exch_oi_ny,      "exch_oi_ldn":    row.exch_oi_ldn,
        "vol_ny":         row.vol_ny,          "vol_ldn":        row.vol_ldn,
        "efp_ny":         row.efp_ny,          "efp_ldn":        row.efp_ldn,
        "spread_vol_ny":  row.spread_vol_ny,   "spread_vol_ldn": row.spread_vol_ldn,
    }

def export_cot(db) -> None:
    rows = db.query(CotWeekly).order_by(CotWeekly.date.asc()).all()
    merged: dict = {}
    for row in rows:
        d = row.date.isoformat()
        if d not in merged:
            merged[d] = {"date": d, "ny": None, "ldn": None}
        merged[d][row.market] = _cot_row_to_dict(row)
    result = sorted(merged.values(), key=lambda x: x["date"])

    path = OUT_DIR / "cot.json"
    written = safe_write_json(path, result, validate_cot)
    print(f"  cot.json → written:{written} {len(result)} weeks")


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

                regions_out.append({
                    "name":    region_name,
                    "frost":   frost_badge,
                    "drought": drought_badge,
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
            # Group by month string "YYYY-MM", tracking volume + FOB per type
            months_data: dict = {}
            for row in import_rows:
                m_str = row.month.strftime("%Y-%m")
                if m_str not in months_data:
                    months_data[m_str] = {
                        "month":            m_str,
                        "urea_kt":          0.0, "urea_fob":          0.0,
                        "kcl_kt":           0.0, "kcl_fob":           0.0,
                        "map_dap_kt":       0.0, "map_dap_fob":       0.0,
                        "total_kt":         0.0,
                        "total_fob_usd_m":  0.0,
                    }
                label  = (row.ncm_label or "").lower()
                kt     = (row.net_weight_kg or 0) / 1_000_000
                fob_m  = (row.fob_usd or 0) / 1_000_000
                if "ureia" in label or "urea" in label:
                    months_data[m_str]["urea_kt"]  += kt
                    months_data[m_str]["urea_fob"] += fob_m
                elif "kcl" in label or "cloreto de pot" in label or "potassio" in label or "potássio" in label:
                    months_data[m_str]["kcl_kt"]   += kt
                    months_data[m_str]["kcl_fob"]  += fob_m
                elif "map" in label or "dap" in label or "fosfato" in label or "diamônio" in label or "diamonio" in label:
                    months_data[m_str]["map_dap_kt"]  += kt
                    months_data[m_str]["map_dap_fob"] += fob_m
                months_data[m_str]["total_kt"]        += kt
                months_data[m_str]["total_fob_usd_m"] += fob_m

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
                monthly_out.append({
                    "month":              entry["month"],
                    "urea_kt":            round(entry["urea_kt"],        1),
                    "kcl_kt":             round(entry["kcl_kt"],         1),
                    "map_dap_kt":         round(entry["map_dap_kt"],     1),
                    "total_kt":           round(entry["total_kt"],       1),
                    "total_fob_usd_m":    round(entry["total_fob_usd_m"],2),
                    "urea_price_usd_mt":    _implied_price(entry["urea_fob"],    entry["urea_kt"]),
                    "kcl_price_usd_mt":     _implied_price(entry["kcl_fob"],     entry["kcl_kt"]),
                    "map_dap_price_usd_mt": _implied_price(entry["map_dap_fob"], entry["map_dap_kt"]),
                })

            # Build price sparklines (last 7 months with valid data) per type
            _COMEX_FERT = {
                "urea":    {"name": "Urea (N)",  "kt_key": "urea_kt",    "fob_key": "urea_fob",    **_FERT_CONFIG["urea"]},
                "map_dap": {"name": "MAP (P)",   "kt_key": "map_dap_kt", "fob_key": "map_dap_fob", **_FERT_CONFIG["dap"]},
                "kcl":     {"name": "KCl (K)",   "kt_key": "kcl_kt",     "fob_key": "kcl_fob",     **_FERT_CONFIG["kcl"]},
            }
            for key, cfg in _COMEX_FERT.items():
                prices_by_month = [
                    (e["month"], _implied_price(e[cfg["fob_key"]], e[cfg["kt_key"]]))
                    for e in sorted_months
                ]
                valid = [(m, p) for m, p in prices_by_month if p is not None]
                if len(valid) < 2:
                    continue
                sparkline    = [p for _, p in valid[-7:]]
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

    # ── Cost ──────────────────────────────────────────────────────────────────
    cost_out = None
    try:
        custos_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "CONAB Custos")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if custos_item:
            meta = json.loads(custos_item.meta or "{}")
            total_brl     = meta.get("total_brl_per_bag")
            prev_total_brl= meta.get("prev_total_brl_per_bag")
            brl_usd       = meta.get("brl_usd", 5.0)
            components    = meta.get("components_brl", [])
            inputs_detail = meta.get("inputs_detail_brl", [])
            cost_season   = meta.get("season")
            if not season:
                season = cost_season

            if total_brl is not None:
                total_usd = total_brl / brl_usd if brl_usd else None

                # Total BRL of all components (for share calc)
                total_comp_brl = sum(c.get("brl", 0) for c in components)

                components_out = []
                for c in components:
                    brl = c.get("brl", 0)
                    share = brl / total_comp_brl if total_comp_brl else 0.0
                    components_out.append({
                        "label":  c.get("label"),
                        "color":  c.get("color"),
                        "brl":    brl,
                        "usd":    round(brl / brl_usd, 2) if brl_usd else None,
                        "share":  round(share, 4),
                    })

                # Inputs total BRL for detail shares
                inputs_total_brl = sum(d.get("brl", 0) for d in inputs_detail)
                inputs_detail_out = []
                for d in inputs_detail:
                    brl = d.get("brl", 0)
                    share = brl / inputs_total_brl if inputs_total_brl else 0.0
                    inputs_detail_out.append({
                        "label": d.get("label"),
                        "brl":   brl,
                        "usd":   round(brl / brl_usd, 2) if brl_usd else None,
                        "share": round(share, 4),
                    })

                # KC spot: from arabica futures NewsItem
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

                yoy_pct = 0.0
                if prev_total_brl:
                    yoy_pct = round((total_brl - prev_total_brl) / prev_total_brl * 100, 1)

                cost_out = {
                    "total_usd_per_bag": round(total_usd, 1) if total_usd is not None else None,
                    "yoy_pct":           yoy_pct,
                    "season_label":      meta.get("source_label", "CONAB Custos"),
                    "components":        components_out,
                    "inputs_detail":     inputs_detail_out,
                    "kc_spot":           kc_spot,
                    "last_updated":      str(custos_item.pub_date)[:10],
                }
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
        "cost":       cost_out,
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
            "next_application": "May–Jun",
        },
    }

    path = OUT_DIR / "farmer_economics.json"
    written = safe_write_json(path, result, validate_farmer_economics)
    print(f"  farmer_economics.json → written:{written} cost:{cost_out is not None} weather:{weather_out is not None} enso:{enso_out is not None}")


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
    finally:
        db.close()
    print(f"Done → {OUT_DIR}")


if __name__ == "__main__":
    main()
