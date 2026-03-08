# Full-Stack Migration Design

**Date:** 2026-03-08
**Status:** Approved
**Approach:** Monorepo scaffold, migrate map first, then tab-by-tab

---

## Context

The current codebase is a single `index.html` with vanilla JS, Leaflet map, and static JSON data files. This design covers the incremental migration to the full stack described in `docs/design-document.md`.

The existing logistics layer (ports, trade routes, factory pins, country pins) is preserved and becomes a permanent layer on tab 6 (News & Intel).

---

## Repository Structure

```
Coffee-intel-map/
├── frontend/                  # Next.js 14 (App Router) + Tailwind CSS
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx           # redirects to /map
│   │   └── (tabs)/
│   │       ├── map/           # Tab 6 — News & Intel (World Map)
│   │       ├── futures/       # Tab 1 — Futures Exchange
│   │       ├── stocks/        # Tab 2 — Certified Stocks & Spreads
│   │       ├── macro/         # Tab 5 — Macro
│   │       ├── supply/        # Tab 3 — Supply
│   │       └── demand/        # Tab 4 — Demand
│   └── components/
├── backend/                   # FastAPI + APScheduler + SQLAlchemy
│   ├── main.py
│   ├── routes/
│   ├── fetchers/
│   ├── models.py
│   └── scheduler.py
├── docs/
│   ├── design-document.md
│   └── plans/
├── docker-compose.yml         # PostgreSQL + backend + frontend
├── countries.json             # reference data (root, kept during migration)
├── factories.json
└── global.json
```

---

## Tab Build Order

| Phase | Tab | Rationale |
|-------|-----|-----------|
| 1 | News & Intel (World Map) | Migrate existing map — no new data feeds needed |
| 2 | Futures Exchange | Core trading view; CFTC CSV is free and simple |
| 3 | Certified Stocks & Spreads | Reuses futures data wired in phase 2 |
| 4 | Macro (FX + Freight) | Free API (Open Exchange Rates), fast to wire |
| 5 | Supply | Origin price cards + basis calculator |
| 6 | Demand | Earnings tracker + inventory charts |

---

## Backend Design

### API Routes

```
GET /api/news          # news feed + geocoded pins (color-coded by category)
GET /api/futures       # KC/RC prices + COT net positioning data
GET /api/stocks        # certified stocks + calendar spreads
GET /api/macro         # FX rates (BRL/USD, VND/USD, COP/USD) + freight
GET /api/supply        # origin prices + basis (physical minus futures)
GET /api/demand        # inventory data (German tax, ECA, JCA) + earnings
```

### Data Fetchers (by phase)

| Phase | Data | Source | Schedule |
|-------|------|--------|----------|
| 1 | News/intel | Migrated from global.json → later scraped | Manual / 30 min |
| 2 | Futures prices | Barchart API or ICE scrape | Every 15 min (market hours) |
| 2 | COT report | CFTC public CSV | Weekly (Friday) |
| 3 | Certified stocks | ICE daily (manual upload initially) | Daily |
| 4 | FX rates | Open Exchange Rates API (free tier) | Every 15 min |
| 4 | Freight rates | Freightos / Baltic Exchange | Daily |
| 5 | Origin prices (Brazil Arabica) | CPA website + B3 | Daily |
| 5 | Origin prices (Brazil Conilon) | Coabriel | Daily |
| 6 | Earnings signals | Yahoo Finance / SEC filings | Quarterly |
| 6 | Demand inventory | German tax, ECA, JCA | Weekly/Monthly |

### PostgreSQL Tables

Matches schema in `docs/design-document.md`:
`futures_prices`, `cot_data`, `certified_stocks`, `spreads`, `physical_prices`, `supply_intel`, `demand_data`, `earnings`, `macro_data`, `news_feed`

### Tech

- FastAPI (Python)
- SQLAlchemy ORM
- APScheduler (cron jobs inside FastAPI process)
- httpx + BeautifulSoup for scraping
- No authentication (single-user tool)

---

## Frontend Design

- Next.js 14 App Router
- Tailwind CSS (dark theme, consistent with current color palette)
- Tab navigation at top of page
- Recharts for all charts (price, COT, certified stocks, FX sparklines)
- Leaflet.js + OpenStreetMap for the map tab (migrated from current index.html)

### Map Tab (Phase 1) specifics

Preserve all existing layers:
- Logistics layer: ports, animated trade routes, factory pins
- Country pins: producer (green) / consumer (blue) / harvesting (pulsing)

Add new news-intel layer on top:
- Color-coded pins: Red (supply disruption), Yellow (demand signal), Blue (macro), Grey (general)
- Click pin → sidebar with headline, source, date, tags
- Below map: chronological news feed, filterable by tag

Scrolling ticker bar preserved at the top.

---

## Docker Compose

Three services:
1. `db` — PostgreSQL
2. `backend` — FastAPI on port 8000
3. `frontend` — Next.js on port 3000
