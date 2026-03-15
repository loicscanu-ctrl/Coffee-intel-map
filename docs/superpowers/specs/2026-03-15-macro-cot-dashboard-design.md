# Macro COT Dashboard — Implementation Spec

## Goal

Replace the fake "Commodity Market" and "Soft Commodities" lines in the Global Money Flow chart (Step 1 of the COT Dashboard) with real Money Manager positioning data drawn from CFTC Disaggregated COT and ICE Futures Europe COT, covering ~28 major commodity futures markets. Add gross exposure, net exposure, and initial margin calculations to give a true picture of speculative capital deployed across commodity markets.

## Architecture

Two new DB tables store positions and prices separately. A hardcoded `COMMODITY_SPECS` dict in Python holds contract specifications and margin rates. A new daily scraper (`macro_cot.py`) populates both tables. A one-time backfill script loads 52 weeks of history. A new API endpoint serves computed exposure figures to the frontend.

## Tech Stack

- **Backend:** Python 3, SQLAlchemy, FastAPI, `yfinance` (new pip dependency)
- **DB:** PostgreSQL (same Supabase instance)
- **Data sources:** CFTC Disaggregated COT ZIP (NYMEX/COMEX/CBOT/CME/ICE US), ICE Futures Europe COT CSV
- **Frontend:** Next.js / React, Recharts (existing)

---

## File Summary

### New files
- `backend/scraper/sources/macro_cot.py` — daily scraper
- `backend/scraper/db_macro.py` — DB upsert helpers
- `backend/routes/macro_cot.py` — API endpoint
- `backend/import_macro_cot.py` — one-time backfill script

### Modified files
- `backend/models.py` — add `CommodityCot`, `CommodityPrice` models
- `backend/requirements.txt` — add `yfinance>=0.2.40`
- `backend/main.py` — register macro_cot router
- `frontend/lib/api.ts` — add `fetchMacroCot()`
- `frontend/components/futures/CotDashboard.tsx` — update Step 1 chart

Note: `backend/scraper/main.py` requires **no changes**. The `run(page)` stub in `macro_cot.py` matches the existing `ALL_SOURCES` interface so it slots in without any modification to the Playwright loop.

---

## Data Layer

### Table: `commodity_cot`

```sql
CREATE TABLE commodity_cot (
    id         SERIAL PRIMARY KEY,
    date       DATE        NOT NULL,
    symbol     VARCHAR(20) NOT NULL,
    mm_long    INTEGER,
    mm_short   INTEGER,
    mm_spread  INTEGER,
    oi_total   INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (date, symbol)
);
```

### Table: `commodity_prices`

```sql
CREATE TABLE commodity_prices (
    id          SERIAL PRIMARY KEY,
    date        DATE             NOT NULL,
    symbol      VARCHAR(20)      NOT NULL,
    close_price DOUBLE PRECISION,
    currency    VARCHAR(3)       DEFAULT 'USD',
    created_at  TIMESTAMP        DEFAULT NOW(),
    UNIQUE (date, symbol)
);
```

All prices stored in **USD**. GBP→USD conversion happens at scrape time (see London Cocoa note below). Both tables added to `backend/models.py` as SQLAlchemy models. `Base.metadata.create_all()` in `main.py` creates them on next startup.

### COMMODITY_SPECS dict (hardcoded in `macro_cot.py`)

One entry per symbol. Fields:

| Field | Description |
|---|---|
| `name` | Display name |
| `sector` | `hard` / `grains` / `meats` / `softs` / `micros` |
| `exchange` | Source exchange |
| `cftc_filter` | Substring to match `Market_and_Exchange_Names` in CFTC CSV (`None` for ICE Europe) |
| `ice_filter` | Substring to match contract name in ICE Europe CSV (`None` for CFTC) |
| `yfinance_ticker` | Yahoo Finance continuous front-month ticker (`None` if proxy used) |
| `price_proxy` | Symbol whose price to use when no direct ticker (e.g. `"heating_oil"` for lsgo) |
| `price_source` | `"yfinance"` / `"proxy"` / `"cot_weekly"` |
| `contract_unit` | Contract size in base units |
| `price_unit` | How to interpret price for USD notional calculation (see Exposure section) |
| `margin_outright_usd` | Exchange initial margin for outright positions (USD) |
| `margin_spread_usd` | Exchange initial margin for spread positions (USD) |

