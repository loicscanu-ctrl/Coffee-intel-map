# Farmer Economics Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Farmer Economics" sub-tab to the Brazil country panel in the Supply tab, showing production cost breakdown, acreage/yield KPIs, daily weather risk grid, ENSO phase, and fertilizer price cards — all from mock static data.

**Architecture:** Seven self-contained panel components receive typed props from a single mock-data constant file. `BrazilTab.tsx` gains a two-pill sub-tab bar; the `BrazilFarmerEconomics` layout mounts lazily only when its tab is active. No API calls, no new dependencies.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Recharts 3, Vitest (for utility functions)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `frontend/components/supply/BrazilTab.tsx` | Add sub-tab state + lazy render |
| Create | `frontend/components/supply/farmer-economics/farmerEconomicsData.ts` | All mock data + TypeScript types |
| Create | `frontend/components/supply/farmer-economics/farmerEconomicsUtils.ts` | Pure utility functions (RMSE, dot count) |
| Create | `frontend/lib/__tests__/farmerEconomicsUtils.test.ts` | Vitest unit tests for utilities |
| Create | `frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx` | Top-level two-column layout |
| Create | `frontend/components/supply/farmer-economics/ProductionCostPanel.tsx` | Stacked bar + inputs sub-breakdown |
| Create | `frontend/components/supply/farmer-economics/AcreageYieldPanel.tsx` | Acreage + Yield KPI cards |
| Create | `frontend/components/supply/farmer-economics/WeatherRiskPanel.tsx` | Risk badges + 14-day grid + dual-line chart |
| Create | `frontend/components/supply/farmer-economics/EnsoPanel.tsx` | Phase badge + ONI bar chart + impact row |
| Create | `frontend/components/supply/farmer-economics/FertilizerPanel.tsx` | Three KPI cards with sparklines |

---

## Task 1: Types, mock data, and utility functions

**Files:**
- Create: `frontend/components/supply/farmer-economics/farmerEconomicsData.ts`
- Create: `frontend/components/supply/farmer-economics/farmerEconomicsUtils.ts`
- Create: `frontend/lib/__tests__/farmerEconomicsUtils.test.ts`

- [ ] **Step 1: Create the types + mock data file**

Create `frontend/components/supply/farmer-economics/farmerEconomicsData.ts`:

