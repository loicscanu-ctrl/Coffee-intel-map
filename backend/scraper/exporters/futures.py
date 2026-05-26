"""Futures-chain and OI→FND-chart exporters.

Split out of export_static_json.py as the first per-topic exporter module.
Reads NewsItem futures chains (+ the OI history / 5-year contract archive) and
writes futures_chain.json and oi_fnd_chart.json.
"""
import json
from datetime import date, datetime, timedelta

from contract_dates import calc_fnd as _calc_fnd
from contract_dates import trading_days_to as _trading_days_to
from models import NewsItem
from scraper import symbols as _sym
from scraper.exporters.base import OUT_DIR, ROOT
from scraper.validate_export import (
    safe_write_json,
    validate_futures_chain,
    validate_oi_fnd_chart,
)


def export_futures_chain(db) -> None:
    # Bound the scan to a recent window rather than pulling the entire
    # news_feed history into memory: we only need the latest chain per market
    # (the validator rejects pub_date > 7d old anyway). Tag membership stays a
    # Python filter because `tags` is a JSON column, not a Postgres array, so a
    # DB-side array containment filter wouldn't be portable to the SQLite tests.
    cutoff = datetime.utcnow() - timedelta(days=120)
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None), NewsItem.pub_date >= cutoff)
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


def _load_oi_history() -> dict:
    """Load oi_history.json (written by fetch_oi_json.py / daily_oi.yml)."""
    path = ROOT / "data" / "oi_history.json"
    if not path.exists():
        path = OUT_DIR / "oi_history.json"
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _load_contract_archive() -> dict:
    """Load the date-keyed per-contract OI+price archive
    (data/contract_prices_archive.json). Shape:
        {market: {YYYY-MM-DD: {SYMBOL: {oi, price}}}}
    This is the 5-year authoritative source — far deeper than the 30-day
    oi_history.json. RM robusta symbols are already normalized to RC here."""
    path = ROOT / "data" / "contract_prices_archive.json"
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def export_oi_fnd_chart(db) -> None:
    # Same memory bound as export_futures_chain: the FND series only needs the
    # last ~45 trading days of chain snapshots, so a 120-day calendar window is
    # ample while keeping the query from scanning the whole news_feed history.
    cutoff = datetime.utcnow() - timedelta(days=120)
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None), NewsItem.pub_date >= cutoff)
        .order_by(NewsItem.pub_date.asc())
        .all()
    )

    today     = date.today()
    cur_yr    = str(today.year)[-2:]
    prev_yr   = str(today.year - 1)[-2:]
    allowed   = {cur_yr, prev_yr}

    # Load oi_history.json — provides daily OI snapshots with full per-contract
    # OI (Playwright-fetched from Barchart), filling the -45…-30 day gap where
    # DB NewsItems may be missing OI (yfinance fallback doesn't supply OI).
    oi_history = _load_oi_history()
    # Load the 5-year per-contract archive — the deepest OI source, gives a
    # complete -45..0 window for every contract.
    contract_archive = _load_contract_archive()

    result = {}
    for market in ("arabica", "robusta"):
        mkt_key = "arabica" if market == "arabica" else "robusta"
        series: dict[str, dict[int, int]] = {}  # sym → {day → oi}

        # 1. DB-derived points (from daily futures scraper)
        chain_items = [
            i for i in all_items
            if "futures" in (i.tags or [])
            and "price"   in (i.tags or [])
            and market     in (i.tags or [])
        ]
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
                    oi  = c.get("oi")
                    if oi is None:
                        continue
                    fnd = _calc_fnd(sym)
                    if not fnd:
                        continue
                    day_val = _trading_days_to(trade_date, fnd)
                    if day_val < -45 or day_val > 0:
                        continue
                    series.setdefault(sym, {})[day_val] = oi
            except Exception:
                pass

        # 2. oi_history.json — fills in OI from the Playwright-fetched daily
        #    snapshots (always has real OI, extends further back in time).
        for snapshot in oi_history.get(mkt_key, []):
            try:
                snap_date = date.fromisoformat(snapshot["date"])
            except Exception:
                continue
            for c in snapshot.get("contracts", []):
                sym = c.get("symbol", "")
                oi  = c.get("oi")
                if oi is None:
                    continue
                fnd = _calc_fnd(sym)
                if not fnd:
                    continue
                day_val = _trading_days_to(snap_date, fnd)
                if day_val < -45 or day_val > 0:
                    continue
                # Don't overwrite DB-sourced point — DB is authoritative
                series.setdefault(sym, {}).setdefault(day_val, oi)

        # 3. contract_prices_archive.json — the 5-year authoritative per-contract
        #    OI history. Deepest source: gives a complete -45..0 window for
        #    every contract (oi_history only reaches ~21 trading days back).
        #    Archive stores robusta as RC; this chart's pipeline (and frontend
        #    STATIC_SERIES) uses RM, so convert RC→RM here for merge consistency.
        archive_market = contract_archive.get(mkt_key, {})
        # Only the last ~120 calendar days can contain a -45..0 trading-day
        # point for a still-current contract, so skip the rest of the 5-year
        # archive up front (avoids a full ~2,700-date scan every export).
        archive_cutoff = (today - timedelta(days=120)).isoformat()
        for snap_date_str, contracts in archive_market.items():
            if snap_date_str < archive_cutoff:
                continue
            try:
                snap_date = date.fromisoformat(snap_date_str)
            except Exception:
                continue
            for sym, cell in contracts.items():
                oi = cell.get("oi")
                if oi is None:
                    continue
                chart_sym = _sym.to_display(sym)  # RC→RM for the FND chart convention
                fnd = _calc_fnd(chart_sym)
                if not fnd:
                    continue
                day_val = _trading_days_to(snap_date, fnd)
                if day_val < -45 or day_val > 0:
                    continue
                series.setdefault(chart_sym, {}).setdefault(day_val, oi)

        candidates = []
        for sym, day_map in series.items():
            if sym[-2:] not in allowed:
                continue
            fnd = _calc_fnd(sym)
            if not fnd:
                continue
            candidates.append({
                "symbol": sym,
                "label":  sym.replace("RM", "").replace("KC", ""),
                "fnd":    fnd.isoformat(),
                "data":   sorted(
                    [{"day": d, "oi": o} for d, o in day_map.items()],
                    key=lambda x: x["day"],
                ),
            })
        candidates.sort(key=lambda x: x["fnd"])
        result[market] = candidates

    path = OUT_DIR / "oi_fnd_chart.json"
    written = safe_write_json(path, result, validate_oi_fnd_chart)
    print(f"  oi_fnd_chart.json → written:{written} arabica:{len(result['arabica'])} robusta:{len(result['robusta'])} series")
