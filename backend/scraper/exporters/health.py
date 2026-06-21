"""Health/freshness manifest export."""
import json
from datetime import date, datetime

from models import (
    CommodityCot,
    CotWeekly,
    FertilizerImport,
    FreightRate,
    NewsItem,
    WeatherSnapshot,
)
from scraper.exporters import base as _base
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import (
    safe_write_json,
    validate_health,
)


def export_health(db, *, exporters_published_at: dict[str, str] | None = None) -> None:
    """Write health.json: last successful DB write per scraper + last
    successful publish per exporter topic.

    `exporters_published_at` is the map the orchestrator builds during
    its per-topic loop ({topic: iso_ts} for topics that published on
    this run). Topics that didn't run on this invocation (because the
    --only slice excluded them, or because they raised) keep their
    previous timestamp from the existing health.json — preserved by a
    defensive merge below, so a 1-topic --only run doesn't blow away
    the other topics' freshness signals.
    """

    def _ts(val) -> str | None:
        if val is None:
            return None
        return val.isoformat() if isinstance(val, (date, datetime)) else str(val)

    def _supply_ts(filename: str) -> str | None:
        """Read scraped_at/updated from a supply JSON file written earlier in this run."""
        try:
            p = OUT_DIR / filename
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("scraped_at") or d.get("updated")
        except Exception:
            pass
        return None

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

    # ECF European port stocks (monthly, from latest NewsItem)
    item = db.query(NewsItem).filter(NewsItem.source == "ECF").order_by(NewsItem.pub_date.desc()).first()
    scrapers["ecf"] = _ts(item.pub_date) if item else None

    # USDA PSD coffee (EU + Japan, annual, from DB — cache file doesn't survive cross-job)
    item = db.query(NewsItem).filter(NewsItem.source == "PSD Coffee").order_by(NewsItem.pub_date.desc()).first()
    scrapers["psd_coffee"] = _ts(item.pub_date) if item else None

    # Vietnam Robusta retail price (giacaphe.com via vietnam.py scraper).
    # Tracked separately from vietnam_exports (the supply scraper) — the price
    # scraper failed silently between Apr 23 and May 14 2026 without anyone
    # noticing because it wasn't surfaced here. 48h threshold in the freshness
    # workflow will alert on the next outage.
    item = db.query(NewsItem).filter(NewsItem.source == "Giacaphe").order_by(NewsItem.pub_date.desc()).first()
    scrapers["vietnam_price"] = _ts(item.pub_date) if item else None

    # AJCA (Japan native source, from DB — cache file doesn't survive cross-job)
    item = db.query(NewsItem).filter(NewsItem.source == "AJCA").order_by(NewsItem.pub_date.desc()).first()
    scrapers["ajca"] = _ts(item.pub_date) if item else None

    # CONAB Costs (arabica production cost, monthly)
    item = db.query(NewsItem).filter(NewsItem.source == "CONAB Custos").order_by(NewsItem.pub_date.desc()).first()
    scrapers["conab_costs"] = _ts(item.pub_date) if item else None

    # CONAB Safra (area/yield, monthly)
    item = db.query(NewsItem).filter(NewsItem.source == "CONAB Safra").order_by(NewsItem.pub_date.desc()).first()
    scrapers["conab_safra"] = _ts(item.pub_date) if item else None

    # Quant currency index (12-currency basket, daily, written by quant export
    # earlier in this run). Surfaces in the Macro tab's Coffee Currency Index
    # section — tracking it here means a silent quant_report.json staleness
    # gets caught by the freshness monitor.
    def _qci_ts() -> str | None:
        try:
            p = OUT_DIR / "quant_report.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("currency_index", {}).get("scraped_at")
        except Exception:
            return None
        return None
    scrapers["quant_currency_index"] = _qci_ts()

    # Retail coffee CPI (BLS + Eurostat + BCB SGS, monthly). Surfaces in the
    # Macro tab's Retail Inflation section.
    def _cpi_ts() -> str | None:
        try:
            p = OUT_DIR / "retail_cpi.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("last_updated")
        except Exception:
            return None
        return None
    scrapers["retail_cpi"] = _cpi_ts()

    # Headline US CPI (BLS CPI-U, monthly). Surfaces in the Macro tab's
    # US Inflation (CPI-U) section.
    def _us_cpi_ts() -> str | None:
        try:
            p = OUT_DIR / "us_cpi.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("last_updated")
        except Exception:
            return None
        return None
    scrapers["us_cpi"] = _us_cpi_ts()

    # FX history (12 currency pairs, daily closes, ~1 year window). Backs the
    # Macro tab's FX Pair Time-Series widget. Written by the quant currency
    # index workflow alongside quant_report.json.
    def _fx_history_ts() -> str | None:
        try:
            p = OUT_DIR / "fx_history.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("scraped_at")
        except Exception:
            return None
        return None
    scrapers["fx_history"] = _fx_history_ts()

    # Origin prices history (Vietnam/Brazil/Uganda daily farmgate accumulator).
    # Backs the Macro tab's Origin Prices time-series widget.
    def _origin_prices_ts() -> str | None:
        try:
            p = OUT_DIR / "origin_prices_history.json"
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                return d.get("scraped_at")
        except Exception:
            return None
        return None
    scrapers["origin_prices"] = _origin_prices_ts()

    # Cecafe daily (updates every business day)
    scrapers["cecafe_daily"]      = _supply_ts("cecafe_daily.json")

    # Origin export supply JSON files
    scrapers["brazil_exports"]    = _supply_ts("cecafe.json")
    scrapers["colombia_exports"]  = _supply_ts("colombia_supply.json")
    scrapers["honduras_exports"]  = _supply_ts("honduras_supply.json")
    scrapers["ethiopia_exports"]  = _supply_ts("ethiopia_supply.json")
    scrapers["vietnam_exports"]   = _supply_ts("vietnam_supply.json")
    scrapers["indonesia_exports"] = _supply_ts("indonesia_supply.json")
    scrapers["uganda_exports"]    = _supply_ts("uganda_supply.json")

    # ICE certified stocks — three freshness rows on two cadences (the daily
    # stock scraper and the two monthly reports run as separate workflows):
    #   ice_certified_daily        — newest snapshot date (daily, Mon-Fri)
    #   ice_arabica_ageing         — arabica ageing report month_end (monthly)
    #   ice_robusta_age_allowance  — robusta age-allowance month_end (monthly)
    def _cert_json(fname: str) -> dict:
        try:
            p = OUT_DIR / fname
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
        return {}
    _ca = _cert_json("certified_stocks_arabica.json")
    _cr = _cert_json("certified_stocks_robusta.json")

    def _last_snap_date(d: dict) -> str | None:
        ss = d.get("snapshots") or []
        return ss[-1].get("date") if ss else None
    _daily = [x for x in (_last_snap_date(_ca), _last_snap_date(_cr)) if x]
    scrapers["ice_certified_daily"]       = max(_daily) if _daily else None
    scrapers["ice_arabica_ageing"]        = (_ca.get("ageing_report") or {}).get("month_end")
    _aa = (_cr.get("monthly") or {}).get("age_allowance") or []
    scrapers["ice_robusta_age_allowance"] = _aa[-1].get("month_end") if _aa else None

    # Per-exporter timestamps — when did each topic in workflow 1.4 last
    # publish successfully? Merge-with-previous, so a partial (--only) run
    # or a single-topic failure doesn't blow away the rest of the map.
    # Fresh successes overwrite; previous values survive when the topic
    # didn't run or failed on this invocation.
    existing_exporters: dict[str, str | None] = {}
    try:
        prev = json.loads((OUT_DIR / "health.json").read_text(encoding="utf-8"))
        existing_exporters = prev.get("exporters") or {}
    except Exception:
        # First run, file missing/unreadable → empty baseline.
        pass
    exporters_map: dict[str, str | None] = {
        **existing_exporters,
        **(exporters_published_at or {}),
    }

    healthy   = sum(1 for v in scrapers.values() if v)
    published = sum(1 for v in exporters_map.values() if v)
    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "scrapers":     scrapers,
        "exporters":    exporters_map,
    }
    # Phase 3 sunset signal — present only when latest_prices had to use the
    # legacy regex fallback. CI/ops can alert on this; once it stays absent we
    # can delete _build_tickers_from_news and the extract_physical_price regex.
    if _base.LATEST_PRICES_FALLBACK:
        result["warnings"] = ["latest_prices_used_regex_fallback"]

    path = OUT_DIR / "health.json"
    safe_write_json(path, result, validate_health)
    print(
        f"  health.json → {healthy}/{len(scrapers)} scrapers + "
        f"{published}/{len(exporters_map)} exporters tracked"
    )
