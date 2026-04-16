# Farmer Economics — Live Data Integration Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Replace all mock data in the Brazil Farmer Economics sub-tab with live scraped data. Six data sources, two new scraper files, one new static JSON export.

---

## 1. Overview

The existing `BRAZIL_FARMER_DATA` constant in `farmerEconomicsData.ts` is replaced by a scraper pipeline that writes `frontend/public/data/farmer_economics.json` on schedule. The frontend reads that file at page load, same pattern as `futures_chain.json`. All six panels become live.

No new npm dependencies. No API keys required. The frontend component tree structure is unchanged (same 5 panels); only `BrazilFarmerEconomics.tsx` switches from a constant to a fetch, and `FertilizerPanel.tsx` gains one new imports sub-section within its existing card.

---

## 2. Architecture

```
GitHub Actions (scraper-daily.yml, 01:00 UTC)
  └─ python -m scraper.run_daily
        └─ farmer_economics.py   → weather (Open-Meteo), ENSO (NOAA), fertilizer prices (World Bank)

  └─ python -m scraper.export_static_json
        └─ export_farmer_economics(db)  → frontend/public/data/farmer_economics.json

GitHub Actions (scraper-monthly.yml, 5th of month 02:00 UTC)
  └─ python -m scraper.run_monthly
        ├─ conab_supply.py         → acreage/yield (CONAB Safra), production cost (CONAB Custos)
        └─ comex_fertilizer.py     → fertilizer imports (Comex Stat, Playwright)

  └─ python -m scraper.export_static_json
        └─ export_farmer_economics(db)  → frontend/public/data/farmer_economics.json

Frontend
  └─ BrazilFarmerEconomics.tsx
        └─ fetch("/data/farmer_economics.json") on mount
              └─ passes slices to each panel component (unchanged props interface)
```

---

## 3. Data Sources

### 3.1 Weather — Open-Meteo (daily)

**URL pattern:**
```
https://api.open-meteo.com/v1/forecast
  ?latitude={lat}&longitude={lon}
  &hourly=temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m,precipitation_probability
  &forecast_days=14
  &timezone=America/Sao_Paulo
```

**4 regions scraped:**

| Region | Latitude | Longitude |
|---|---|---|
| Sul de Minas | −21.76 | −45.25 |
| Cerrado | −18.50 | −47.50 |
| Paraná | −23.55 | −51.17 |
| Espírito Santo | −20.08 | −41.37 |

**Aggregation (hourly → daily):**
- `temperature_2m` → daily min and max (°C)
- `dew_point_2m` → daily mean (°C)
- `cloud_cover` → daily mean (%)
- `wind_speed_10m` → daily max (km/h)
- `precipitation_probability` → daily max (%)

**Risk derivation (per day, per region):**

Frost risk (based on daily min temperature):
- `H` → min_temp < 4°C
- `M` → min_temp < 8°C
- `L` → min_temp < 12°C
- `-` → min_temp ≥ 12°C

Drought risk (based on daily max precipitation probability):
- `H` → precip_prob < 15%
- `M` → precip_prob < 35%
- `L` → precip_prob < 60%
- `-` → precip_prob ≥ 60%