```ts
// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "HIGH" | "MED" | "LOW" | "NONE";
export type EnsoPhase = "el-nino" | "la-nina" | "neutral";
export type ImpactType = "DRY" | "WET" | "COLD" | "WARM";
export type DayRisk = "H" | "M" | "L" | "-";

export interface CostComponent {
  label: string;
  share: number;   // 0–1
  usd: number;
  color: string;
}

export interface InputDetail {
  label: string;
  share: number;   // 0–1 of inputs total
  usd: number;
}

export interface WeatherRegion {
  name: string;
  frost: RiskLevel;
  drought: RiskLevel;
}

export interface DailyRiskRow {
  region: string;
  days: DayRisk[];  // length 14
}

export interface ForecastAccuracyPoint {
  date: string;       // "Apr 8"
  forecast_c: number;
  actual_c: number;
}

export interface OniHistoryPoint {
  month: string;      // "Oct-24"
  value: number;
  forecast?: boolean;
}

export interface RegionalImpact {
  region: string;
  type: ImpactType;
  dots: number;       // 1–4
  note: string;
}

export interface FertilizerItem {
  name: string;
  price_usd_mt: number;
  mom_pct: number;
  sparkline: number[];   // 6 monthly prices, oldest first
  input_weight: number;  // fraction of total inputs cost
  base_usd_per_bag: number;
}

export interface FarmerEconomicsData {
  country: string;
  season: string;
  cost: {
    total_usd_per_bag: number;
    yoy_pct: number;
    components: CostComponent[];
    inputs_detail: InputDetail[];
    kc_spot: number;
  };
  acreage: { thousand_ha: number; yoy_pct: number };
  yield:   { bags_per_ha: number; yoy_pct: number };
  weather: {
    regions: WeatherRegion[];
    daily_frost: DailyRiskRow[];
    daily_drought: DailyRiskRow[];
    forecast_accuracy: ForecastAccuracyPoint[];
    forecast_rmse: number;
    forecast_region: string;
  };
  enso: {
    phase: EnsoPhase;
    intensity: string;
    oni: number;
    peak_month: string;
    forecast_direction: string;
    oni_history: OniHistoryPoint[];
    regional_impact: RegionalImpact[];
    historical_stat: string;
  };
  fertilizer: {
    items: FertilizerItem[];
    next_application: string;
  };
}

// ── Mock data ────────────────────────────────────────────────────────────────

export const BRAZIL_FARMER_DATA: FarmerEconomicsData = {
  country: "brazil",
  season: "2025/26",
  cost: {
    total_usd_per_bag: 142,
    yoy_pct: 2.1,
    components: [
      { label: "Inputs",        share: 0.38, usd: 54, color: "#3b82f6" },
      { label: "Labor",         share: 0.27, usd: 38, color: "#22c55e" },
      { label: "Mechanization", share: 0.18, usd: 26, color: "#f59e0b" },
      { label: "Land rent",     share: 0.12, usd: 17, color: "#8b5cf6" },
      { label: "Admin",         share: 0.05, usd:  7, color: "#475569" },
    ],
    inputs_detail: [
      { label: "Nitrogen (urea / AN)",    share: 0.35, usd: 19 },
      { label: "Potassium (KCl)",         share: 0.25, usd: 14 },
      { label: "Phosphorus (MAP)",        share: 0.20, usd: 11 },
      { label: "Pesticides / fungicides", share: 0.15, usd:  8 },
      { label: "Lime / soil correction",  share: 0.05, usd:  3 },
    ],
    kc_spot: 302,
  },
  acreage: { thousand_ha: 2240, yoy_pct: 1.4 },
  yield:   { bags_per_ha: 32,   yoy_pct: -3.2 },
  weather: {
    regions: [
      { name: "Sul de Minas",  frost: "MED",  drought: "LOW"  },
      { name: "Cerrado",       frost: "NONE", drought: "HIGH" },
      { name: "Paraná",        frost: "HIGH", drought: "NONE" },
      { name: "Esp. Santo",    frost: "NONE", drought: "NONE" },
    ],
    daily_frost: [
      { region: "Sul de Minas", days: ["L","M","M","H","H","M","-","-","L","M","M","-","-","-"] },
      { region: "Paraná",       days: ["H","H","H","H","M","M","L","-","-","L","M","H","H","M"] },
    ],
    daily_drought: [
      { region: "Cerrado",      days: ["M","M","H","H","H","M","M","L","L","M","H","H","M","M"] },
      { region: "Sul de Minas", days: ["-","-","L","L","M","M","L","-","-","-","L","L","-","-"] },
    ],
    forecast_accuracy: [
      { date: "Apr 8",  forecast_c: 9.4,  actual_c: 9.7  },
      { date: "Apr 9",  forecast_c: 11.7, actual_c: 12.5 },
      { date: "Apr 10", forecast_c: 7.0,  actual_c: 6.8  },
      { date: "Apr 11", forecast_c: 6.0,  actual_c: 5.2  },
      { date: "Apr 12", forecast_c: 5.5,  actual_c: 7.8  },
      { date: "Apr 13", forecast_c: 8.0,  actual_c: 7.6  },
      { date: "Apr 14", forecast_c: 10.2, actual_c: 9.8  },
    ],
    forecast_rmse: 1.1,
    forecast_region: "Sul de Minas",
  },
  enso: {
    phase: "el-nino",
    intensity: "Moderate",
    oni: 1.4,
    peak_month: "Nov 2025",
    forecast_direction: "Neutral by Jun 2026",
    oni_history: [
      { month: "Oct-24", value: 0.1 },
      { month: "Nov-24", value: 0.3 },
      { month: "Dec-24", value: 0.6 },
      { month: "Jan-25", value: 0.9 },
      { month: "Feb-25", value: 1.1 },
      { month: "Mar-25", value: 1.3 },
      { month: "Apr-25", value: 1.5 },
      { month: "May-25", value: 1.7 },
      { month: "Jun-25", value: 1.6 },
      { month: "Jul-25", value: 1.5 },
      { month: "Aug-25", value: 1.3 },
      { month: "Sep-25", value: 1.1 },
      { month: "Oct-25", value: 0.9 },
      { month: "Nov-25", value: 0.7 },
      { month: "Dec-25", value: 0.5 },
      { month: "Jan-26", value: 0.3, forecast: true },
      { month: "Feb-26", value: 0.1, forecast: true },
      { month: "Mar-26", value: 0.0, forecast: true },
    ],
    regional_impact: [
      { region: "Sul de Minas", type: "DRY",  dots: 2, note: "rainfall −18% vs norm." },
      { region: "Cerrado",      type: "DRY",  dots: 3, note: "moisture deficit critical" },
      { region: "Paraná",       type: "COLD", dots: 2, note: "frost window +12 days" },
      { region: "Esp. Santo",   type: "WET",  dots: 1, note: "above-avg rainfall" },
    ],
    historical_stat: "El Niño years avg. Brazil arabica output −4.2% vs neutral",
  },
  fertilizer: {
    items: [
      {
        name: "Urea (N)",
        price_usd_mt: 312,
        mom_pct: 8.3,
        sparkline: [268, 274, 281, 290, 298, 312],
        input_weight: 0.35,
        base_usd_per_bag: 18.9,
      },
      {
        name: "MAP (P)",
        price_usd_mt: 584,
        mom_pct: 2.1,
        sparkline: [560, 565, 570, 572, 572, 584],
        input_weight: 0.20,
        base_usd_per_bag: 10.8,
      },
      {
        name: "KCl (K)",
        price_usd_mt: 278,
        mom_pct: -5.4,
        sparkline: [310, 305, 298, 292, 294, 278],
        input_weight: 0.25,
        base_usd_per_bag: 13.5,
      },
    ],
    next_application: "May–Jun",
  },
};
```

- [ ] **Step 2: Create utility functions**

Create `frontend/components/supply/farmer-economics/farmerEconomicsUtils.ts`:

```ts
import type { ForecastAccuracyPoint, FertilizerItem } from "./farmerEconomicsData";

/**
 * Root mean square error between forecast and actual temperature arrays.
 */
export function computeRmse(points: ForecastAccuracyPoint[]): number {
  if (points.length === 0) return 0;
  const sumSq = points.reduce((s, p) => s + (p.forecast_c - p.actual_c) ** 2, 0);
  return Math.round(Math.sqrt(sumSq / points.length) * 10) / 10;
}

/**
 * Number of filled dots (1–4) for ENSO impact intensity based on ONI magnitude.
 *   0.5–1.0 → 1  (mild)
 *   1.0–1.5 → 2  (moderate)
 *   1.5–2.0 → 3  (strong)
 *   > 2.0   → 4  (extreme)
 */
export function oniToDots(oni: number): number {
  const abs = Math.abs(oni);
  if (abs > 2.0) return 4;
  if (abs > 1.5) return 3;
  if (abs > 1.0) return 2;
  return 1;
}

/**
 * Estimated per-bag cost delta for a fertilizer item given its current MoM change.
 * delta = (mom_pct / 100) * base_usd_per_bag
 */
export function fertCostDelta(item: FertilizerItem): number {
  return Math.round((item.mom_pct / 100) * item.base_usd_per_bag * 10) / 10;
}

/**
 * Net input cost impact across all fertilizer items ($/bag).
 */
export function netFertImpact(items: FertilizerItem[]): number {
  const total = items.reduce((s, f) => s + fertCostDelta(f), 0);
  return Math.round(total * 10) / 10;
}
```

- [ ] **Step 3: Write failing tests**

Create `frontend/lib/__tests__/farmerEconomicsUtils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeRmse,
  oniToDots,
  fertCostDelta,
  netFertImpact,
} from "../../components/supply/farmer-economics/farmerEconomicsUtils";
import type { FertilizerItem } from "../../components/supply/farmer-economics/farmerEconomicsData";

describe("computeRmse", () => {
  it("returns 0 for empty array", () => {
    expect(computeRmse([])).toBe(0);
  });
  it("returns 0 when forecast equals actual", () => {
    expect(computeRmse([{ date: "d", forecast_c: 5, actual_c: 5 }])).toBe(0);
  });
  it("computes correctly for a single point", () => {
    // error = 2, RMSE = 2
    expect(computeRmse([{ date: "d", forecast_c: 7, actual_c: 5 }])).toBe(2);
  });
  it("computes correctly for multiple points", () => {
    // errors: 1, 1 → RMSE = 1
    expect(computeRmse([
      { date: "d1", forecast_c: 6, actual_c: 5 },
      { date: "d2", forecast_c: 4, actual_c: 5 },
    ])).toBe(1);
  });
});

describe("oniToDots", () => {
  it("returns 1 for ONI 0.5–1.0", () => {
    expect(oniToDots(0.6)).toBe(1);
    expect(oniToDots(1.0)).toBe(1);
  });
  it("returns 2 for ONI 1.0–1.5", () => {
    expect(oniToDots(1.1)).toBe(2);
    expect(oniToDots(1.5)).toBe(2);
  });
  it("returns 3 for ONI 1.5–2.0", () => {
    expect(oniToDots(1.6)).toBe(3);
    expect(oniToDots(2.0)).toBe(3);
  });
  it("returns 4 for ONI > 2.0", () => {
    expect(oniToDots(2.1)).toBe(4);
    expect(oniToDots(3.0)).toBe(4);
  });
  it("works for negative ONI (La Niña)", () => {
    expect(oniToDots(-1.4)).toBe(2);
  });
});

describe("fertCostDelta", () => {
  const item: FertilizerItem = {
    name: "Test", price_usd_mt: 300, mom_pct: 10,
    sparkline: [], input_weight: 0.35, base_usd_per_bag: 18.9,
  };
  it("returns positive delta when price rose", () => {
    expect(fertCostDelta(item)).toBeCloseTo(1.9, 1);
  });
  it("returns negative delta when price fell", () => {
    expect(fertCostDelta({ ...item, mom_pct: -5.4, base_usd_per_bag: 13.5 })).toBeCloseTo(-0.7, 1);
  });
});

describe("netFertImpact", () => {
  it("sums deltas across items", () => {
    const items: FertilizerItem[] = [
      { name: "A", price_usd_mt: 0, mom_pct: 10, sparkline: [], input_weight: 0.35, base_usd_per_bag: 10 },
      { name: "B", price_usd_mt: 0, mom_pct: -5, sparkline: [], input_weight: 0.20, base_usd_per_bag: 10 },
    ];
    // A: +1.0, B: -0.5 → net +0.5
    expect(netFertImpact(items)).toBeCloseTo(0.5, 1);
  });
});
```

- [ ] **Step 4: Run tests — verify they fail**

```bash
cd frontend && npx vitest run lib/__tests__/farmerEconomicsUtils.test.ts
```

Expected: FAIL — `farmerEconomicsUtils` not found yet.

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd frontend && npx vitest run lib/__tests__/farmerEconomicsUtils.test.ts
```

Expected: All 11 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/supply/farmer-economics/farmerEconomicsData.ts \
        frontend/components/supply/farmer-economics/farmerEconomicsUtils.ts \
        frontend/lib/__tests__/farmerEconomicsUtils.test.ts
git commit -m "feat: farmer economics types, mock data, and utility functions"
```

---

## Task 2: Sub-tab navigation in BrazilTab

**Files:**
- Modify: `frontend/components/supply/BrazilTab.tsx` (top of `BrazilTab` component, ~line 1386)

- [ ] **Step 1: Add sub-tab state and render the pill bar**

In `frontend/components/supply/BrazilTab.tsx`, find the `BrazilTab` component's return statement. Add `subTab` state and wrap existing content. The diff below shows exactly what to change:

Add this import at the top of the file (after existing imports):
```ts
import BrazilFarmerEconomics from "./farmer-economics/BrazilFarmerEconomics";
```

Inside `BrazilTab`, add state after the existing state declarations:
```ts
const [subTab, setSubTab] = useState<"exports" | "farmer-economics">("exports");
```

