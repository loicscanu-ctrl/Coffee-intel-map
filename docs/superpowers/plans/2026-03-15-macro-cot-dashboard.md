# Macro COT Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fake multiplier lines in the Global Money Flow chart (Step 1) with real CFTC/ICE Money Manager positioning data across 28 commodity futures, adding gross/net exposure and initial margin calculations.

**Architecture:** Two new PostgreSQL tables (`commodity_cot`, `commodity_prices`) store positions and prices independently. A hardcoded `COMMODITY_SPECS` dict in Python holds contract specs and margin rates. A new daily scraper populates both tables; a one-time backfill script loads 52 weeks of history. A new FastAPI route computes and serves exposure figures; the frontend Step 1 chart is updated to display stacked sector exposure.

**Tech Stack:** Python 3 / SQLAlchemy / FastAPI / yfinance (new), PostgreSQL (Supabase), Next.js / React / Recharts

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `backend/models.py` | Add `CommodityCot` and `CommodityPrice` models |
| Modify | `backend/requirements.txt` | Add `yfinance>=0.2.40` |
| Create | `backend/scraper/db_macro.py` | Upsert helpers for new tables |
| Create | `backend/scraper/sources/macro_cot.py` | Daily scraper + `COMMODITY_SPECS` |
| Create | `backend/import_macro_cot.py` | One-time 52-week backfill script |
| Create | `backend/routes/macro_cot.py` | `GET /api/macro-cot` endpoint |
| Modify | `backend/main.py` | Register macro_cot router |
| Modify | `frontend/lib/api.ts` | Add `fetchMacroCot()` |
| Modify | `frontend/components/futures/CotDashboard.tsx` | Update Step 1 chart |

---

## Chunk 1: Backend Data Layer

### Task 1: DB Models + Requirements

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add `yfinance` to requirements**

In `backend/requirements.txt`, add at the end:
```
yfinance>=0.2.40
```

- [ ] **Step 2: Add `CommodityCot` model to `backend/models.py`**

Add after the `CotWeekly` class (end of file):

```python
class CommodityCot(Base):
    __tablename__ = "commodity_cot"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    date:       Mapped[date]     = mapped_column(Date, nullable=False, index=True)
    symbol:     Mapped[str]      = mapped_column(String(20), nullable=False)
    mm_long:    Mapped[int | None] = mapped_column(Integer)
    mm_short:   Mapped[int | None] = mapped_column(Integer)
    mm_spread:  Mapped[int | None] = mapped_column(Integer)
    oi_total:   Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("date", "symbol", name="uq_commodity_cot_date_symbol"),)


class CommodityPrice(Base):
    __tablename__ = "commodity_prices"

    id:          Mapped[int]        = mapped_column(primary_key=True)
    date:        Mapped[date]       = mapped_column(Date, nullable=False, index=True)
    symbol:      Mapped[str]        = mapped_column(String(20), nullable=False)
    close_price: Mapped[float | None] = mapped_column(Float)
    currency:    Mapped[str]        = mapped_column(String(3), default="USD")
    created_at:  Mapped[datetime]   = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("date", "symbol", name="uq_commodity_price_date_symbol"),)
```

- [ ] **Step 3: Verify models parse without error**

```bash
cd backend
python -c "from models import CommodityCot, CommodityPrice; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/models.py backend/requirements.txt
git commit -m "feat: add CommodityCot and CommodityPrice DB models"
```

---

### Task 2: DB Upsert Helpers

**Files:**
- Create: `backend/scraper/db_macro.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_db_macro.py`:

```python
import pytest
from unittest.mock import MagicMock, call
from datetime import date

# We test the upsert logic by passing a mock db session
def test_upsert_commodity_cot_insert():
    """New row is added when no existing row found."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.db_macro import upsert_commodity_cot

    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = None

    upsert_commodity_cot(db, "arabica", date(2025, 1, 7), {"mm_long": 100, "mm_short": 50, "mm_spread": 10, "oi_total": 200})

    db.add.assert_called_once()
    db.commit.assert_called_once()


def test_upsert_commodity_cot_update():
    """Existing row is updated, not duplicated."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.db_macro import upsert_commodity_cot

    existing = MagicMock()
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = existing

    upsert_commodity_cot(db, "arabica", date(2025, 1, 7), {"mm_long": 200, "mm_short": 60, "mm_spread": 5, "oi_total": 300})

    assert existing.mm_long == 200
    db.add.assert_not_called()
    db.commit.assert_called_once()


def test_upsert_commodity_price_insert():
    """New price row is added when absent."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.db_macro import upsert_commodity_price

    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = None

    upsert_commodity_price(db, "arabica", date(2025, 1, 7), 320.5)

    db.add.assert_called_once()
    db.commit.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
python -m pytest tests/test_db_macro.py -v 2>&1 | head -20
```
Expected: ImportError or ModuleNotFoundError (file doesn't exist yet)

- [ ] **Step 3: Create `backend/scraper/db_macro.py`**

```python
# backend/scraper/db_macro.py
# Upsert helpers for commodity_cot and commodity_prices tables.
# Session lifecycle is the CALLER'S responsibility (same pattern as scraper/db.py).

def upsert_commodity_cot(db, symbol: str, report_date, fields: dict) -> None:
    """Insert or update a commodity_cot row.
    fields keys: mm_long, mm_short, mm_spread, oi_total
    """
    from models import CommodityCot
    existing = db.query(CommodityCot).filter_by(date=report_date, symbol=symbol).first()
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
    else:
        db.add(CommodityCot(date=report_date, symbol=symbol, **fields))
    db.commit()


def upsert_commodity_price(db, symbol: str, report_date, close_price_usd: float) -> None:
    """Insert or update a commodity_prices row. Price must already be in USD."""
    from models import CommodityPrice
    existing = db.query(CommodityPrice).filter_by(date=report_date, symbol=symbol).first()
    if existing:
        existing.close_price = close_price_usd
    else:
        db.add(CommodityPrice(date=report_date, symbol=symbol, close_price=close_price_usd))
    db.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
python -m pytest tests/test_db_macro.py -v
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/scraper/db_macro.py backend/tests/test_db_macro.py
git commit -m "feat: add db_macro upsert helpers for commodity_cot and commodity_prices"
```

---

### Task 3: Daily Scraper (`macro_cot.py`)

**Files:**
- Create: `backend/scraper/sources/macro_cot.py`

This module downloads the current year's CFTC Disaggregated ZIP and ICE Futures Europe CSV, extracts the latest row per symbol, fetches prices via yfinance, and upserts to both tables. It does **not** use the Playwright browser — `run(page)` ignores `page`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_macro_cot.py`:

```python
import pytest
from unittest.mock import patch, MagicMock
import pandas as pd
from datetime import date

def test_commodity_specs_all_required_fields():
    """Every COMMODITY_SPECS entry has required fields."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.sources.macro_cot import COMMODITY_SPECS

    required = {"name", "sector", "exchange", "price_source", "contract_unit",
                "price_unit", "margin_outright_usd", "margin_spread_usd"}
    for sym, spec in COMMODITY_SPECS.items():
        missing = required - spec.keys()
        assert not missing, f"{sym} missing fields: {missing}"


def test_commodity_specs_sector_values():
    """All sectors are one of the allowed values."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.sources.macro_cot import COMMODITY_SPECS

    valid = {"hard", "grains", "meats", "softs", "micros"}
    for sym, spec in COMMODITY_SPECS.items():
        assert spec["sector"] in valid, f"{sym} has invalid sector: {spec['sector']}"


def test_commodity_specs_proxy_has_factor():
    """Proxy price_source entries have proxy_to_usd_per_mt_factor."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.sources.macro_cot import COMMODITY_SPECS

    for sym, spec in COMMODITY_SPECS.items():
        if spec["price_source"] == "proxy":
            assert "proxy_to_usd_per_mt_factor" in spec, f"{sym} proxy missing factor"
            assert spec["price_proxy"] is not None, f"{sym} proxy missing price_proxy"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
python -m pytest tests/test_macro_cot.py -v 2>&1 | head -20
```
Expected: ImportError (file doesn't exist yet)

- [ ] **Step 3: Create `backend/scraper/sources/macro_cot.py`**

```python
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
# One entry per traded symbol. Margins from RJO Brien guide effective 3/14/2026.
# Entries marked *est* require manual verification at ice.com.
COMMODITY_SPECS = {
  # ── Hard Commodities ─────────────────────────────────────────────────────────
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
    "proxy_to_usd_per_mt_factor": 264.17,   # heating_oil USD/gal -> USD/MT
    "contract_unit": 100, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 8993, "margin_spread_usd": 800,  # *est*
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
  # ── Grains ───────────────────────────────────────────────────────────────────
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
  # ── Meats ────────────────────────────────────────────────────────────────────
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
  # ── Softs ────────────────────────────────────────────────────────────────────
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
    "proxy_to_usd_per_mt_factor": 2204.62,  # sugar11 USD/lb -> USD/MT
    "contract_unit": 50, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 1526, "margin_spread_usd": 150,  # *est*
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
    "price_source": "cot_weekly",
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 5000, "margin_spread_usd": 500,  # *est*
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
    "price_source": "proxy",
    "proxy_to_usd_per_mt_factor": 1.0,      # cocoa_ny already USD/MT
    "contract_unit": 10, "price_unit": "usd_per_mt", "currency": "USD",
    "margin_outright_usd": 7069, "margin_spread_usd": 700,  # *est* £5,566 × 1.27
  },
  "oj": {
    "name": "Orange Juice (FCOJ-A)", "sector": "softs", "exchange": "ICE US",
    "cftc_filter": "FROZEN CONCENTRATED ORANGE JUICE - ICE FUTURES U.S.",
    "ice_filter": None, "yfinance_ticker": "OJ=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 15000, "price_unit": "usd_per_lb", "currency": "USD",
    "margin_outright_usd": 4775, "margin_spread_usd": 1881,
  },
  # ── Micros ───────────────────────────────────────────────────────────────────
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
    # CFTC filter string may need adjustment — verify on first run
    "cftc_filter": "RANDOM LENGTH LUMBER - CHICAGO MERCANTILE EXCHANGE",
    "ice_filter": None, "yfinance_ticker": "LBS=F", "price_proxy": None,
    # If LBS=F returns no data, switch to "LBR=F" in COMMODITY_SPECS
    "price_source": "yfinance",
    "contract_unit": 110000, "price_unit": "usd_per_mbf", "currency": "USD",
    "margin_outright_usd": 9500, "margin_spread_usd": 950,
  },
  "rough_rice": {
    "name": "Rough Rice", "sector": "micros", "exchange": "CBOT",
    "cftc_filter": "ROUGH RICE - CHICAGO BOARD OF TRADE",
    "ice_filter": None, "yfinance_ticker": "ZR=F", "price_proxy": None,
    "price_source": "yfinance",
    "contract_unit": 2000, "price_unit": "usd_per_cwt", "currency": "USD",
    "margin_outright_usd": 1375, "margin_spread_usd": 1265,
  },
}

# ── CFTC column name constants ─────────────────────────────────────────────────
_CFTC_MARKET_COL = "Market_and_Exchange_Names"
_CFTC_DATE_COL   = "As_of_Date_In_Form_YYMMDD"
_CFTC_MM_LONG    = "M_Money_Positions_Long_All"
_CFTC_MM_SHORT   = "M_Money_Positions_Short_All"
_CFTC_MM_SPREAD  = "M_Money_Positions_Spread_All"
_CFTC_OI         = "Open_Interest_All"

# ICE Europe CSV uses different column names — verify on first run
_ICE_MARKET_COL  = "Contract"
_ICE_DATE_COL    = "Date"
_ICE_MM_LONG     = "Money Manager Longs"
_ICE_MM_SHORT    = "Money Manager Shorts"
_ICE_MM_SPREAD   = "Money Manager Spreads"
_ICE_OI          = "Total Open Interest"


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
    return pd.read_csv(io.StringIO(resp.text))


def _parse_cftc(df: pd.DataFrame) -> dict:
    """Return {symbol: (report_date, {mm_long, mm_short, mm_spread, oi_total})} for latest row per symbol."""
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
        # Sort by date desc, take latest
        rows = rows.copy()
        rows["_date_parsed"] = pd.to_datetime(rows[_CFTC_DATE_COL], format="%y%m%d", errors="coerce")
        rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
        row = rows.iloc[0]
        report_date = row["_date_parsed"].date()
        results[sym] = (report_date, {
            "mm_long":   int(row[_CFTC_MM_LONG]),
            "mm_short":  int(row[_CFTC_MM_SHORT]),
            "mm_spread": int(row[_CFTC_MM_SPREAD]),
            "oi_total":  int(row[_CFTC_OI]),
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
        rows["_date_parsed"] = pd.to_datetime(rows[_ICE_DATE_COL], errors="coerce")
        rows = rows.dropna(subset=["_date_parsed"]).sort_values("_date_parsed", ascending=False)
        row = rows.iloc[0]
        report_date = row["_date_parsed"].date()
        results[sym] = (report_date, {
            "mm_long":   int(row[_ICE_MM_LONG]),
            "mm_short":  int(row[_ICE_MM_SHORT]),
            "mm_spread": int(row.get(_ICE_MM_SPREAD, 0) or 0),
            "oi_total":  int(row[_ICE_OI]),
        })
    return results


def _fetch_yfinance_prices(symbols_dates: list) -> dict:
    """Batch-fetch prices for [(symbol, date), ...] using yfinance.
    Returns {(symbol, date): price_usd}. Fetches per ticker to minimise API calls.
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
        start = min(dates) - timedelta(days=3)
        end   = max(dates) + timedelta(days=1)
        try:
            hist = yf.download(ticker, start=start.isoformat(), end=end.isoformat(),
                               interval="1d", auto_adjust=True, progress=False)
            if hist.empty:
                continue
            hist.index = pd.to_datetime(hist.index).date
            for sym, dt in pairs:
                # Use exact date or nearest prior trading day (up to 5 days back)
                for offset in range(6):
                    check = dt - timedelta(days=offset)
                    if check in hist.index:
                        close = float(hist.loc[check, "Close"])
                        results[(sym, dt)] = close
                        break
        except Exception as e:
            print(f"[macro_cot] yfinance error for {ticker}: {e}", file=sys.stderr)
    return results


def _fetch_and_upsert(db) -> None:
    from scraper.db_macro import upsert_commodity_cot, upsert_commodity_price
    from models import CotWeekly

    today = date.today()
    year  = today.year

    # Download CFTC — fallback to prior year if current year has 0 rows
    try:
        cftc_df = _download_cftc_df(year)
        if len(cftc_df) == 0:
            raise ValueError("empty")
    except Exception:
        cftc_df = _download_cftc_df(year - 1)

    # Download ICE Europe — same fallback
    try:
        ice_df = _download_ice_df(year)
        if len(ice_df) == 0:
            raise ValueError("empty")
    except Exception:
        ice_df = _download_ice_df(year - 1)

    cot_data = {}
    cot_data.update(_parse_cftc(cftc_df))
    cot_data.update(_parse_ice(ice_df))

    # Upsert COT rows
    for sym, (report_date, fields) in cot_data.items():
        upsert_commodity_cot(db, sym, report_date, fields)

    # Fetch prices
    yfinance_pairs = [
        (sym, dt) for sym, (dt, _) in [(s, cot_data[s]) for s in cot_data
                                        if COMMODITY_SPECS[s]["price_source"] == "yfinance"]
    ]
    # Rearrange to (sym, date)
    yfinance_pairs = [
        (sym, cot_data[sym][0])
        for sym in cot_data
        if COMMODITY_SPECS[sym]["price_source"] == "yfinance"
    ]
    price_cache = _fetch_yfinance_prices(yfinance_pairs)

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

        elif src == "proxy":
            proxy_sym = spec["price_proxy"]
            proxy_price = price_cache.get((proxy_sym, cot_data.get(proxy_sym, (report_date,))[0]))
            if proxy_price is None:
                print(f"[macro_cot] WARNING: no proxy price for {sym} (proxy={proxy_sym})", file=sys.stderr)
                continue
            converted = proxy_price * spec["proxy_to_usd_per_mt_factor"]
            upsert_commodity_price(db, sym, report_date, converted)

        elif src == "cot_weekly":
            # Robusta: read price_ldn from cot_weekly table
            row = (db.query(CotWeekly)
                     .filter_by(market="ldn", date=report_date)
                     .first())
            if row and row.price_ldn:
                upsert_commodity_price(db, sym, report_date, float(row.price_ldn))
            else:
                print(f"[macro_cot] WARNING: no cot_weekly price_ldn for robusta on {report_date}", file=sys.stderr)


async def run(page):  # page unused — no browser needed
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from scraper.db import get_session
    db = get_session()
    try:
        _fetch_and_upsert(db)
    finally:
        db.close()
```

- [ ] **Step 4: Run COMMODITY_SPECS tests**

```bash
cd backend
python -m pytest tests/test_macro_cot.py -v
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/scraper/sources/macro_cot.py backend/tests/test_macro_cot.py
git commit -m "feat: add macro_cot daily scraper with COMMODITY_SPECS"
```

---

## Chunk 2: Backfill + API

### Task 4: Backfill Script

**Files:**
- Create: `backend/import_macro_cot.py`

This script loads 52 weeks of history for all 28 symbols. Run once after deploying the new models.

- [ ] **Step 1: Create `backend/import_macro_cot.py`**

```python
#!/usr/bin/env python3
# backend/import_macro_cot.py
# One-time 52-week historical backfill for commodity_cot and commodity_prices.
#
# Usage:
#   cd backend
#   DATABASE_URL=postgresql://... python import_macro_cot.py

import io
import os
import sys
import zipfile
from datetime import date, timedelta

import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, os.path.dirname(__file__))
from scraper.db import get_session
from scraper.db_macro import upsert_commodity_cot, upsert_commodity_price
from scraper.sources.macro_cot import (
    COMMODITY_SPECS,
    _CFTC_MARKET_COL, _CFTC_DATE_COL, _CFTC_MM_LONG, _CFTC_MM_SHORT,
    _CFTC_MM_SPREAD, _CFTC_OI,
    _ICE_MARKET_COL, _ICE_DATE_COL, _ICE_MM_LONG, _ICE_MM_SHORT,
    _ICE_MM_SPREAD, _ICE_OI,
    _download_cftc_df, _download_ice_df,
)
from models import CotWeekly

WEEKS_BACK = 52
CUTOFF = date.today() - timedelta(weeks=WEEKS_BACK)


def _all_cftc_rows(df: pd.DataFrame, sym: str, spec: dict) -> pd.DataFrame:
    filt = spec.get("cftc_filter")
    if not filt:
        return pd.DataFrame()
    mask = df[_CFTC_MARKET_COL].str.contains(filt, na=False, regex=False)
    rows = df[mask].copy()
    if rows.empty:
        print(f"WARNING: no CFTC rows for '{filt}' ({sym})", file=sys.stderr)
    return rows


def _all_ice_rows(df: pd.DataFrame, sym: str, spec: dict) -> pd.DataFrame:
    filt = spec.get("ice_filter")
    if not filt:
        return pd.DataFrame()
    mask = df[_ICE_MARKET_COL].str.contains(filt, na=False, regex=False)
    rows = df[mask].copy()
    if rows.empty:
        print(f"WARNING: no ICE rows for '{filt}' ({sym})", file=sys.stderr)
    return rows


def main():
    today = date.today()
    years = list({today.year - 1, today.year})

    print("Downloading CFTC files...")
    cftc_frames = []
    for yr in years:
        try:
            cftc_frames.append(_download_cftc_df(yr))
            print(f"  CFTC {yr}: OK")
        except Exception as e:
            print(f"  CFTC {yr}: SKIP ({e})")
    cftc_df = pd.concat(cftc_frames, ignore_index=True) if cftc_frames else pd.DataFrame()

    print("Downloading ICE files...")
    ice_frames = []
    for yr in years:
        try:
            ice_frames.append(_download_ice_df(yr))
            print(f"  ICE {yr}: OK")
        except Exception as e:
            print(f"  ICE {yr}: SKIP ({e})")
    ice_df = pd.concat(ice_frames, ignore_index=True) if ice_frames else pd.DataFrame()

    # Collect all (sym, date, fields) COT rows within the 52-week window
    cot_rows: list[tuple] = []

    for sym, spec in COMMODITY_SPECS.items():
        if spec.get("cftc_filter"):
            rows = _all_cftc_rows(cftc_df, sym, spec)
            if rows.empty:
                continue
            rows["_date_parsed"] = pd.to_datetime(rows[_CFTC_DATE_COL], format="%y%m%d", errors="coerce")
            rows = rows.dropna(subset=["_date_parsed"])
            rows = rows[rows["_date_parsed"].dt.date >= CUTOFF]
            for _, row in rows.iterrows():
                cot_rows.append((sym, row["_date_parsed"].date(), {
                    "mm_long":   int(row[_CFTC_MM_LONG]),
                    "mm_short":  int(row[_CFTC_MM_SHORT]),
                    "mm_spread": int(row[_CFTC_MM_SPREAD]),
                    "oi_total":  int(row[_CFTC_OI]),
                }))

        elif spec.get("ice_filter"):
            rows = _all_ice_rows(ice_df, sym, spec)
            if rows.empty:
                continue
            rows["_date_parsed"] = pd.to_datetime(rows[_ICE_DATE_COL], errors="coerce")
            rows = rows.dropna(subset=["_date_parsed"])
            rows = rows[rows["_date_parsed"].dt.date >= CUTOFF]
            for _, row in rows.iterrows():
                cot_rows.append((sym, row["_date_parsed"].date(), {
                    "mm_long":   int(row[_ICE_MM_LONG]),
                    "mm_short":  int(row[_ICE_MM_SHORT]),
                    "mm_spread": int(row.get(_ICE_MM_SPREAD, 0) or 0),
                    "oi_total":  int(row[_ICE_OI]),
                }))

    print(f"Collected {len(cot_rows)} COT rows across {WEEKS_BACK} weeks")

    # Batch-fetch yfinance prices
    yfinance_pairs = [
        (sym, dt) for sym, dt, _ in cot_rows
        if COMMODITY_SPECS[sym]["price_source"] == "yfinance"
    ]
    # Deduplicate by ticker+date range
    ticker_sym_map: dict[str, str] = {}
    ticker_dates:   dict[str, set] = {}
    for sym, dt in yfinance_pairs:
        ticker = COMMODITY_SPECS[sym]["yfinance_ticker"]
        ticker_sym_map[ticker] = sym
        ticker_dates.setdefault(ticker, set()).add(dt)

    price_cache: dict[tuple, float] = {}
    print("Fetching yfinance prices...")
    for ticker, dates in ticker_dates.items():
        start = min(dates) - timedelta(days=5)
        end   = max(dates) + timedelta(days=1)
        try:
            hist = yf.download(ticker, start=start.isoformat(), end=end.isoformat(),
                               interval="1d", auto_adjust=True, progress=False)
            if hist.empty:
                print(f"  {ticker}: no data", file=sys.stderr)
                continue
            hist.index = pd.to_datetime(hist.index).date
            # Map all symbols that share this ticker
            for sym2, dt2 in yfinance_pairs:
                if COMMODITY_SPECS[sym2]["yfinance_ticker"] != ticker:
                    continue
                for offset in range(6):
                    check = dt2 - timedelta(days=offset)
                    if check in hist.index:
                        price_cache[(sym2, dt2)] = float(hist.loc[check, "Close"])
                        break
            print(f"  {ticker}: OK")
        except Exception as e:
            print(f"  {ticker}: ERROR {e}", file=sys.stderr)

    # Upsert all rows
    db = get_session()
    try:
        inserted_cot = 0
        for sym, report_date, fields in cot_rows:
            upsert_commodity_cot(db, sym, report_date, fields)
            inserted_cot += 1

        inserted_prices = 0
        processed_proxies = set()

        for sym, report_date, _ in cot_rows:
            spec = COMMODITY_SPECS[sym]
            src  = spec["price_source"]

            if src == "yfinance":
                price = price_cache.get((sym, report_date))
                if price is not None:
                    upsert_commodity_price(db, sym, report_date, price)
                    inserted_prices += 1

            elif src == "proxy":
                proxy_sym = spec["price_proxy"]
                proxy_price = price_cache.get((proxy_sym, report_date))
                if proxy_price is not None:
                    converted = proxy_price * spec["proxy_to_usd_per_mt_factor"]
                    upsert_commodity_price(db, sym, report_date, converted)
                    inserted_prices += 1

            elif src == "cot_weekly":
                key = (sym, report_date)
                if key not in processed_proxies:
                    row = db.query(CotWeekly).filter_by(market="ldn", date=report_date).first()
                    if row and row.price_ldn:
                        upsert_commodity_price(db, sym, report_date, float(row.price_ldn))
                        inserted_prices += 1
                    processed_proxies.add(key)

        print(f"Done. {inserted_cot} COT rows upserted, {inserted_prices} prices upserted.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify script syntax**

```bash
cd backend
python -c "import import_macro_cot; print('syntax OK')"
```
Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
git add backend/import_macro_cot.py
git commit -m "feat: add 52-week historical backfill script for macro COT data"
```

---

### Task 5: API Route

**Files:**
- Create: `backend/routes/macro_cot.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_routes_macro_cot.py`:

```python
import pytest
from unittest.mock import MagicMock, patch
from datetime import date

def test_contract_value_usd_per_bbl():
    """usd_per_bbl: price × contract_unit."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _to_contract_value

    spec = {"price_unit": "usd_per_bbl", "contract_unit": 1000}
    assert _to_contract_value(80.0, spec) == pytest.approx(80_000.0)


def test_contract_value_usd_per_lb():
    """usd_per_lb: price × contract_unit."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _to_contract_value

    spec = {"price_unit": "usd_per_lb", "contract_unit": 37500}
    assert _to_contract_value(3.0, spec) == pytest.approx(112_500.0)


def test_exposure_calc_null_price():
    """gross/net exposure is None when price missing; initial_margin always computed."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _compute_exposures

    spec = {"price_unit": "usd_per_lb", "contract_unit": 37500,
            "margin_outright_usd": 7376, "margin_spread_usd": 830}
    result = _compute_exposures(mm_long=100, mm_short=50, mm_spread=10,
                                close_price=None, spec=spec)
    assert result["gross_exposure_usd"] is None
    assert result["net_exposure_usd"] is None
    assert result["initial_margin_usd"] == (100 + 50) * 7376 + 10 * 830


def test_exposure_calc_with_price():
    """All fields populated when price present."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _compute_exposures

    spec = {"price_unit": "usd_per_bbl", "contract_unit": 1000,
            "margin_outright_usd": 4675, "margin_spread_usd": 420}
    result = _compute_exposures(mm_long=200, mm_short=100, mm_spread=20,
                                close_price=80.0, spec=spec)
    assert result["gross_exposure_usd"] == pytest.approx((200 + 100) * 80_000.0)
    assert result["net_exposure_usd"]   == pytest.approx((200 - 100) * 80_000.0)
    assert result["initial_margin_usd"] == (200 + 100) * 4675 + 20 * 420
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
python -m pytest tests/test_routes_macro_cot.py -v 2>&1 | head -20
```
Expected: ImportError (route doesn't exist yet)

- [ ] **Step 3: Create `backend/routes/macro_cot.py`**

```python
# backend/routes/macro_cot.py
from datetime import date as DateType, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import CommodityCot, CommodityPrice
from scraper.sources.macro_cot import COMMODITY_SPECS

router = APIRouter(prefix="/api/macro-cot", tags=["macro-cot"])


def _to_contract_value(price: float, spec: dict) -> float:
    """All price_unit variants resolve to price × contract_unit (all already in USD per unit)."""
    return price * spec["contract_unit"]


def _compute_exposures(mm_long: int, mm_short: int, mm_spread: int,
                       close_price: Optional[float], spec: dict) -> dict:
    initial_margin = (mm_long + mm_short) * spec["margin_outright_usd"] \
                   + mm_spread             * spec["margin_spread_usd"]

    if close_price is None:
        return {
            "gross_exposure_usd": None,
            "net_exposure_usd":   None,
            "initial_margin_usd": initial_margin,
        }

    cv = _to_contract_value(close_price, spec)
    return {
        "gross_exposure_usd": (mm_long + mm_short) * cv,
        "net_exposure_usd":   (mm_long - mm_short) * cv,
        "initial_margin_usd": initial_margin,
    }


@router.get("")
def get_macro_cot(
    after: Optional[str] = Query(None, description="ISO date lower bound YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    if after:
        try:
            cutoff = DateType.fromisoformat(after)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'after' date. Use YYYY-MM-DD.")
    else:
        cutoff = DateType.today() - timedelta(weeks=52)

    cot_rows = (db.query(CommodityCot)
                  .filter(CommodityCot.date > cutoff)
                  .order_by(CommodityCot.date.asc())
                  .all())

    # Build price lookup {(date, symbol): close_price}
    price_rows = (db.query(CommodityPrice)
                    .filter(CommodityPrice.date > cutoff)
                    .all())
    price_map = {(p.date, p.symbol): p.close_price for p in price_rows}

    # Group by date
    weeks: dict[DateType, list] = {}
    for row in cot_rows:
        spec = COMMODITY_SPECS.get(row.symbol)
        if spec is None:
            continue  # unknown symbol — skip

        mm_long   = row.mm_long   or 0
        mm_short  = row.mm_short  or 0
        mm_spread = row.mm_spread or 0
        close_price = price_map.get((row.date, row.symbol))

        exposures = _compute_exposures(mm_long, mm_short, mm_spread, close_price, spec)

        entry = {
            "symbol":   row.symbol,
            "sector":   spec["sector"],
            "name":     spec["name"],
            "mm_long":  mm_long,
            "mm_short": mm_short,
            "mm_spread": mm_spread,
            "oi_total": row.oi_total or 0,
            "close_price": close_price,
            **exposures,
        }
        weeks.setdefault(row.date, []).append(entry)

    return [
        {"date": d.isoformat(), "commodities": weeks[d]}
        for d in sorted(weeks.keys())
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
python -m pytest tests/test_routes_macro_cot.py -v
```
Expected: 4 tests PASS

- [ ] **Step 5: Register router in `backend/main.py`**

Add after line 9 (`from routes.cot import router as cot_router`):
```python
from routes.macro_cot import router as macro_cot_router
```

Add after line 23 (`app.include_router(cot_router)`):
```python
app.include_router(macro_cot_router)
```

- [ ] **Step 6: Smoke-test the endpoint**

Start the backend:
```bash
cd backend
DATABASE_URL=postgresql://coffee:coffee@localhost:5432/coffee_intel uvicorn main:app --reload --port 8000
```

In another terminal (after backfill has run — see note below):
```bash
curl -s "http://localhost:8000/api/macro-cot" | python -m json.tool | head -40
```
Expected: JSON array. If `commodity_cot` is empty, it returns `[]` — that's fine until backfill runs.

Note: Run the backfill **after** this commit if the DB is empty:
```bash
cd backend
DATABASE_URL=postgresql://coffee:coffee@localhost:5432/coffee_intel python import_macro_cot.py
```
Or against Supabase:
```bash
DATABASE_URL=<supabase-url> python import_macro_cot.py
```

- [ ] **Step 7: Commit**

```bash
git add backend/routes/macro_cot.py backend/main.py backend/tests/test_routes_macro_cot.py
git commit -m "feat: add /api/macro-cot endpoint with exposure calculations"
```

---

## Chunk 3: Frontend

### Task 6: Frontend API Function

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add `MacroCotEntry` and `MacroCotWeek` types plus `fetchMacroCot` to `frontend/lib/api.ts`**

Append to the end of the file:

```typescript
export interface MacroCotEntry {
  symbol: string;
  sector: "hard" | "grains" | "meats" | "softs" | "micros";
  name: string;
  mm_long: number;
  mm_short: number;
  mm_spread: number;
  oi_total: number;
  close_price: number | null;
  gross_exposure_usd: number | null;
  net_exposure_usd: number | null;
  initial_margin_usd: number;
}

export interface MacroCotWeek {
  date: string;
  commodities: MacroCotEntry[];
}

export async function fetchMacroCot(after?: string): Promise<MacroCotWeek[]> {
  const url = after
    ? `${API_URL}/api/macro-cot?after=${after}`
    : `${API_URL}/api/macro-cot`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`macro-cot fetch failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add fetchMacroCot API function with TypeScript types"
```

---

### Task 7: Frontend Chart — Step 1 Update

**Files:**
- Modify: `frontend/components/futures/CotDashboard.tsx`

This task replaces the fake `macroMarket` (×2.5) and `macroSofts` (×1.5) lines in Step 1 with a two-panel real-data layout: Panel A is a stacked AreaChart by sector, Panel B is Coffee % of total.

- [ ] **Step 1: Read the current Step 1 render section of CotDashboard.tsx**

Read the file to find exactly where Step 1 content is rendered and where the fake multiplier lines are defined. Look for `macroMarket` and `macroSofts` variables, and the Step 1 conditional block.

```bash
cd frontend
grep -n "macroMarket\|macroSofts\|step === 1\|Step 1\|GlobalMoney" components/futures/CotDashboard.tsx | head -40
```

- [ ] **Step 2: Add `fetchMacroCot` import and types to CotDashboard.tsx**

At the top of the file, find the existing `fetchCot` import and add `fetchMacroCot`, `MacroCotWeek`:

```typescript
import { fetchCot, fetchMacroCot, type MacroCotWeek } from "@/lib/api";
```

- [ ] **Step 3: Add state and useEffect for macro data**

After the existing `cotRows` state declaration, add:

```tsx
const [macroData, setMacroData] = useState<MacroCotWeek[]>([]);
const [macroToggle, setMacroToggle] = useState<"gross" | "net" | "margin">("gross");
```

In the existing `useEffect` that calls `fetchCot`, add a parallel fetch:

```tsx
fetchMacroCot().then(setMacroData).catch(() => {});
```

- [ ] **Step 4: Add `transformMacroData` helper**

Add a pure function (outside the component) that transforms `MacroCotWeek[]` into chart-ready data:

```tsx
const SECTORS = ["hard", "grains", "meats", "softs", "micros"] as const;
const SECTOR_COLORS: Record<string, string> = {
  hard:   "#6366f1",
  grains: "#f59e0b",
  meats:  "#ef4444",
  softs:  "#10b981",
  micros: "#8b5cf6",
};

function transformMacroData(
  weeks: MacroCotWeek[],
  mode: "gross" | "net" | "margin"
): { date: string; hard: number; grains: number; meats: number; softs: number; micros: number; coffeeShare: number | null }[] {
  return weeks.map(week => {
    const sectorTotals: Record<string, number> = { hard: 0, grains: 0, meats: 0, softs: 0, micros: 0 };
    let coffeeGross = 0;
    let totalGross  = 0;
    let hasCoffeePrice = true;

    for (const c of week.commodities) {
      const val =
        mode === "gross"  ? (c.gross_exposure_usd  ?? null) :
        mode === "net"    ? (c.net_exposure_usd    ?? null) :
        /* margin */        c.initial_margin_usd;

      if (val === null) continue;
      const valB = val / 1e9;  // convert to billions
      sectorTotals[c.sector] = (sectorTotals[c.sector] ?? 0) + valB;

      // Coffee share (gross only, requires price)
      if (c.symbol === "arabica" || c.symbol === "robusta") {
        if (c.gross_exposure_usd === null) hasCoffeePrice = false;
        else coffeeGross += c.gross_exposure_usd;
      }
      if (c.gross_exposure_usd !== null) totalGross += c.gross_exposure_usd;
    }

    const coffeeShare = (hasCoffeePrice && totalGross > 0)
      ? (coffeeGross / totalGross) * 100
      : null;

    return {
      date: week.date,
      ...sectorTotals,
      coffeeShare,
    };
  });
}
```

- [ ] **Step 5: Replace Step 1 chart content**

Find the existing Step 1 render block. It contains the `GlobalMoneyFlow` / `macroMarket` / `macroSofts` lines. Replace the entire Step 1 JSX content with:

```tsx
{/* Toggle */}
<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
  {(["gross", "net", "margin"] as const).map(m => (
    <button
      key={m}
      onClick={() => setMacroToggle(m)}
      style={{
        padding: "4px 12px", borderRadius: 4, border: "1px solid #374151",
        background: macroToggle === m ? "#4f46e5" : "#1f2937",
        color: "#f9fafb", cursor: "pointer", fontSize: 12,
      }}
    >
      {m === "gross" ? "Gross Exposure" : m === "net" ? "Net Exposure" : "Initial Margin"}
    </button>
  ))}
</div>

{/* Panel A — MM Exposure by Sector */}
<div style={{ marginBottom: 8 }}>
  <span style={{ fontSize: 12, color: "#9ca3af" }}>MM Exposure by Sector (USD bn)</span>
</div>
<ResponsiveContainer width="100%" height={260}>
  <AreaChart data={transformMacroData(macroData, macroToggle)}
    margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
      tickFormatter={v => v.slice(0, 7)} interval="preserveStartEnd" />
    <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
      tickFormatter={v => `$${v.toFixed(0)}B`} width={52} />
    <Tooltip
      contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
      formatter={(v: number, name: string) => [`$${v.toFixed(1)}B`, name]}
      labelFormatter={l => `Week: ${l}`}
    />
    <Legend wrapperStyle={{ fontSize: 11 }} />
    {SECTORS.map(sector => (
      <Area key={sector} type="monotone" dataKey={sector}
        stackId="1" name={sector.charAt(0).toUpperCase() + sector.slice(1)}
        stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
        fillOpacity={0.6} dot={false} />
    ))}
  </AreaChart>
</ResponsiveContainer>

{/* Panel B — Coffee % of Total (gross only) */}
<div style={{ marginTop: 12, marginBottom: 6 }}>
  <span style={{ fontSize: 12, color: "#9ca3af" }}>Coffee % of Total Gross Exposure</span>
</div>
<ResponsiveContainer width="100%" height={120}>
  <LineChart data={transformMacroData(macroData, macroToggle)}
    margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
      tickFormatter={v => v.slice(0, 7)} interval="preserveStartEnd" />
    <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
      tickFormatter={v => `${v.toFixed(1)}%`} width={44} domain={[0, "auto"]} />
    <Tooltip
      contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
      formatter={(v: number) => [`${v.toFixed(2)}%`, "Coffee share"]}
    />
    <Line type="monotone" dataKey="coffeeShare" name="Coffee share"
      stroke="#f59e0b" dot={false} strokeWidth={1.5}
      connectNulls={false} />
  </LineChart>
</ResponsiveContainer>
```

- [ ] **Step 6: Remove fake multiplier variables**

Search for `macroMarket` and `macroSofts` (the ×2.5 and ×1.5 fake lines). Delete those variable declarations and remove their `<Line>` elements from any chart that references them.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 8: Visual smoke-test**

Open the app at `http://localhost:3000`. Navigate to the COT Dashboard → Step 1 (Flow tab). Verify:
- Toggle buttons (Gross / Net / Initial Margin) are visible
- Stacked area chart renders with 5 coloured bands (or empty if DB not yet backfilled)
- Coffee % panel renders below
- No `×2.5` or `×1.5` fake lines remain

- [ ] **Step 9: Commit**

```bash
git add frontend/components/futures/CotDashboard.tsx
git commit -m "feat: replace fake multiplier lines with real MM sector exposure chart in Step 1"
```

---

## Post-Implementation Checklist

- [ ] Run backfill against target DB: `DATABASE_URL=<url> python backend/import_macro_cot.py`
- [ ] Verify CFTC filter string matches for `lumber` — stderr should show no warnings
- [ ] Add `macro_cot` to `ALL_SOURCES` in `backend/scraper/main.py`:
  ```python
  from sources.macro_cot import run as macro_cot_run
  # add to ALL_SOURCES list: module with .run attribute
  ```
  Or create a minimal wrapper object — follow the existing pattern in `main.py`.
- [ ] Verify ICE Europe margins manually at ice.com for: LSGO, White Sugar, Robusta, London Cocoa (currently marked `*est*` in `COMMODITY_SPECS`)
- [ ] Update `COMMODITY_SPECS` margins once verified
