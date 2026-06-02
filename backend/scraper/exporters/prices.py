"""Price-ticker exporters (latest_prices, vn_physical_prices)."""
import json
from datetime import datetime, timedelta

from models import (
    NewsItem,
    PhysicalPrice,
)
from scraper.exporters import base as _base
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import (
    price_swing_guard,
    safe_write_json,
)


def export_latest_prices(db) -> None:
    """Pre-compute all ticker display values → latest_prices.json.
    Primary source: physical_prices table (typed columns, indexed).
    Fallback: NewsItem body parsing (used until physical_prices is populated)."""
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
    # Note: meta filter intentionally removed so that no-meta items (e.g. b3_icf) are found too
    recent_news = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date > datetime.utcnow() - timedelta(days=7))
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

    # KC front month — price + change both from NewsItem.meta (same source as chain table)
    kc = _chain_item("arabica")
    if kc:
        last = kc.get("last")
        chg  = kc.get("chg", 0) or 0
        sym  = kc.get("symbol", "KC")
        if last is not None:
            sign = "+" if chg >= 0 else ""
            tickers.append({"label": sym, "value": f"{float(last):.2f} ({sign}{chg:.2f})", "category": "futures"})

    # RC front month — same
    rc = _chain_item("robusta")
    if rc:
        last = rc.get("last")
        chg  = rc.get("chg", 0) or 0
        sym  = rc.get("symbol", "RC")
        if last is not None:
            sign = "+" if chg >= 0 else ""
            tickers.append({"label": sym, "value": f"{int(last):,} ({sign}{int(chg)})", "category": "futures"})

    # B3 ICF — settlement from PhysicalPrice; the contract-month label comes
    # from the scraper's structured meta (no body/title regex).
    b3it = _b3_item()
    if b3it and "B3_ICF" in pp:
        price = pp["B3_ICF"].price
        try:
            label_month = (_json.loads(b3it.meta or "{}") or {}).get("label_month")
        except Exception:
            label_month = None
        lbl = f"B3 4/5 {label_month}" if label_month else "B3 4/5"
        tickers.append({"label": lbl, "value": f"{price:.2f} USD/sac", "category": "futures"})

    # VN FAQ — from PhysicalPrice (structured at scrape time).
    usd_vnd = pp["USD_VND"].price if "USD_VND" in pp else None
    vn_faq_vnd = int(pp["VN_FAQ"].price) if "VN_FAQ" in pp else None
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
        _base.LATEST_PRICES_FALLBACK = True
        print("  latest_prices.json → WARN PhysicalPrice empty, FELL BACK to NewsItem regex parsing")
        tickers = _build_tickers_from_news(db)

    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "tickers": tickers,
    }
    path = OUT_DIR / "latest_prices.json"
    written = safe_write_json(
        path,
        result,
        lambda d: (len(d.get("tickers", [])) > 0, "no tickers"),
        sanity_fn=price_swing_guard(0.30),
    )
    print(f"  latest_prices.json → written:{written} {len(tickers)} items "
          f"({'PhysicalPrice' if pp else 'NewsItem fallback'})")


def _build_tickers_from_news(db) -> list[dict]:
    """Fallback: parse tickers from NewsItem.body (used before PhysicalPrice is populated)."""
    import json as _json
    import re as _re

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


def _vn_faq_from_physical(db, stale_hours: int):
    """(vnd_per_kg, usd_vnd, status) from PhysicalPrice. status ∈ ok|stale|missing.

    `stale` means we found a VN_FAQ row but it is older than the freshness
    threshold (the scraper has likely been failing silently) — the caller skips
    the write so the file's `updated` timestamp stops advancing.
    """
    vn = (db.query(PhysicalPrice)
            .filter(PhysicalPrice.symbol == "VN_FAQ")
            .order_by(PhysicalPrice.price_date.desc(), PhysicalPrice.scraped_at.desc())
            .first())
    fx = (db.query(PhysicalPrice)
            .filter(PhysicalPrice.symbol == "USD_VND")
            .order_by(PhysicalPrice.price_date.desc(), PhysicalPrice.scraped_at.desc())
            .first())
    if not vn or not fx:
        return None, None, "missing"
    age_h = (datetime.utcnow() - vn.scraped_at).total_seconds() / 3600
    if age_h > stale_hours:
        return None, None, "stale"
    return int(vn.price), float(fx.price), "ok"


