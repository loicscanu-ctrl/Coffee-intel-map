"""
tender_parity.py
Accumulates a daily per-origin tenderable-parity history — the exact series the
Research "Tender parity" tool needs to eventually fit a rigorous
"differential-hits-parity → exchange-inflow" event study.

For each robusta origin and each day we have a farmgate price, it records:
  farmgate_usd  local price → USD/MT (via that day's FX)
  at_port       farmgate_usd + FOBbing            (origin → vessel)
  tendering     at_port + freight + parity adders  (all-in into an exchange warehouse)
  rc            London Robusta front (USD/MT)
  differential  at_port − rc                       (the N-diff)
  parity_gap    rc − tendering                     (≥ 0 ⇒ tendering is profitable)
  tenderable    parity_gap ≥ 0

It is DERIVED (reads the already-published static JSONs — origin_prices_history,
fx_history, freight, futures_price_history) and APPEND-ONLY / idempotent: any date
already recorded is left as-observed, missing dates (incl. the whole existing
farmgate back-history on first run) are backfilled. So the file lengthens in
lockstep with origin_prices_history — today it is ~2 months; give it a year and
the per-origin event study becomes statistically viable. Must run AFTER
origin_prices_history, freight and futures_price_history in the export order.
"""
import json
from datetime import datetime, timezone

from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json, validate_tender_parity

OUT_PATH = OUT_DIR / "tender_parity_history.json"

PARITY_ADDERS_USD = 72.0   # port transport ~7 + rent ~15 + loading-out ~40 + allowances ~10
CONTAINER_MT      = 21.6
LB_PER_MT         = 2204.62

# Robusta origins tendered against London RC. FOBbing mirrors lib/originCosts.ts;
# freight_route indexes the FBX-derived routes in freight.json.
ORIGINS = [
    {"key": "vietnam",        "name": "Vietnam Robusta FAQ G2", "fx": "VND=X", "unit": "per_kg",        "fobbing": 100.0, "freight_route": "vn-eu"},
    {"key": "brazil_conilon", "name": "Brazil Conilon T7",      "fx": "BRL=X", "unit": "per_saca_60kg", "fobbing": 200.0, "freight_route": "br-eu"},
    {"key": "uganda",         "name": "Uganda Robusta S15",     "fx": None,    "unit": "cents_lb",      "fobbing": 265.0, "freight_route": "et-eu"},
]


def _load(name: str) -> dict:
    p = OUT_DIR / name
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _ffill_map(pairs: list[tuple[str, float]]):
    """Return (sorted_dates, {date: value}) for as-of-or-before lookups."""
    d = {k: v for k, v in pairs if v is not None}
    return sorted(d.keys()), d


def _asof(dates: list[str], by_date: dict, on: str):
    if on in by_date:
        return by_date[on]
    lo, hi, ans = 0, len(dates) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if dates[mid] <= on:
            ans = dates[mid]; lo = mid + 1
        else:
            hi = mid - 1
    return by_date[ans] if ans is not None else None


def _to_usd_mt(price: float, fx: float | None, unit: str) -> float | None:
    if unit == "cents_lb":
        return price / 100.0 * LB_PER_MT
    if fx is None or fx <= 0:
        return None
    if unit == "per_kg":
        return price / fx * 1000.0
    if unit == "per_saca_60kg":
        return price / fx / 60.0 * 1000.0
    return None


def export_tender_parity() -> None:
    origin_prices = _load("origin_prices_history.json").get("origins") or {}
    fx_pairs      = _load("fx_history.json").get("pairs") or {}
    freight       = _load("freight.json")
    futures       = _load("futures_price_history.json")

    rc_dates, rc_by = _ffill_map([(r.get("date"), r.get("price")) for r in (futures.get("robusta") or [])])
    if not rc_dates:
        print("  tender_parity → no RC price history; skipping")
        return

    # freight per route: prefer the daily history column, fall back to current rate.
    freight_hist = freight.get("history") or []
    freight_routes = {r.get("id"): r.get("rate") for r in (freight.get("routes") or [])}

    def freight_usd_mt(route: str, on: str) -> float | None:
        dates, by = _ffill_map([(row.get("date"), row.get(route)) for row in freight_hist])
        feu = _asof(dates, by, on) if dates else None
        if feu is None:
            feu = freight_routes.get(route)
        return (feu / CONTAINER_MT) if feu else None

    existing = _load("tender_parity_history.json").get("origins") or {}
    out_origins: dict = {}

    for cfg in ORIGINS:
        key = cfg["key"]
        farmgate = (origin_prices.get(key) or {}).get("history") or []
        fx_dates, fx_by = ([], {})
        if cfg["fx"]:
            fx_dates, fx_by = _ffill_map([(r.get("date"), r.get("close")) for r in (fx_pairs.get(cfg["fx"]) or {}).get("history", [])])

        prior = {r["date"]: r for r in ((existing.get(key) or {}).get("history") or [])}
        for pt in farmgate:
            d, price = pt.get("date"), pt.get("price")
            if not d or price is None or d in prior:
                continue
            fx = _asof(fx_dates, fx_by, d) if cfg["fx"] else None
            rc = _asof(rc_dates, rc_by, d)
            fr = freight_usd_mt(cfg["freight_route"], d)
            farm_usd = _to_usd_mt(price, fx, cfg["unit"])
            if rc is None or farm_usd is None or fr is None:
                continue
            at_port   = farm_usd + cfg["fobbing"]
            tendering = at_port + fr + PARITY_ADDERS_USD
            prior[d] = {
                "date": d,
                "farmgate_usd": round(farm_usd, 1),
                "at_port": round(at_port, 1),
                "freight": round(fr, 1),
                "tendering": round(tendering, 1),
                "rc": round(rc, 1),
                "differential": round(at_port - rc, 1),
                "parity_gap": round(rc - tendering, 1),
                "tenderable": rc >= tendering,
            }
        out_origins[key] = {
            "name": cfg["name"], "market": "RC", "fobbing_usd": cfg["fobbing"],
            "history": sorted(prior.values(), key=lambda r: r["date"]),
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "meta": {
            "adders_usd": PARITY_ADDERS_USD, "container_mt": CONTAINER_MT,
            "note": "differential = at_port − RC; parity_gap = RC − tendering (≥0 ⇒ tenderable). "
                    "Append-only, as-observed; backfilled from origin_prices_history.",
        },
        "origins": out_origins,
    }
    safe_write_json(OUT_PATH, payload, validate_tender_parity)
    total = sum(len(v["history"]) for v in out_origins.values())
    print(f"  tender_parity_history.json → {total} rows across {len(out_origins)} origins")