Replace the opening `<div className="space-y-5">` and header block with:
```tsx
<div className="space-y-5">
  {/* Sub-tab bar */}
  <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
    {(["exports", "farmer-economics"] as const).map((t) => (
      <button
        key={t}
        onClick={() => setSubTab(t)}
        className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
          subTab === t
            ? "bg-slate-700 text-slate-100"
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
        }`}
      >
        {t === "exports" ? "Exports" : "Farmer Economics"}
      </button>
    ))}
  </div>

  {/* Lazy-mount: Farmer Economics only mounts when active */}
  {subTab === "farmer-economics" && <BrazilFarmerEconomics />}
  {subTab === "exports" && (
    <>
```

Then close the conditional at the very end of the return, replacing the existing closing `</div>`:
```tsx
    </>
  )}
</div>
```

The full modified return block looks like this (replace from `return (` to the final `);`):
```tsx
return (
  <div className="space-y-5">
    {/* Sub-tab bar */}
    <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
      {(["exports", "farmer-economics"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setSubTab(t)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            subTab === t
              ? "bg-slate-700 text-slate-100"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          }`}
        >
          {t === "exports" ? "Exports" : "Farmer Economics"}
        </button>
      ))}
    </div>

    {subTab === "farmer-economics" && <BrazilFarmerEconomics />}

    {subTab === "exports" && (
      <>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-200">Brazil — Cecafe Export Data</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Report: {report} · Updated {updated} · Source: Cecafe (60 kg bags)
            </p>
          </div>
          <span className="text-[10px] bg-green-900/50 text-green-400 px-2 py-0.5 rounded border border-green-800">
            Arabica &amp; Conillon origin
          </span>
        </div>

        <DailyRegistrationSection />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label={`${latest.date} — total exports`}
            value={`${bagsToKT(latest.total).toFixed(1)} kt`}
            sub={`${(latest.total / 1000).toFixed(0)}k bags`}
          />
          <StatCard
            label="vs same month last year"
            value={lyChg !== null ? `${lyChg > 0 ? "+" : ""}${lyChg}%` : "—"}
            sub={prev ? `${bagsToKT(prev.total).toFixed(1)} kt in ${prev.date}` : ""}
          />
          <StatCard
            label={`Crop ${latestCropKey} — ${ctdMonthRange}`}
            value={`${bagsToKT(ctdTotal).toFixed(1)} kt`}
            sub={`${(ctdTotal / 1000).toFixed(0)}k bags crop-to-date`}
          />
          <StatCard
            label={`vs crop ${prevCropKey} same period`}
            value={ctdChg !== null ? `${ctdChg > 0 ? "+" : ""}${ctdChg}%` : "—"}
            sub={`${prevCropKey}: ${bagsToKT(ctdPrevTotal).toFixed(1)} kt`}
          />
        </div>

        <CountryHubFilter byCountry={by_country} filter={filter} onChange={setFilter} />

        <MonthlyVolumeChart  series={filteredSeries ?? series} typeFilter={filter.type} />
        <AnnualTrendChart    series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
        <YoYByTypeChart      series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
        <RollingAvgChart     series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
        <DestinationChart
          byCountry={by_country}         byCountryPrev={by_country_prev}
          byArabica={by_country_arabica} byArabicaPrev={by_country_arabica_prev}
          byConillon={by_country_conillon} byConillonPrev={by_country_conillon_prev}
          bySoluvel={by_country_soluvel} bySoluvelPrev={by_country_soluvel_prev}
          byTorrado={by_country_torrado} byTorradoPrev={by_country_torrado_prev}
          byCountryHistory={by_country_history}
        />
      </>
    )}
  </div>
);
```

- [ ] **Step 2: Create a placeholder BrazilFarmerEconomics so the import resolves**

Create `frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx`:
```tsx
export default function BrazilFarmerEconomics() {
  return (
    <div className="text-slate-500 text-sm py-8 text-center">
      Farmer Economics — loading…
    </div>
  );
}
```

- [ ] **Step 3: Visual check — verify sub-tab bar appears and switching works**

```bash
cd frontend && npm run dev
```

Open http://localhost:3000/supply. Verify:
- Two pills appear: "Exports" and "Farmer Economics"
- Clicking "Exports" shows existing export content (unchanged)
- Clicking "Farmer Economics" shows the placeholder text
- Switching back to "Exports" re-renders correctly

- [ ] **Step 4: Commit**

```bash
git add frontend/components/supply/BrazilTab.tsx \
        frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx
git commit -m "feat: add Exports/Farmer Economics sub-tab bar to BrazilTab"
```

---

## Task 3: ProductionCostPanel

**Files:**
- Create: `frontend/components/supply/farmer-economics/ProductionCostPanel.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/supply/farmer-economics/ProductionCostPanel.tsx`:

```tsx
"use client";
import type { FarmerEconomicsData } from "./farmerEconomicsData";

interface Props {
  cost: FarmerEconomicsData["cost"];
}

export default function ProductionCostPanel({ cost }: Props) {
  const margin = cost.kc_spot - cost.total_usd_per_bag;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      {/* Header KPI */}
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">
          Production Cost — Brazil 2025/26
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-slate-100">
            ${cost.total_usd_per_bag}
          </span>
          <span className="text-xs text-slate-500">/ 60kg bag</span>
          <span className={`text-xs font-semibold ${cost.yoy_pct >= 0 ? "text-red-400" : "text-green-400"}`}>
            {cost.yoy_pct >= 0 ? "▲" : "▼"} {Math.abs(cost.yoy_pct).toFixed(1)}% YoY
          </span>
        </div>
      </div>

      {/* Stacked horizontal bar */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1">Cost breakdown</div>
        <div className="flex h-5 rounded overflow-hidden mb-2">
          {cost.components.map((c) => (
            <div
              key={c.label}
              style={{ width: `${c.share * 100}%`, background: c.color }}
              className="flex items-center justify-center text-[7px] font-bold text-white overflow-hidden"
            >
              {c.share >= 0.1 ? c.label.split(" ")[0].slice(0, 4) : ""}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {cost.components.map((c) => (
            <div key={c.label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="text-[10px] text-slate-400">
                {c.label} ${c.usd} ({Math.round(c.share * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Inputs sub-breakdown */}
      <div className="border-l-2 border-blue-500 pl-3 bg-slate-900 rounded-r-lg p-3">
        <div className="text-[10px] text-blue-400 uppercase tracking-wide mb-2">
          🌱 Inputs detail — ${cost.components[0].usd}/bag total
        </div>
        <div className="space-y-1.5">
          {cost.inputs_detail.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="text-[10px] text-slate-400 w-40 flex-shrink-0">{item.label}</div>
              <div className="flex-1 bg-slate-800 rounded h-1.5">
                <div
                  className="h-full rounded bg-blue-400"
                  style={{ width: `${item.share * 100}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-300 font-semibold w-8 text-right">
                {Math.round(item.share * 100)}%
              </div>
              <div className="text-[10px] text-slate-500 w-8 text-right">${item.usd}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Margin line */}
      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700">
        KC spot{" "}
        <span className="text-green-400 font-bold">${cost.kc_spot}/bag</span>
        {" "}→ farmer margin ~
        <span className="text-green-400 font-bold">${margin}/bag</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/supply/farmer-economics/ProductionCostPanel.tsx
git commit -m "feat: ProductionCostPanel with stacked bar and inputs sub-breakdown"
```

---

## Task 4: AcreageYieldPanel

**Files:**
- Create: `frontend/components/supply/farmer-economics/AcreageYieldPanel.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/supply/farmer-economics/AcreageYieldPanel.tsx`:

```tsx
"use client";
import type { FarmerEconomicsData } from "./farmerEconomicsData";

interface Props {
  acreage: FarmerEconomicsData["acreage"];
  yield_: FarmerEconomicsData["yield"];
}

function KpiCard({
  label, value, unit, yoyPct, source,
}: {
  label: string;
  value: string;
  unit: string;
  yoyPct: number;
  source: string;
}) {
  const up = yoyPct >= 0;
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 flex-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-xl font-extrabold text-slate-100">{value}</span>
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
      <div className={`text-xs font-semibold mb-2 ${up ? "text-red-400" : "text-green-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(yoyPct).toFixed(1)}% YoY
      </div>
      <div className="text-[9px] text-slate-600">{source}</div>
    </div>
  );
}

export default function AcreageYieldPanel({ acreage, yield_ }: Props) {
  return (
    <div className="flex gap-3">
      <KpiCard
        label="Harvested Area"
        value={acreage.thousand_ha.toLocaleString()}
        unit="thousand ha"
        yoyPct={acreage.yoy_pct}
        source="CONAB 2025/26"
      />
      <KpiCard
        label="Yield"
        value={String(yield_.bags_per_ha)}
        unit="bags / ha"
        yoyPct={yield_.yoy_pct}
        source="CONAB 2025/26"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/supply/farmer-economics/AcreageYieldPanel.tsx
git commit -m "feat: AcreageYieldPanel with KPI cards"
```

---

## Task 5: WeatherRiskPanel

**Files:**
- Create: `frontend/components/supply/farmer-economics/WeatherRiskPanel.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/supply/farmer-economics/WeatherRiskPanel.tsx`:

```tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { FarmerEconomicsData, RiskLevel, DayRisk } from "./farmerEconomicsData";
import { computeRmse } from "./farmerEconomicsUtils";

interface Props {
  weather: FarmerEconomicsData["weather"];
}

const RISK_BADGE: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-600 text-white" },
  MED:  { label: "MED",  className: "bg-amber-500 text-black" },
  LOW:  { label: "LOW",  className: "bg-green-600 text-white" },
  NONE: { label: "—",   className: "bg-slate-800 text-slate-500 border border-slate-600" },
};

const FROST_CELL: Record<DayRisk, string> = {
  "H": "bg-blue-900 text-white",
  "M": "bg-blue-600 text-white",
  "L": "bg-blue-950 text-blue-300",
  "-": "bg-slate-900 text-slate-600",
};

const DROUGHT_CELL: Record<DayRisk, string> = {
  "H": "bg-amber-700 text-white",
  "M": "bg-amber-500 text-black",
  "L": "bg-amber-900 text-amber-300",
  "-": "bg-slate-900 text-slate-600",
};

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

export default function WeatherRiskPanel({ weather }: Props) {
  // Build chart data for dual-line forecast accuracy
  const chartData = weather.forecast_accuracy.map((p) => ({
    date: p.date,
    forecast: p.forecast_c,
    actual: p.actual_c,
  }));

  // Compute y-axis domain with 2°C padding
  const allTemps = weather.forecast_accuracy.flatMap((p) => [p.forecast_c, p.actual_c]);
  const minTemp  = Math.floor(Math.min(...allTemps)) - 2;
  const maxTemp  = Math.ceil(Math.max(...allTemps)) + 2;

  const rmse = computeRmse(weather.forecast_accuracy);

  // Build day labels (today + 13)
  const today = new Date();
  const dayLabels = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return String(d.getDate());
  });

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Weather Risk</div>

      {/* Current risk badges */}
      <div className="grid grid-cols-2 gap-2">
        {weather.regions.map((r) => (
          <div key={r.name} className="bg-slate-900 rounded p-2">
            <div className="text-[9px] text-slate-500 mb-1.5">{r.name}</div>
            <div className="flex gap-1.5">
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${RISK_BADGE[r.frost].className}`}>
                ❄ {RISK_BADGE[r.frost].label}
              </span>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${RISK_BADGE[r.drought].className}`}>
                ☀ {RISK_BADGE[r.drought].label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 14-day frost risk grid */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1.5">14-day frost risk ❄</div>
        <div
          className="grid gap-[2px] text-[7px] font-bold"
          style={{ gridTemplateColumns: `80px repeat(14, 1fr)` }}
        >
          {/* Header */}
          <div />
          {dayLabels.map((d) => (
            <div key={d} className="text-center text-slate-600">{d}</div>
          ))}
          {/* Rows */}
          {weather.daily_frost.map((row) => (
            <>
              <div key={`${row.region}-label`} className="text-slate-400 flex items-center text-[9px]">
                {row.region}
              </div>
              {row.days.map((cell, i) => (
                <div
                  key={i}
                  className={`h-4 flex items-center justify-center rounded-[2px] ${FROST_CELL[cell]}`}
                >
                  {cell}
                </div>
              ))}
            </>
          ))}
        </div>
      </div>

      {/* 14-day drought risk grid */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1.5">14-day drought risk ☀</div>
        <div
          className="grid gap-[2px] text-[7px] font-bold"
          style={{ gridTemplateColumns: `80px repeat(14, 1fr)` }}
        >
          <div />
          {dayLabels.map((d) => (
            <div key={d} className="text-center text-slate-600">{d}</div>
          ))}
          {weather.daily_drought.map((row) => (
            <>
              <div key={`${row.region}-label`} className="text-slate-400 flex items-center text-[9px]">
                {row.region}
              </div>
              {row.days.map((cell, i) => (
                <div
                  key={i}
                  className={`h-4 flex items-center justify-center rounded-[2px] ${DROUGHT_CELL[cell]}`}
                >
                  {cell}
                </div>
              ))}
            </>
          ))}
        </div>
      </div>

      {/* Forecast accuracy — dual-line chart */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1">
          Forecast accuracy — min temp °C, {weather.forecast_region} (last 7 days)
        </div>
        <div className="flex gap-3 text-[9px] text-slate-500 mb-2">
          <span><span className="inline-block w-4 border-t-2 border-dashed border-blue-400 align-middle mr-1" />Forecast</span>
          <span><span className="inline-block w-4 border-t-2 border-orange-400 align-middle mr-1" />Actual</span>
        </div>
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 8 }} />
            <YAxis domain={[minTemp, maxTemp]} tick={{ fill: "#475569", fontSize: 8 }} width={28} unit="°" />
            <Tooltip contentStyle={TT_STYLE} formatter={(v: any, n: string) => [`${v}°C`, n === "forecast" ? "Forecast" : "Actual"]} />
            <Line
              type="monotone" dataKey="forecast" stroke="#60a5fa"
              strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line
              type="monotone" dataKey="actual" stroke="#f97316"
              strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="text-[9px] text-slate-600 mt-1">
          RMSE {rmse}°C over {weather.forecast_accuracy.length} days · Source: INMET / CPTEC
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/supply/farmer-economics/WeatherRiskPanel.tsx
git commit -m "feat: WeatherRiskPanel with risk badges, daily grid, and forecast accuracy chart"
```

---

## Task 6: EnsoPanel

**Files:**
- Create: `frontend/components/supply/farmer-economics/EnsoPanel.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/supply/farmer-economics/EnsoPanel.tsx`:

```tsx
"use client";
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip,
  Cell, ResponsiveContainer,
} from "recharts";
import type { FarmerEconomicsData, EnsoPhase, ImpactType } from "./farmerEconomicsData";

interface Props {
  enso: FarmerEconomicsData["enso"];
}

const PHASE_STYLE: Record<EnsoPhase, { icon: string; label: string; border: string; text: string; bg: string }> = {
  "el-nino": { icon: "🌡", label: "El Niño",  border: "border-purple-500", text: "text-purple-300", bg: "bg-purple-950" },
  "la-nina": { icon: "🌊", label: "La Niña",  border: "border-blue-400",   text: "text-blue-300",   bg: "bg-blue-950"   },
  "neutral":  { icon: "⚖",  label: "Neutral",  border: "border-slate-500",  text: "text-slate-400",  bg: "bg-slate-900"  },
};

const IMPACT_STYLE: Record<ImpactType, { bg: string; text: string; dotFill: string; dotEmpty: string }> = {
  DRY:  { bg: "bg-amber-900",  text: "text-amber-300",  dotFill: "bg-amber-400",  dotEmpty: "bg-amber-950 border border-amber-800"  },
  WET:  { bg: "bg-cyan-900",   text: "text-cyan-300",   dotFill: "bg-cyan-400",   dotEmpty: "bg-cyan-950 border border-cyan-800"    },
  COLD: { bg: "bg-blue-900",   text: "text-blue-300",   dotFill: "bg-blue-400",   dotEmpty: "bg-blue-950 border border-blue-800"    },
  WARM: { bg: "bg-orange-900", text: "text-orange-300", dotFill: "bg-orange-400", dotEmpty: "bg-orange-950 border border-orange-800" },
};

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

export default function EnsoPanel({ enso }: Props) {
  const phase = PHASE_STYLE[enso.phase];

  // Bar color per data point
  const barColor = (value: number, isForecast?: boolean) => {
    if (isForecast) return "#94a3b8";
    return value >= 0
      ? enso.phase === "el-nino" ? "#a78bfa" : "#a78bfa"
      : "#60a5fa";
  };

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">ENSO</div>

      {/* Phase badge */}
      <div className={`rounded-lg px-3 py-2 border ${phase.border} ${phase.bg}`}>
        <div className={`font-bold text-sm ${phase.text}`}>
          {phase.icon} {phase.label} — {enso.intensity} · ONI {enso.oni > 0 ? "+" : ""}{enso.oni}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          Peak: {enso.peak_month} · Weakening · Forecast: {enso.forecast_direction}
        </div>
      </div>

      {/* ONI bar chart */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1">
          ONI index — 18-month history + forecast
        </div>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={enso.oni_history} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 7 }} interval={2} />
            <YAxis domain={[-2.5, 2.5]} tick={{ fill: "#475569", fontSize: 8 }} width={28} />
            <ReferenceLine y={0}    stroke="#334155" strokeWidth={1.5} />
            <ReferenceLine y={0.5}  stroke="#7c3aed" strokeWidth={0.5} strokeDasharray="3 3" />
            <ReferenceLine y={-0.5} stroke="#2563eb" strokeWidth={0.5} strokeDasharray="3 3" />
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: any, _: any, props: any) => [
                `ONI ${v > 0 ? "+" : ""}${v}`,
                props.payload.forecast ? "Forecast" : "Historical",
              ]}
            />
            <Bar dataKey="value" maxBarSize={14} radius={[2, 2, 0, 0]}>
              {enso.oni_history.map((entry, i) => (
                <Cell
                  key={i}
                  fill={barColor(entry.value, entry.forecast)}
                  fillOpacity={entry.forecast ? 0.4 : 0.85}
                  stroke={entry.forecast ? "#94a3b8" : "none"}
                  strokeDasharray={entry.forecast ? "3 2" : "0"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="text-[9px] text-slate-600 mt-1">
          Solid = historical · Faded = NOAA 3-month forecast · Threshold ±0.5
        </div>
      </div>

      {/* Regional impact row */}
      <div>
        <div className="text-[10px] text-slate-500 mb-2">Regional impact</div>
        <div className="grid grid-cols-2 gap-2">
          {enso.regional_impact.map((r) => {
            const style = IMPACT_STYLE[r.type];
            return (
              <div key={r.region} className="bg-slate-900 rounded p-2">
                <div className="text-[9px] text-slate-500 mb-1">{r.region}</div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                    {r.type}
                  </span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 4 }, (_, i) => (
                      <span
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full inline-block ${
                          i < r.dots ? style.dotFill : style.dotEmpty
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="text-[8px] text-slate-500">{r.note}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Historical stat */}
      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700">
        {enso.historical_stat}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/supply/farmer-economics/EnsoPanel.tsx
git commit -m "feat: EnsoPanel with phase badge, ONI bar chart, and dot-scale impact row"
```

---

## Task 7: FertilizerPanel

**Files:**
- Create: `frontend/components/supply/farmer-economics/FertilizerPanel.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/components/supply/farmer-economics/FertilizerPanel.tsx`:

```tsx
"use client";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import type { FarmerEconomicsData, FertilizerItem } from "./farmerEconomicsData";
import { fertCostDelta, netFertImpact } from "./farmerEconomicsUtils";

interface Props {
  fertilizer: FarmerEconomicsData["fertilizer"];
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function FertCard({ item }: { item: FertilizerItem }) {
  const delta     = fertCostDelta(item);
  const priceRose = item.mom_pct > 0; // rising price = bad for farmer = red
  const sparkData = item.sparkline.map((v, i) => ({ i, v }));

  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 flex-1 min-w-0">
      <div className="text-[10px] text-slate-400 mb-0.5">{item.name}</div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-base font-extrabold text-slate-100">${item.price_usd_mt}</span>
        <span className="text-[9px] text-slate-500">/mt</span>
      </div>
      <div className="text-[8px] text-slate-600 mb-1">CFR Brazil</div>

      {/* Sparkline */}
      <div className="h-10 mb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: any) => [`$${v}/mt`, item.name]}
              labelFormatter={() => ""}
            />
            <Line
              type="monotone" dataKey="v"
              stroke={priceRose ? "#ef4444" : "#22c55e"}
              strokeWidth={1.5} dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* MoM change */}
      <div className={`text-[10px] font-semibold mb-1 ${priceRose ? "text-red-400" : "text-green-400"}`}>
        {priceRose ? "▲" : "▼"} {Math.abs(item.mom_pct).toFixed(1)}% MoM
      </div>

      {/* Cost-per-bag impact badge */}
      <div className={`text-[9px] font-semibold px-1.5 py-0.5 rounded inline-block ${
        delta > 0 ? "bg-red-950 text-red-300" : delta < 0 ? "bg-green-950 text-green-300" : "bg-slate-800 text-slate-500"
      }`}>
        {delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {delta > 0 ? "+" : ""}{delta.toFixed(1)}/bag est.
      </div>
    </div>
  );
}

export default function FertilizerPanel({ fertilizer }: Props) {
  const net = netFertImpact(fertilizer.items);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Fertilizer Prices</div>

      <div className="flex gap-3">
        {fertilizer.items.map((item) => (
          <FertCard key={item.name} item={item} />
        ))}
      </div>

      {/* Net impact summary */}
      <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-700">
        Net input cost impact:{" "}
        <span className={`font-bold ${net > 0 ? "text-amber-400" : "text-green-400"}`}>
          {net > 0 ? "+" : ""}{net.toFixed(1)}/bag vs last month
        </span>
        {" "}· Next application window: {fertilizer.next_application}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/supply/farmer-economics/FertilizerPanel.tsx
git commit -m "feat: FertilizerPanel with sparkline KPI cards and net cost impact"
```

---

## Task 8: BrazilFarmerEconomics layout — wire everything together

**Files:**
- Modify: `frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx`

- [ ] **Step 1: Replace the placeholder with the full layout**

Replace the entire contents of `frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx`:

```tsx
"use client";
import { BRAZIL_FARMER_DATA } from "./farmerEconomicsData";
import ProductionCostPanel from "./ProductionCostPanel";
import AcreageYieldPanel   from "./AcreageYieldPanel";
import WeatherRiskPanel    from "./WeatherRiskPanel";
import EnsoPanel           from "./EnsoPanel";
import FertilizerPanel     from "./FertilizerPanel";

export default function BrazilFarmerEconomics() {
  const d = BRAZIL_FARMER_DATA;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
      {/* ── Left: Fundamentals ─────────────────────────────────── */}
      <div className="space-y-4">
        <ProductionCostPanel cost={d.cost} />
        <AcreageYieldPanel   acreage={d.acreage} yield_={d.yield} />
      </div>

      {/* ── Right: Risk Signals ─────────────────────────────────── */}
      <div className="space-y-4">
        <WeatherRiskPanel weather={d.weather} />
        <EnsoPanel        enso={d.enso} />
        <FertilizerPanel  fertilizer={d.fertilizer} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Visual verification in the browser**

```bash
cd frontend && npm run dev
```

Open http://localhost:3000/supply. Click "Farmer Economics". Verify:

1. Two-column layout renders (stacks to single column on narrow window)
2. **Left column:**
   - Production cost header KPI: `$142 / 60kg bag ▲ 2.1% YoY`
   - Stacked bar with 5 segments, legend with $ and %
   - Blue-bordered inputs sub-breakdown with 5 rows and mini-bars
   - Margin line: `KC spot $302/bag → farmer margin ~$160/bag`
   - Two KPI cards: Acreage `2,240 thousand ha ▲ 1.4%` and Yield `32 bags / ha ▼ 3.2%`
3. **Right column:**
   - Four region cards with frost/drought badges
   - 14-day frost grid (Sul de Minas, Paraná rows, 14 colored cells each)
   - 14-day drought grid (Cerrado, Sul de Minas rows)
   - Dual-line forecast accuracy chart (dashed blue = forecast, solid orange = actual)
   - RMSE line: `RMSE 1.1°C over 7 days`
   - ENSO purple badge: `🌡 El Niño — Moderate · ONI +1.4`
   - ONI bar chart (18 bars, last 3 faded/dashed)
   - 4 regional impact cards with dot-scale badges
   - Three fertilizer KPI cards with sparklines and cost badges
   - Net impact summary line

- [ ] **Step 3: TypeScript check — no type errors**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx
git commit -m "feat: wire BrazilFarmerEconomics layout — Farmer Economics tab complete"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Sub-tab bar (Exports / Farmer Economics) | Task 2 |
| Lazy mount of FarmerEconomics | Task 2 — conditional render only when `subTab === "farmer-economics"` |
| Left/right two-column layout | Task 8 |
| Production cost KPI + stacked bar + legend | Task 3 |
| Inputs sub-breakdown panel with mini-bars | Task 3 |
| Margin line | Task 3 |
| Acreage KPI | Task 4 |
| Yield KPI | Task 4 |
| Weather risk badges per region (frost + drought) | Task 5 |
| 14-day frost daily grid | Task 5 |
| 14-day drought daily grid | Task 5 |
| Forecast accuracy dual-line chart | Task 5 |
| RMSE + source label | Task 5 |
| ENSO phase badge with ONI value | Task 6 |
| ONI bar chart (18 months + 3 forecast) | Task 6 |
| Regional impact dot-scale tags | Task 6 |
| Historical stat line | Task 6 |
| Fertilizer KPI cards with sparklines | Task 7 |
| MoM % change + cost-per-bag impact badge | Task 7 |
| Net cost impact summary line | Task 7 |
| Mock data constant with all TypeScript types | Task 1 |
| Utility function tests | Task 1 |
| Vietnam/Colombia/etc. show "coming soon" | ✅ Already handled — `page.tsx` only renders `<BrazilTab />` for Brazil; other origins show existing placeholder |

**Placeholder scan:** No TBDs, no "implement later" phrases, all code blocks are complete.

**Type consistency check:**
- `FarmerEconomicsData["cost"]` used in `ProductionCostPanel` ✓
- `FarmerEconomicsData["acreage"]` and `["yield"]` used in `AcreageYieldPanel` ✓
- `FarmerEconomicsData["weather"]` used in `WeatherRiskPanel` ✓
- `FarmerEconomicsData["enso"]` used in `EnsoPanel` ✓
- `FarmerEconomicsData["fertilizer"]` used in `FertilizerPanel` ✓
- `computeRmse` imported in `WeatherRiskPanel` from `farmerEconomicsUtils` ✓
- `fertCostDelta`, `netFertImpact` imported in `FertilizerPanel` ✓
- `BRAZIL_FARMER_DATA` imported in `BrazilFarmerEconomics` ✓
