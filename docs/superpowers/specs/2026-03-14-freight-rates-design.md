# Freight Rate Live Data — Design Spec
**Date:** 2026-03-14
**Status:** Approved

## Overview

Replace the hardcoded dummy freight rates in `frontend/app/freight/page.tsx` with live data scraped daily from the Freightos Baltic Index (FBX). The freight page displays a current spot rate table and a 12-week evolution chart for 7 coffee trade corridors.

## Data Source

**Freightos Baltic Index (FBX)** via Playwright XHR interception on the public Freightos Terminal pages.

- The FBX API is enterprise/paid-only; the Terminal web pages render chart data via an internal JSON API call that can be intercepted with Playwright.
- 4 FBX indices are fetched, then mapped to 7 coffee routes via multipliers.
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

**Unit:** USD/FEU (40ft container). FBX measures FEU, not TEU.

## Architecture & Data Flow

```
Playwright scraper (freightos.py)
  └─ loads 4 Freightos Terminal pages (FBX01, FBX03, FBX11, FBX24)
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

**New table: `freight_rates`**

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| index_code | varchar | e.g. "FBX11" |
| date | date | |
| rate | float | USD/FEU |
| created_at | timestamp | |

Unique constraint on `(index_code, date)` — upsert on conflict.

Added via Alembic migration.

## Backend Components

### `backend/scraper/sources/freightos.py` (new)
- Playwright scraper following same pattern as `barchart.py`
- For each FBX page: load → intercept XHR chart data → parse JSON history
- First run captures full available history (~1 year on Freightos charts)
- Subsequent runs upsert by `(index_code, date)` — idempotent
- Added to `ALL_SOURCES` in `backend/scraper/main.py`

### `backend/api/routes/freight.py` (new)
- `GET /api/freight` endpoint
- Reads last 84 days per index from `freight_rates` table
- Applies multipliers to produce 7 route objects
- Computes `prev` as the rate from 7 days prior
- Returns:

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
      "proxy": false,
      "history": [
        { "date": "2025-12-20", "rate": 3100 }
      ]
    }
  ]
}
```

Registered in `backend/api/main.py`.

## Frontend Changes

**`frontend/app/freight/page.tsx`**

- Remove `FREIGHT_ROUTES`, `FREIGHT_HISTORY`, `CHART_LINES` static constants
- Add `useEffect` fetch to `/api/freight` with loading state
- Rate table: add `~est.` badge on proxy routes; change unit label to `USD/FEU`
- Chart: use `route.history` arrays with real dates on X-axis
- Add "Last updated: {date}" label below chart header
- No layout changes — same two-panel structure (chart + table)

## Files Changed

| File | Change |
|---|---|
| `backend/scraper/sources/freightos.py` | New |
| `backend/scraper/main.py` | Add `freightos` to imports and `ALL_SOURCES` |
| `backend/alembic/versions/XXXX_add_freight_rates.py` | New migration |
| `backend/models/freight_rate.py` | New SQLAlchemy model |
| `backend/api/routes/freight.py` | New endpoint |
| `backend/api/main.py` | Register `/api/freight` router |
| `frontend/app/freight/page.tsx` | Replace static data with live fetch |
