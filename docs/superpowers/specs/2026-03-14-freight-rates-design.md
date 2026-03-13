# Freight Rate Live Data — Design Spec
**Date:** 2026-03-14
**Status:** Approved

## Overview

Replace the hardcoded dummy freight rates in `frontend/app/freight/page.tsx` with live data scraped daily from the Freightos Baltic Index (FBX). The freight page displays a current spot rate table and a 12-week evolution chart for 7 coffee trade corridors.

## Data Source

**Freightos Baltic Index (FBX)** via Playwright XHR interception on the public Freightos Terminal pages.

- The FBX API is enterprise/paid-only; the Terminal web pages render chart data via an internal JSON API call that can be intercepted with Playwright.
- 3 FBX indices are fetched (FBX01, FBX03, FBX11), then mapped to 7 coffee routes via multipliers.
- Update frequency: daily (run by the existing scraper cron).

## Route → FBX Mapping

| Route ID | From | To | FBX Index | Type | Multiplier |
|---|---|---|---|---|---|
| vn-eu | Ho Chi Minh | Rotterdam | FBX11 | direct | ×1.00 |
| vn-ham | Ho Chi Minh | Hamburg | FBX11 | direct | ×1.02 |
| vn-us | Ho Chi Minh | Los Angeles | FBX01 | direct | ×1.00 |
| br-eu | Santos | Rotterdam | FBX11 | proxy | ×0.58 |
| co-eu | Cartagena | Rotterdam | FBX11 | proxy | ×0.55 |
| et-eu | Djibouti | Rotterdam | FBX11 | proxy | ×0.70 |
| br-us | Santos | New York | FBX03 | proxy | ×0.45 |

**Proxy rationale:** No public FBX index exists for South America→Europe or Africa→Europe in the export (headhaul) direction. FBX11 (East Asia→North Europe) moves directionally with the global container market and serves as a calibrated proxy. Proxy routes are clearly labelled `~est.` in the UI.

**Unit:** USD/FEU (40ft container). FBX measures FEU. The existing page labels (`USD/TEU`, "20ft container") will be updated to `USD/FEU` and "40ft container" to match the actual data source.

## Architecture & Data Flow

```
Playwright scraper (freightos.py)
  └─ loads 3 Freightos Terminal pages (FBX01, FBX03, FBX11)
  └─ intercepts XHR → captures JSON chart history
  └─ upserts into freight_rates table (index_code, date, rate)
        ↓
FastAPI  GET /api/freight
  └─ reads last 84 days (12 weeks) per FBX index from DB
  └─ computes 7 derived routes with multipliers
  └─ returns { routes: [...], updated: "date" }
        ↓
frontend/app/freight/page.tsx
  └─ fetch on mount
  └─ renders rate table + 12-week chart (existing layout, live data)
```

## Database

**New model added to `backend/models.py`:**

```python
class FreightRate(Base):
    __tablename__ = "freight_rates"
    id         = Column(Integer, primary_key=True)
    index_code = Column(String, nullable=False)   # e.g. "FBX11"
    date       = Column(Date, nullable=False)
    rate       = Column(Float, nullable=False)    # USD/FEU
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("index_code", "date"),)
```

No Alembic — the project uses `Base.metadata.create_all(bind=engine)` at startup. Adding `FreightRate` to `backend/models.py` is sufficient; the table will be created automatically on next app start.

## Backend Components

### `backend/scraper/sources/freightos.py` (new)

Playwright scraper following the same pattern as `barchart.py`.

For each FBX index page (FBX01, FBX03, FBX11):
1. Load the Freightos Terminal page (e.g. `https://terminal.freightos.com/fbx-11-china-to-northern-europe/`)
2. Intercept XHR requests — the chart data arrives as a JSON response from an internal API endpoint (expected pattern: a fetch/XHR to a path containing `fbx` or `series` with a JSON body containing date/rate pairs)
3. Parse the full history array from the JSON payload
4. Call `upsert_freight_rate()` for each data point

**Interception failure handling:** If no XHR matching the expected pattern is observed within 15 seconds, log a warning (`logger.warning("FBX{X}: no chart XHR intercepted, skipping")`) and continue. The scraper must not raise — a failed index leaves the previous DB data intact.

