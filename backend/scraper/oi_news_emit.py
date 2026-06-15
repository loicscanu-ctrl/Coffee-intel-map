"""Daily OI → news-feed commentary.

Reads the freshly-derived `oi_history.json` view (two most recent dates per
market) and renders the regime-matrix badge:

  Price Up   + OI Up   → LONG BUILDING
  Price Down + OI Up   → SHORT BUILDING
  Price Up   + OI Down → SHORT LIQUIDATION
  Price Down + OI Down → LONG LIQUIDATION

Pure helpers (commentary + matrix lookup) kept testable; the DB upsert is
a no-op when DATABASE_URL is unset.

KNOWN CAVEAT — nearby-OI definition
  Tracked in GitHub issue #132 item 7. This module currently sums the first
  two contracts (`contracts[:2]`) for the "nearby two" reading, mirroring
  what the existing OIHistoryTable UI does. After a front-month rolls off,
  that pair can briefly mix old/new fronts and the delta lags reality by
  one COT cycle. The fix is to derive "nearby" from the active roll
  window per market (NY: 17d before FND, LDN: 26d). Until that lands the
  template wording stays correct directionally; only the magnitude of the
  nearby clause is affected.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

_REGIME_MATRIX = {
    # (price_up, oi_up) → human regime label
    (True,  True):  "LONG BUILDING",
    (False, True):  "SHORT BUILDING",
    (True,  False): "SHORT LIQUIDATION",
    (False, False): "LONG LIQUIDATION",
}


def _front_price(contracts: list[dict]) -> float | None:
    """Front-month price = `last_price` of the first contract carrying one.
    Some entries in the snapshot are OI-only (no price), so we walk forward
    rather than indexing blindly."""
    for c in contracts:
        if c.get("last_price") is not None:
            return float(c["last_price"])
    return None


def _sum_oi(contracts: list[dict]) -> int:
    return sum(int(c.get("oi") or 0) for c in contracts)


def _compute_commentary_for_market(market_label: str, days: list[dict]) -> str | None:
    """Render the daily-OI badge for one market (NY or LDN).

    `days` is the per-market list from `oi_history.json`, newest first.
    Returns None when we don't have two days, or when a front-month price
    is unavailable on either day (no direction = no regime).
    """
    from scraper.commentary import render, signed

    if not days or len(days) < 2:
        return None
    cur, prev = days[0], days[1]
    cur_oi   = _sum_oi(cur.get("contracts", []))
    prev_oi  = _sum_oi(prev.get("contracts", []))
    if cur_oi == 0 and prev_oi == 0:
        return None
    total_delta = cur_oi - prev_oi

    cur_contracts  = cur.get("contracts", []) or []
    prev_contracts = prev.get("contracts", []) or []
    cur_nearby  = _sum_oi(cur_contracts[:2])
    prev_nearby = _sum_oi(prev_contracts[:2])
    nearby_delta  = cur_nearby - prev_nearby
    forward_delta = total_delta - nearby_delta

    cur_price  = _front_price(cur_contracts)
    prev_price = _front_price(prev_contracts)
    if cur_price is None or prev_price is None or cur_price == prev_price:
        return None  # no direction → skip rather than fabricate a regime
    price_up = cur_price > prev_price
    oi_up    = total_delta > 0
    regime = _REGIME_MATRIX[(price_up, oi_up)]
    price_dir_text = "PRICE UP" if price_up else "PRICE DOWN"

    try:
        return render("daily_oi", {
            "market":                 market_label,
            "total_oi_delta_signed":  signed(total_delta),
            "nearby_delta_signed":    signed(nearby_delta),
            "forward_delta_signed":   signed(forward_delta),
            "price_dir_text":         price_dir_text,
            "regime_text":            regime,
        })
    except Exception as e:  # noqa: BLE001
        print(f"[oi-news] render failed for {market_label}: {e!r}")
        return None


def emit_from_history_path(history_path: Path) -> int:
    """Read the just-written oi_history.json from disk, render commentary
    per market, and upsert news_feed rows. No-op when DATABASE_URL is unset.

    Reads from disk on purpose — the orchestrator has already saved the file,
    so any test/manual run that bypasses fetch_oi_json() can still drive this.
    Returns the number of news rows written (0–2).
    """
    import os
    if not os.environ.get("DATABASE_URL"):
        print("[oi-news] DATABASE_URL unset — skipping news_feed upsert")
        return 0
    if not history_path.exists():
        print(f"[oi-news] {history_path} missing — nothing to emit")
        return 0
    history = json.loads(history_path.read_text(encoding="utf-8"))

    from scraper.commentary import embed_commentary
    from scraper.db import get_session, upsert_news_item

    written = 0
    with get_session() as db:
        for market_key, label, lat, lng in (
            ("arabica", "IFUS KC",  40.74, -74.05),  # ICE Futures U.S. (NY)
            ("robusta", "ICE-EU RC", 51.51,  -0.09), # ICE Futures Europe (London)
        ):
            days = history.get(market_key) or []
            text = _compute_commentary_for_market(label, days)
            if not text:
                print(f"[oi-news] {label}: insufficient data (need 2 days + price direction)")
                continue
            latest_date = days[0]["date"]
            meta_obj: dict = {"market": market_key, "date": latest_date}
            embed_commentary(meta_obj, text=text, has_update=True, is_latest_trading_day=True)
            upsert_news_item(db, {
                "title":    f"{label} Daily OI Snapshot – {latest_date}",
                "body":     text,
                "source":   "ICE",
                "category": "futures",
                "lat":      lat,
                "lng":      lng,
                "tags":     ["daily-oi", market_key, "futures", "auto-commentary"],
                "meta":     json.dumps(meta_obj, ensure_ascii=False),
                "pub_date": datetime.now(UTC),
            })
            written += 1
            print(f"[oi-news] {label} {latest_date}: {text}")
    return written
