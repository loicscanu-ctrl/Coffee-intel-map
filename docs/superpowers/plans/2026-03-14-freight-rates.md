# Freight Rate Live Data Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dummy freight rates in `frontend/app/freight/page.tsx` with live FBX container rate data scraped daily from Freightos Terminal pages.

**Architecture:** A new Playwright scraper intercepts XHR responses on Freightos Terminal chart pages to capture FBX time-series data, upserts it into a new `freight_rates` DB table, and a new FastAPI endpoint transforms that data (applying multipliers for proxy routes) into a shape consumed by the existing freight page.

**Tech Stack:** Python/Playwright (scraper), SQLAlchemy 2.x (model), FastAPI (API), React/Recharts (frontend), PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-03-14-freight-rates-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/models.py` | Modify | Add `FreightRate` model |
| `backend/scraper/db.py` | Modify | Add `upsert_freight_rate()` |
| `backend/scraper/sources/freightos.py` | Create | Playwright XHR scraper for FBX01, FBX03, FBX11 |
| `backend/scraper/main.py` | Modify | Register `freightos` in `ALL_SOURCES` |
| `backend/routes/freight.py` | Create | `GET /api/freight` endpoint |
| `backend/main.py` | Modify | Register freight router |
| `backend/tests/conftest.py` | Create | Pytest fixtures (SQLite in-memory DB) |
| `backend/tests/test_freight_model.py` | Create | Model + upsert tests |
| `backend/tests/test_freight_route.py` | Create | API endpoint tests |
| `frontend/app/freight/page.tsx` | Modify | Fetch live data, remove static constants |

---

## Chunk 1: Data Layer

### Task 1: Test setup + FreightRate model

**Files:**
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_freight_model.py`
- Modify: `backend/models.py`

- [ ] **Step 1: Create `backend/tests/conftest.py`**

`DATABASE_URL` must be set **before any project imports** so `database.py`'s module-level `create_engine()` uses SQLite. This also means the `startup` hook's `Base.metadata.create_all` runs against SQLite — no Docker required.

```python
# backend/tests/conftest.py
import os
# Override DB URL before any project code is imported
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, engine, SessionLocal

@pytest.fixture
def db():
    """In-process session for model tests."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(engine)
```

- [ ] **Step 2: Write failing test for FreightRate model**

```python
# backend/tests/test_freight_model.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from models import FreightRate

def test_freight_rate_create(db):
    row = FreightRate(index_code="FBX11", date=date(2026, 3, 14), rate=2850.0)
    db.add(row)
    db.commit()
    result = db.query(FreightRate).first()
    assert result.index_code == "FBX11"
    assert result.rate == 2850.0

def test_freight_rate_unique_constraint(db):
    """Inserting duplicate (index_code, date) should raise."""
    from sqlalchemy.exc import IntegrityError
    import pytest
    db.add(FreightRate(index_code="FBX11", date=date(2026, 3, 14), rate=2850.0))
    db.commit()
    db.add(FreightRate(index_code="FBX11", date=date(2026, 3, 14), rate=9999.0))
    with pytest.raises(IntegrityError):
        db.commit()
```