def _vn_faq_from_news(db, stale_hours: int):
    """Transitional fallback: (vnd_per_kg, usd_vnd, status) parsed from NewsItem
    bodies via regex. Kept until the PhysicalPrice path is verified in prod."""
    import re as _re

    recent = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date > (datetime.utcnow() - timedelta(days=30)))
        .order_by(NewsItem.pub_date.desc())
        .all()
    )
    vn_item = next(
        (i for i in recent
         if "price" in (i.tags or []) and "robusta" in (i.tags or [])
         and "vietnam" in (i.tags or []) and "futures" not in (i.tags or [])),
        None,
    )
    fx_item = next(
        (i for i in recent if "fx" in (i.tags or []) and "vietnam" in (i.tags or [])),
        None,
    )
    if not vn_item or not fx_item:
        return None, None, "missing"
    age_h = (datetime.utcnow() - vn_item.pub_date).total_seconds() / 3600
    if age_h > stale_hours:
        return None, None, "stale"
    m1 = _re.search(r"price:\s*([\d.]+)\s*VND/kg", vn_item.body or "", _re.I)
    m2 = _re.search(r"price:\s*([\d.,]+)", fx_item.body or "", _re.I)
    if not m1 or not m2:
        return None, None, "missing"
    raw = m1.group(1)
    vnd_per_kg = int(raw.replace(".", "")) if _re.match(r"^\d{2,3}\.\d{3}$", raw) else int(float(raw))
    usd_vnd = float(m2.group(1).replace(",", ""))
    return vnd_per_kg, usd_vnd, "ok"


def _vn_physical_commentary(db) -> str | None:
    """Render the Vietnam Robusta absorption-ratio badge.

    Compares the latest two PhysicalPrice rows for VN_FAQ (Vietnam farmgate
    in VND/kg, converted to USD/MT via the same-date USD/VND row) against the
    latest two `commodity_prices.robusta` rows (London Robusta front-month
    close, already in USD/MT). The result is the share of the London move
    that landed in the local Vietnam farmgate — the user's locked wording:

      "X% of the market change has gone into the local price"

    Returns None when the historical pairs aren't available (e.g. first run,
    or the futures price for the matching session hasn't landed yet).
    """
    from models import CommodityPrice, PhysicalPrice

    # Two most recent VN_FAQ rows. Pulling distinct dates protects us from
    # multiple intra-day scrapes — we want the per-day series.
    vn_rows = (
        db.query(PhysicalPrice)
          .filter(PhysicalPrice.symbol == "VN_FAQ")
          .order_by(PhysicalPrice.price_date.desc(), PhysicalPrice.scraped_at.desc())
          .limit(20)
          .all()
    )
    # Dedupe to one row per price_date (keep most-recent scrape).
    by_date: dict = {}
    for r in vn_rows:
        if r.price_date not in by_date:
            by_date[r.price_date] = r
    distinct = sorted(by_date.values(), key=lambda r: r.price_date, reverse=True)
    if len(distinct) < 2:
        return None
    cur_vn, prev_vn = distinct[0], distinct[1]

    # USD/VND on the matching dates so the USD/MT conversion uses the right rate
    # on each side of the comparison (FX-only moves shouldn't pollute the
    # physical-vs-futures absorption ratio).
    fx_rows = (
        db.query(PhysicalPrice)
          .filter(PhysicalPrice.symbol == "USD_VND")
          .filter(PhysicalPrice.price_date.in_([cur_vn.price_date, prev_vn.price_date]))
          .all()
    )
    fx_by_date = {r.price_date: r.price for r in fx_rows}
    cur_fx  = fx_by_date.get(cur_vn.price_date)
    prev_fx = fx_by_date.get(prev_vn.price_date)
    if not cur_fx or not prev_fx:
        return None
    cur_usd_mt  = cur_vn.price  / cur_fx  * 1000
    prev_usd_mt = prev_vn.price / prev_fx * 1000
    phys_delta_usd_mt = round(cur_usd_mt - prev_usd_mt)

    # London Robusta closes on the same two dates. CommodityPrice symbol is
    # "robusta", price_unit is usd_per_mt — see macro_cot COMMODITY_SPECS.
    fut_rows = (
        db.query(CommodityPrice)
          .filter(CommodityPrice.symbol == "robusta")
          .filter(CommodityPrice.date.in_([cur_vn.price_date, prev_vn.price_date]))
          .all()
    )
    fut_by_date = {r.date: r.close_price for r in fut_rows}
    cur_fut  = fut_by_date.get(cur_vn.price_date)
    prev_fut = fut_by_date.get(prev_vn.price_date)

    if cur_fut is None or prev_fut is None:
        return None  # futures price for the matching session isn't in yet
    from scraper.commentary import render_absorption
    return render_absorption(
        origin="Vietnam Robusta",
        benchmark="London Robusta",
        phys_delta_usd_mt=phys_delta_usd_mt,
        futures_delta=round(cur_fut - prev_fut),
    )


