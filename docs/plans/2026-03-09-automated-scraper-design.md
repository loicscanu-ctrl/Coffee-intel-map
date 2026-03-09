# Automated Daily Scraper — Design Document

**Date:** 2026-03-09
**Status:** Approved

---

## Overview

Add a daily automated scraper that fetches coffee market data from ~15 sources across futures, supply-side origins, destination stocks, technicals, and logistics. All data is stored as `NewsItem` records in the existing SQLite database.

---

## Architecture

```
Docker Compose
├── frontend   (Next.js, port 3000)
├── backend    (FastAPI, port 8000)  ← shared SQLite volume
└── scraper    (Python + Playwright) ← same SQLite volume, runs daily at 06:00 UTC
```

The scraper is a standalone Python service that:
- Shares the SQLite DB file via a Docker volume mount with the backend
- Runs once on container startup, then loops every 24 hours
- Uses the existing `NewsItem` SQLAlchemy model directly
- Deduplicates by title (same as seed logic)

---

## Data Sources

| Source | URL | What we scrape | Category | Tags |
|--------|-----|----------------|----------|------|
| Barchart ICE NY Arabica | barchart.com | Daily settlement price | `general` | `["futures", "arabica", "price"]` |
| Barchart ICE London Robusta | barchart.com | Daily settlement price | `general` | `["futures", "robusta", "price"]` |
| Barchart USD/BRL | barchart.com | FX rate | `general` | `["fx", "brazil"]` |
| Barchart USD/VND | barchart.com | FX rate | `general` | `["fx", "vietnam"]` |
| Barchart USD/IDR | barchart.com | FX rate | `general` | `["fx", "indonesia"]` |
| Barchart USD/HNL | barchart.com | FX rate | `general` | `["fx", "honduras"]` |
| B3 Brazil | b3.com.br | Arabica/Conilon futures | `general` | `["futures", "brazil"]` |
| Cooabriel | cooabriel.coop.br | Conilon physical price (BRL) | `supply` | `["price", "brazil", "conilon"]` |
| Noticiasagricolas | noticiasagricolas.com.br | Arabica price + headlines | `supply` | `["price", "brazil", "arabica"]` |
| Cecafe | cecafe.com.br | Export volumes | `supply` | `["exports", "brazil"]` |
| Giacaphe | giacaphe.com | Vietnam local VND price | `supply` | `["price", "vietnam"]` |
| Tintaynguyen | tintaynguyen.com | Vietnam regional intel | `supply` | `["news", "vietnam"]` |
| Vicofa | vicofa.org.vn | Vietnam association news | `supply` | `["news", "vietnam"]` |
| Alfabean | alfabean.com | Indonesia local IDR price | `supply` | `["price", "indonesia"]` |
| AEKI | aeki-aice.org | Indonesia association news | `supply` | `["news", "indonesia"]` |
| BPS Indonesia | bps.go.id | Indonesia official stats | `supply` | `["stats", "indonesia"]` |
| IHCafe Honduras | ihcafe.hn | Daily price HNL/Quintal | `supply` | `["price", "honduras"]` |
| Uganda Coffee | ugandacoffee.go.ug | Export data | `supply` | `["exports", "uganda"]` |
| Federación de Cafeteros | federaciondecafeteros.org | Colombia stats | `supply` | `["stats", "colombia"]` |
| ECF | ecf-coffee.org | EU port stocks | `demand` | `["stocks", "eu"]` |
| AJCA Japan | coffee.ajca.or.jp | Japan stocks | `demand` | `["stocks", "japan"]` |
| BLS CPI | bls.gov | US CPI demand indicator | `demand` | `["cpi", "usa"]` |
| CFTC CoT | cftc.gov | Speculative positioning | `general` | `["technicals", "cot"]` |
| World Bank | worldbank.org | Fertilizer index | `supply` | `["inputs", "fertilizer"]` |
| Searates / FBX | searates.com | Freight rates | `general` | `["logistics", "freight"]` |

---

## NewsItem Field Mapping

- **title:** `"{Source} – {date}"` or extracted headline (includes date for daily dedup)
- **body:** Formatted price/stat string or translated article excerpt
- **source:** Source name (e.g. `"Barchart"`, `"IHCafe"`)
- **category:** `"supply"` / `"demand"` / `"general"`
- **lat/lng:** Static country coordinate lookup table
- **tags:** Per source (see table above)
- **pub_date:** Today's date at scrape time

---

## Translation

- Library: `deep-translator` (Google backend, no API key required)
- Applied to: PT (Brazil), VI (Vietnam), ID (Indonesia), ES (Honduras, Colombia)
- Strategy: Translate title and body to English before storing
- Fallback: If translation fails, store original text (record is not skipped)

---

## Error Handling

- Each source is scraped independently in a try/except block
- Failures are logged with source name + error message
- No retries — daily cadence makes same-day retry unnecessary
- Container continues to next source on failure

---

## Scraping Technology

- **Playwright** (Python) — handles JavaScript-rendered pages
- Installed via `playwright install chromium` in the scraper Dockerfile
- All sources use Playwright for consistency (no hybrid complexity)

---

## Deduplication

- Skip insert if `NewsItem` with same `title` already exists
- Titles include the date suffix, so each day produces new records
- Old records are never deleted (history is preserved)

---

## Schedule

- Runs once on container startup (catches up if container was down)
- Then sleeps 24 hours and repeats
- Target window: ~06:00 UTC (after Asian markets open, before EU open)

---

## File Structure

```
backend/
  scraper/
    __init__.py
    main.py          # entrypoint: loop + orchestrator
    sources/
      __init__.py
      barchart.py    # ICE futures + FX
      b3.py          # B3 Brazil futures
      brazil.py      # Cooabriel, Noticiasagricolas, Cecafe
      vietnam.py     # Giacaphe, Tintaynguyen, Vicofa
      indonesia.py   # Alfabean, AEKI, BPS
      honduras.py    # IHCafe
      uganda.py      # Uganda Coffee Board
      colombia.py    # Federación de Cafeteros
      demand.py      # ECF, AJCA, BLS CPI
      technicals.py  # CFTC CoT, World Bank, Searates
    translate.py     # deep-translator wrapper
    db.py            # SQLAlchemy session + upsert helper
  Dockerfile.scraper
```

Docker Compose adds:
```yaml
scraper:
  build:
    context: ./backend
    dockerfile: Dockerfile.scraper
  volumes:
    - db_data:/app/data
  depends_on:
    - backend
```