- [ ] **Step 3: Run test — expect ImportError (FreightRate doesn't exist yet)**

```bash
cd backend && python -m pytest tests/test_freight_model.py -v
```
Expected: `ImportError: cannot import name 'FreightRate'`

- [ ] **Step 4: Add `FreightRate` to `backend/models.py`**

Add `UniqueConstraint` to the existing import line (line 2):
```python
from sqlalchemy import String, Float, DateTime, Text, JSON, Date, Integer, UniqueConstraint
```

Append after the `CertifiedStock` class (after line 47):
```python
class FreightRate(Base):
    __tablename__ = "freight_rates"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    index_code: Mapped[str]      = mapped_column(String(10), nullable=False)
    date:       Mapped[date]     = mapped_column(Date, nullable=False)
    rate:       Mapped[float]    = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("index_code", "date", name="uq_freight_index_date"),)
```

- [ ] **Step 5: Run test — expect both tests to pass**

```bash
cd backend && python -m pytest tests/test_freight_model.py -v
```
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/tests/conftest.py backend/tests/test_freight_model.py
git commit -m "feat: add FreightRate model and tests"
```

---

### Task 2: upsert_freight_rate helper

**Files:**
- Modify: `backend/scraper/db.py`
- Modify: `backend/tests/test_freight_model.py`

- [ ] **Step 1: Update `backend/tests/conftest.py` to also export a `scraper_db` fixture**

The upsert tests call `upsert_freight_rate` (which opens its own session via `scraper/db.py`'s `get_session`) and verify results with a fresh session. Since `conftest.py` already sets `DATABASE_URL` to `"sqlite:///./test.db"`, `scraper/db.py`'s `get_session()` will use the same DB — we just need to reset its cached engine between tests.

Note: `tmp_path.as_posix()` is required on Windows to produce forward-slash SQLite URLs.

Add to `conftest.py` (after the `db` fixture):

```python
@pytest.fixture
def scraper_db():
    """
    Resets scraper/db.py's cached engine so it picks up the conftest DATABASE_URL.
    Creates tables, yields, then drops tables and resets cache.
    """
    import scraper.db as _scraper_db
    _scraper_db._engine = None
    _scraper_db._Session = None
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    _scraper_db._engine = None
    _scraper_db._Session = None
```

- [ ] **Step 2: Write failing tests for upsert_freight_rate**

Add to `backend/tests/test_freight_model.py`:

```python
def test_upsert_freight_rate_insert(scraper_db):
    """upsert_freight_rate inserts a new record when none exists."""
    from scraper.db import upsert_freight_rate, get_session
    upsert_freight_rate("FBX11", date(2026, 3, 14), 2850.0)
    db = get_session()
    try:
        result = db.query(FreightRate).filter_by(index_code="FBX11").first()
        assert result is not None
        assert result.rate == 2850.0
    finally:
        db.close()

def test_upsert_freight_rate_update(scraper_db):
    """upsert_freight_rate updates an existing record on duplicate (index_code, date)."""
    from scraper.db import upsert_freight_rate, get_session
    upsert_freight_rate("FBX11", date(2026, 3, 14), 2850.0)
    upsert_freight_rate("FBX11", date(2026, 3, 14), 3000.0)
    db = get_session()
    try:
        rows = db.query(FreightRate).filter_by(index_code="FBX11").all()
        assert len(rows) == 1
        assert rows[0].rate == 3000.0
    finally:
        db.close()
```

- [ ] **Step 3: Run test — expect AttributeError (upsert_freight_rate doesn't exist)**

```bash
cd backend && python -m pytest tests/test_freight_model.py::test_upsert_freight_rate_insert -v
```
Expected: `AttributeError: module 'scraper.db' has no attribute 'upsert_freight_rate'`

- [ ] **Step 4: Add `upsert_freight_rate` to `backend/scraper/db.py`**

Append after `upsert_news_item` (after line 54). The function creates and closes its own session — this is intentional since it is called directly by the Freightos scraper, not via the main scraper loop's shared session:

```python
def upsert_freight_rate(index_code: str, rate_date, rate: float):
    from models import FreightRate
    db = get_session()
    try:
        existing = db.query(FreightRate).filter_by(
            index_code=index_code, date=rate_date
        ).first()
        if existing:
            existing.rate = rate
        else:
            db.add(FreightRate(index_code=index_code, date=rate_date, rate=rate))
        db.commit()
    except Exception:
        db.rollback()
        raise  # Let the caller (scraper loop) decide how to handle failures
    finally:
        db.close()
```

Note: unlike `upsert_news_item`, this function re-raises on error. The scraper loop in `freightos.py` wraps each call in its own try/except, so a single failed upsert doesn't abort the whole batch (see Task 4 Step 1).

- [ ] **Step 5: Run all model tests**

```bash
cd backend && python -m pytest tests/test_freight_model.py -v
```
Expected: `4 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/scraper/db.py backend/tests/test_freight_model.py
git commit -m "feat: add upsert_freight_rate helper"
```

---

## Chunk 2: Freightos Scraper

### Task 3: Discover the XHR endpoint

Before writing the scraper, the actual network request URL pattern must be confirmed.

**Files:** None (discovery only)

- [ ] **Step 1: Inspect the Freightos Terminal page network traffic**

Open Chrome DevTools → Network tab → filter by "Fetch/XHR". Navigate to:
```
https://terminal.freightos.com/fbx-11-china-to-northern-europe/
```
Wait for the chart to render. Look for JSON responses that contain arrays of objects with date strings and numeric rate values. Note:
- The exact URL of the request (path, query params)
- The JSON response structure (field names for date and rate)

- [ ] **Step 2: Record findings**

Note the URL pattern and field names. The scraper implementation in Task 4 uses these. Expected example (verify against actual):
```
URL pattern: something like /api/v1/fbx/FBX11/data or /series/FBX11/history
Response body: [{"date": "2026-03-14", "rate": 2850}, ...] or similar structure
```

---

### Task 4: Implement freightos.py scraper

**Files:**
- Create: `backend/scraper/sources/freightos.py`
- Modify: `backend/scraper/main.py`

- [ ] **Step 1: Create `backend/scraper/sources/freightos.py`**

Use the URL pattern and field names discovered in Task 3 to fill in the `_parse_chart_json` function.

```python
# backend/scraper/sources/freightos.py
import asyncio
import json as _json
import re
from datetime import date, datetime
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from scraper.db import upsert_freight_rate

FBX_INDICES = {
    "FBX01": "https://terminal.freightos.com/fbx-01-china-to-north-america-west-coast/",
    "FBX03": "https://terminal.freightos.com/fbx-03-china-to-north-america-east-coast/",
    "FBX11": "https://terminal.freightos.com/fbx-11-china-to-northern-europe/",
}


def _parse_chart_json(payload: dict | list) -> list[tuple[date, float]]:
    """
    Extract (date, rate) pairs from the XHR JSON payload.

    IMPORTANT: Update the field names below to match what you observed
    in the DevTools network inspection (Task 3).

    Common patterns to handle:
      - {"data": [{"date": "2026-03-14", "value": 2850.0}, ...]}
      - [{"x": "2026-03-14", "y": 2850.0}, ...]
      - {"series": [{"t": 1710374400000, "v": 2850.0}, ...]}  (Unix ms timestamps)
    """
    results = []
    # Unwrap if wrapped in an outer object
    if isinstance(payload, dict):
        # Try common wrapper keys
        for key in ("data", "series", "prices", "values", "results"):
            if key in payload and isinstance(payload[key], list):
                payload = payload[key]
                break

    if not isinstance(payload, list):
        return results

    for item in payload:
        if not isinstance(item, dict):
            continue
        # Try to extract date — update field names based on Task 3 findings
        raw_date = item.get("date") or item.get("x") or item.get("t") or item.get("time")
        raw_rate = item.get("value") or item.get("y") or item.get("v") or item.get("rate") or item.get("price")
        if raw_date is None or raw_rate is None:
            continue
        try:
            # Handle ISO string "2026-03-14" or Unix ms timestamp
            if isinstance(raw_date, (int, float)):
                d = date.fromtimestamp(raw_date / 1000)
            else:
                d = date.fromisoformat(str(raw_date)[:10])
            results.append((d, float(raw_rate)))
        except (ValueError, TypeError):
            continue
    return results


async def _scrape_index(page, index_code: str, url: str) -> int:
    """Load one FBX page, intercept chart XHR, upsert all data points. Returns count saved."""
    captured = []

    async def on_response(response):
        ct = response.headers.get("content-type", "")
        if "json" not in ct:
            return
        try:
            body = await response.json()
            pairs = _parse_chart_json(body)
            if pairs:
                captured.extend(pairs)
                print(f"[freightos] {index_code}: captured {len(pairs)} points from {response.url}")
        except Exception:
            pass

    page.on("response", on_response)
    try:
        await page.goto(url, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3000)  # Extra wait for late XHR
    except Exception as e:
        print(f"[freightos] {index_code}: page load error: {e}")
    finally:
        page.remove_listener("response", on_response)

    if not captured:
        print(f"[freightos] {index_code}: WARNING — no chart data captured, skipping")
        return 0

    saved = 0
    for rate_date, rate in captured:
        try:
            upsert_freight_rate(index_code, rate_date, rate)
            saved += 1
        except Exception as e:
            print(f"[freightos] {index_code}: upsert failed for {rate_date}: {e}")
    return saved


async def run(page) -> list[dict]:
    """Scrape all FBX indices and write to freight_rates table. Returns [] (side-effect only)."""
    for index_code, url in FBX_INDICES.items():
        count = await _scrape_index(page, index_code, url)
        print(f"[freightos] {index_code}: {count} data points saved")
    return []
```

- [ ] **Step 2: Add `freightos` to `backend/scraper/main.py`**

Line 11 — add `freightos` to the import:
```python
from scraper.sources import barchart, b3, brazil, vietnam, origins, demand, technicals, futures, uganda, freightos
```

Line 13 — add `freightos` to `ALL_SOURCES`:
```python
ALL_SOURCES = [barchart, b3, brazil, vietnam, origins, demand, technicals, futures, uganda, freightos]
```

- [ ] **Step 3: Test the scraper manually (Docker)**

Rebuild and run the scraper once to verify it captures data:
```bash
docker compose build scraper
docker compose run --rm scraper python -m scraper.main
```
Expected log output:
```
[freightos] FBX11: captured N points from https://...
[freightos] FBX11: N data points saved
[freightos] FBX01: N data points saved
[freightos] FBX03: N data points saved
```

If you see `WARNING — no chart data captured`, the field names in `_parse_chart_json` need updating based on what was found in Task 3. Print the raw `body` to inspect:
```python
# Temporary debug — add inside on_response before _parse_chart_json call:
if "json" in ct:
    print(f"[debug] {response.url}: {str(body)[:300]}")
```

- [ ] **Step 4: Verify data in DB**

```bash
docker compose exec db psql -U coffee -d coffee_intel -c \
  "SELECT index_code, min(date), max(date), count(*) FROM freight_rates GROUP BY index_code;"
```
Expected: 3 rows (FBX01, FBX03, FBX11) each with 200+ data points.

- [ ] **Step 5: Commit**

```bash
git add backend/scraper/sources/freightos.py backend/scraper/main.py
git commit -m "feat: add Freightos FBX scraper with XHR interception"
```

---

## Chunk 3: API + Frontend

### Task 5: GET /api/freight endpoint

**Files:**
- Create: `backend/routes/freight.py`
- Create: `backend/tests/test_freight_route.py`

- [ ] **Step 1: Write failing tests for the freight endpoint**

Because `conftest.py` sets `DATABASE_URL` to SQLite before any imports, `database.py`'s module-level `create_engine` and `main.py`'s startup `create_all` both use SQLite — no `dependency_overrides` needed.

```python
# backend/tests/test_freight_route.py
# Note: conftest.py sets DATABASE_URL=sqlite before this file is imported
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from database import Base, engine, SessionLocal
from models import FreightRate
import main as app_main


@pytest.fixture(autouse=True)
def reset_tables():
    """Create tables before each test; clean freight_rates rows after."""
    Base.metadata.create_all(bind=engine)
    yield
    db = SessionLocal()
    db.query(FreightRate).delete()
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


def _seed_fbx(session, index_code: str, days: int = 20, base_rate: float = 3000.0):
    """Insert `days` daily records ending today. i=0 is oldest, i=days-1 is today."""
    today = date.today()
    for i in range(days):
        d = today - timedelta(days=days - 1 - i)
        session.add(FreightRate(index_code=index_code, date=d, rate=base_rate - i * 10))
    session.commit()


def test_freight_returns_seven_routes(client, session):
    _seed_fbx(session, "FBX11", days=20, base_rate=3000)
    _seed_fbx(session, "FBX01", days=20, base_rate=4000)
    _seed_fbx(session, "FBX03", days=20, base_rate=3500)
    resp = client.get("/api/freight")
    assert resp.status_code == 200
    assert len(resp.json()["routes"]) == 7


def test_multiplier_applied(client, session):
    """br-eu rate should be FBX11 latest rate * 0.58."""
    _seed_fbx(session, "FBX11", days=10, base_rate=3000)
    _seed_fbx(session, "FBX01", days=10, base_rate=4000)
    _seed_fbx(session, "FBX03", days=10, base_rate=3500)
    resp = client.get("/api/freight")
    routes = {r["id"]: r for r in resp.json()["routes"]}
    # i=9 is today: rate = 3000 - 9*10 = 2910
    assert routes["br-eu"]["rate"] == round(2910 * 0.58)


def test_prev_fallback_when_no_old_data(client, session):
    """When no data older than 7 days exists, prev equals rate."""
    _seed_fbx(session, "FBX11", days=5, base_rate=3000)
    _seed_fbx(session, "FBX01", days=5, base_rate=4000)
    _seed_fbx(session, "FBX03", days=5, base_rate=3500)
    resp = client.get("/api/freight")
    vn_eu = next(r for r in resp.json()["routes"] if r["id"] == "vn-eu")
    assert vn_eu["prev"] == vn_eu["rate"]


def test_history_has_chart_routes(client, session):
    """History array contains date + keys for the 4 chart routes."""
    _seed_fbx(session, "FBX11", days=20, base_rate=3000)
    _seed_fbx(session, "FBX01", days=20, base_rate=4000)
    _seed_fbx(session, "FBX03", days=20, base_rate=3500)
    resp = client.get("/api/freight")
    history = resp.json()["history"]
    assert len(history) > 0
    for key in ("date", "vn-eu", "br-eu", "vn-us", "et-eu"):
        assert key in history[0]


def test_empty_db_returns_empty_routes(client):
    """Empty DB returns empty routes and history without crashing."""
    resp = client.get("/api/freight")
    assert resp.status_code == 200
    assert resp.json()["routes"] == []
    assert resp.json()["history"] == []
```

- [ ] **Step 2: Run tests — expect 404 (route doesn't exist yet)**

```bash
cd backend && python -m pytest tests/test_freight_route.py -v
```
Expected: all tests fail with connection error or 404

- [ ] **Step 3: Create `backend/routes/freight.py`**

```python
# backend/routes/freight.py
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import FreightRate

router = APIRouter(prefix="/api/freight", tags=["freight"])

# Route configuration: id, from, to, FBX index, multiplier, is_proxy
ROUTE_CONFIG = [
    ("vn-eu",  "Ho Chi Minh", "Rotterdam",   "FBX11", 1.00, False),
    ("vn-ham", "Ho Chi Minh", "Hamburg",     "FBX11", 1.02, False),
    ("vn-us",  "Ho Chi Minh", "Los Angeles", "FBX01", 1.00, False),
    ("br-eu",  "Santos",      "Rotterdam",   "FBX11", 0.58, True),
    ("co-eu",  "Cartagena",   "Rotterdam",   "FBX11", 0.55, True),
    ("et-eu",  "Djibouti",    "Rotterdam",   "FBX11", 0.70, True),
    ("br-us",  "Santos",      "New York",    "FBX03", 0.45, True),
]

# The 4 routes shown in the chart
CHART_ROUTES = {"vn-eu", "br-eu", "vn-us", "et-eu"}


def _latest_rate(db: Session, index_code: str) -> FreightRate | None:
    return (
        db.query(FreightRate)
        .filter(FreightRate.index_code == index_code)
        .order_by(FreightRate.date.desc())
        .first()
    )


def _prev_rate(db: Session, index_code: str) -> FreightRate | None:
    cutoff = date.today() - timedelta(days=7)
    return (
        db.query(FreightRate)
        .filter(FreightRate.index_code == index_code, FreightRate.date < cutoff)
        .order_by(FreightRate.date.desc())
        .first()
    )


def _history_rows(db: Session, index_code: str, days: int = 84) -> list[FreightRate]:
    cutoff = date.today() - timedelta(days=days)
    return (
        db.query(FreightRate)
        .filter(FreightRate.index_code == index_code, FreightRate.date >= cutoff)
        .order_by(FreightRate.date.asc())
        .all()
    )


@router.get("")
def get_freight(db: Session = Depends(get_db)):
    # Fetch latest + prev for each unique index
    indices = {cfg[3] for cfg in ROUTE_CONFIG}
    latest = {idx: _latest_rate(db, idx) for idx in indices}
    prev   = {idx: _prev_rate(db, idx)   for idx in indices}

    # No data yet
    if all(v is None for v in latest.values()):
        return {"updated": date.today().isoformat(), "routes": [], "history": []}

    routes = []
    for route_id, from_, to, index, mult, is_proxy in ROUTE_CONFIG:
        latest_row = latest.get(index)
        prev_row   = prev.get(index)
        if latest_row is None:
            continue
        rate = round(latest_row.rate * mult)
        prev_rate = round(prev_row.rate * mult) if prev_row else rate
        routes.append({
            "id":    route_id,
            "from":  from_,
            "to":    to,
            "rate":  rate,
            "prev":  prev_rate,
            "unit":  "USD/FEU",
            "proxy": is_proxy,
        })

    # Build merged time-series history for the 4 chart routes
    # Each FBX index only needs to be fetched once even if used by multiple routes
    fbx11_rows = _history_rows(db, "FBX11")
    fbx01_rows = _history_rows(db, "FBX01")

    history_by_date: dict[str, dict] = {}
    for row in fbx11_rows:
        d = row.date.isoformat()
        if d not in history_by_date:
            history_by_date[d] = {"date": d}
        history_by_date[d]["vn-eu"] = round(row.rate * 1.00)
        history_by_date[d]["br-eu"] = round(row.rate * 0.58)
        history_by_date[d]["et-eu"] = round(row.rate * 0.70)
    for row in fbx01_rows:
        d = row.date.isoformat()
        if d not in history_by_date:
            history_by_date[d] = {"date": d}
        history_by_date[d]["vn-us"] = round(row.rate * 1.00)

    history = sorted(history_by_date.values(), key=lambda x: x["date"])

    updated = max(
        (r.date for r in latest.values() if r is not None),
        default=date.today()
    ).isoformat()

    return {"updated": updated, "routes": routes, "history": history}
```

- [ ] **Step 4: Run tests — expect tests to pass**

```bash
cd backend && python -m pytest tests/test_freight_route.py -v
```
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/routes/freight.py backend/tests/test_freight_route.py
git commit -m "feat: add GET /api/freight endpoint with multiplier + history logic"
```

---

### Task 6: Register router in backend/main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add freight router import and include**

In `backend/main.py`, add after line 7 (`from routes.map import router as map_router`):
```python
from routes.freight import router as freight_router
```

Add after line 19 (`app.include_router(map_router)`):
```python
app.include_router(freight_router)
```

- [ ] **Step 2: Verify the endpoint is reachable**

```bash
cd backend && uvicorn main:app --reload
# In another terminal:
curl http://localhost:8000/api/freight
```
Expected: JSON with `{"updated": "...", "routes": [...], "history": [...]}` (routes may be empty if DB is empty, which is fine)

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: register /api/freight router"
```

---

### Task 7: Update frontend freight page

**Files:**
- Modify: `frontend/app/freight/page.tsx`

- [ ] **Step 1: Replace `frontend/app/freight/page.tsx` entirely**

```tsx
"use client";
import React, { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

type FreightRoute = {
  id: string;
  from: string;
  to: string;
  rate: number;
  prev: number;
  unit: string;
  proxy: boolean;
};

type FreightData = {
  updated: string;
  routes: FreightRoute[];
  history: Record<string, number | string>[];
};

const CHART_LINES = [
  { key: "vn-eu", label: "VN → EU", color: "#38bdf8" },
  { key: "br-eu", label: "BR → EU", color: "#4ade80" },
  { key: "vn-us", label: "VN → US", color: "#fb923c" },
  { key: "et-eu", label: "ET → EU", color: "#c084fc" },
];

export default function FreightPage() {
  const [data, setData] = useState<FreightData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/freight")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      <h1 className="text-lg font-bold text-white">Freight</h1>

      {/* Chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">
          Freight Rate Evolution — USD / FEU
        </div>
        {data?.updated && (
          <div className="text-[10px] text-slate-600 mb-3">
            Last updated: {data.updated}
          </div>
        )}

        {loading && (
          <div className="h-[260px] flex items-center justify-center text-slate-500 text-xs">
            Loading…
          </div>
        )}

        {!loading && (!data || data.history.length === 0) && (
          <div className="h-[260px] flex items-center justify-center text-slate-500 text-xs">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {!loading && data && data.history.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={(v: string) => v.slice(5)} /* Show MM-DD */
              />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={50}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(v: number) => [`$${v.toLocaleString("en-US")}`, ""]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "#94a3b8" }}
                formatter={(value) => CHART_LINES.find((l) => l.key === value)?.label ?? value}
              />
              {CHART_LINES.map((l) => (
                <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Route table */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
          <span className="text-xs font-semibold text-slate-300">Current Spot Rates — Coffee Corridors</span>
          <span className="text-[10px] text-slate-500 ml-3">40ft container · FBX index</span>
        </div>

        {loading && (
          <div className="px-4 py-6 text-xs text-slate-500">Loading…</div>
        )}

        {!loading && (!data || data.routes.length === 0) && (
          <div className="px-4 py-6 text-xs text-slate-500">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {!loading && data && data.routes.length > 0 && (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-slate-500 bg-slate-800/40">
                <th className="text-left px-4 py-2">Origin</th>
                <th className="text-left px-4 py-2">Destination</th>
                <th className="text-right px-4 py-2">Rate</th>
                <th className="text-right px-4 py-2">Prev</th>
                <th className="text-right px-4 py-2">Chg</th>
                <th className="text-right px-4 py-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.map((r) => {
                const chg = r.rate - r.prev;
                const chgColor = chg <= 0 ? "text-emerald-400" : "text-red-400";
                return (
                  <tr key={r.id} className="border-t border-slate-800 text-slate-300">
                    <td className="px-4 py-2">{r.from}</td>
                    <td className="px-4 py-2">
                      {r.to}
                      {r.proxy && (
                        <span className="ml-1 text-[9px] text-slate-500 font-sans">~est.</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-sky-300">
                      ${r.rate.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      ${r.prev.toLocaleString("en-US")}
                    </td>
                    <td className={`px-4 py-2 text-right font-bold ${chgColor}`}>
                      {chg >= 0 ? "+" : ""}{chg.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{r.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and verify page renders without errors**

```bash
cd frontend && npm run dev
```
Open `http://localhost:3000/freight` in browser. Expected:
- If DB has data: chart and table render with live rates; proxy routes show `~est.` next to destination
- If DB is empty: both panels show "Freight data not yet available…" message (no crash, no hydration error)

- [ ] **Step 3: Run the scraper and verify end-to-end**

```bash
docker compose build scraper && docker compose up --force-recreate scraper
```
After scraper completes, reload `http://localhost:3000/freight`. Expected: chart and table populated with FBX data.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/freight/page.tsx
git commit -m "feat: wire freight page to live /api/freight endpoint"
```

---

## Final Checklist

- [ ] `freight_rates` table created automatically on backend startup
- [ ] `GET /api/freight` returns 7 routes with correct multipliers
- [ ] Proxy routes show `~est.` badge in UI
- [ ] Chart renders with real dates on X-axis
- [ ] Empty-DB state shows informative message (no crash)
- [ ] All 5 backend tests pass
- [ ] Docker scraper rebuilt with `docker compose build scraper`
