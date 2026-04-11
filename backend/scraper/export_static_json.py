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

Run after any scraper that updates the relevant tables:
    cd backend
    python -m scraper.export_static_json
"""

import json
import re
import sys
import shutil
from datetime import date, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem, CotWeekly, CommodityCot, CommodityPrice, FreightRate
from scraper.sources.macro_cot import COMMODITY_SPECS

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
            result[market] = {
                "pub_date":  date_str,
                "contracts": meta.get("contracts", []),
            }
        except Exception:
            result[market] = None

    path = OUT_DIR / "futures_chain.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  futures_chain.json → arabica:{result['arabica'] is not None} robusta:{result['robusta'] is not None}")


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
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  oi_fnd_chart.json → arabica:{len(result['arabica'])} robusta:{len(result['robusta'])} series")


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
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  cot.json → {len(result)} weeks")


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
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  macro_cot.json → {len(result)} weeks")


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
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  freight.json → {len(result.get('routes', []))} routes, {len(result.get('history', []))} history rows")


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
    finally:
        db.close()
    print(f"Done → {OUT_DIR}")


if __name__ == "__main__":
    main()