Full `COMMODITY_SPECS` (margins from RJO Brien guide effective 3/14/2026; entries marked `*est*` require manual verification at ice.com):

```python
COMMODITY_SPECS = {
  # ── Hard Commodities ───────────────────────────────────────────────────────
  "wti": {
    "name": "WTI Crude Oil", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "CL=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 1000, "price_unit": "usd_per_bbl", "currency": "USD",
    "margin_outright_usd": 4675, "margin_spread_usd": 420,
  },
  "brent": {
    "name": "Brent Crude Oil", "sector": "hard", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Brent Crude Futures - ICE Futures Europe",
    "yfinance_ticker": "BZ=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 1000, "price_unit": "usd_per_bbl", "currency": "USD",
    "margin_outright_usd": 4785, "margin_spread_usd": 540,
  },
  "natgas": {
    "name": "Natural Gas (Henry Hub)", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "NG=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 10000, "price_unit": "usd_per_mmbtu", "currency": "USD",
    "margin_outright_usd": 6259, "margin_spread_usd": 570,
  },
  "heating_oil": {
    "name": "NY Harbor ULSD (Heating Oil)", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "N.Y. HARBOR ULSD FUTURES - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "HO=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 42000, "price_unit": "usd_per_gal", "currency": "USD",
    "margin_outright_usd": 7596, "margin_spread_usd": 690,
  },
  "rbob": {
    "name": "RBOB Gasoline", "sector": "hard", "exchange": "NYMEX",
    "cftc_filter": "RBOB GASOLINE - NEW YORK MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "RB=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 42000, "price_unit": "usd_per_gal", "currency": "USD",
    "margin_outright_usd": 5988, "margin_spread_usd": 545,
  },
  "lsgo": {
    "name": "Low Sulphur Gasoil", "sector": "hard", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Gas Oil Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": "heating_oil",
    "price_source": "proxy",
    # Proxy unit conversion: heating_oil price is USD/gallon; LSGO contract is 100 MT.
    # 1 MT gasoil ≈ 264.17 gallons → proxy_price_usd_per_mt = price_usd_per_gal × 264.17
    # contract_value_usd = price_usd_per_gal × 264.17 × 100
    "proxy_to_usd_per_mt_factor": 264.17,
    "contract_unit": 100, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 8993, "margin_spread_usd": 800,  # *est* verify at ICE
  },
  "gold": {
    "name": "Gold", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "GOLD - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "GC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 100, "price_unit": "usd_per_oz", "currency": "USD",
    "margin_outright_usd": 38905, "margin_spread_usd": 400,
  },
  "silver": {
    "name": "Silver", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "SILVER - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "SI=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 5000, "price_unit": "usd_per_oz", "currency": "USD",
    "margin_outright_usd": 62304, "margin_spread_usd": 441,
  },
  "copper": {
    "name": "Copper", "sector": "hard", "exchange": "COMEX",
    "cftc_filter": "COPPER- #1 - COMMODITY EXCHANGE INC.",
    "ice_filter": None, "yfinance_ticker": "HG=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 25000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 13200, "margin_spread_usd": 660,
  },
  # ── Grains ─────────────────────────────────────────────────────────────────
  "corn": {
    "name": "Corn", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "CORN - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 1073, "margin_spread_usd": 303,
  },
  "wheat": {
    "name": "Wheat (SRW)", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "WHEAT - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZW=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 1815, "margin_spread_usd": 440,
  },
  "soybeans": {
    "name": "Soybeans", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEANS - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZS=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 2200, "margin_spread_usd": 660,
  },
  "soy_meal": {
    "name": "Soybean Meal", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEAN MEAL - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZM=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 100, "price_unit": "usd_per_short_ton", "currency": "USD",
    "margin_outright_usd": 1705, "margin_spread_usd": 495,
  },
  "soy_oil": {
    "name": "Soybean Oil", "sector": "grains", "exchange": "CBOT",
    "cftc_filter": "SOYBEAN OIL - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZL=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 60000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 2310, "margin_spread_usd": 605,
  },
  # ── Meats ──────────────────────────────────────────────────────────────────
  "live_cattle": {
    "name": "Live Cattle", "sector": "meats", "exchange": "CME",
    "cftc_filter": "LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "LE=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 40000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 3630, "margin_spread_usd": 1100,
  },
  "feeder_cattle": {
    "name": "Feeder Cattle", "sector": "meats", "exchange": "CME",
    "cftc_filter": "FEEDER CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "GF=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 50000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 6600, "margin_spread_usd": 1595,
  },
  "lean_hogs": {
    "name": "Lean Hogs", "sector": "meats", "exchange": "CME",
    "cftc_filter": "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "HE=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 40000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 1870, "margin_spread_usd": 1760,
  },
  # ── Softs ──────────────────────────────────────────────────────────────────
  "cotton": {
    "name": "Cotton No. 2", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COTTON NO. 2 - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "CT=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 50000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 1254, "margin_spread_usd": 364,
  },
  "sugar11": {
    "name": "Sugar No. 11", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "SUGAR NO. 11 (WORLD) - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "SB=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 112000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 838, "margin_spread_usd": 183,
  },
  "white_sugar": {
    "name": "White Sugar No. 5", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE White Sugar Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": "sugar11",
    "price_source": "proxy",
    # Proxy unit conversion: sugar11 price is USD/lb; White Sugar contract is 50 MT.
    # 1 MT = 2204.62 lbs → proxy_price_usd_per_mt = price_usd_per_lb × 2204.62
    # contract_value_usd = price_usd_per_lb × 2204.62 × 50
    "proxy_to_usd_per_mt_factor": 2204.62,
    "contract_unit": 50, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 1526, "margin_spread_usd": 150,  # *est* verify at ICE
  },
  "arabica": {
    "name": "Coffee Arabica (C)", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COFFEE C - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "KC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 37500, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 7376, "margin_spread_usd": 830,
  },
  "robusta": {
    "name": "Coffee Robusta", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Robusta Coffee Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": None,
    # price_source="cot_weekly": read price_ldn from cot_weekly table for matching date
    "price_source": "cot_weekly",
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 5000, "margin_spread_usd": 500,  # *est* verify at ICE
  },
  "cocoa_ny": {
    "name": "Cocoa NY", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "COCOA - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "CC=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 4961, "margin_spread_usd": 535,
  },
  "cocoa_ldn": {
    "name": "Cocoa London", "sector": "softs", "exchange": "ICE Europe",
    "cftc_filter": None,
    "ice_filter": "ICE Cocoa Futures - ICE Futures Europe",
    "yfinance_ticker": None, "price_proxy": "cocoa_ny",
    # NY Cocoa (CC=F) price is already in USD/MT — same unit as London Cocoa.
    # No unit conversion needed; proxy price is used directly.
    # proxy_to_usd_per_mt_factor = 1.0 (identity)
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 1.0,
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 7069, "margin_spread_usd": 700,  # £5,566 × 1.27
  },
  "oj": {
    "name": "Orange Juice (FCOJ-A)", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "FROZEN CONCENTRATED ORANGE JUICE - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "OJ=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 15000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 4775, "margin_spread_usd": 1881,
  },
  # ── Micros ─────────────────────────────────────────────────────────────────
  "oats": {
    "name": "Oats", "sector": "micros", "exchange": "CBOT",
    "cftc_filter": "OATS - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZO=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 5000, "price_unit": "usd_per_bushel", "currency": "USD",
    "margin_outright_usd": 1375, "margin_spread_usd": 1100,
  },
  "lumber": {
    "name": "Lumber", "sector": "micros", "exchange": "CME",
    # CFTC filter string must be verified on first run — may need "LBR" variant
    "cftc_filter": "RANDOM LENGTH LUMBER - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "LBS=F", "price_proxy": None,
    # If LBS=F returns no data, switch to "LBR=F" (physically-delivered contract)
    "price_source": "yfinance",
    "contract_unit": 110000, "price_unit": "usd_per_mbf", "currency": "USD",
    "margin_outright_usd": 9500, "margin_spread_usd": 950,
  },
  "rough_rice": {
    "name": "Rough Rice", "sector": "micros", "exchange": "CBOT",
    "cftc_filter": "ROUGH RICE - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZR=F", "price_proxy": None,
    "price_source": "yfinance",
    # contract_unit = 2000 hundredweights (cwt); yfinance returns price in USD/cwt
    "contract_unit": 2000, "price_unit": "usd_per_cwt", "currency": "USD",
    "margin_outright_usd": 1375, "margin_spread_usd": 1265,
  },
}
```

