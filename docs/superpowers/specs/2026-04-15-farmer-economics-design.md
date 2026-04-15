# Farmer Economics Tab — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Scope:** Brazil only (initial build). Other origins show "coming soon."

---

## 1. Overview

A "Farmer Economics" sub-tab is added to each country panel in the Supply tab. It sits alongside the existing "Exports" sub-tab and is rendered lazily (no data fetched until the user clicks in). The goal is to give coffee traders and analysts a single-screen view of farm-level fundamentals and near-term risk signals for each producing country.

---

## 2. Navigation Structure

Each country tab gains a two-pill sub-tab bar:

```
[ Exports ]  [ Farmer Economics ]
```

- **Exports** — existing content, unchanged
- **Farmer Economics** — new content described in this spec
- Sub-tab state is local to each country tab (no cross-country persistence needed)
- Lazy render: the `FarmerEconomics` component only mounts when its tab is active

For Vietnam, Colombia, Ethiopia, and Honduras, the "Farmer Economics" tab renders the same "coming soon" placeholder used by their Exports tab.

---

## 3. Page Layout

Inside the Farmer Economics tab, content is split into two columns:

| Left — Fundamentals (55%) | Right — Risk Signals (45%) |
|---|---|
| Production Cost | Weather Risk |
| Acreage | ENSO |
| Yield | Fertilizer Prices |

Columns stack vertically on mobile / narrow viewports.

---

## 4. Left Column — Fundamentals

### 4.1 Production Cost Panel

**Header KPI**
- Label: `Production Cost — Brazil 2025/26`
- Value: `$142 / 60kg bag`
- Sub-label: YoY change (e.g. `▲ 2.1% YoY`)

**Cost breakdown — stacked horizontal bar**
Five segments, left to right:

| Component | Share | Mock $ | Color |
|---|---|---|---|
| Inputs | 38% | $54 | `#3b82f6` (blue) |
| Labor | 27% | $38 | `#22c55e` (green) |
| Mechanization | 18% | $26 | `#f59e0b` (amber) |
| Land rent | 12% | $17 | `#8b5cf6` (purple) |
| Admin | 5% | $7 | `#475569` (slate) |

Below the bar: color-coded legend showing each component name, $ amount, and %.

**Inputs sub-breakdown panel** (always visible, below legend)
Panel style: `bg-slate-800` with blue left border. Title: `🌱 Inputs detail — $54/bag total`.

Five rows, each with: label, proportional mini-bar, %, $/bag:

| Sub-component | Share of Inputs | $ / bag |
|---|---|---|
| Nitrogen (urea / AN) | 35% | $19 |
| Potassium (KCl) | 25% | $14 |
| Phosphorus (MAP) | 20% | $11 |
| Pesticides / fungicides | 15% | $8 |
| Lime / soil correction | 5% | $3 |

**Margin line** (below panel)
`KC spot $302/bag → farmer margin ~$160/bag`

---

### 4.2 Acreage Panel

- KPI: total harvested area — `2,240 thousand ha` — with YoY change
- Source label: CONAB 2025/26
- No chart in initial build (single annual figure)

---

### 4.3 Yield Panel

- KPI: yield — `32 bags / ha` — with YoY change
- Source label: CONAB 2025/26
- No chart in initial build (single annual figure)

---

## 5. Right Column — Risk Signals

### 5.1 Weather Risk Panel

**Current risk badges — top row**
Four regions: Sul de Minas, Cerrado, Paraná, Espírito Santo.
Each region card shows two badges independently:
- ❄ Frost: HIGH / MED / LOW / NONE
- ☀ Drought: HIGH / MED / LOW / NONE

Badge colors: HIGH = red, MED = amber, LOW = green, NONE = slate outline.

**14-day daily risk grid**
- Rows: frost-relevant regions (Sul de Minas, Paraná) for the frost grid; drought-relevant regions (Cerrado, Sul de Minas) for the drought grid
- Columns: next 14 calendar days, labeled by date (e.g. `15`, `16`, … `28`)
- Each cell: colored by risk level
  - Frost cells: dark navy (`#1e293b`) → mid blue (`#2563eb`) → bright blue (`#1e3a8a`) = None → Med → High
  - Drought cells: equivalent amber scale
  - Cell label: `–` / `L` / `M` / `H`

**Forecast accuracy panel**
- Title: `Forecast accuracy — min temp °C, [Region] (last 7 days)`
- Dual-line chart:
  - Dashed line = 7-day forecast minimum temperature
  - Solid line = actual minimum temperature recorded
  - Shaded polygon between lines = error zone
- Below chart: RMSE score (e.g. `RMSE 1.1°C over 7 days`) and source (`INMET / CPTEC`)

Data source for initial build: mock static values. Real integration (INMET API or CPTEC GEFS) is out of scope for this spec.

---

### 5.2 ENSO Panel

**Phase badge**
Full-width badge showing current phase with style:
- El Niño → purple border/text, `🌡 El Niño — [Intensity] · ONI [value]`
- La Niña → blue border/text, `🌊 La Niña — [Intensity] · ONI [value]`
- Neutral → slate border/text, `⚖ Neutral · ONI [value]`

Sub-label: peak month, trend direction, and 3-month forecast (e.g. `Peak: Nov 2025 · Weakening · Forecast: Neutral by Jun 2026`).

**ONI bar chart**
- 18 months of historical ONI values as vertical bars (positive = El Niño color, negative = La Niña color)
- Last 3 months: dashed outline bars = NOAA forecast
- Axis note: `Threshold ±0.5`
- Month labels on x-axis

