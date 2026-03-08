# Coffee Intel Dashboard — Design Document

**Date:** 2026-03-08
**Status:** Approved

---

## Overview

A web dashboard aggregating market data, supply/demand intelligence, macro signals, and news for a trader active in both physical coffee and coffee futures markets (one used operationally, one as a hedge).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                          │
│  Futures Exchange | Cert. Stocks & Spreads | Supply | Demand    │
│  Macro | News & Intel (World Map)                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API
┌───────────────────────────▼─────────────────────────────────────┐
│                        FastAPI Backend                           │
│   Scrapers / Fetchers  |  APScheduler (cron)  |  API Routes     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                      PostgreSQL Database                         │
│  futures_prices | cot_data | certified_stocks | spreads          │
│  physical_prices | supply_intel | demand_data | earnings         │
│  macro_data | news_feed                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dashboard Tabs

### 1. Futures Exchange
- KC front-month + next contract price chart (configurable timeframe)
- COT report: net positioning chart (commercials vs. non-commercials), updated weekly

### 2. Certified Stocks & Spreads
- Certified stocks bar chart (current vs. historical)
- Spread table: key calendar spreads (H/K, K/N, etc.) with trend indicators
- Spread economics calculated from futures price data

### 3. Supply
- Origin price cards: Brazil Arabica, Brazil Conilon, Vietnam (+ TBD stubs for Uganda, Colombia, Honduras)
- Basis calculator: physical price minus futures (auto-calculated per origin)
- Crop / harvest / selling pace: text feed cards by origin (USDA WASDE + scraped intel)

### 4. Demand
- Inventory charts: German coffee tax data, ECA stocks, JCA stocks
- Earnings tracker: table of latest results per company with up/down demand signal
  - Companies: Starbucks, JD, Keurig Dr Pepper, Restaurant Brands International

### 5. Macro
- FX cards with sparklines: BRL/USD, VND/USD, COP/USD
- Freight rate card (Freightos index) with trend indicator

### 6. News & Intel (World Map)
- Interactive world map (Leaflet.js + OpenStreetMap) as primary view
- Each news item geocoded and rendered as a color-coded pin:
  - Red: supply disruption / crop issue
  - Yellow: demand signal
  - Blue: macro (freight, FX)
  - Grey: general intel
- Clicking a pin opens a sidebar with headline, source, date, and tags
- Pin placement logic:
  - Arabica futures / certified stocks → New York (ICE)
  - Robusta futures / certified stocks → London (LIFFE)
  - Brazil supply → Brazil
  - Vietnam supply → Vietnam
  - Colombia / Uganda / Honduras → respective country
  - German tax / ECA demand → Germany / Europe
  - JCA demand → Japan
  - Macro (freight, FX) → relevant country or global
- Below the map: chronological news feed, filterable by tag

---

## Data Sources

| Tab | Data | Source | Status |
|-----|------|--------|--------|
| Futures Exchange | Price data | Barchart API or ICE scrape | Ready |
| Futures Exchange | COT report | CFTC public CSV | Ready |
| Certified Stocks & Spreads | Certified stocks | ICE exchange (daily) | Ready |
| Certified Stocks & Spreads | Spread economics | Calculated from futures data | Ready |
| Supply | Brazil Arabica prices | CPA website + B3 | Ready |
| Supply | Brazil Conilon prices | Coabriel (Type 7 bid) | Ready |
| Supply | Vietnam prices | TBD | Wire in later |
| Supply | Uganda prices | TBD | Wire in later |
| Supply | Colombia prices | TBD (FNC) | Wire in later |
| Supply | Honduras prices | TBD (IHCAFE) | Wire in later |
| Supply | Crop / harvest / selling pace | USDA WASDE + origin scrapes | Ready |
| Demand | German coffee tax | Deutscher Kaffeeverband | Ready |
| Demand | EU stock data | European Coffee Association | Ready |
| Demand | Japan stock data | Japanese Coffee Association | Ready |
| Demand | Earnings signals | Yahoo Finance / SEC filings | Ready |
| Macro | FX rates | Open Exchange Rates API (free) | Ready |
| Macro | Freight rates | Freightos or Baltic Exchange | Ready |
| News & Intel | Coffee news | Daily Coffee News, Reuters, specialist sites | Ready |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 14 (App Router) + Tailwind CSS |
| Charts | Recharts |
| Map | Leaflet.js + OpenStreetMap |
| Backend | FastAPI (Python) |
| Scheduler | APScheduler |
| Database | PostgreSQL |
| Scraping | httpx + BeautifulSoup |
| ORM | SQLAlchemy |

---

## Data Refresh Intervals

| Data | Frequency |
|------|-----------|
| Futures prices | Every 15 min (market hours) |
| COT report | Weekly (CFTC publishes Fridays) |
| Certified stocks | Daily |
| Physical origin prices | Daily |
| FX rates | Every 15 min |
| Freight rates | Daily |
| Demand data (German tax, ECA, JCA) | Weekly / Monthly (as published) |
| Earnings | Quarterly |
| News feed | Every 30 min |

---

## Out of Scope (for now)
- Uganda, Vietnam, Colombia, Honduras physical price scrapers (TBD sources)
- Alerts / notifications
- User authentication (single-user tool)
- Mobile layout
