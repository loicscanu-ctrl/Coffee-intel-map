# CoT Real Data Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `generateData()` synthetic data in `CotDashboard.tsx` with real CFTC/ICE CoT history from a `cot_weekly` PostgreSQL table, seeded from a local Excel file.

**Architecture:** Excel (`NY COT` + `LDN COT` + `Other` sheets) → one-time import script → `cot_weekly` table → `GET /api/cot` FastAPI endpoint → `CotDashboard` fetches on mount and calls `transformApiData()` instead of `generateData()`.

**Tech Stack:** Python 3.11 / openpyxl / SQLAlchemy 2.0 / FastAPI / pytest / Next.js 14 / TypeScript / Recharts

**Spec:** `docs/superpowers/specs/2026-03-14-cot-real-data-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/models.py` | Modify | Add `CotWeekly` ORM model |
| `backend/scraper/db.py` | Modify | Add `upsert_cot_weekly()` helper |
| `backend/import_cot_excel.py` | Create | One-time Excel → DB import script |
| `backend/routes/cot.py` | Create | `GET /api/cot` endpoint |
| `backend/main.py` | Modify | Register cot router |
| `backend/scraper/sources/futures.py` | Modify | Upsert weekly CoT data on scrape |
| `backend/tests/test_cot_model.py` | Create | Model + upsert unit tests |
| `backend/tests/test_cot_route.py` | Create | Route integration tests |
| `frontend/lib/api.ts` | Modify | Add `fetchCot()` |
| `frontend/components/futures/CotDashboard.tsx` | Modify | Lazy-fetch + `transformApiData()` |

---

## Chunk 1: Model and DB Helper

### Task 1: Add CotWeekly model

**Files:**
- Modify: `backend/models.py`
- Test: `backend/tests/test_cot_model.py`

- [ ] **Step 1.1: Write the failing test**

Create `backend/tests/test_cot_model.py`:

```python
from datetime import date
from models import CotWeekly


def test_cot_weekly_create(db):
    row = CotWeekly(
        date=date(2026, 3, 11),
        market="ny",
        oi_total=150000,
        mm_long=25000,
        mm_short=12000,
    )
    db.add(row)
    db.commit()
    result = db.query(CotWeekly).first()
    assert result.market == "ny"
    assert result.oi_total == 150000
    assert result.mm_long == 25000


def test_cot_weekly_unique_constraint(db):
    """Inserting duplicate (date, market) should raise IntegrityError."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    db.add(CotWeekly(date=date(2026, 3, 11), market="ny", oi_total=150000))
    db.commit()
    db.add(CotWeekly(date=date(2026, 3, 11), market="ny", oi_total=999))
    with pytest.raises(IntegrityError):
        db.commit()


def test_cot_weekly_ldn_nr_nullable(db):
    """LDN rows have t_nr_long and t_nr_short as None."""
    row = CotWeekly(
        date=date(2026, 3, 11),
        market="ldn",
        oi_total=80000,
        t_nr_long=None,
        t_nr_short=None,
    )
    db.add(row)
    db.commit()
    result = db.query(CotWeekly).filter_by(market="ldn").first()
    assert result.t_nr_long is None
    assert result.t_nr_short is None
```

- [ ] **Step 1.2: Run the test to confirm it fails**

```bash
cd backend && python -m pytest tests/test_cot_model.py -v
```

Expected: `ImportError: cannot import name 'CotWeekly' from 'models'`

- [ ] **Step 1.3: Add CotWeekly to models.py**

Open `backend/models.py`. The file currently imports:
```python
from sqlalchemy import String, Float, DateTime, Text, JSON, Date, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
```

Add `Optional` to the Python typing imports at the top:
```python
from typing import Optional
```

Then append this class at the end of `backend/models.py`:

```python
class CotWeekly(Base):
    __tablename__ = "cot_weekly"

    id:     Mapped[int]  = mapped_column(primary_key=True)
    date:   Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market: Mapped[str]  = mapped_column(String(3), nullable=False)  # "ny" | "ldn"

    # CoT OI fields
    oi_total:     Mapped[Optional[int]] = mapped_column(Integer)
    pmpu_long:    Mapped[Optional[int]] = mapped_column(Integer)
    pmpu_short:   Mapped[Optional[int]] = mapped_column(Integer)
    swap_long:    Mapped[Optional[int]] = mapped_column(Integer)
    swap_short:   Mapped[Optional[int]] = mapped_column(Integer)
    swap_spread:  Mapped[Optional[int]] = mapped_column(Integer)
    mm_long:      Mapped[Optional[int]] = mapped_column(Integer)
    mm_short:     Mapped[Optional[int]] = mapped_column(Integer)
    mm_spread:    Mapped[Optional[int]] = mapped_column(Integer)
    other_long:   Mapped[Optional[int]] = mapped_column(Integer)
    other_short:  Mapped[Optional[int]] = mapped_column(Integer)
    other_spread: Mapped[Optional[int]] = mapped_column(Integer)
    nr_long:      Mapped[Optional[int]] = mapped_column(Integer)
    nr_short:     Mapped[Optional[int]] = mapped_column(Integer)

    # Trader count fields
    t_pmpu_long:    Mapped[Optional[int]] = mapped_column(Integer)
    t_pmpu_short:   Mapped[Optional[int]] = mapped_column(Integer)
    t_swap_long:    Mapped[Optional[int]] = mapped_column(Integer)
    t_swap_short:   Mapped[Optional[int]] = mapped_column(Integer)
    t_swap_spread:  Mapped[Optional[int]] = mapped_column(Integer)
    t_mm_long:      Mapped[Optional[int]] = mapped_column(Integer)
    t_mm_short:     Mapped[Optional[int]] = mapped_column(Integer)
    t_mm_spread:    Mapped[Optional[int]] = mapped_column(Integer)
    t_other_long:   Mapped[Optional[int]] = mapped_column(Integer)
    t_other_short:  Mapped[Optional[int]] = mapped_column(Integer)
    t_other_spread: Mapped[Optional[int]] = mapped_column(Integer)
    t_nr_long:      Mapped[Optional[int]] = mapped_column(Integer)  # NY only; None for LDN
    t_nr_short:     Mapped[Optional[int]] = mapped_column(Integer)  # NY only; None for LDN

    # From Other sheet (joined by report date)
    price_ny:       Mapped[Optional[float]] = mapped_column(Float)
    price_ldn:      Mapped[Optional[float]] = mapped_column(Float)
    structure_ny:   Mapped[Optional[float]] = mapped_column(Float)
    structure_ldn:  Mapped[Optional[float]] = mapped_column(Float)
    exch_oi_ny:     Mapped[Optional[int]]   = mapped_column(Integer)
    exch_oi_ldn:    Mapped[Optional[int]]   = mapped_column(Integer)
    vol_ny:         Mapped[Optional[int]]   = mapped_column(Integer)
    vol_ldn:        Mapped[Optional[int]]   = mapped_column(Integer)
    efp_ny:         Mapped[Optional[float]] = mapped_column(Float)
    efp_ldn:        Mapped[Optional[float]] = mapped_column(Float)
    spread_vol_ny:  Mapped[Optional[float]] = mapped_column(Float)
    spread_vol_ldn: Mapped[Optional[float]] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("date", "market", name="uq_cot_date_market"),
    )
```

- [ ] **Step 1.4: Run the tests to confirm they pass**

```bash
cd backend && python -m pytest tests/test_cot_model.py -v
```

Expected: 3 tests PASS

- [ ] **Step 1.5: Commit**

```bash
git add backend/models.py backend/tests/test_cot_model.py
git commit -m "feat: add CotWeekly model"
```

---

### Task 2: Add upsert_cot_weekly helper

**Files:**
- Modify: `backend/scraper/db.py`
- Test: `backend/tests/test_cot_model.py` (extend)

- [ ] **Step 2.1: Write the failing tests**

Append to `backend/tests/test_cot_model.py`:

```python
def test_upsert_cot_weekly_insert(scraper_db):
    """upsert_cot_weekly inserts a new record when none exists."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 150000, "mm_long": 25000})
    db = get_session()
    try:
        result = db.query(CotWeekly).filter_by(market="ny").first()
        assert result is not None
        assert result.oi_total == 150000
        assert result.mm_long == 25000
    finally:
        db.close()


def test_upsert_cot_weekly_update(scraper_db):
    """upsert_cot_weekly updates existing record on duplicate (date, market)."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 150000})
    upsert_cot_weekly("ny", date(2026, 3, 11), {"oi_total": 999999})
    db = get_session()
    try:
        rows = db.query(CotWeekly).filter_by(market="ny").all()
        assert len(rows) == 1
        assert rows[0].oi_total == 999999
    finally:
        db.close()


def test_upsert_cot_weekly_ldn_nr_none(scraper_db):
    """LDN upsert with t_nr_long=None stores None, not 0."""
    from scraper.db import upsert_cot_weekly, get_session
    upsert_cot_weekly("ldn", date(2026, 3, 11), {
        "oi_total": 80000,
        "t_nr_long": None,
        "t_nr_short": None,
    })
    db = get_session()
    try:
        result = db.query(CotWeekly).filter_by(market="ldn").first()
        assert result.t_nr_long is None
    finally:
        db.close()
```

- [ ] **Step 2.2: Run the tests to confirm they fail**

```bash
cd backend && python -m pytest tests/test_cot_model.py::test_upsert_cot_weekly_insert -v
```

Expected: `ImportError: cannot import name 'upsert_cot_weekly' from 'scraper.db'`

- [ ] **Step 2.3: Add upsert_cot_weekly to scraper/db.py**

Append to `backend/scraper/db.py`:

```python
def upsert_cot_weekly(market: str, report_date, fields: dict):
    from models import CotWeekly
    db = get_session()
    try:
        existing = db.query(CotWeekly).filter_by(date=report_date, market=market).first()
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(CotWeekly(date=report_date, market=market, **fields))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

- [ ] **Step 2.4: Run all model tests**

```bash
cd backend && python -m pytest tests/test_cot_model.py -v
```

Expected: 6 tests PASS

- [ ] **Step 2.5: Commit**

```bash
git add backend/scraper/db.py backend/tests/test_cot_model.py
git commit -m "feat: add upsert_cot_weekly helper"
```

---

## Chunk 2: Import Script

### Task 3: Excel import script

**Files:**
- Create: `backend/import_cot_excel.py`

This is a standalone one-time script. No automated test needed — verified manually against row counts. It is **not** part of the application server.

- [ ] **Step 3.1: Create backend/import_cot_excel.py**

```python
#!/usr/bin/env python3
"""
One-time import: reads NY COT + LDN COT + Other sheets from the Excel file
and upserts all rows into the cot_weekly table.

Usage:
    DATABASE_URL=postgresql://... python import_cot_excel.py \
        --file "C:/Users/Loic Scanu/OneDrive - Tuan Loc Commodities/TradeTeam/COT report.xlsx"
"""
import argparse
import bisect
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))