**First run:** The Freightos Terminal charts display ~1 year of history. The first scrape captures and stores the full available history. Subsequent runs upsert by `(index_code, date)` — idempotent.

### `backend/scraper/db.py` — add `upsert_freight_rate`

```python
def upsert_freight_rate(index_code: str, date: date, rate: float):
    from models import FreightRate  # matches existing import pattern in scraper/db.py
    db = get_session()
    try:
        existing = db.query(FreightRate).filter_by(index_code=index_code, date=date).first()
        if existing:
            existing.rate = rate
        else:
            db.add(FreightRate(index_code=index_code, date=date, rate=rate))
        db.commit()
    finally:
        db.close()
```

**DB session acquisition in `freightos.py`:** `freightos.py` calls `upsert_freight_rate()` directly (no `db` parameter on `run()`). `upsert_freight_rate` opens and closes its own session via `get_session()` — the same pattern used by `scraper/db.py`. The `run(page)` signature stays consistent with all other scraper sources; `scraper/main.py` does not need to be modified.

### `backend/routes/freight.py` (new)

`GET /api/freight` endpoint.

- Reads last 84 days per index from `freight_rates` table
- Applies multipliers to produce 7 route objects
- Computes `prev` as the most recent rate older than 7 days (not strictly 7 days prior — handles weekends, holidays, and scraper gaps gracefully)
- If `prev` is not available (no data older than 7 days), sets `prev = rate` and `chg = 0`
- Registered in `backend/main.py` alongside existing routers

**Response shape:**

```json
{
  "updated": "2026-03-14",
  "routes": [
    {
      "id": "vn-eu",
      "from": "Ho Chi Minh",
      "to": "Rotterdam",
      "rate": 2850,
      "prev": 2780,
      "unit": "USD/FEU",
      "proxy": false
    }
  ],
  "history": [
    { "date": "2025-12-20", "vn-eu": 3100, "br-eu": 1798, "vn-us": 3400, "et-eu": 2170 }
  ]
}
```

The `history` array is a **merged time series** (one object per date, all routes as keys) so it can be passed directly to the existing Recharts `LineChart` with `dataKey` per route. Route IDs are used as keys. Missing values for a date are omitted (Recharts handles gaps). Only the 4 routes currently shown in the chart are included in `history` (vn-eu, br-eu, vn-us, et-eu) matching the existing `CHART_LINES`.

## Frontend Changes

**`frontend/app/freight/page.tsx`**

- Remove `FREIGHT_ROUTES`, `FREIGHT_HISTORY`, `CHART_LINES` static constants
- Add `useEffect` fetch to `/api/freight` with loading state (spinner/skeleton)
- **Empty/error state:** If the API returns no routes (first deploy, scraper not yet run), display: "Freight data not yet available — check back after the next scraper run." No crash, no empty table.
- Rate table:
  - Add `~est.` badge on proxy routes (`proxy: true`)
  - Change unit label from `USD/TEU` to `USD/FEU`
  - Change "20ft container" to "40ft container"
- Chart: use `history` array from API response with real dates on X-axis; `CHART_LINES` keys change from `"VN→EU"` to route IDs `"vn-eu"` etc.
- Add "Last updated: {updated}" label below chart header

No layout changes — same two-panel structure (chart on top, table below).

**`chg` computation:** The `chg` value (rate minus prev) is computed on the frontend (`const chg = r.rate - r.prev`) — the API does not need to return it. This matches the existing pattern in `freight/page.tsx`.

## Deployment Note

The scraper runs inside Docker with no volume mount (`COPY scraper/ ./scraper/` bakes sources at build time). After adding `freightos.py`, a full image rebuild is required:
```
docker compose build scraper && docker compose up --force-recreate scraper
```
Without this, the cron will silently continue running the old image without the new scraper.

## Files Changed

| File | Change |
|---|---|
| `backend/scraper/sources/freightos.py` | New |
| `backend/scraper/main.py` | Add `freightos` to imports and `ALL_SOURCES` |
| `backend/scraper/db.py` | Add `upsert_freight_rate()` helper |
| `backend/models.py` | Add `FreightRate` model class |
| `backend/routes/freight.py` | New endpoint |
| `backend/main.py` | Register `/api/freight` router |
| `frontend/app/freight/page.tsx` | Replace static data with live fetch |
