# backend/scraper/sources/macro_cot.py
# Daily scraper for multi-commodity COT positions + prices.
# Integrates into scraper/main.py ALL_SOURCES via run(page) stub.

import io
import sys
import zipfile
from datetime import date, timedelta

import pandas as pd
import requests

# ── COMMODITY_SPECS ────────────────────────────────────────────────────────────
# One entry per traded symbol.
# Entries marked *est* require manual verification at ice.com.
COMMODITY_SPECS = {
  # ── Hard Commodities ─────────────────────────────────────────────────────────
  "wti": {
    "name": "WTI Crude Oil", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "CL=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 1000, "price_unit": "usd_per_bbl", "currency": "USD",
  },
  "brent": {
    "name": "Brent Crude Oil", "sector": "hard", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Brent Crude Futures - ICE Futures Europe",
    "yfinance_ticker": "BZ=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 1000, "price_unit": "usd_per_bbl", "currency": "USD",
  },
  "natgas": {
    "name": "Natural Gas (Henry Hub)", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "HENRY HUB - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "NG=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 10000, "price_unit": "usd_per_mmbtu", "currency": "USD",
  },
  "heating_oil": {
    "name": "NY Harbor ULSD (Heating Oil)", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "NY HARBOR ULSD - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "HO=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 42000, "price_unit": "usd_per_gal", "currency": "USD",
  },
  "rbob": {
    "name": "RBOB Gasoline", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "GASOLINE RBOB - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "RB=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 42000, "price_unit": "usd_per_gal", "currency": "USD",
  },
  "lsgo": {
    "name": "Low Sulphur Gasoil", "sector": "hard", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Gasoil Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": "heating_oil",
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 264.17,
    "contract_unit": 100, "price_unit": "usd_per_mt", "currency": "USD",
  },
  "gold": {
    "name": "Gold", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "GOLD - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "GC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 100, "price_unit": "usd_per_oz", "currency": "USD",
  },
  "silver": {
    "name": "Silver", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "SILVER - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "SI=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 5000, "price_unit": "usd_per_oz", "currency": "USD",
  },
  "copper": {
    "name": "Copper", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "COPPER- #1 - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "HG=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 25000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  # ── Grains ───────────────────────────────────────────────────────────────────
  "corn": {
    "name": "Corn", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "CORN - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZC=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZC=F quotes in cents/bushel — divide by 100 to get USD/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
  },
  "wheat": {
    "name": "Wheat (SRW)", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZW=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZW=F quotes in cents/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
  },
  "soybeans": {
    "name": "Soybeans", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEANS - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZS=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZS=F quotes in cents/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
  },
  "soy_meal": {
    "name": "Soybean Meal", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEAN MEAL - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZM=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZM=F quotes in USD/short ton — no conversion needed
    "contract_unit": 100, "price_unit": "usd_per_short_ton", "currency": "USD",
  },
  "soy_oil": {
    "name": "Soybean Oil", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEAN OIL - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZL=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZL=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 60000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  # ── Meats ────────────────────────────────────────────────────────────────────
  "live_cattle": {
    "name": "Live Cattle", "sector": "meats", "exchange": "CME",
    "cftc_filter": "LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "LE=F", "price_proxy": None,
    "price_source": "yfinance",
    # LE=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 40000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  "feeder_cattle": {
    "name": "Feeder Cattle", "sector": "meats", "exchange": "CME",
    "cftc_filter": "FEEDER CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "GF=F", "price_proxy": None,
    "price_source": "yfinance",
    # GF=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 50000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  "lean_hogs": {
    "name": "Lean Hogs", "sector": "meats", "exchange": "CME",
    "cftc_filter": "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "HE=F", "price_proxy": None,
    "price_source": "yfinance",
    # HE=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 40000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  # ── Softs ────────────────────────────────────────────────────────────────────
  "cotton": {
    "name": "Cotton No. 2", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COTTON NO. 2 - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "CT=F", "price_proxy": None,
    "price_source": "yfinance",
    # CT=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 50000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  "sugar11": {
    "name": "Sugar No. 11", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "SUGAR NO. 11 - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "SB=F", "price_proxy": None,
    "price_source": "yfinance",
    # SB=F quotes in cents/lb (also used as proxy source for white_sugar)
    "yfinance_mult": 0.01,
    "contract_unit": 112000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  "white_sugar": {
    "name": "White Sugar No. 5", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE White Sugar Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": "sugar11",
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 2204.62,
    "contract_unit": 50, "price_unit": "usd_per_mt", "currency": "USD",
  },
  "arabica": {
    "name": "Coffee Arabica (C)", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COFFEE C - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "KC=F", "price_proxy": None,
    "price_source": "yfinance",
    # KC=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 37500, "price_unit": "usd_per_lb", "currency": "USD",
  },
  "robusta": {
    "name": "Coffee Robusta", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Robusta Coffee Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": None,
    "price_source": "cot_weekly",
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
  },
  "cocoa_ny": {
    "name": "Cocoa NY", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COCOA - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "CC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
  },
  "cocoa_ldn": {
    "name": "Cocoa London", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Cocoa Futures - ICE Futures Europe",
    # LCC=F is delisted on Yahoo Finance; proxy off NY Cocoa (CC=F, USD/MT) instead.
    "yfinance_ticker": None, "price_proxy": "cocoa_ny",
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 1.0,
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
  },
  "oj": {
    "name": "Orange Juice (FCOJ-A)", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "FRZN CONCENTRATED ORANGE JUICE - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "OJ=F", "price_proxy": None,
    "price_source": "yfinance",
    # OJ=F quotes in cents/lb
    "yfinance_mult": 0.01,
    "contract_unit": 15000, "price_unit": "usd_per_lb", "currency": "USD",
  },
  # ── Micros ───────────────────────────────────────────────────────────────────
  "oats": {
    "name": "Oats", "sector": "micros", "exchange": "CBOT",
    "cftc_filter": "OATS - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZO=F", "price_proxy": None,
    "price_source": "yfinance",
    # ZO=F quotes in cents/bushel
    "yfinance_mult": 0.01,
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
  },
  "lumber": {
    "name": "Lumber", "sector": "micros", "exchange": "CME",
    "cftc_filter": "LUMBER - CHICAGO MERCANTILE EXCHANGE",
    # LBS=F is delisted on Yahoo Finance; no price source available.
    "ice_filter": None, "yfinance_ticker": None, "price_proxy": None,
    "price_source": None,
    "contract_unit": 110000, "price_unit": "usd_per_mbf", "currency": "USD",
  },
  "rough_rice": {
    "name": "Rough Rice", "sector": "micros", "exchange": "CBOT",
    "cftc_filter": "ROUGH RICE - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZR=F", "price_proxy": None,
    "price_source": "yfinance", "yfinance_mult": 0.01,
    "contract_unit": 2000, "price_unit": "usd_per_cwt", "currency": "USD",
  },
}

# ── CFTC column name constants ─────────────────────────────────────────────────
_CFTC_MARKET_COL = "Market_and_Exchange_Names"
_CFTC_DATE_COL   = "As_of_Date_In_Form_YYMMDD"
_CFTC_MM_LONG    = "M_Money_Positions_Long_All"
_CFTC_MM_SHORT   = "M_Money_Positions_Short_All"
_CFTC_MM_SPREAD  = "M_Money_Positions_Spread_All"
_CFTC_OI         = "Open_Interest_All"

# ICE Europe COT file uses the same CFTC disaggregated format with identical column names.
_ICE_MARKET_COL  = "Market_and_Exchange_Names"
_ICE_DATE_COL    = "As_of_Date_In_Form_YYMMDD"
_ICE_MM_LONG     = "M_Money_Positions_Long_All"
_ICE_MM_SHORT    = "M_Money_Positions_Short_All"
_ICE_MM_SPREAD   = "M_Money_Positions_Spread_All"
_ICE_OI          = "Open_Interest_All"


def _safe_int(val, default: int = 0) -> int:
    """Cast val to int; return default on NaN/None/blank."""
    try:
        if pd.isna(val):
            return default
    except (TypeError, ValueError):
        pass
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


_GBPUSD_TICKER = "GBPUSD=X"


def _fetch_gbpusd_rates(dates: set) -> dict:
    """Fetch GBP/USD spot rates for a set of dates via yfinance.
    Returns {date: rate} using up to a 6-day lookback per date.
    """
    import yfinance as yf
    if not dates:
        return {}
    start = min(dates) - timedelta(days=7)
    end   = max(dates) + timedelta(days=1)
    result = {}
    try:
        hist = yf.download(_GBPUSD_TICKER, start=start.isoformat(), end=end.isoformat(),
                           interval="1d", auto_adjust=True, progress=False)
        if hist.empty:
            print(f"[macro_cot] WARNING: no GBPUSD data for range {start}–{end}", file=sys.stderr)
            return result
        hist.index = pd.to_datetime(hist.index).date
        for dt in dates:
            for offset in range(6):
                check = dt - timedelta(days=offset)
                if check in hist.index:
                    result[dt] = float(hist.loc[check, "Close"])
                    break
    except Exception as e:
        print(f"[macro_cot] GBPUSD fetch error: {e}", file=sys.stderr)
    return result


def _download_cftc_df(year: int) -> pd.DataFrame:
    url = f"https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        csv_name = [n for n in z.namelist() if n.endswith(".txt") or n.endswith(".csv")][0]
        with z.open(csv_name) as f:
            return pd.read_csv(f, low_memory=False)


def _download_ice_df(year: int) -> pd.DataFrame:
    url = f"https://www.ice.com/publicdocs/futures/COTHist{year}.csv"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    # ICE files may have a UTF-8 BOM on the first column — use utf-8-sig to strip it
    return pd.read_csv(io.StringIO(resp.content.decode("utf-8-sig")), low_memory=False)


def _parse_cftc(df: pd.DataFrame) -> dict:
    """Return {symbol: (report_date, fields)} for latest row per CFTC symbol."""
    results = {}
    for sym, spec in COMMODITY_SPECS.items():
        filt = spec.get("cftc_filter")
        if not filt:
            continue
        mask = df[_CFTC_MARKET_COL].str.contains(filt, na=False, regex=False)
        rows = df[mask]
        if rows.empty:
            print(f"[macro_cot] WARNING: no CFTC rows matched '{filt}' for {sym}", file=sys.stderr)
            continue
        # Prefer exact match to avoid e.g. "E-MICRO GOLD" matching "GOLD - COMMODITY EXCHANGE INC."
        exact = rows[rows[_CFTC_MARKET_COL].str.strip() == filt]
        if not exact.empty:
            rows = exact
        rows = rows.copy()
        rows["_date_parsed"] = pd.to_datetime(rows[_CFTC_DATE_COL], format="%y%m%d", errors="coerce")
        rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
        row = rows.iloc[0]
        report_date = row["_date_parsed"].date()
        results[sym] = (report_date, {
            "mm_long":   _safe_int(row[_CFTC_MM_LONG]),
            "mm_short":  _safe_int(row[_CFTC_MM_SHORT]),
            "mm_spread": _safe_int(row[_CFTC_MM_SPREAD]),
            "oi_total":  _safe_int(row[_CFTC_OI]),
        })
    return results


def _parse_ice(df: pd.DataFrame) -> dict:
    """Return {symbol: (report_date, fields)} for latest row per ICE symbol."""
    results = {}
    for sym, spec in COMMODITY_SPECS.items():
        filt = spec.get("ice_filter")
        if not filt:
            continue
        mask = df[_ICE_MARKET_COL].str.contains(filt, na=False, regex=False)
        rows = df[mask]
        if rows.empty:
            print(f"[macro_cot] WARNING: no ICE rows matched '{filt}' for {sym}", file=sys.stderr)
            continue
        rows = rows.copy()
        rows["_date_parsed"] = pd.to_datetime(rows[_ICE_DATE_COL], format="%y%m%d", errors="coerce")
        rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
        row = rows.iloc[0]
        report_date = row["_date_parsed"].date()
        results[sym] = (report_date, {
            "mm_long":   _safe_int(row[_ICE_MM_LONG]),
            "mm_short":  _safe_int(row[_ICE_MM_SHORT]),
            "mm_spread": _safe_int(row[_ICE_MM_SPREAD]),
            "oi_total":  _safe_int(row[_ICE_OI]),
        })
    return results


def _fetch_yfinance_prices(symbols_dates: list) -> dict:
    """Batch-fetch prices for [(symbol, date), ...] using yfinance.
    Returns {(symbol, date): price_usd}. Groups by ticker to minimise API calls.
    """
    import yfinance as yf
    # Group by ticker
    ticker_map: dict[str, list] = {}
    for sym, dt in symbols_dates:
        spec = COMMODITY_SPECS[sym]
        ticker = spec["yfinance_ticker"]
        if ticker not in ticker_map:
            ticker_map[ticker] = []
        ticker_map[ticker].append((sym, dt))

    results = {}
    for ticker, pairs in ticker_map.items():
        dates = sorted({dt for _, dt in pairs})
        start = min(dates) - timedelta(days=7)
        end   = max(dates) + timedelta(days=1)
        try:
            hist = yf.download(ticker, start=start.isoformat(), end=end.isoformat(),
                               interval="1d", auto_adjust=True, progress=False)
            if hist.empty:
                continue
            hist.index = pd.to_datetime(hist.index).date
            for sym, dt in pairs:
                for offset in range(6):
                    check = dt - timedelta(days=offset)
                    if check in hist.index:
                        close = float(hist.loc[check, "Close"])
                        mult  = COMMODITY_SPECS[sym].get("yfinance_mult", 1.0)
                        results[(sym, dt)] = close * mult
                        break
        except Exception as e:
            print(f"[macro_cot] yfinance error for {ticker}: {e}", file=sys.stderr)
    return results


def _fetch_and_upsert(db) -> None:
    from scraper.db_macro import upsert_commodity_cot, upsert_commodity_price
    from models import CotWeekly

    today = date.today()
    year  = today.year

    # Download CFTC — fallback to prior year if current year returns 0 rows
    try:
        cftc_df = _download_cftc_df(year)
        if len(cftc_df) == 0:
            raise ValueError("empty")
    except Exception as e:
        print(f"[macro_cot] CFTC {year} unavailable ({e}), falling back to {year - 1}", file=sys.stderr)
        cftc_df = _download_cftc_df(year - 1)

    # Download ICE Europe — same fallback
    try:
        ice_df = _download_ice_df(year)
        if len(ice_df) == 0:
            raise ValueError("empty")
    except Exception as e:
        print(f"[macro_cot] ICE {year} unavailable ({e}), falling back to {year - 1}", file=sys.stderr)
        ice_df = _download_ice_df(year - 1)

    cot_data = {}
    cot_data.update(_parse_cftc(cftc_df))
    cot_data.update(_parse_ice(ice_df))

    # Upsert COT rows
    for sym, (report_date, fields) in cot_data.items():
        upsert_commodity_cot(db, sym, report_date, fields)

    # Build yfinance fetch list (yfinance + yfinance_gbp both need price download)
    yfinance_pairs = [
        (sym, cot_data[sym][0])
        for sym in cot_data
        if COMMODITY_SPECS[sym]["price_source"] in ("yfinance", "yfinance_gbp")
    ]
    price_cache = _fetch_yfinance_prices(yfinance_pairs)

    # Fetch GBP/USD rates for any yfinance_gbp symbols
    gbp_dates = {
        cot_data[sym][0]
        for sym in cot_data
        if COMMODITY_SPECS[sym]["price_source"] == "yfinance_gbp"
    }
    gbpusd_cache = _fetch_gbpusd_rates(gbp_dates) if gbp_dates else {}

    for sym in cot_data:
        report_date = cot_data[sym][0]
        spec = COMMODITY_SPECS[sym]
        src  = spec["price_source"]

        if src == "yfinance":
            price = price_cache.get((sym, report_date))
            if price is None:
                print(f"[macro_cot] WARNING: no yfinance price for {sym} on {report_date}", file=sys.stderr)
                continue
            upsert_commodity_price(db, sym, report_date, price)

        elif src == "yfinance_gbp":
            price_gbp = price_cache.get((sym, report_date))
            gbpusd    = gbpusd_cache.get(report_date)
            if price_gbp is None:
                print(f"[macro_cot] WARNING: no yfinance price for {sym} ({spec['yfinance_ticker']}) on {report_date}", file=sys.stderr)
                continue
            if gbpusd is None:
                print(f"[macro_cot] WARNING: no GBPUSD rate for {report_date}, skipping {sym}", file=sys.stderr)
                continue
            upsert_commodity_price(db, sym, report_date, price_gbp * gbpusd)

        elif src == "proxy":
            proxy_sym = spec["price_proxy"]
            # Use the proxy symbol's report_date if it has one, else current sym's date
            proxy_date = cot_data.get(proxy_sym, (report_date,))[0]
            proxy_price = price_cache.get((proxy_sym, proxy_date))
            if proxy_price is None:
                print(f"[macro_cot] WARNING: no proxy price for {sym} (proxy={proxy_sym})", file=sys.stderr)
                continue
            converted = proxy_price * spec["proxy_to_usd_per_mt_factor"]
            upsert_commodity_price(db, sym, report_date, converted)

        elif src == "cot_weekly":
            # Robusta: read price_ldn from cot_weekly table for matching date
            row = (db.query(CotWeekly)
                     .filter_by(market="ldn", date=report_date)
                     .first())
            if row and row.price_ldn:
                upsert_commodity_price(db, sym, report_date, float(row.price_ldn))
            else:
                print(f"[macro_cot] WARNING: no cot_weekly price_ldn for robusta on {report_date}", file=sys.stderr)


async def run(page):  # page unused — no browser needed
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from scraper.db import get_session
    db = get_session()
    try:
        _fetch_and_upsert(db)
    finally:
        db.close()