def _to_float(val):
    """Coerce openpyxl cell value to float or None."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _to_int(val):
    """Coerce openpyxl cell value to int or None."""
    f = _to_float(val)
    return int(f) if f is not None else None


def _build_prices(ws_other):
    """
    Read the Other sheet (data starts at row 3, openpyxl min_row=3).
    Returns (sorted_dates, prices_dict) where prices_dict maps date -> field dict.

    Column mapping (0-indexed from row tuple):
      col 0: Date          col 1: price_ny     col 4: price_ldn
      col 7: structure_ny  col 8: structure_ldn
      col 18: exch_oi_ny   col 19: exch_oi_ldn
      col 20: vol_ny       col 21: vol_ldn
      col 22: efp_ny       col 23: efp_ldn
      col 24: spread_vol_ny col 25: spread_vol_ldn
    """
    prices = {}
    for row in ws_other.iter_rows(min_row=3, values_only=True):
        if row[0] is None:
            continue
        try:
            d = row[0].date() if hasattr(row[0], "date") else None
        except Exception:
            continue
        if d is None:
            continue
        prices[d] = {
            "price_ny":       _to_float(row[1]),
            "price_ldn":      _to_float(row[4]),
            "structure_ny":   _to_float(row[7]),
            "structure_ldn":  _to_float(row[8]),
            "exch_oi_ny":     _to_int(row[18]),
            "exch_oi_ldn":    _to_int(row[19]),
            "vol_ny":         _to_int(row[20]),
            "vol_ldn":        _to_int(row[21]),
            "efp_ny":         _to_float(row[22]),
            "efp_ldn":        _to_float(row[23]),
            "spread_vol_ny":  _to_float(row[24]),
            "spread_vol_ldn": _to_float(row[25]),
        }
    sorted_dates = sorted(prices.keys())
    return sorted_dates, prices


def _lookup_price(report_date, sorted_dates, prices):
    """Return price fields for the most recent date <= report_date."""
    if not sorted_dates:
        return {}
    idx = bisect.bisect_right(sorted_dates, report_date) - 1
    if idx < 0:
        return {}
    return prices[sorted_dates[idx]]


def _import_sheet(ws, market: str, ny_col_map: bool, sorted_dates, prices):
    """
    Import one COT sheet (NY or LDN). Returns count of rows processed.

    Column mapping (0-indexed):
      NY COT:                         LDN COT:
        0  date                         0  date
        1  oi_total                     1  oi_total
        2  pmpu_long                    2  pmpu_long
        3  pmpu_short                   3  pmpu_short
        4  swap_long                    4  swap_long
        5  swap_short                   5  swap_short
        6  swap_spread                  6  swap_spread
        7  mm_long                      7  mm_long
        8  mm_short                     8  mm_short
        9  mm_spread                    9  mm_spread
       10  other_long                  10  other_long
       11  other_short                 11  other_short
       12  other_spread                12  other_spread
       13  nr_long                     13  nr_long
       14  nr_short                    14  nr_short
       32  t_pmpu_long                 17  t_pmpu_long
       33  t_pmpu_short                18  t_pmpu_short
       34  t_swap_long                 19  t_swap_long
       35  t_swap_short                20  t_swap_short
       36  t_swap_spread               21  t_swap_spread
       37  t_mm_long                   22  t_mm_long
       38  t_mm_short                  23  t_mm_short
       39  t_mm_spread                 24  t_mm_spread
       40  t_other_long                25  t_other_long
       41  t_other_short               26  t_other_short
       42  t_other_spread              27  t_other_spread
       43  t_nr_long                   N/A (None)
       44  t_nr_short                  N/A (None)
    """
    from scraper.db import upsert_cot_weekly

    # Trader count column offsets differ between NY and LDN
    if ny_col_map:
        tc = 32   # trader count base offset for NY
        has_nr_traders = True
    else:
        tc = 17   # trader count base offset for LDN
        has_nr_traders = False

    count = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] is None:
            continue
        try:
            d = row[0].date() if hasattr(row[0], "date") else None
        except Exception:
            continue
        if d is None:
            continue

        fields = {
            "oi_total":     _to_int(row[1]),
            "pmpu_long":    _to_int(row[2]),
            "pmpu_short":   _to_int(row[3]),
            "swap_long":    _to_int(row[4]),
            "swap_short":   _to_int(row[5]),
            "swap_spread":  _to_int(row[6]),
            "mm_long":      _to_int(row[7]),
            "mm_short":     _to_int(row[8]),
            "mm_spread":    _to_int(row[9]),
            "other_long":   _to_int(row[10]),
            "other_short":  _to_int(row[11]),
            "other_spread": _to_int(row[12]),
            "nr_long":      _to_int(row[13]),
            "nr_short":     _to_int(row[14]),
            # Trader counts
            "t_pmpu_long":    _to_int(row[tc + 0]),
            "t_pmpu_short":   _to_int(row[tc + 1]),
            "t_swap_long":    _to_int(row[tc + 2]),
            "t_swap_short":   _to_int(row[tc + 3]),
            "t_swap_spread":  _to_int(row[tc + 4]),
            "t_mm_long":      _to_int(row[tc + 5]),
            "t_mm_short":     _to_int(row[tc + 6]),
            "t_mm_spread":    _to_int(row[tc + 7]),
            "t_other_long":   _to_int(row[tc + 8]),
            "t_other_short":  _to_int(row[tc + 9]),
            "t_other_spread": _to_int(row[tc + 10]),
            "t_nr_long":  _to_int(row[tc + 11]) if has_nr_traders else None,
            "t_nr_short": _to_int(row[tc + 12]) if has_nr_traders else None,
        }

        # Merge price/vol fields from Other sheet
        fields.update(_lookup_price(d, sorted_dates, prices))

        upsert_cot_weekly(market, d, fields)
        count += 1

    return count


def main():
    parser = argparse.ArgumentParser(description="Import CoT Excel data into cot_weekly table")
    parser.add_argument("--file", required=True, help="Path to COT report.xlsx")
    args = parser.parse_args()

    import openpyxl
    print(f"Opening {args.file} ...")
    wb = openpyxl.load_workbook(args.file, read_only=True, data_only=True)

    print("Reading Other sheet for prices/volumes ...")
    ws_other = wb["Other"]
    sorted_dates, prices = _build_prices(ws_other)
    print(f"  Other sheet: {len(prices)} date entries loaded")

    print("Importing NY COT ...")
    ws_ny = wb["NY COT"]
    ny_count = _import_sheet(ws_ny, "ny", ny_col_map=True,
                              sorted_dates=sorted_dates, prices=prices)
    print(f"  NY: {ny_count} rows upserted")

    print("Importing LDN COT ...")
    ws_ldn = wb["LDN COT"]
    ldn_count = _import_sheet(ws_ldn, "ldn", ny_col_map=False,
                               sorted_dates=sorted_dates, prices=prices)
    print(f"  LDN: {ldn_count} rows upserted")

    print(f"Done. Total: {ny_count + ldn_count} rows.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3.2: Verify imports work (dry run, no DB needed)**

```bash
cd backend && python -c "import import_cot_excel; print('OK')"
```

Expected: `OK` (no ImportError)

- [ ] **Step 3.3: Commit**

```bash
git add backend/import_cot_excel.py
git commit -m "feat: add one-time CoT Excel import script"
```

---

## Chunk 3: API Route

### Task 4: Create GET /api/cot endpoint

**Files:**
- Create: `backend/routes/cot.py`
- Test: `backend/tests/test_cot_route.py`

- [ ] **Step 4.1: Write failing route tests**

Create `backend/tests/test_cot_route.py`:

```python
# backend/tests/test_cot_route.py
# conftest.py sets DATABASE_URL=sqlite before this file is imported
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import date
from fastapi.testclient import TestClient
from database import Base, engine, SessionLocal
from models import CotWeekly
import main as app_main


@pytest.fixture(autouse=True)
def reset_tables():
    Base.metadata.create_all(bind=engine)
    yield
    db = SessionLocal()
    db.query(CotWeekly).delete()
    db.commit()
    db.close()


@pytest.fixture
def client():
    with TestClient(app_main.app) as c:
        yield c


@pytest.fixture
def session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _seed_row(session, market: str, report_date: date, **kwargs):
    row = CotWeekly(date=report_date, market=market, **kwargs)
    session.add(row)
    session.commit()


def test_empty_db_returns_empty_list(client):
    resp = client.get("/api/cot")
    assert resp.status_code == 200
    assert resp.json() == []


def test_single_ny_row(client, session):
    _seed_row(session, "ny", date(2026, 3, 11),
              oi_total=150000, mm_long=25000, mm_short=12000)
    resp = client.get("/api/cot")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["date"] == "2026-03-11"
    assert data[0]["ny"]["oi_total"] == 150000
    assert data[0]["ny"]["mm_long"] == 25000
    assert data[0]["ldn"] is None


def test_same_date_ny_and_ldn_merged(client, session):
    _seed_row(session, "ny",  date(2026, 3, 11), oi_total=150000)
    _seed_row(session, "ldn", date(2026, 3, 11), oi_total=80000)
    resp = client.get("/api/cot")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["ny"]["oi_total"] == 150000
    assert data[0]["ldn"]["oi_total"] == 80000


def test_ldn_nr_fields_are_null(client, session):
    """t_nr_long and t_nr_short stored as None should come back as null in JSON."""
    _seed_row(session, "ldn", date(2026, 3, 11),
              oi_total=80000, t_nr_long=None, t_nr_short=None)
    resp = client.get("/api/cot")
    ldn = resp.json()[0]["ldn"]
    assert ldn["t_nr_long"] is None
    assert ldn["t_nr_short"] is None


def test_after_param_filters_exclusive(client, session):
    """?after=2026-03-07 should return only rows with date > 2026-03-07."""
    _seed_row(session, "ny", date(2026, 3, 4),  oi_total=100000)
    _seed_row(session, "ny", date(2026, 3, 7),  oi_total=110000)
    _seed_row(session, "ny", date(2026, 3, 11), oi_total=120000)
    resp = client.get("/api/cot?after=2026-03-07")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["date"] == "2026-03-11"


def test_rows_sorted_ascending(client, session):
    _seed_row(session, "ny", date(2026, 3, 11), oi_total=120000)
    _seed_row(session, "ny", date(2026, 3, 4),  oi_total=100000)
    resp = client.get("/api/cot")
    dates = [r["date"] for r in resp.json()]
    assert dates == sorted(dates)
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```bash
cd backend && python -m pytest tests/test_cot_route.py -v
```

Expected: `AttributeError` or `404` because the route doesn't exist yet

- [ ] **Step 4.3: Create backend/routes/cot.py**

```python
# backend/routes/cot.py
from datetime import date as DateType
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from models import CotWeekly

router = APIRouter(prefix="/api/cot", tags=["cot"])


def _row_to_dict(row: CotWeekly) -> dict:
    return {
        "oi_total":      row.oi_total,
        "pmpu_long":     row.pmpu_long,     "pmpu_short":    row.pmpu_short,
        "swap_long":     row.swap_long,     "swap_short":    row.swap_short,
        "swap_spread":   row.swap_spread,
        "mm_long":       row.mm_long,       "mm_short":      row.mm_short,
        "mm_spread":     row.mm_spread,
        "other_long":    row.other_long,    "other_short":   row.other_short,
        "other_spread":  row.other_spread,
        "nr_long":       row.nr_long,       "nr_short":      row.nr_short,
        "t_pmpu_long":   row.t_pmpu_long,   "t_pmpu_short":  row.t_pmpu_short,
        "t_swap_long":   row.t_swap_long,   "t_swap_short":  row.t_swap_short,
        "t_swap_spread": row.t_swap_spread,
        "t_mm_long":     row.t_mm_long,     "t_mm_short":    row.t_mm_short,
        "t_mm_spread":   row.t_mm_spread,
        "t_other_long":  row.t_other_long,  "t_other_short": row.t_other_short,
        "t_other_spread":row.t_other_spread,
        "t_nr_long":     row.t_nr_long,     "t_nr_short":    row.t_nr_short,
        "price_ny":      row.price_ny,      "price_ldn":     row.price_ldn,
        "structure_ny":  row.structure_ny,  "structure_ldn": row.structure_ldn,
        "exch_oi_ny":    row.exch_oi_ny,    "exch_oi_ldn":   row.exch_oi_ldn,
        "vol_ny":        row.vol_ny,        "vol_ldn":       row.vol_ldn,
        "efp_ny":        row.efp_ny,        "efp_ldn":       row.efp_ldn,
        "spread_vol_ny": row.spread_vol_ny, "spread_vol_ldn":row.spread_vol_ldn,
    }


@router.get("")
def get_cot(
    after: Optional[str] = Query(None, description="Exclusive lower bound date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    query = db.query(CotWeekly).order_by(CotWeekly.date.asc())
    if after:
        cutoff = DateType.fromisoformat(after)
        query = query.filter(CotWeekly.date > cutoff)

    # Group in Python (not SQL) — too many columns for SQL aggregation
    merged: dict[DateType, dict] = {}
    for row in query.all():
        d = row.date
        if d not in merged:
            merged[d] = {"date": d.isoformat(), "ny": None, "ldn": None}
        merged[d][row.market] = _row_to_dict(row)

    return sorted(merged.values(), key=lambda x: x["date"])
```

- [ ] **Step 4.4: Run the route tests — still expect failure (router not registered)**

```bash
cd backend && python -m pytest tests/test_cot_route.py::test_empty_db_returns_empty_list -v
```

Expected: 404 — route not registered in main.py yet

- [ ] **Step 4.5: Register the router in main.py**

In `backend/main.py`, add the cot router import and include it:

```python
# Add to imports at top:
from routes.cot import router as cot_router

# Add after the existing app.include_router lines:
app.include_router(cot_router)
```

- [ ] **Step 4.6: Run all route tests**

```bash
cd backend && python -m pytest tests/test_cot_route.py -v
```

Expected: 6 tests PASS

- [ ] **Step 4.7: Run the full test suite to confirm nothing broken**

```bash
cd backend && python -m pytest -v
```

Expected: All tests PASS

- [ ] **Step 4.8: Commit**

```bash
git add backend/routes/cot.py backend/main.py backend/tests/test_cot_route.py
git commit -m "feat: add GET /api/cot endpoint"
```

---

## Chunk 4: Scraper Update

### Task 5: Upsert CoT data on weekly scrape

**Files:**
- Modify: `backend/scraper/sources/futures.py`

No automated test needed — the upsert helper is already tested in Task 2. This task is a one-line addition inside each scraper function.

- [ ] **Step 5.1: Add import at top of futures.py**

Open `backend/scraper/sources/futures.py`. Find the existing imports (typically `import json`, `import csv`, etc.). Add:

```python
from scraper.db import upsert_cot_weekly
```

- [ ] **Step 5.2: Add upsert call inside _make_cot_item (CFTC → NY)**

In `_make_cot_item`, find the line `cot_struct = {` (around line 331). The function already has local variables `pmpu_l, pmpu_s, swap_l, swap_s, swap_sp, mm_l, mm_s, mm_sp, oth_l, oth_s, oth_sp, nr_l, nr_s`.

After the `cot_struct = {...}` block closes (the closing `}` on the line before `mm_net = ...`), add:

```python
    # Persist to cot_weekly for the CoT dashboard
    try:
        upsert_cot_weekly("ny", report_date, {
            "oi_total":    oi,
            "pmpu_long":   pmpu_l,  "pmpu_short":  pmpu_s,
            "swap_long":   swap_l,  "swap_short":  swap_s,  "swap_spread": swap_sp,
            "mm_long":     mm_l,    "mm_short":    mm_s,    "mm_spread":   mm_sp,
            "other_long":  oth_l,   "other_short": oth_s,   "other_spread": oth_sp,
            "nr_long":     nr_l,    "nr_short":    nr_s,
            # Trader counts not available from CFTC disaggregated CSV
            # price_ny / price_ldn not available at scrape time
        })
    except Exception as e:
        print(f"[cot] Failed to upsert NY cot_weekly for {report_date}: {e}")
```

> Note the `try/except` — a DB failure must not prevent the scraper from returning the news item.

- [ ] **Step 5.3: Add upsert call inside _make_ice_cot_item (ICE → LDN)**

In `_make_ice_cot_item`, the same local variables exist (`pmpu_l, pmpu_s, swap_l, swap_s, swap_sp, mm_l, mm_s, mm_sp, oth_l, oth_s, oth_sp, nr_l, nr_s`). After `cot_struct = {...}` closes, add:

```python
    # Persist to cot_weekly for the CoT dashboard
    try:
        upsert_cot_weekly("ldn", report_date, {
            "oi_total":    oi,
            "pmpu_long":   pmpu_l,  "pmpu_short":  pmpu_s,
            "swap_long":   swap_l,  "swap_short":  swap_s,  "swap_spread": swap_sp,
            "mm_long":     mm_l,    "mm_short":    mm_s,    "mm_spread":   mm_sp,
            "other_long":  oth_l,   "other_short": oth_s,   "other_spread": oth_sp,
            "nr_long":     nr_l,    "nr_short":    nr_s,
            "t_nr_long":   None,    "t_nr_short":  None,    # ICE has no NR trader count
            # price_ny / price_ldn not available at scrape time
        })
    except Exception as e:
        print(f"[cot] Failed to upsert LDN cot_weekly for {report_date}: {e}")
```

- [ ] **Step 5.4: Verify the scraper module still imports cleanly**

```bash
cd backend && python -c "from scraper.sources.futures import _make_cot_item; print('OK')"
```

Expected: `OK`

- [ ] **Step 5.5: Commit**

```bash
git add backend/scraper/sources/futures.py
git commit -m "feat: upsert cot_weekly on weekly CFTC/ICE scrape"
```

---

## Chunk 5: Frontend

### Task 6: Add fetchCot to api.ts

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 6.1: Append fetchCot to frontend/lib/api.ts**

```typescript
export async function fetchCot(after?: string): Promise<any[]> {
  const url = after
    ? `${API_URL}/api/cot?after=${after}`
    : `${API_URL}/api/cot`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch CoT data");
  return res.json();
}
```

- [ ] **Step 6.2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6.3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add fetchCot() to api.ts"
```

---

### Task 7: Add transformApiData and lazy fetch to CotDashboard

**Files:**
- Modify: `frontend/components/futures/CotDashboard.tsx`

This is the most complex task. Read the full spec section "transformApiData — Complete Specification" before starting.

- [ ] **Step 7.1: Add useEffect to React import**

In `CotDashboard.tsx` line 2, change:
```typescript
import React, { useState, useMemo } from "react";
```
to:
```typescript
import React, { useState, useMemo, useEffect } from "react";
```

- [ ] **Step 7.2: Add fetchCot import**

After the recharts import block (after line 7), add:
```typescript
import { fetchCot } from "@/lib/api";
```

- [ ] **Step 7.3: Add transformApiData function**

Insert this function **before** `generateData()` (before line 39):

```typescript
// ── Real data transform ─────────────────────────────────────────────────────
function transformApiData(rows: any[]): any[] {
  if (!rows.length) return [];

  let prevPriceNY  = 130;
  let prevPriceLDN = 1800;
  let cumulativeNominal = 0;
  let cumulativeMargin  = 0;

  // Pass 1: ordered iteration — delta fields require access to previous row
  const base: any[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ny  = row.ny  ?? {};
    const ldn = row.ldn ?? {};

    const oiNY  = ny.oi_total  ?? 0;
    const oiLDN = ldn.oi_total ?? 0;
    const totalOI = oiNY + oiLDN;

    // Spreading — from RAW API spread fields (these are NOT in the ny/ldn sub-objects below)
    const spreadingNY  = (ny.swap_spread  ?? 0) + (ny.mm_spread  ?? 0) + (ny.other_spread  ?? 0);
    const spreadingLDN = (ldn.swap_spread ?? 0) + (ldn.mm_spread ?? 0) + (ldn.other_spread ?? 0);
    const spreadingTotal = spreadingNY + spreadingLDN;
    const outrightTotal  = totalOI - spreadingTotal;

    // Price carry-forward
    const priceNY  = ny.price_ny   != null ? ny.price_ny   : prevPriceNY;
    const priceLDN = ldn.price_ldn != null ? ldn.price_ldn : prevPriceLDN;
    prevPriceNY  = priceNY;
    prevPriceLDN = priceLDN;

    const priceNY_USD_Ton  = priceNY * CENTS_LB_TO_USD_TON;
    const avgPrice_USD_Ton = totalOI > 0
      ? ((priceNY_USD_Ton * oiNY) + (priceLDN * oiLDN)) / totalOI
      : 0;

    // Delta OI
    const prev         = base[i - 1] ?? null;
    const deltaOINY    = prev ? oiNY  - prev.oiNY  : 0;
    const deltaOILDN   = prev ? oiLDN - prev.oiLDN : 0;

    // Weekly nominal flow ($M)
    const flowNY  = (deltaOINY  * priceNY  * 375) / 1_000_000;
    const flowLDN = (deltaOILDN * priceLDN * 10)  / 1_000_000;
    const weeklyNominalFlow = flowNY + flowLDN;

    // Weekly margin flow ($M)
    const prevSpread   = prev ? prev.spreadingTotal : 0;
    const prevOutright = prev ? prev.outrightTotal  : 0;
    const deltaSpread   = spreadingTotal - prevSpread;
    const deltaOutright = outrightTotal  - prevOutright;
    const weeklyMarginFlow =
      ((deltaOutright * MARGIN_OUTRIGHT) + (deltaSpread * MARGIN_SPREAD)) / 1_000_000;

    cumulativeNominal += weeklyNominalFlow;
    cumulativeMargin  += weeklyMarginFlow;

    const macroMarket = cumulativeNominal * 2.5;
    const macroSofts  = cumulativeNominal * 1.5;

    // ny / ldn sub-objects: camelCase OI fields
    // IMPORTANT: nonRepLong (capital R) — matches d.ny[`nonRepLong`] used in Tabs 2 & 5
    // tradersNY.nonrep (lowercase) — matches m.tr["nonrep"] used in Tab 5's dpCats loop
    const nyObj = {
      pmpuLong:    ny.pmpu_long   ?? 0,  pmpuShort:   ny.pmpu_short  ?? 0,
      swapLong:    ny.swap_long   ?? 0,  swapShort:   ny.swap_short  ?? 0,
      mmLong:      ny.mm_long     ?? 0,  mmShort:     ny.mm_short    ?? 0,
      otherLong:   ny.other_long  ?? 0,  otherShort:  ny.other_short ?? 0,
      nonRepLong:  ny.nr_long     ?? 0,  nonRepShort: ny.nr_short    ?? 0,
    };
    const ldnObj = {
      pmpuLong:    ldn.pmpu_long  ?? 0,  pmpuShort:   ldn.pmpu_short  ?? 0,
      swapLong:    ldn.swap_long  ?? 0,  swapShort:   ldn.swap_short  ?? 0,
      mmLong:      ldn.mm_long    ?? 0,  mmShort:     ldn.mm_short    ?? 0,
      otherLong:   ldn.other_long ?? 0,  otherShort:  ldn.other_short ?? 0,
      nonRepLong:  ldn.nr_long    ?? 0,  nonRepShort: ldn.nr_short    ?? 0,
    };

    const tradersNY = {
      pmpu:   ny.t_pmpu_long  ?? 0,
      mm:     ny.t_mm_long    ?? 0,
      swap:   ny.t_swap_long  ?? 0,
      other:  ny.t_other_long ?? 0,
      nonrep: ny.t_nr_long    ?? 0,
    };
    const tradersLDN = {
      pmpu:   ldn.t_pmpu_long  ?? 0,
      mm:     ldn.t_mm_long    ?? 0,
      swap:   ldn.t_swap_long  ?? 0,
      other:  ldn.t_other_long ?? 0,
      nonrep: 0,  // ICE has no NR trader count
    };

    const pmpuShortMT_NY  = nyObj.pmpuShort  * ARABICA_MT_FACTOR;
    const pmpuShortMT_LDN = ldnObj.pmpuShort * ROBUSTA_MT_FACTOR;
    const efpMT = (ny.efp_ny ?? 0) * ARABICA_MT_FACTOR;

    base.push({
      id: i,
      date: row.date,
      priceNY, priceLDN, avgPrice_USD_Ton,
      oiNY, oiLDN, totalOI,
      spreadingTotal, outrightTotal,
      weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
      macroMarket, macroSofts,
      ny: nyObj, ldn: ldnObj,
      tradersNY, tradersLDN,
      pmpuShortMT_NY, pmpuShortMT_LDN,
      pmpuShortMT: pmpuShortMT_NY + pmpuShortMT_LDN,
      efpMT,
      timeframe: "historical", // overwritten in pass 2
    });
  }

  // Pass 2: timeframe buckets + 52-week rolling ranks
  const n = base.length;
  return base.map((d, i) => {
    const timeframe =
      i === n - 1               ? "current"    :
      i === n - 2               ? "recent_1"   :
      (i >= n - 6 && i <= n - 3) ? "recent_4"  :
      (i >= n - 58 && i <= n - 7) ? "year"      :
                                   "historical";

    const slice  = base.slice(Math.max(0, i - 52), i + 1);
    const prices = slice.map(s => s.priceNY);
    const maxP   = Math.max(...prices);
    const minP   = Math.min(...prices);
    const net    = d.ny.mmLong - d.ny.mmShort;
    const nets   = slice.map(s => s.ny.mmLong - s.ny.mmShort);
    const maxNet = Math.max(...nets);
    const minNet = Math.min(...nets);

    return {
      ...d,
      timeframe,
      priceRank: maxP !== minP ? ((d.priceNY - minP) / (maxP - minP)) * 100 : 50,
      oiRank:    maxNet !== minNet ? ((net - minNet) / (maxNet - minNet)) * 100 : 50,
    };
  });
}
```

- [ ] **Step 7.4: Update the CotDashboard component**

Find the `export default function CotDashboard()` at line 228. Replace its opening lines:

**Before:**
```typescript
export default function CotDashboard() {
  const [step, setStep] = useState<Step>(1);
  const data = useMemo(() => generateData(), []);
  const latest = data[data.length - 1];
```

**After:**
```typescript
export default function CotDashboard() {
  const [step, setStep] = useState<Step>(1);
  const [cotRows, setCotRows] = useState<any[] | null>(null);
  const [cotError, setCotError] = useState(false);

  useEffect(() => {
    fetchCot()
      .then(setCotRows)
      .catch(() => setCotError(true));
  }, []);

  const data = useMemo(
    () => (cotRows?.length ? transformApiData(cotRows) : generateData()),
    [cotRows]
  );
  const latest = data[data.length - 1];
```

- [ ] **Step 7.5: Add loading/error banner above the tab content**

Find the JSX that renders the step navigation tabs (look for `NAV_STEPS.map` in the return). Just above the chart area (the `<div>` that renders by `step`), add:

```tsx
{cotError && (
  <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-400 text-xs">
    Live data unavailable — showing illustrative data
  </div>
)}
{cotRows === null && !cotError && (
  <div className="mb-3 h-2 rounded-full bg-slate-800 overflow-hidden">
    <div className="h-full bg-slate-600 animate-pulse w-full" />
  </div>
)}
```

- [ ] **Step 7.6: Verify TypeScript compiles with no errors**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7.7: Start dev server and verify CoT tab renders**

```bash
cd frontend && npm run dev
```

Open browser → Futures page → CoT tab. Verify:
- Loading bar appears briefly (or not at all if API responds fast)
- Charts render with data (real if API is seeded, fallback dummy if not)
- No console errors

- [ ] **Step 7.8: Commit**

```bash
git add frontend/components/futures/CotDashboard.tsx frontend/lib/api.ts
git commit -m "feat: CoT dashboard lazy-fetches real data, falls back to generateData()"
```

---

## Deployment Notes (run after all tasks pass)

1. Deploy the backend — `Base.metadata.create_all()` on startup creates `cot_weekly` table in Supabase
2. Run the import script once against production DB:
   ```bash
   DATABASE_URL=postgresql://<supabase_url> python backend/import_cot_excel.py \
     --file "C:/Users/Loic Scanu/OneDrive - Tuan Loc Commodities/TradeTeam/COT report.xlsx"
   ```
3. Verify: `SELECT COUNT(*), market FROM cot_weekly GROUP BY market;`
4. Update CORS in `backend/main.py` to include the production frontend origin alongside `localhost:3000`

> **Column offset verification:** Before running the import script, open the Excel file and confirm the 0-indexed column positions in `NY COT` and `LDN COT` match the mapping table in the spec. The trader count columns (offsets 32–44 for NY, 17–27 for LDN) are the most likely to differ from the `FO` sheets.