**Regional impact row**
Four regions (Sul de Minas, Cerrado, Paraná, Espírito Santo), each showing:
- Impact type tag: DRY / WET / COLD / WARM (color-coded: amber=dry, blue=cold, cyan=wet, orange=warm)
- Dot-scale intensity: 4 dots, filled count derived from ONI magnitude:
  - ONI 0.5–1.0 → 1 dot (mild)
  - ONI 1.0–1.5 → 2 dots (moderate)
  - ONI 1.5–2.0 → 3 dots (strong)
  - ONI > 2.0   → 4 dots (extreme)
- Short consequence text (e.g. `rainfall −18%`, `frost window +12 days`)

Historical stat line: `El Niño years avg. Brazil arabica output −4.2% vs neutral`

Data source for initial build: mock static values. Real integration (NOAA CPC ONI dataset) is out of scope for this spec.

---

### 5.3 Fertilizer Prices Panel

Three KPI cards in a row: **Urea (N)**, **MAP (P)**, **KCl (K)**.

Each card contains:
- Fertilizer name and type
- Current price: `$XXX / mt · CFR Brazil`
- 6-month sparkline (Recharts `LineChart` or `AreaChart`, minimal axes)
- MoM % change with directional color (red = up, green = down — rising costs are bad for farmers)
- Estimated cost-per-bag impact badge, derived from input weights:
  - Urea: 35% of $54 inputs = $18.90 base → delta = price change × weight
  - MAP: 20% of $54 = $10.80 base
  - KCl: 25% of $54 = $13.50 base

Net impact summary line below cards:
`Net input cost impact: +$X.X/bag vs last month · Next application window: May–Jun`

Data source for initial build: mock static values (6 months of price history per fertilizer). Real integration (World Bank Pink Sheet, Yara, or similar) is out of scope for this spec.

---

## 6. Data & State

### 6.1 Mock data structure (initial build)

All data is hardcoded in a single static object in the component file. Shape:

```ts
type FarmerEconomicsData = {
  country: string;           // "brazil"
  season: string;            // "2025/26"
  cost: {
    total_usd_per_bag: number;
    yoy_pct: number;
    components: { label: string; share: number; usd: number; color: string }[];
    inputs_detail: { label: string; share: number; usd: number }[];
    kc_spot: number;
  };
  acreage: { thousand_ha: number; yoy_pct: number };
  yield:   { bags_per_ha: number; yoy_pct: number };
  weather: {
    regions: {
      name: string;
      frost: "HIGH" | "MED" | "LOW" | "NONE";
      drought: "HIGH" | "MED" | "LOW" | "NONE";
    }[];
    daily_frost: { region: string; days: ("H" | "M" | "L" | "-")[] }[];
    daily_drought: { region: string; days: ("H" | "M" | "L" | "-")[] }[];
    forecast_accuracy: { date: string; forecast_c: number; actual_c: number }[];
  };
  enso: {
    phase: "el-nino" | "la-nina" | "neutral";
    intensity: string;        // "Moderate"
    oni: number;              // 1.4
    peak_month: string;       // "Nov 2025"
    forecast_direction: string; // "Neutral by Jun 2026"
    oni_history: { month: string; value: number; forecast?: boolean }[];
    regional_impact: {
      region: string;
      type: "DRY" | "WET" | "COLD" | "WARM";
      dots: number;           // 1–4
      note: string;
    }[];
    historical_stat: string;
  };
  fertilizer: {
    items: {
      name: string;           // "Urea (N)"
      price_usd_mt: number;
      mom_pct: number;
      sparkline: number[];    // 6 monthly prices
      input_weight: number;   // 0.35
      base_usd_per_bag: number;
    }[];
    next_application: string; // "May–Jun"
  };
};
```

### 6.2 No API calls in initial build

All values are inlined as a constant in the component. The data shape above is designed so a future API endpoint can replace the constant with a fetch without changing the component rendering logic.

---

## 7. Component Structure

```
frontend/app/supply/
  page.tsx                          ← add sub-tab bar to BrazilTab rendering
  components/
    BrazilTab.tsx                   ← add sub-tab state + lazy render
    farmer-economics/
      BrazilFarmerEconomics.tsx     ← top-level layout (left/right split)
      ProductionCostPanel.tsx       ← stacked bar + inputs detail
      AcreageYieldPanel.tsx         ← two KPI cards
      WeatherRiskPanel.tsx          ← badges + daily grid + forecast accuracy
      EnsoPanel.tsx                 ← badge + ONI chart + impact row
      FertilizerPanel.tsx           ← three KPI cards with sparklines
      farmerEconomicsData.ts        ← mock data constant
```

Each panel is a self-contained component that receives only its slice of data as props. No shared state between panels.

---

## 8. Styling Conventions

- Background: `bg-slate-900` (existing app standard)
- Panel cards: `bg-slate-800` / `bg-slate-700` for nested sections
- Charts: Recharts — match existing chart style in the app (`stroke="#94a3b8"`, minimal axes)
- Text scale: existing Tailwind typography classes (`text-xs`, `text-sm`, `font-bold`)
- No new dependencies required

---

## 9. Out of Scope

- Real weather data integration (INMET / CPTEC)
- Real ENSO data integration (NOAA CPC)
- Real fertilizer price integration (World Bank / Yara)
- Vietnam, Colombia, Ethiopia, Honduras content
- User-adjustable date ranges or filters
- Historical year-over-year comparison charts for cost/acreage/yield