**Price source notes:**
- `"yfinance"` — fetch from Yahoo Finance using `yfinance_ticker`; store USD close price in `commodity_prices`
- `"proxy"` — use already-fetched price of the `price_proxy` symbol for the same date. Where source and target use different units, `proxy_to_usd_per_mt_factor` converts before storing: `stored_price = proxy_price × factor`. For `cocoa_ldn` the factor is 1.0 (NY Cocoa is already USD/MT). For `lsgo` (proxy: heating_oil, USD/gal) the factor is 264.17 gal/MT. For `white_sugar` (proxy: sugar11, USD/lb) the factor is 2204.62 lbs/MT.
- `"cot_weekly"` — read `price_ldn` from the existing `cot_weekly` table for `market='ldn'` on the matching date (Robusta only)

**Margins marked `*est*`** — LSGO, White Sugar, Robusta, London Cocoa ICE Europe margins require manual verification at ice.com. `COMMODITY_SPECS` is the single place to update them.

---

## Backend Pipeline

### `backend/scraper/sources/macro_cot.py` (new)

This module does **not** use the Playwright browser. It exposes a `run(page)` function that ignores the `page` argument, matching the scraper framework interface:

```python
async def run(page):  # page unused — no browser needed
    db = get_session()
    try:
        _fetch_and_upsert(db)
    finally:
        db.close()
```