def _emit_vn_physical_news(db) -> None:
    """Upsert a Vietnam-physical news_feed row carrying the absorption-ratio
    commentary. No-op when DATABASE_URL is unset (covered by the upstream
    DB session being None in offline modes) or the commentary can't be built."""
    from datetime import datetime, timezone

    text = _vn_physical_commentary(db)
    if not text:
        print("[vn-physical-news] insufficient history — skipping")
        return

    from scraper.commentary import embed_commentary
    from scraper.db import upsert_news_item

    meta_obj: dict = {"origin": "vietnam"}
    embed_commentary(meta_obj, text=text, has_update=True, is_latest_trading_day=True)
    upsert_news_item(db, {
        "title":    f"Vietnam FAQ vs London Robusta – {datetime.utcnow().date().isoformat()}",
        "body":     text,
        "source":   "VICOFA",
        "category": "supply",
        "lat":      12.668,    # Đắk Lắk
        "lng":      108.040,
        "tags":     ["vietnam", "physical-price", "absorption", "auto-commentary"],
        "meta":     json.dumps(meta_obj, ensure_ascii=False),
        "pub_date": datetime.now(timezone.utc),
    })
    print(f"[vn-physical-news] {text}")


def export_vn_physical_prices(db) -> None:
    """vn_physical_prices.json from the latest VN FAQ + USD/VND.

    Primary: PhysicalPrice (structured at scrape time). Fallback: NewsItem body
    regex, kept until the migration is verified (sets the Phase-3 signal flag).
    A 48h freshness gate on the source data stops the file's `updated` timestamp
    from advancing on stale data — the signal the freshness monitor relies on.
    """
    STALE_AFTER_HOURS = 48

    vnd_per_kg, usd_vnd, status = _vn_faq_from_physical(db, STALE_AFTER_HOURS)
    if status == "stale":
        print(f"  vn_physical_prices.json → SKIPPED (stale): VN_FAQ PhysicalPrice > {STALE_AFTER_HOURS}h old.")
        return
    if status == "missing":
        vnd_per_kg, usd_vnd, status = _vn_faq_from_news(db, STALE_AFTER_HOURS)
        if status == "stale":
            print(f"  vn_physical_prices.json → SKIPPED (stale): VN news item > {STALE_AFTER_HOURS}h old.")
            return
        if status == "ok":
            _base.LATEST_PRICES_FALLBACK = True
            print("  vn_physical_prices.json → WARN FELL BACK to NewsItem regex parsing")

    if status != "ok":
        print("  vn_physical_prices.json → skipped (no VN FAQ data)")
        return

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

    # News-feed badge: absorption ratio Vietnam vs London. Additive — never
    # fails the JSON export over a commentary write.
    try:
        _emit_vn_physical_news(db)
    except Exception as e:  # noqa: BLE001
        print(f"[vn-physical-news] FAILED: {e!r} — JSON already written")
