# Exports Tab — Improvements Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Scope:** Four additions to the existing Brazil Exports sub-tab. All data sourced from existing `cecafe.json` already in memory — no new fetches or dependencies.

---

## 1. Cumulative Crop-Year Pace Chart

**What:** A line chart where the x-axis is the crop month (Apr → Mar, 12 positions) and each line is one crop year's cumulative export volume. Shows at a glance whether the current crop is ahead or behind prior years.

**Lines:**
- Current crop year: `#ef4444` (red), 2.5px, solid — stops at the latest data month with a labeled dot showing `Xkt`
- Prior crop year: `#60a5fa` (blue), 1.5px, solid
- Two crops ago: `#475569` (slate), 1px, solid

**Y-axis:** cumulative kt (60kg bags converted), formatted `Xkt`
**X-axis:** crop month labels: `Apr May Jun Jul Aug Sep Oct Nov Dec Jan Feb Mar`

**Pace delta:** Below the chart, a single line: `25/26 pace vs 24/25: +X.X% at same crop-month`

**Respects type filter:** if a type (Arabica/Conillon/Soluble/Roasted) is selected via the existing `CountryHubFilter`, the chart uses that series key instead of `total`.

**Placement:** Immediately after `MonthlyVolumeChart`.

---

## 2. Coffee Type Share Evolution Chart

**What:** A 100%-stacked bar chart showing the annual mix of Arabica / Conillon / Soluble / Roasted across crop years. Each bar sums to 100%; each segment is the type's % of that year's total exports.

**Stacks (bottom to top):**
- Arabica: `#22c55e`
- Conillon: `#2dd4bf`
- Soluble: `#f59e0b`
- Roasted & Ground: `#60a5fa`

**Y-axis:** 0–100%, formatted `X%`
**X-axis:** crop year labels (`2019/20`, …, `2025/26`), angled −45°

**Year range filter:** same 2000/2010/2015 buttons as other annual charts.

**Excludes** incomplete crop years' partial data from share calculation — uses only complete crop years plus current crop year as-is (partial).

**Placement:** After `AnnualTrendChart`.

---

## 3. Monthly Seasonality Heatmap

**What:** A compact grid — rows = crop years (7 most recent), columns = crop months (Apr → Mar). Each cell is colored by its volume relative to that year's peak month. Makes seasonal patterns and year-over-year shifts instantly visible.

**Color scale (blue intensity):** volume / peak_month_volume for that year:
- 0–20%: `#0f172a` (near black)
- 20–40%: `#1e293b`
- 40–60%: `#1e3a5f`
- 60–75%: `#1d4ed8`
- 75–90%: `#2563eb`
- 90–100%: `#60a5fa`

**Future months** (current crop year, not yet elapsed): `bg-slate-900` with dashed border.

**Cell content:** no label (color only). Tooltip on hover: `[Month Year]: X kt (Y% of peak)`.

**Row labels:** crop year keys (`24/25`, `25/26`, etc.), newest at top.

**Placement:** After `YoYByTypeChart`.

---

## 4. Hub View — Share Change Column

**What:** In the `DestinationChart` component, when mode is "By Hub", the YoY change table below the bar chart gains a second column showing share Δpp (percentage-point change in that hub's share of total exports vs same period last year).

**Example row:** `Central Europe | +42 kt (+6%) | share: +1.2pp`

**Computation:**
- `totalCurrent` = sum of all hub `current` values
- `totalPrev`    = sum of all hub `prev` values  
- `shareCurrent` = `hub.current / totalCurrent * 100`
- `sharePrev`    = `hub.prev / totalPrev * 100`
- `deltaShare`   = `shareCurrent − sharePrev` (rounded to 1 decimal)

**Display:** A third column in the hub table: `share Δpp`, colored green for positive, red for negative, slate for zero. Not shown in country mode.

**Placement:** Modification inside existing `DestinationChart` component in `BrazilTab.tsx`.

---

## 5. Component Structure

All four additions live in `frontend/components/supply/BrazilTab.tsx` following the existing pattern of self-contained function components in the same file.

New functions added to `BrazilTab.tsx`:
- `CumulativePaceChart({ series, filteredSeries, typeFilter })`
- `TypeShareChart({ series })`
- `SeasonalityHeatmap({ series })`

`DestinationChart` modified in-place (share Δpp logic added to `hubRows` useMemo + table render).

**Render order in `BrazilTab` return (Exports sub-tab):**
1. `DailyRegistrationSection` *(existing)*
2. KPI cards *(existing)*
3. `CountryHubFilter` *(existing)*
4. `MonthlyVolumeChart` *(existing)*
5. **`CumulativePaceChart`** *(new)*
6. `AnnualTrendChart` *(existing)*
7. **`TypeShareChart`** *(new)*
8. `YoYByTypeChart` *(existing)*
9. **`SeasonalityHeatmap`** *(new)*
10. `RollingAvgChart` *(existing)*
11. `DestinationChart` *(existing, modified)*

---

## 6. Out of Scope

- Daily delta KPI row (improvement 2) — deferred
- Top destination movers chart (improvement 4) — deferred
- Any new data fetches or dependencies
- Changes to Vietnam/Colombia/etc. tabs