`scraper/main.py` calls all sources via `await source.run(page)`. This stub signature means `macro_cot` integrates into the existing `ALL_SOURCES` list without any change to `main.py`'s Playwright loop.

The `_fetch_and_upsert(db)` function:

1. **Download CFTC Disaggregated ZIP** for the current year (uses `date.today().year`). If the current-year file returns 0 rows (e.g. early January), falls back to the prior year's file:
   ```
   https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip
   ```
   Parse the full CSV in one pass. For each symbol where `cftc_filter` is set, find the latest row whose `Market_and_Exchange_Names` contains the filter string. If a symbol is unmatched, print a warning to stderr.

2. **Download ICE Futures Europe COT CSV** for the current year, with same year-boundary fallback:
   ```
   https://www.ice.com/publicdocs/futures/COTHist{year}.csv
   ```
   For each symbol where `ice_filter` is set, find the latest matching row.

3. **Determine the report date** (Tuesday) from each row's date field.

4. **Fetch prices via yfinance** for any `(symbol, date)` pair not already in `commodity_prices`. Process all `price_source="yfinance"` symbols first (so proxy symbols can reuse their prices). For `price_source="cot_weekly"`, query the existing `cot_weekly` table.

5. **Upsert** to `commodity_cot` and `commodity_prices` via `db_macro.py`.

### `backend/scraper/db_macro.py` (new)

Follows the same pattern as `scraper/db.py` — uses the scraper's `get_session()` factory, not FastAPI's `Depends(get_db)`. Session management is the caller's responsibility:

```python
def upsert_commodity_cot(db, symbol: str, report_date, fields: dict) -> None:
    """Insert or update commodity_cot row. fields: mm_long, mm_short, mm_spread, oi_total."""

def upsert_commodity_price(db, symbol: str, report_date, close_price_usd: float) -> None:
    """Insert or update commodity_prices row. Price must already be in USD."""
```