**Current conditions badge (today's values):**
- Frost badge: worst frost risk across next 7 days for each region
- Drought badge: worst drought risk across next 7 days for each region

**Forecast accuracy:** Removed from live version — replaced by "Current Conditions" section showing today's temperature, dew point, cloud cover, and wind speed for each region.

**No authentication. No API key. No rate limit for 4 calls/day.**

---

### 3.2 ENSO / ONI — NOAA CPC (monthly)

**URL:** `https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt`

Plain space-delimited text. Columns: `SEAS  YR  TOTAL  ANOM`

**Processing:**
- Parse all rows for current year + previous year = 18 months of history
- Last 3 rows flagged `forecast: true`
- Phase classification: El Niño if ANOM ≥ +0.5 for 5+ consecutive seasons, La Niña if ANOM ≤ −0.5, else Neutral
- Intensity: "Weak" |ANOM| 0.5–0.9, "Moderate" 1.0–1.4, "Strong" 1.5–1.9, "Extreme" ≥ 2.0
- `oniToDots()` utility already handles dot-scale derivation

**Regional impact:** remains static configuration in scraper (impact type per phase is climatologically fixed for Brazil regions; ONI magnitude drives dot count live).

---

### 3.3 Fertilizer Prices — World Bank Pink Sheet (monthly)

**URL:** `https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx`

**Rows extracted (sheet: "Monthly Prices", USD column):**
- `Urea, E. Europe (fob Bulk)` → Urea (N)
- `DAP (fob US Gulf)` → MAP proxy (P)
- `Potassium chloride (fob Vancouver)` → KCl (K)

**Processing:**
- Extract last 7 monthly values per row → sparkline (6 values) + current price
- Compute MoM % change: `(current - prev) / prev * 100`
- Compute per-bag cost delta using existing `fertCostDelta()` utility
- Compute net impact using `netFertImpact()` utility

**No authentication. Direct HTTPS download (~750 KB Excel file).**

---

### 3.4 Fertilizer Imports — Comex Stat (monthly, Playwright)

**Approach:** Playwright navigates `https://comexstat.mdic.gov.br/pt/geral`, submits a query for NCM Chapter 31 (last 12 months), and parses the rendered data table.

**NCM codes targeted:**
- `31021010` — Urea (nitrogen fertilizer)
- `31042010` — Potassium chloride (KCl)
- `31052000` — MAP (monoammonium phosphate)
- `31054000` — DAP (diammonium phosphate)

**Fields captured per row:**
- `month` (YYYY-MM)
- `ncm_code`
- `net_weight_kg`
- `fob_usd`

**Fallback:** If the Playwright scrape fails (site change, bot detection), the scraper logs the failure and retains the last successful data. The JSON export includes a `imports_last_updated` timestamp so the frontend can show data age.

**Stored in DB** as a separate table (`FertilizerImport`), not as a NewsItem.

**Runs in `scraper-monthly.yml`** (5th of each month, 02:00 UTC) to avoid rate-sensitivity during daily runs.

---

### 3.5 Acreage / Yield — CONAB Safra (monthly check)

**URL:** `https://www.conab.gov.br/info-agro/safras/cafe`

CONAB publishes 6 crop estimate bulletins per year. The page lists the latest bulletin as an HTML summary table with Brazil total harvested area (thousand ha) and yield (bags/ha).

**Scraping approach:** `requests` + BeautifulSoup, no Playwright needed. Parse the summary table for the Brazil total row. Extract: crop season label, harvested area (thousand ha), yield (bags/ha), YoY % change.

**Scrape frequency:** Monthly check (new bulletin appears every ~2 months; scraper is idempotent — re-scraping the same bulletin produces no DB change).

---

### 3.6 Production Cost — CONAB Custos de Produção (monthly check)

**URL:** `https://www.conab.gov.br/info-agro/custos-de-producao/cafe`

CONAB publishes production cost reports ~twice per crop year as Excel files. The page lists the latest file with a direct download link.

**Processing:**
- Download Excel, parse the "Sul de Minas" sheet (most representative for Arabica, CONAB's primary benchmark region)
- Extract 5 cost components: Insumos (Inputs), Mão de obra (Labor), Mecanização (Mechanization), Arrendamento (Land rent), Administração (Admin)
- Values in R$/bag → convert to USD using latest BRL/USD rate from `macro_cot.py` (already scraped)
- Compute % shares and absolute USD values

**Scrape frequency:** Monthly check. New data appears ~April and ~October each crop year.

---

## 4. New DB Tables

### `WeatherSnapshot`
| Column | Type | Description |
|---|---|---|
| id | int PK | |
| region | str | "Sul de Minas" etc. |
| scraped_at | datetime | UTC timestamp |
| daily_data | JSON | 14-day array: {date, min_temp, max_temp, dew_point, cloud_cover, wind_speed, precip_prob, frost_risk, drought_risk} |

### `FertilizerImport`
| Column | Type | Description |
|---|---|---|
| id | int PK | |
| month | date | First day of reference month |
| ncm_code | str | e.g. "31021010" |
| ncm_label | str | "Urea" etc. |
| net_weight_kg | bigint | |
| fob_usd | bigint | |
| scraped_at | datetime | |

Existing `NewsItem` table (with `meta` JSON) continues to be used for ENSO, fertilizer prices, acreage/yield, and production cost — consistent with current pattern.

---

## 5. New Scraper Files

### `backend/scraper/sources/farmer_economics.py`

Three `async` functions called from `run()`:
- `_scrape_weather(page)` → 4 Open-Meteo calls (plain `requests`, not Playwright), writes to `WeatherSnapshot`
- `_scrape_enso()` → NOAA CPC fetch (plain `requests`), upserts into `NewsItem`
- `_scrape_fertilizer_prices()` → World Bank Excel download + parse, upserts into `NewsItem`

### `backend/scraper/sources/conab_supply.py`

Two functions called from `run_monthly()` (not daily):
- `_scrape_acreage_yield(page)` → CONAB Safra HTML parse, upserts into `NewsItem`
- `_scrape_production_cost()` → CONAB Excel download + parse, upserts into `NewsItem`

### `backend/scraper/sources/comex_fertilizer.py`

- `run(page)` → Playwright scrape of Comex Stat UI, writes to `FertilizerImport`
- Called only from `scraper-monthly.yml`

---

## 6. Static JSON Export

New function `export_farmer_economics(db)` in `export_static_json.py`.

Output shape (`frontend/public/data/farmer_economics.json`):

```ts
{
  country: "brazil",
  season: "2025/26",
  scraped_at: "2026-04-16T01:12:00Z",
  cost: {
    total_usd_per_bag: number,
    yoy_pct: number,
    season_label: string,          // "2025/26 — CONAB Apr 2026"
    components: CostComponent[],
    inputs_detail: InputDetail[],
    kc_spot: number,               // from existing futures scraper
    last_updated: string,          // ISO date of CONAB report
  },
  acreage: { thousand_ha: number; yoy_pct: number; source_label: string },
  yield:   { bags_per_ha: number; yoy_pct: number; source_label: string },
  weather: {
    scraped_at: string,
    regions: WeatherRegion[],      // frost + drought badges (7-day worst)
    daily_frost: DailyRiskRow[],   // 14-day per frost region
    daily_drought: DailyRiskRow[], // 14-day per drought region
    current_conditions: {          // today's values per region
      region: string;
      temp_c: number;
      dew_point_c: number;
      cloud_cover_pct: number;
      wind_speed_kmh: number;
    }[],
  },
  enso: {
    phase: EnsoPhase,
    intensity: string,
    oni: number,
    peak_month: string,
    forecast_direction: string,
    oni_history: OniHistoryPoint[],
    regional_impact: RegionalImpact[],  // type fixed per phase; dots from ONI live
    historical_stat: string,            // static string, always same
    last_updated: string,
  },
  fertilizer: {
    items: FertilizerItem[],        // prices from World Bank
    imports: {                      // from Comex Stat
      last_updated: string,
      monthly: {
        month: string,
        urea_kt: number,
        kcl_kt: number,
        map_dap_kt: number,
        total_kt: number,
        total_fob_usd_m: number,    // millions USD
      }[],
    } | null,                       // null if Comex Stat scrape failed
    next_application: string,
  },
}
```

---

## 7. Frontend Changes

### `BrazilFarmerEconomics.tsx`

Replace the `BRAZIL_FARMER_DATA` constant import with a `useEffect` fetch:

```tsx
const [data, setData] = useState<FarmerEconomicsData | null>(null);
useEffect(() => {
  fetch("/data/farmer_economics.json")
    .then(r => r.json())
    .then(setData);
}, []);
if (!data) return <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>;
```

All panel props remain unchanged. No component tree modifications.

### `FertilizerPanel.tsx`

Add a new imports sub-section below the existing 3 KPI cards:
- 12-month bar chart of total fertilizer import volume (kt) using Recharts `BarChart`
- Source label + last updated date
- Hidden when `fertilizer.imports === null` (fallback to prices-only view)

### `WeatherRiskPanel.tsx`

Replace the `forecast_accuracy` dual-line chart with a **Current Conditions** row:
- 4 region cards showing: temp (°C), dew point (°C), cloud cover (%), wind speed (km/h)
- Displayed as compact stat chips, same card style as existing risk badges

The 14-day frost/drought grids remain unchanged.

---

## 8. GitHub Actions

### Modified: `scraper-daily.yml`

Add `farmer_economics.json` to the `git add` list in the "Commit updated static JSON" step.

### New: `scraper-monthly.yml`

```yaml
on:
  schedule:
    - cron: '0 2 5 * *'   # 02:00 UTC on the 5th of each month
  workflow_dispatch:
```

Steps: checkout → install → Playwright → run `conab_supply` + `comex_fertilizer` → export static JSON → commit.

---

## 9. `farmerEconomicsData.ts` — Type Changes

Add new fields to existing interfaces:

```ts
// WeatherRegion gains current conditions
export interface CurrentCondition {
  region: string;
  temp_c: number;
  dew_point_c: number;
  cloud_cover_pct: number;
  wind_speed_kmh: number;
}

// FertilizerImportMonth (new)
export interface FertilizerImportMonth {
  month: string;
  urea_kt: number;
  kcl_kt: number;
  map_dap_kt: number;
  total_kt: number;
  total_fob_usd_m: number;
}

// FarmerEconomicsData.fertilizer gains:
imports: {
  last_updated: string;
  monthly: FertilizerImportMonth[];
} | null;

// FarmerEconomicsData.weather gains:
current_conditions: CurrentCondition[];
```

`ForecastAccuracyPoint` interface is removed (no longer used).

---

## 10. Out of Scope

- ANDA "Entregas ao Mercado" (login required)
- CONAB Logistics Bulletins (PDF complexity, deferred)
- Argus / CRU (paid services)
- Vietnam, Colombia, Ethiopia, Honduras panels
- Real-time (sub-daily) weather refresh
- Historical weather data beyond 14-day forecast window
- BRL/USD rate scraping (already handled by `macro_cot.py`)