### `backend/import_macro_cot.py` (new)

One-time backfill script. Usage:
```bash
cd backend
DATABASE_URL=postgresql://... python import_macro_cot.py
```

Steps:
1. Download CFTC ZIPs for 2025 and 2026 — parse all relevant markets, collect all rows in last 52 weeks
2. Download ICE COT CSVs for 2025 and 2026 — same
3. Collect all unique `(symbol, date)` pairs
4. For each symbol with `price_source="yfinance"`, call `yf.download(ticker, start, end, interval="1d")` once per symbol for the full 52-week range — efficient batch fetch
5. For `price_source="proxy"`, use the already-fetched source price
6. For Robusta (`price_source="cot_weekly"`), query `cot_weekly` table for `price_ldn` values
7. Upsert all rows via `db_macro.py`

### `backend/scraper/sources/futures.py` (unchanged)

No changes. Existing `_fetch_cftc_cot()` and `_fetch_ice_robusta_cot()` continue writing to `cot_weekly` unchanged. `commodity_cot` receives its own independent copy of Arabica and Robusta positions from `macro_cot.py`.

### `backend/models.py` (modified)

Add `CommodityCot` and `CommodityPrice` SQLAlchemy models matching the table schemas above.

### `backend/requirements.txt` (modified)

Add `yfinance>=0.2.40`.

### `backend/main.py` (modified)

```python
from routes.macro_cot import router as macro_cot_router
app.include_router(macro_cot_router)
```

---

## API

### `backend/routes/macro_cot.py` (new)

```
GET /api/macro-cot?after=YYYY-MM-DD
```

Router prefix: `/api/macro-cot`. Default `after`: 52 weeks before today.

Performs a **LEFT JOIN** of `commodity_cot` with `commodity_prices` on `(date, symbol)`. Rows where `close_price` is NULL (price fetch failed for that week) are included with `null` exposure fields — the frontend skips null entries without interpolating.

For each joined row, computes derived fields using `COMMODITY_SPECS` imported from `macro_cot.py`:

```python
contract_value_usd  = _to_contract_value(close_price, spec)
gross_exposure_usd  = (mm_long + mm_short) * contract_value_usd
net_exposure_usd    = (mm_long - mm_short)  * contract_value_usd
initial_margin_usd  = (mm_long + mm_short) * spec["margin_outright_usd"] \
                    + mm_spread             * spec["margin_spread_usd"]
```

Response shape — TypeScript interface for the frontend:

```typescript
interface MacroCotEntry {
  symbol: string;
  sector: "hard" | "grains" | "meats" | "softs" | "micros";
  name: string;
  mm_long: number;
  mm_short: number;
  mm_spread: number;
  oi_total: number;
  close_price: number | null;
  gross_exposure_usd: number | null;  // null when price missing
  net_exposure_usd: number | null;
  initial_margin_usd: number;  // margin calc needs no price — always present
}

interface MacroCotWeek {
  date: string;           // ISO "YYYY-MM-DD"
  commodities: MacroCotEntry[];
}

// Endpoint returns: MacroCotWeek[]
```

Note: `initial_margin_usd` is always computable (needs only contracts × fixed margin rate, no price). `gross_exposure_usd` and `net_exposure_usd` are null when price is missing.

---

## Frontend

### `frontend/lib/api.ts` (modified)

```typescript
export async function fetchMacroCot(after?: string): Promise<MacroCotWeek[]> {
  const url = after ? `${API_URL}/api/macro-cot?after=${after}` : `${API_URL}/api/macro-cot`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`macro-cot fetch failed: ${res.status}`);
  return res.json();
}
```

### `frontend/components/futures/CotDashboard.tsx` (modified)

**State additions:**
```tsx
const [macroData, setMacroData] = useState<MacroCotWeek[]>([]);
```

Loaded in a `useEffect` alongside `cotRows`:
```tsx
useEffect(() => {
  fetchMacroCot().then(setMacroData).catch(() => {});
}, []);
```

**Step 1 chart — two-panel layout:**

**Panel A — MM Exposure by Sector** (stacked AreaChart, 52 weeks):
- X-axis: date; Y-axis: USD billions
- Five stacked areas: Hard / Grains / Meats / Softs / Micros (colour-coded)
- Coffee (arabica + robusta) displayed as a distinct amber highlight within the Softs band
- Toggle buttons: **Gross Exposure** / **Net Exposure** / **Initial Margin**
- The existing `cumulativeNominal` (amber) and `cumulativeMargin` (green) coffee-only lines from `fetchCot()` / `cot_weekly` are retained as overlaid lines on Panel A — they continue reading from the existing `cotRows` state, not from `macroData`

**Panel B — Coffee % of Total** (LineChart below Panel A):
- `(arabica_gross + robusta_gross) / total_gross × 100` per week
- Skips weeks where either coffee exposure is null

**Removed:** `macroMarket` (×2.5 multiplier) and `macroSofts` (×1.5 multiplier) lines are deleted entirely.

---

## Exposure Calculation Reference

All prices stored in `commodity_prices` are in USD. `_to_contract_value(price, spec)` in the API route:

| `price_unit` | Formula | Notes |
|---|---|---|
| `usd_per_bbl` | `price × contract_unit` | Energy (per barrel) |
| `usd_per_gal` | `price × contract_unit` | Gasoline, heating oil |
| `usd_per_mmbtu` | `price × contract_unit` | Natural gas |
| `usd_per_oz` | `price × contract_unit` | Gold, silver |
| `usd_per_lb` | `price × contract_unit` | Copper, softs, meats |
| `usd_per_bushel` | `price × contract_unit` | Grains — yfinance returns USD/bushel (not cents) |
| `usd_per_short_ton` | `price × contract_unit` | Soybean meal |
| `usd_per_mt` | `price × contract_unit` | Cocoa, coffee robusta, white sugar, gasoil |
| `usd_per_cwt` | `price × contract_unit` | Rough rice — yfinance returns USD/cwt; `contract_unit=2000` cwt |
| `usd_per_mbf` | `price × contract_unit` | Lumber — yfinance returns USD/mbf |

**Important:** yfinance returns CBOT grain prices (ZC=F, ZW=F, ZS=F, ZO=F, ZR=F) in **USD per bushel / cwt** (not cents). The formula is simply `price × contract_unit` for all `usd_per_*` units — no division by 100 needed.

---

## Data Quality Notes

1. **CFTC filter strings** must be verified against the actual CSV on first run of `import_macro_cot.py` — the script must print each unmatched symbol to stderr. The exact `Market_and_Exchange_Names` values may include extra spaces or slightly different wording.

2. **ICE Europe filter strings** must similarly be verified against `COTHist{year}.csv` on first run.

3. **Margin rates marked `*est*`** (LSGO, White Sugar, Robusta, London Cocoa) — update in `COMMODITY_SPECS` once verified at ice.com. `COMMODITY_SPECS` is the single place to update them.

4. **yfinance front-month tickers** (e.g. `CL=F`) roll automatically. Small price discontinuities at roll dates are acceptable for weekly analysis.

5. **Lumber** — two CME contracts: legacy cash-settled (LBS) and physically-delivered (LBR). If `LBS=F` returns no yfinance data, switch to `LBR=F` in `COMMODITY_SPECS`.

6. **`cot_weekly` vs `commodity_cot` overlap** — Arabica and Robusta positions appear in both tables. Steps 2–6 of the COT Dashboard continue reading from `cot_weekly` (via `fetchCot()`). The Global Money Flow chart (Step 1) reads from both: coffee-specific cumulative lines from `cot_weekly`, sector exposure from `commodity_cot`. These are independent and may show minor differences if update timing differs.

7. **Missing prices (LEFT JOIN)** — if yfinance returns no data for a COT date (e.g. holiday), `gross_exposure_usd` and `net_exposure_usd` for that symbol/week will be null. The frontend skips null entries when drawing the stacked chart; `initial_margin_usd` is always shown since it requires no price.
