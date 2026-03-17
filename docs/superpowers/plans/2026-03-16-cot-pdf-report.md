# CoT PDF Report Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Download PDF" button to the CoT dashboard that generates a professional 7-page A4 report with charts and template-based commentary for the latest COT week.

**Architecture:** Fully client-side — `@react-pdf/renderer` builds the A4 PDF document in the browser; `html2canvas` captures the 5 Recharts charts as PNG images; derived metrics and template comments are computed as pure functions from data already loaded in React state. No backend changes required.

**Tech Stack:** `@react-pdf/renderer` (PDF generation), `html2canvas` (chart capture), TypeScript, React 18, existing `/api/cot` + `/api/macro-cot` data

---

## Data Model Reference

All data available in `CotDashboard.tsx` state at report time:

```
data[]           — raw COT rows from /api/cot, shape: { date, ny: CotRow, ldn: CotRow }
macroData[]      — macro COT from /api/macro-cot, shape: MacroCotWeek[]
recent52[]       — processed COT with derived fields:
  .priceNY         cents/lb
  .priceLDN        USD/MT
  .oiRank          0-100 (52w rolling percentile of MM net)
  .priceRank       0-100 (52w rolling percentile of price NY)
  .oiRankLDN / .priceRankLDN
  .ny.mmLong/mmShort/mmSpread  (contracts)
  .ny.pmpuLong/pmpuShort
  .ny.swapLong/swapShort
  .ny.otherLong/otherShort / .ny.nonRepLong/nonRepShort
  .tradersNY / .tradersLDN  { pmpu, mm, swap, other, nonrep }
  .pmpuLongMT_NY / .pmpuLongMT_LDN  (MT)
  .pmpuShortMT_NY / .pmpuShortMT_LDN
  .timeframe       "current" | "recent_1" | "recent_4" | "year" | "historical"

Raw api data (cotRows[] — the unprocessed array stored as `data` in state before transformation):
  row.ny.structure_ny  — front spread (M2-M1) in cents/lb — carry/backwardation
  row.ny.exch_oi_ny    — nearby exchange OI (used for nearby vs forward split)
  row.ny.efp_ny        — EFP value
  row.ny.price_ny / row.ny.price_ldn
  NOTE: `recent52` does NOT forward structure_ny / exch_oi_ny. Pass the raw `data` array
  (which maps 1:1 to the /api/cot response) as `rawData` in the handler.
```

Constants already in CotDashboard.tsx:
- `ARABICA_MT_FACTOR = 5.625` (MT per lot)
- `ROBUSTA_MT_FACTOR = 10` (MT per lot)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/lib/pdf/types.ts` | Shared TypeScript interfaces for report data |
| Create | `frontend/lib/pdf/dataHelpers.ts` | Pure functions: derived metrics from COT data |
| Create | `frontend/lib/pdf/comments.ts` | Template comment functions → formatted strings |
| Create | `frontend/lib/pdf/chartCapture.ts` | html2canvas wrapper → PNG data URL |
| Create | `frontend/lib/pdf/PdfReport.tsx` | @react-pdf/renderer A4 document (all 7 pages) |
| Create | `frontend/lib/pdf/pdfStyles.ts` | StyleSheet definitions for @react-pdf |
| Create | `frontend/lib/pdf/__tests__/dataHelpers.test.ts` | Unit tests for dataHelpers |
| Create | `frontend/lib/pdf/__tests__/comments.test.ts` | Unit tests for comments |
| Modify | `frontend/components/futures/CotDashboard.tsx` | Add 5 chart refs + Download PDF button |

---

## Chunk 1: Foundation — Dependencies, Types, Chart Capture

### Task 1: Install dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install packages**

```bash
cd frontend
npm install @react-pdf/renderer html2canvas
npm install --save-dev vitest @vitejs/plugin-react jsdom
```

`html2canvas` ships its own TypeScript declarations — do NOT install `@types/html2canvas` (no such package exists on npm).

Expected: no peer-dep errors. All packages install successfully.

- [ ] **Step 2: Add vitest config**

Create `frontend/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

Add to `frontend/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 3: Verify types are available**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors related to the new packages.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "chore: add @react-pdf/renderer, html2canvas, vitest"
```

---

### Task 2: Create shared types

**Files:**
- Create: `frontend/lib/pdf/types.ts`

- [ ] **Step 1: Create the file**

```typescript
// frontend/lib/pdf/types.ts

export interface MarketMetrics {
  // Identification
  market: "NY Arabica" | "LDN Robusta";
  date: string;             // COT report date e.g. "2026-03-10"

  // OI change
  oiChangeLots: number;     // total WoW delta in lots
  oiChangeNearby: number;   // lots change in first 2 contracts (exch_oi delta)
  oiChangeForward: number;  // lots change in forward contracts (total - nearby delta)

  // Price
  price: number;            // current price (cents/lb for NY, USD/MT for LDN)
  priceUnit: "¢/lb" | "$/MT";
  priceChangePct: number;   // % change WoW
  priceChangeAbs: number;   // absolute change in price units

  // Front structure
  structureValue: number;   // M2 - M1 spread (same unit as price)
  structurePrevValue: number;
  structureType: "carry" | "backwardation"; // positive spread = carry; negative = backwardation
  annualizedRollPct: number; // (structureValue / price) * (365/30) * 100, sign-flipped for carry convention

  // Industry coverage (min/max normalised over 52w history)
  producerCovPct: number;   // ((current - min52w) / (max52w - min52w)) * 100 — position within 52w range
  producerMT: number;       // current PMPU long MT equivalent
  producerMTWoW: number;    // WoW change in MT
  roasterCovPct: number;    // ((current - min52w) / (max52w - min52w)) * 100 — same normalization as producerCovPct
  roasterMT: number;
  roasterMTWoW: number;

  // Managed Money
  mmLong: number;           // current lots
  mmShort: number;
  mmLongChangeLots: number; // WoW delta
  mmShortChangeLots: number;
  mmLongChangePct: number;  // delta / prior * 100
  mmShortChangePct: number;
  fundsMaxedLongPct: number; // mmLong / max(mmLong last 52w) * 100
  fundsMaxedShortPct: number;

  // Risk flags
  obosFlag: "overbought" | "oversold" | "neutral"; // price >75 AND oi >75 = OB; both <25 = OS
  priceRank: number;        // 0-100
  oiRank: number;           // 0-100
  positionMismatch: boolean; // sign(mmLong-mmShort) != sign(t_mm_long - t_mm_short)
  mmConcentrationPct: number; // (mmLong + mmShort) / oi_total * 100

  // Counterparty WoW deltas (lots)
  cp: {
    longs:  { pmpu: number; sd: number; mm: number; or: number; nr: number };
    shorts: { pmpu: number; sd: number; mm: number; or: number; nr: number };
  };
}

export interface GlobalFlowMetrics {
  date: string;
  totalGrossB: number;      // USD billions
  netExpB: number;
  wowDeltaB: number;        // total gross WoW change
  softSharePct: number;     // softs % of total gross
  biggestMoverSector: string;
  biggestMoverDeltaB: number;
  coffeeSharePct: number;   // arabica+robusta combined % of total gross
  coffeeDeltaB: number;     // WoW change in coffee gross exposure
}

export interface ReportData {
  weekNumber: number;       // ISO week number
  year: number;
  cotDate: string;          // "March 10, 2026"
  generatedAt: string;      // ISO timestamp
  globalFlow: GlobalFlowMetrics;
  coffeeOverview: {
    combinedNetLots: number;    // NY mmNet + LDN mmNet
    combinedNetMT: number;
    alignedDirection: boolean;  // NY and LDN net pointing same direction
    nyCombinedOiRank: number;
    ldnCombinedOiRank: number;
  };
  ny: MarketMetrics;
  ldn: MarketMetrics;
  // PNG data URLs for chart images (set during capture phase)
  charts: {
    globalFlow:    string | null;
    structural:    string | null;
    counterparty:  string | null;
    industryPulse: string | null;
    dryPowder:     string | null;
    obosMatrix:    string | null;
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "pdf/types"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/pdf/types.ts
git commit -m "feat(pdf): add ReportData types"
```

---

### Task 3: Chart capture utility

**Files:**
- Create: `frontend/lib/pdf/chartCapture.ts`

- [ ] **Step 1: Create the file**

```typescript
// frontend/lib/pdf/chartCapture.ts
import html2canvas from "html2canvas";

/**
 * Captures a DOM element (typically a Recharts ResponsiveContainer wrapper)
 * as a PNG data URL suitable for embedding in @react-pdf/renderer.
 * Returns null if the ref is not mounted.
 */
export async function captureChartAsPng(
  containerRef: React.RefObject<HTMLDivElement>,
  bgColor = "#0f172a"
): Promise<string | null> {
  if (!containerRef.current) return null;
  try {
    const canvas = await html2canvas(containerRef.current, {
      backgroundColor: bgColor,
      scale: 2,          // 2× for retina-quality in PDF
      logging: false,
      useCORS: true,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Captures all six charts in parallel. Any failed capture returns null
 * (the PDF page will show a placeholder instead of crashing).
 */
export async function captureAllCharts(refs: {
  globalFlow:    React.RefObject<HTMLDivElement>;
  structural:    React.RefObject<HTMLDivElement>;
  counterparty:  React.RefObject<HTMLDivElement>;
  industryPulse: React.RefObject<HTMLDivElement>;
  dryPowder:     React.RefObject<HTMLDivElement>;
  obosMatrix:    React.RefObject<HTMLDivElement>;
}): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    Object.entries(refs).map(async ([key, ref]) => [key, await captureChartAsPng(ref)])
  );
  return Object.fromEntries(entries);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/pdf/chartCapture.ts
git commit -m "feat(pdf): add html2canvas chart capture utility"
```

---

## Chunk 2: Data & Comment Layer

### Task 4: Data helpers — pure derived metrics

**Files:**
- Create: `frontend/lib/pdf/dataHelpers.ts`
- Create: `frontend/lib/pdf/__tests__/dataHelpers.test.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
// frontend/lib/pdf/__tests__/dataHelpers.test.ts
import { describe, it, expect } from "vitest";
import {
  computeAnnualizedRoll,
  computeCovPct,
  computeFundsMaxedPct,
  computeObosFlag,
  computePositionMismatch,
  computeCounterpartyDeltas,
  computeOiSplit,
} from "../dataHelpers";

describe("computeAnnualizedRoll", () => {
  it("returns positive value for carry (M2 > M1)", () => {
    // structure = +5 ¢/lb means M2 is 5 cents above M1 → contango → negative roll
    const roll = computeAnnualizedRoll(5, 300);
    expect(roll).toBeCloseTo(-(5 / 300) * (365 / 30) * 100, 1);
  });
  it("returns positive roll for backwardation (structure < 0)", () => {
    const roll = computeAnnualizedRoll(-5, 300);
    expect(roll).toBeGreaterThan(0);
  });
  it("returns 0 for zero structure", () => {
    expect(computeAnnualizedRoll(0, 300)).toBe(0);
  });
});

describe("computeCovPct", () => {
  it("returns 100% when at historical max", () => {
    expect(computeCovPct(1000, 200, 1000)).toBe(100);
  });
  it("returns 0% when at historical min", () => {
    expect(computeCovPct(200, 200, 1000)).toBe(0);
  });
  it("returns 50% at midpoint", () => {
    expect(computeCovPct(600, 200, 1000)).toBeCloseTo(50, 1);
  });
  it("returns 50 if min === max (no range)", () => {
    expect(computeCovPct(500, 500, 500)).toBe(50);
  });
});

describe("computeFundsMaxedPct", () => {
  it("returns 80 when current is 80% of max", () => {
    expect(computeFundsMaxedPct(80, [50, 60, 70, 80, 100])).toBe(80);
  });
  it("clamps to 100 if current exceeds observed max", () => {
    expect(computeFundsMaxedPct(110, [50, 60, 70, 100])).toBe(100);
  });
});

describe("computeObosFlag", () => {
  it("returns overbought when both ranks > 75", () => {
    expect(computeObosFlag(80, 80)).toBe("overbought");
  });
  it("returns oversold when both ranks < 25", () => {
    expect(computeObosFlag(20, 20)).toBe("oversold");
  });
  it("returns neutral for mixed signals", () => {
    expect(computeObosFlag(80, 40)).toBe("neutral");
    expect(computeObosFlag(10, 80)).toBe("neutral");
  });
});

describe("computePositionMismatch", () => {
  it("detects mismatch: net long in lots but net short in traders", () => {
    expect(computePositionMismatch(100, 50, 10, 20)).toBe(true);
  });
  it("returns false when both aligned net long", () => {
    expect(computePositionMismatch(100, 50, 20, 10)).toBe(false);
  });
  it("returns false when both aligned net short", () => {
    expect(computePositionMismatch(50, 100, 10, 20)).toBe(false);
  });
});

describe("computeOiSplit", () => {
  it("computes nearby and forward delta from exch_oi and total", () => {
    const result = computeOiSplit(
      { oi_total: 170000, exch_oi_ny: 30000 },  // current
      { oi_total: 168000, exch_oi_ny: 29000 }   // previous
    );
    expect(result.total).toBe(2000);
    expect(result.nearby).toBe(1000);
    expect(result.forward).toBe(1000);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (functions not defined)**

```bash
cd frontend && npx vitest run lib/pdf/__tests__/dataHelpers.test.ts 2>&1 | tail -10
```

Expected: all tests fail with import errors.

- [ ] **Step 3: Implement dataHelpers.ts**

```typescript
// frontend/lib/pdf/dataHelpers.ts
import type { MarketMetrics, GlobalFlowMetrics } from "./types";
import type { MacroCotWeek } from "@/lib/api";

// ── Primitive helpers ────────────────────────────────────────────────────────

/** Annualised front roll. Positive = backwardation (roll income). Negative = contango. */
export function computeAnnualizedRoll(structureValue: number, price: number): number {
  if (price === 0) return 0;
  // structure = M2 - M1. Contango (M2 > M1) means you pay on roll → negative income.
  return -(structureValue / price) * (365 / 30) * 100;
}

/** Coverage % normalised on 52-week range. Returns 50 if no range. */
export function computeCovPct(current: number, min52: number, max52: number): number {
  if (max52 === min52) return 50;
  return Math.min(100, Math.max(0, ((current - min52) / (max52 - min52)) * 100));
}

/** Funds % maxed: current / historical max × 100, capped at 100. */
export function computeFundsMaxedPct(current: number, history: number[]): number {
  const max = Math.max(...history);
  if (max === 0) return 0;
  return Math.min(100, (current / max) * 100);
}

/** OB/OS flag: both price AND OI rank must cross threshold. */
export function computeObosFlag(
  priceRank: number,
  oiRank: number
): "overbought" | "oversold" | "neutral" {
  if (priceRank > 75 && oiRank > 75) return "overbought";
  if (priceRank < 25 && oiRank < 25) return "oversold";
  return "neutral";
}

/**
 * Position mismatch: MM are net long in contracts but net short in # traders, or vice versa.
 * mmLong/mmShort = contract lots. tLong/tShort = number of traders.
 */
export function computePositionMismatch(
  mmLong: number, mmShort: number,
  tLong: number, tShort: number
): boolean {
  const lotsSign    = Math.sign(mmLong - mmShort);
  const tradersSign = Math.sign(tLong  - tShort);
  return lotsSign !== 0 && tradersSign !== 0 && lotsSign !== tradersSign;
}

/**
 * OI nearby/forward split.
 * exch_oi_ny = ICE/CBOT nearby OI (first ~2 contracts listed on exchange).
 * forward = total_oi - exch_oi.
 */
export function computeOiSplit(
  current: { oi_total: number; exch_oi_ny?: number | null },
  prev:    { oi_total: number; exch_oi_ny?: number | null }
): { total: number; nearby: number; forward: number } {
  const total   = current.oi_total - prev.oi_total;
  const nearbyC = current.exch_oi_ny ?? 0;
  const nearbyP = prev.exch_oi_ny    ?? 0;
  const nearby  = nearbyC - nearbyP;
  return { total, nearby, forward: total - nearby };
}

// ── High-level builders ──────────────────────────────────────────────────────

// MacroCotEntry.sector values: "hard" | "grains" | "meats" | "softs" | "micros"
// "hard" is split into energy vs metals using ENERGY_SYMS at display time only.
const ENERGY_SYMS = new Set(["wti","brent","natgas","heating_oil","rbob","lsgo"]);
// Display sectors used for biggestMover label
const DISPLAY_SECTORS = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;

export function buildGlobalFlowMetrics(macroData: MacroCotWeek[]): GlobalFlowMetrics | null {
  if (macroData.length < 2) return null;
  const latest = macroData[macroData.length - 1];
  const prev   = macroData[macroData.length - 2];

  // Helper: sum gross exposure for a week
  const sumGross = (week: MacroCotWeek) =>
    week.commodities.reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);
  const totalGross = sumGross(latest);
  const prevGross  = sumGross(prev);

  // Sector breakdowns — map display sector name to actual MacroCotEntry.sector filter
  const sectorGross = (week: MacroCotWeek, displaySector: string) =>
    week.commodities
      .filter(c => {
        if (displaySector === "energy")  return c.sector === "hard" &&  ENERGY_SYMS.has(c.symbol);
        if (displaySector === "metals")  return c.sector === "hard" && !ENERGY_SYMS.has(c.symbol);
        return c.sector === displaySector; // grains | meats | softs | micros match directly
      })
      .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);

  const sectorDeltas = DISPLAY_SECTORS.map(s => ({
    sector: s,
    delta: sectorGross(latest, s) - sectorGross(prev, s),
  }));
  const biggest = sectorDeltas.reduce((a, b) => Math.abs(a.delta) > Math.abs(b.delta) ? a : b);

  const softsGross  = sectorGross(latest, "softs");
  const coffeeGross = latest.commodities
    .filter(c => c.symbol === "arabica" || c.symbol === "robusta")
    .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);
  const coffeePrev = prev.commodities
    .filter(c => c.symbol === "arabica" || c.symbol === "robusta")
    .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);

  const netExp = latest.commodities.reduce((s, c) => s + (c.net_exposure_usd ?? 0), 0);

  return {
    date:               latest.date,
    totalGrossB:        totalGross  / 1e9,
    netExpB:            netExp      / 1e9,
    wowDeltaB:          (totalGross - prevGross) / 1e9,
    softSharePct:       totalGross > 0 ? (softsGross / totalGross) * 100 : 0,
    biggestMoverSector: biggest.sector,
    biggestMoverDeltaB: biggest.delta / 1e9,
    coffeeSharePct:     totalGross > 0 ? (coffeeGross / totalGross) * 100 : 0,
    coffeeDeltaB:       (coffeeGross - coffeePrev) / 1e9,
  };
}

/**
 * Build MarketMetrics for one market (ny or ldn) from the processed recent52 array
 * and the raw data[] array.
 *
 * @param recent52  — processed rows from CotDashboard (has priceRank, oiRank, tradersNY/LDN, etc.)
 * @param rawData   — raw rows from /api/cot (has structure_ny, exch_oi_ny, efp_ny, etc.)
 * @param market    — "ny" | "ldn"
 */
export function buildMarketMetrics(
  recent52: any[],
  rawData:  any[],
  market:   "ny" | "ldn"
): MarketMetrics | null {
  if (recent52.length < 2 || rawData.length < 2) return null;

  const cur  = recent52[recent52.length - 1];
  const prev = recent52[recent52.length - 2];
  const rawCur  = rawData[rawData.length - 1];
  const rawPrev = rawData[rawData.length - 2];

  const isNY = market === "ny";
  const mf   = isNY ? "NY" : "LDN";        // suffix for tradersNY/tradersLDN
  const mk   = isNY ? "ny" : "ldn";        // key in raw data and in cur/prev
  const MT_FACTOR = isNY ? 5.625 : 10;

  const price      = isNY ? cur.priceNY  : cur.priceLDN;
  const prevPrice  = isNY ? prev.priceNY : prev.priceLDN;
  const priceUnit  = isNY ? "¢/lb" : "$/MT" as "¢/lb" | "$/MT";

  const curNY  = cur[mk];   // the ny/ldn sub-object from processed data
  const prevNY = prev[mk];

  // OI split
  const rawMk = rawCur?.[mk];
  const rawPMk = rawPrev?.[mk];
  const oiSplit = rawMk && rawPMk
    ? computeOiSplit(
        { oi_total: rawMk.oi_total ?? 0,  exch_oi_ny: isNY ? rawMk.exch_oi_ny  : rawMk.exch_oi_ldn  },
        { oi_total: rawPMk.oi_total ?? 0, exch_oi_ny: isNY ? rawPMk.exch_oi_ny : rawPMk.exch_oi_ldn }
      )
    : { total: 0, nearby: 0, forward: 0 };

  // Structure / roll
  const structureValue     = isNY ? (rawMk?.structure_ny ?? 0) : (rawMk?.structure_ldn ?? 0);
  const structurePrevValue = isNY ? (rawPMk?.structure_ny ?? 0) : (rawPMk?.structure_ldn ?? 0);
  const annualizedRollPct  = computeAnnualizedRoll(structureValue, price);

  // PMPU MT (industry coverage) — normalize over 52w
  const pmpuLongMTs  = recent52.map(d => (isNY ? d.pmpuLongMT_NY  : d.pmpuLongMT_LDN)  ?? 0);
  const pmpuShortMTs = recent52.map(d => (isNY ? d.pmpuShortMT_NY : d.pmpuShortMT_LDN) ?? 0);
  const prodMT    = isNY ? cur.pmpuLongMT_NY  : cur.pmpuLongMT_LDN;
  const roastMT   = isNY ? cur.pmpuShortMT_NY : cur.pmpuShortMT_LDN;
  const prodMTPrev  = isNY ? prev.pmpuLongMT_NY  : prev.pmpuLongMT_LDN;
  const roastMTPrev = isNY ? prev.pmpuShortMT_NY : prev.pmpuShortMT_LDN;

  // Funds maxed
  const mmLongs  = recent52.map(d => d[mk].mmLong  ?? 0);
  const mmShorts = recent52.map(d => d[mk].mmShort ?? 0);

  // Counterparty deltas (lots WoW)
  const cpDelta = (field: string, side: "long" | "short") => {
    const k = field + (side === "long" ? "Long" : "Short");
    return (cur[mk][k] ?? 0) - (prev[mk][k] ?? 0);
  };

  // Trader counts
  // tradersNY/LDN currently stores t_mm_long under key "mm" (long-side count only).
  // t_mm_short is available in the raw COT row as row.ny.t_mm_short.
  // Use rawCur for the short trader count to correctly detect position mismatch.
  const traders        = isNY ? cur.tradersNY  : cur.tradersLDN;
  const tMmLong  = traders?.mm ?? 0;
  // Both NY and LDN raw rows store the MM short trader count under "t_mm_short".
  const tMmShort = rawMk?.t_mm_short ?? 0;

  return {
    market:   isNY ? "NY Arabica" : "LDN Robusta",
    date:     cur.date,

    oiChangeLots:    oiSplit.total,
    oiChangeNearby:  oiSplit.nearby,
    oiChangeForward: oiSplit.forward,

    price,
    priceUnit,
    priceChangePct:  prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0,
    priceChangeAbs:  price - prevPrice,

    structureValue,
    structurePrevValue,
    structureType:    structureValue <= 0 ? "backwardation" : "carry",
    annualizedRollPct,

    // Coverage %: PMPU position normalised on 52-week min/max range (0% = 52w low, 100% = 52w high)
    producerCovPct:  computeCovPct(prodMT,  Math.min(...pmpuLongMTs),  Math.max(...pmpuLongMTs)),
    producerMT:      prodMT,
    producerMTWoW:   prodMT - prodMTPrev,
    roasterCovPct:   computeCovPct(roastMT, Math.min(...pmpuShortMTs), Math.max(...pmpuShortMTs)),
    roasterMT:       roastMT,
    roasterMTWoW:    roastMT - roastMTPrev,

    mmLong:             curNY.mmLong,
    mmShort:            curNY.mmShort,
    mmLongChangeLots:   cpDelta("mm", "long"),
    mmShortChangeLots:  cpDelta("mm", "short"),
    mmLongChangePct:    prevNY.mmLong > 0 ? (cpDelta("mm","long")  / prevNY.mmLong)  * 100 : 0,
    mmShortChangePct:   prevNY.mmShort> 0 ? (cpDelta("mm","short") / prevNY.mmShort) * 100 : 0,
    fundsMaxedLongPct:  computeFundsMaxedPct(curNY.mmLong,  mmLongs),
    fundsMaxedShortPct: computeFundsMaxedPct(curNY.mmShort, mmShorts),

    obosFlag: computeObosFlag(
      isNY ? cur.priceRank : cur.priceRankLDN,
      isNY ? cur.oiRank    : cur.oiRankLDN
    ),
    priceRank:          isNY ? cur.priceRank    : cur.priceRankLDN,
    oiRank:             isNY ? cur.oiRank       : cur.oiRankLDN,
    // tMmLong = long-side trader count; tMmShort = short-side from raw row
    positionMismatch:   computePositionMismatch(curNY.mmLong, curNY.mmShort, tMmLong, tMmShort),
    mmConcentrationPct: (curNY.oi_total ?? 0) > 0
      ? ((curNY.mmLong + curNY.mmShort) / (curNY.oi_total ?? 1)) * 100
      : 0,

    cp: {
      longs:  { pmpu: cpDelta("pmpu","long"),  sd: cpDelta("swap","long"),  mm: cpDelta("mm","long"),  or: cpDelta("other","long"),  nr: cpDelta("nonRep","long")  },
      shorts: { pmpu: cpDelta("pmpu","short"), sd: cpDelta("swap","short"), mm: cpDelta("mm","short"), or: cpDelta("other","short"), nr: cpDelta("nonRep","short") },
    },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx vitest run lib/pdf/__tests__/dataHelpers.test.ts
```

Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/pdf/dataHelpers.ts frontend/lib/pdf/__tests__/dataHelpers.test.ts
git commit -m "feat(pdf): add COT data helpers with tests"
```

---

### Task 5: Template comment functions

**Files:**
- Create: `frontend/lib/pdf/comments.ts`
- Create: `frontend/lib/pdf/__tests__/comments.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// frontend/lib/pdf/__tests__/comments.test.ts
import { describe, it, expect } from "vitest";
import {
  globalFlowComment,
  marketOverviewComment,
  structuralComment,
  counterpartyComment,
  industryPulseComment,
  dryPowderComment,
  obosComment,
} from "../comments";
import type { GlobalFlowMetrics, MarketMetrics } from "../types";

const mockFlow: GlobalFlowMetrics = {
  date: "2026-03-10", totalGrossB: 142, netExpB: 18,
  wowDeltaB: 4.2, softSharePct: 14, biggestMoverSector: "softs",
  biggestMoverDeltaB: 2.1, coffeeSharePct: 6.2, coffeeDeltaB: 0.8,
};

describe("globalFlowComment", () => {
  it("mentions total gross and biggest mover", () => {
    const c = globalFlowComment(mockFlow);
    expect(c).toContain("$142");
    expect(c).toContain("softs");
  });
  it("flags coffee contribution", () => {
    expect(globalFlowComment(mockFlow)).toContain("coffee");
  });
});

const mockNY: Partial<MarketMetrics> = {
  market: "NY Arabica", oiChangeLots: -2400, oiChangeNearby: -3000, oiChangeForward: 600,
  priceChangePct: 4.5, priceChangeAbs: 12.7, priceUnit: "¢/lb",
  structureType: "backwardation", annualizedRollPct: 9.8,
  mmLongChangeLots: 600, mmLongChangePct: 1.5,
  mmShortChangeLots: -1600, mmShortChangePct: -7.9,
  fundsMaxedLongPct: 46.3, fundsMaxedShortPct: 13.1,
  obosFlag: "neutral", priceRank: 55, oiRank: 62,
  positionMismatch: false, mmConcentrationPct: 34,
};

describe("marketOverviewComment", () => {
  it("includes OI change and price change", () => {
    const c = marketOverviewComment(mockNY as MarketMetrics);
    expect(c).toContain("2.4k");
    expect(c).toContain("4.5%");
  });
  it("mentions backwardation", () => {
    expect(marketOverviewComment(mockNY as MarketMetrics)).toContain("backwardation");
  });
});

describe("obosComment", () => {
  it("flags overbought condition", () => {
    const m = { ...mockNY, obosFlag: "overbought", priceRank: 80, oiRank: 82 } as MarketMetrics;
    expect(obosComment(m)).toContain("overbought");
  });
  it("flags position mismatch", () => {
    const m = { ...mockNY, positionMismatch: true } as MarketMetrics;
    expect(obosComment(m)).toContain("mismatch");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd frontend && npx vitest run lib/pdf/__tests__/comments.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement comments.ts**

```typescript
// frontend/lib/pdf/comments.ts
import type { GlobalFlowMetrics, MarketMetrics } from "./types";

const RISK_FREE_RATE = 4.1; // % — update manually if needed
const fmt1 = (n: number) => Math.abs(n).toFixed(1);
const fmt0 = (n: number) => Math.abs(n).toFixed(0);
const sign = (n: number) => (n >= 0 ? "+" : "−");
const kLots = (n: number) => `${sign(n)}${fmt1(n / 1000)}k lots`;
const pct = (n: number) => `${sign(n)}${fmt1(n)}%`;

// ── Page 1: Global Money Flow ─────────────────────────────────────────────────
export function globalFlowComment(g: GlobalFlowMetrics): string {
  const dir   = g.wowDeltaB >= 0 ? "expanded" : "contracted";
  const mover = g.biggestMoverSector.charAt(0).toUpperCase() + g.biggestMoverSector.slice(1);
  const cofDir = g.coffeeDeltaB >= 0 ? "rose" : "fell";
  return (
    `Speculative gross exposure ${dir} by $${fmt1(Math.abs(g.wowDeltaB))}B to ` +
    `$${fmt1(g.totalGrossB)}B this week. ${mover} led the move ` +
    `(${sign(g.biggestMoverDeltaB)}$${fmt1(Math.abs(g.biggestMoverDeltaB))}B). ` +
    `Coffee's combined exposure ${cofDir} by $${fmt1(Math.abs(g.coffeeDeltaB))}B, ` +
    `representing ${fmt1(g.coffeeSharePct)}% of total gross speculative flow.`
  );
}

// ── Page 2: Coffee Combined Overview ─────────────────────────────────────────
export function coffeeOverviewComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const nyDir  = ny.mmLong - ny.mmShort > 0 ? "net long" : "net short";
  const ldnDir = ldn.mmLong - ldn.mmShort > 0 ? "net long" : "net short";
  const aligned = nyDir === ldnDir;
  const signal  = aligned
    ? `Both contracts are ${nyDir} — directional signals are aligned.`
    : `NY is ${nyDir} while LDN is ${ldnDir} — contracts diverge in direction.`;
  return (
    `NY Arabica MM ${nyDir} at ${fmt0(Math.abs(ny.mmLong - ny.mmShort))} lots; ` +
    `LDN Robusta MM ${ldnDir} at ${fmt0(Math.abs(ldn.mmLong - ldn.mmShort))} lots. ${signal}`
  );
}

// ── Pages 3-4: Per-market overview ───────────────────────────────────────────
export function marketOverviewComment(m: MarketMetrics): string {
  const oiDir  = m.oiChangeLots >= 0 ? "added" : "shed";
  const pDir   = m.priceChangePct >= 0 ? "rose" : "fell";
  const struct = m.structureType === "backwardation"
    ? `market is inverted at ${fmt1(Math.abs(m.annualizedRollPct))}% annualised roll (vs ${RISK_FREE_RATE}% RFR)`
    : `front structure in carry at ${fmt1(Math.abs(m.annualizedRollPct))}% annualised roll`;
  return (
    `Total OI ${oiDir} ${fmt1(Math.abs(m.oiChangeLots / 1000))}k lots ` +
    `(nearby: ${kLots(m.oiChangeNearby)}, forward: ${kLots(m.oiChangeForward)}). ` +
    `Price ${pDir} ${fmt1(Math.abs(m.priceChangePct))}% (${sign(m.priceChangeAbs)}${fmt1(Math.abs(m.priceChangeAbs))} ${m.priceUnit}) on the COT week. ` +
    `${struct.charAt(0).toUpperCase() + struct.slice(1)}.`
  );
}

export function industryCoverageComment(m: MarketMetrics): string {
  const pDir = m.producerMTWoW >= 0 ? "increased" : "decreased";
  const rDir = m.roasterMTWoW  >= 0 ? "increased" : "decreased";
  return (
    `Producers' coverage at ${fmt1(m.producerCovPct)}% of 52-week range ` +
    `(${fmt0(m.producerMT / 1000)}k MT, ${pDir} ${fmt0(Math.abs(m.producerMTWoW / 1000))}k MT WoW). ` +
    `Roasters at ${fmt1(m.roasterCovPct)}% of range ` +
    `(${fmt0(m.roasterMT / 1000)}k MT, ${rDir} ${fmt0(Math.abs(m.roasterMTWoW / 1000))}k MT WoW).`
  );
}

export function mmPositioningComment(m: MarketMetrics): string {
  const lDir = m.mmLongChangeLots  >= 0 ? "increasing longs"  : "liquidating longs";
  const sDir = m.mmShortChangeLots >= 0 ? "increasing shorts" : "liquidating shorts";
  const rollSignal = m.annualizedRollPct > RISK_FREE_RATE
    ? `Roll above RFR — further long building likely.`
    : `Roll below RFR — less incentive to add longs.`;
  return (
    `MM ${lDir} (${kLots(m.mmLongChangeLots)} / ${pct(m.mmLongChangePct)} of position) ` +
    `and ${sDir} (${kLots(m.mmShortChangeLots)} / ${pct(m.mmShortChangePct)} of position). ` +
    `Funds ${fmt1(m.fundsMaxedLongPct)}% maxed on longs, ${fmt1(m.fundsMaxedShortPct)}% on shorts. ${rollSignal}`
  );
}

export function obosComment(m: MarketMetrics): string {
  const flagStr =
    m.obosFlag === "overbought" ? `⚠ OVERBOUGHT — price rank ${fmt1(m.priceRank)}th, OI rank ${fmt1(m.oiRank)}th percentile.` :
    m.obosFlag === "oversold"   ? `⚠ OVERSOLD — price rank ${fmt1(m.priceRank)}th, OI rank ${fmt1(m.oiRank)}th percentile.` :
    `No extreme signal — price rank ${fmt1(m.priceRank)}th, OI rank ${fmt1(m.oiRank)}th percentile.`;
  const mismatch = m.positionMismatch
    ? ` ⚠ Position mismatch detected (MM net direction differs between lots and trader count).`
    : "";
  const conc = m.mmConcentrationPct > 40
    ? ` ⚠ MM concentration at ${fmt1(m.mmConcentrationPct)}% of OI — elevated.`
    : ` MM concentration ${fmt1(m.mmConcentrationPct)}% of OI.`;
  return flagStr + mismatch + conc;
}

// ── Chart micro-comments ──────────────────────────────────────────────────────

export function structuralComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const nyConc = ny.mmConcentrationPct > 40 ? "elevated" : "normal";
  return `MM share of total OI: NY ${fmt1(ny.mmConcentrationPct)}% (${nyConc}), LDN ${fmt1(ldn.mmConcentrationPct)}%. No structural concentration risk flagged.`;
}

export function counterpartyComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const absMax = (obj: Record<string, number>) =>
    Object.entries(obj).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const nyBigLong  = absMax(ny.cp.longs  as any);
  const nyBigShort = absMax(ny.cp.shorts as any);
  return (
    `NY: largest long move from ${nyBigLong[0].toUpperCase()} (${kLots(nyBigLong[1])}), ` +
    `largest short move from ${nyBigShort[0].toUpperCase()} (${kLots(nyBigShort[1])}). ` +
    `Handshake balance reflects normal market-making activity.`
  );
}

export function industryPulseComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const dir = (ny.producerMTWoW + ldn.producerMTWoW) >= 0 ? "increasing" : "reducing";
  return (
    `Producers are ${dir} gross long hedges across NY and LDN. ` +
    `Combined PMPU coverage at ${fmt1((ny.producerCovPct + ldn.producerCovPct) / 2)}% of 52-week range.`
  );
}

export function dryPowderComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const nyFull = ny.fundsMaxedLongPct > 80 ? "limited" : "available";
  const ldnFull = ldn.fundsMaxedLongPct > 80 ? "limited" : "available";
  return (
    `NY dry powder ${nyFull} — funds ${fmt1(ny.fundsMaxedLongPct)}% maxed on longs. ` +
    `LDN dry powder ${ldnFull} — funds ${fmt1(ldn.fundsMaxedLongPct)}% maxed on longs.`
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd frontend && npx vitest run lib/pdf/__tests__/comments.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/pdf/comments.ts frontend/lib/pdf/__tests__/comments.test.ts
git commit -m "feat(pdf): add template comment functions with tests"
```

---

## Chunk 3: PDF Document

### Task 6: PDF styles

**Files:**
- Create: `frontend/lib/pdf/pdfStyles.ts`

- [ ] **Step 1: Create styles**

```typescript
// frontend/lib/pdf/pdfStyles.ts
import { StyleSheet } from "@react-pdf/renderer";

export const BRAND = {
  amber:     "#d97706",
  dark:      "#111827",
  slate800:  "#1e293b",
  slate600:  "#475569",
  slate400:  "#94a3b8",
  slate200:  "#e2e8f0",
  white:     "#ffffff",
  green:     "#059669",
  red:       "#dc2626",
  orange:    "#ea580c",
};

export const S = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    paddingTop: 36, paddingBottom: 48,
    paddingLeft: 40, paddingRight: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1e293b",
  },

  // ── Header bar ──
  headerBar: {
    backgroundColor: BRAND.dark,
    marginHorizontal: -40,
    marginTop: -36,
    paddingHorizontal: 40,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  headerTitle:  { color: BRAND.amber, fontSize: 12, fontFamily: "Helvetica-Bold" },
  headerSub:    { color: BRAND.slate400, fontSize: 8 },

  // ── Section headings ──
  sectionTitle: {
    fontSize: 11, fontFamily: "Helvetica-Bold",
    color: BRAND.dark, borderBottomWidth: 1.5,
    borderBottomColor: BRAND.amber, paddingBottom: 3,
    marginBottom: 8,
  },
  subTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: BRAND.slate600, marginBottom: 4, marginTop: 6 },

  // ── Comment boxes ──
  commentBox: {
    backgroundColor: "#f8fafc",
    border: "1pt solid #e2e8f0",
    borderRadius: 3,
    padding: 7,
    marginTop: 6,
    marginBottom: 8,
  },
  commentText: { fontSize: 8, color: "#374151", lineHeight: 1.5 },
  commentSignal: { fontSize: 8, color: BRAND.amber, fontFamily: "Helvetica-Bold", lineHeight: 1.5 },

  // ── KPI pills ──
  kpiRow:   { flexDirection: "row", gap: 8, marginBottom: 12 },
  kpiPill:  { flex: 1, backgroundColor: BRAND.dark, borderRadius: 4, padding: "6 8", alignItems: "center" },
  kpiLabel: { fontSize: 7, color: BRAND.slate400, textTransform: "uppercase", marginBottom: 2 },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: BRAND.white },
  kpiSub:   { fontSize: 7, color: BRAND.slate600, marginTop: 1 },

  // ── 2-column layout ──
  row:      { flexDirection: "row", gap: 12 },
  col:      { flex: 1 },

  // ── Metric rows in deep dive ──
  metricRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  metricLabel: { fontSize: 8, color: BRAND.slate600 },
  metricValue: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.dark },
  flagRed:     { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.red },
  flagGreen:   { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.green },
  flagAmber:   { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.amber },

  // ── Chart image ──
  chartImg: { width: "100%", objectFit: "contain", marginVertical: 6 },
  chartCaption: { fontSize: 7.5, color: BRAND.slate400, marginTop: 2, marginBottom: 8, textAlign: "center" },

  // ── Footer ──
  footer: {
    position: "absolute", bottom: 18, left: 40, right: 40,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 7, color: BRAND.slate400,
    borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 4,
  },

  // ── Cover ──
  coverTitle:  { fontSize: 28, fontFamily: "Helvetica-Bold", color: BRAND.dark, marginBottom: 4 },
  coverWeek:   { fontSize: 14, color: BRAND.slate600, marginBottom: 2 },
  coverDate:   { fontSize: 10, color: BRAND.slate400, marginBottom: 24 },
  coverDivider:{ height: 2, backgroundColor: BRAND.amber, marginBottom: 16 },

  // ── Disclaimer ──
  disclaimerTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BRAND.dark, marginBottom: 8 },
  disclaimerText:  { fontSize: 7.5, color: BRAND.slate600, lineHeight: 1.5, marginBottom: 6 },
});
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/pdf/pdfStyles.ts
git commit -m "feat(pdf): add PDF stylesheet"
```

---

### Task 7: PDF document — all pages

**Files:**
- Create: `frontend/lib/pdf/PdfReport.tsx`

This is the full `@react-pdf/renderer` document. It composes all pages using the data types and styles already defined.

- [ ] **Step 1: Create PdfReport.tsx**

```tsx
// frontend/lib/pdf/PdfReport.tsx
// NOTE: This file must only be imported via dynamic import() — never in SSR context.
import React from "react";
import {
  Document, Page, View, Text, Image, Link,
} from "@react-pdf/renderer";
import { S, BRAND } from "./pdfStyles";
import type { ReportData, MarketMetrics } from "./types";
import {
  globalFlowComment, coffeeOverviewComment,
  marketOverviewComment, industryCoverageComment,
  mmPositioningComment, obosComment,
  structuralComment, counterpartyComment,
  industryPulseComment, dryPowderComment,
} from "./comments";

// ── Shared micro-components ──────────────────────────────────────────────────

function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={S.headerBar}>
      <Text style={S.headerTitle}>☕ COFFEE INTEL — COT REPORT</Text>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={S.headerTitle}>{title}</Text>
        <Text style={S.headerSub}>{sub}</Text>
      </View>
    </View>
  );
}

function PageFooter({ page, total, date }: { page: number; total: number; date: string }) {
  return (
    <View style={S.footer}>
      <Text>Generated {date} · Data: CFTC, ICE Europe, yfinance</Text>
      <Text>Page {page} of {total}</Text>
    </View>
  );
}

function CommentBox({ text, isSignal = false }: { text: string; isSignal?: boolean }) {
  return (
    <View style={S.commentBox}>
      <Text style={isSignal ? S.commentSignal : S.commentText}>{text}</Text>
    </View>
  );
}

function MetricRow({ label, value, flag }: { label: string; value: string; flag?: "red" | "green" | "amber" }) {
  const style = flag === "red" ? S.flagRed : flag === "green" ? S.flagGreen : flag === "amber" ? S.flagAmber : S.metricValue;
  return (
    <View style={S.metricRow}>
      <Text style={S.metricLabel}>{label}</Text>
      <Text style={style}>{value}</Text>
    </View>
  );
}

function KpiPill({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={S.kpiPill}>
      <Text style={S.kpiLabel}>{label}</Text>
      <Text style={[S.kpiValue, color ? { color } : {}]}>{value}</Text>
      {sub && <Text style={S.kpiSub}>{sub}</Text>}
    </View>
  );
}

// ── Market deep-dive column (used for both NY and LDN) ───────────────────────

function MarketColumn({ m }: { m: MarketMetrics }) {
  const s = (n: number, dec = 1) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(dec);
  const kl = (n: number) => `${s(n / 1000)}k lots`;

  return (
    <View style={S.col}>
      <Text style={S.sectionTitle}>{m.market}</Text>

      {/* Overview */}
      <Text style={S.subTitle}>OVERVIEW</Text>
      <MetricRow label="Total OI change"   value={kl(m.oiChangeLots)} />
      <MetricRow label="  → Nearby (M1+M2)" value={kl(m.oiChangeNearby)} />
      <MetricRow label="  → Forward (M3+)"  value={kl(m.oiChangeForward)} />
      <MetricRow label="Price change"       value={`${s(m.priceChangePct)}% (${s(m.priceChangeAbs, 1)} ${m.priceUnit})`} />
      <MetricRow
        label="Front structure"
        value={`${m.structureType} · roll ${s(m.annualizedRollPct)}% (RFR 4.1%)`}
        flag={m.structureType === "backwardation" && m.annualizedRollPct > 4.1 ? "green" : "amber"}
      />
      <CommentBox text={marketOverviewComment(m)} />

      {/* Industry */}
      <Text style={S.subTitle}>INDUSTRY COVERAGE</Text>
      <MetricRow label="Producers (PMPU Long)" value={`${m.producerCovPct.toFixed(1)}% · ${(m.producerMT/1000).toFixed(0)}k MT`} />
      <MetricRow label="  WoW"                  value={`${s(m.producerMTWoW/1000)}k MT`} />
      <MetricRow label="Roasters (PMPU Short)"  value={`${m.roasterCovPct.toFixed(1)}% · ${(m.roasterMT/1000).toFixed(0)}k MT`} />
      <MetricRow label="  WoW"                  value={`${s(m.roasterMTWoW/1000)}k MT`} />
      <CommentBox text={industryCoverageComment(m)} />

      {/* MM Positioning */}
      <Text style={S.subTitle}>MANAGED MONEY</Text>
      <MetricRow label="MM Longs"  value={`${(m.mmLong/1000).toFixed(1)}k (${s(m.mmLongChangeLots/1000)}k / ${s(m.mmLongChangePct)}%)`} />
      <MetricRow label="MM Shorts" value={`${(m.mmShort/1000).toFixed(1)}k (${s(m.mmShortChangeLots/1000)}k / ${s(m.mmShortChangePct)}%)`} />
      <MetricRow label="Funds maxed (longs)"  value={`${m.fundsMaxedLongPct.toFixed(1)}%`}  flag={m.fundsMaxedLongPct  > 80 ? "red" : undefined} />
      <MetricRow label="Funds maxed (shorts)" value={`${m.fundsMaxedShortPct.toFixed(1)}%`} flag={m.fundsMaxedShortPct > 80 ? "red" : undefined} />
      <CommentBox text={mmPositioningComment(m)} />

      {/* Risk flags */}
      <Text style={S.subTitle}>RISK FLAGS</Text>
      <MetricRow
        label="OB/OS"
        value={m.obosFlag === "overbought" ? "⚠ OVERBOUGHT" : m.obosFlag === "oversold" ? "⚠ OVERSOLD" : "Neutral"}
        flag={m.obosFlag !== "neutral" ? "red" : "green"}
      />
      <MetricRow label="  Price rank"  value={`${m.priceRank.toFixed(1)}th pctl`} />
      <MetricRow label="  OI rank"     value={`${m.oiRank.toFixed(1)}th pctl`} />
      <MetricRow
        label="Position mismatch"
        value={m.positionMismatch ? "⚠ YES" : "None"}
        flag={m.positionMismatch ? "red" : "green"}
      />
      <MetricRow
        label="MM concentration"
        value={`${m.mmConcentrationPct.toFixed(1)}% of OI`}
        flag={m.mmConcentrationPct > 40 ? "amber" : undefined}
      />
      <CommentBox text={obosComment(m)} isSignal />

      {/* Counterparty */}
      <Text style={S.subTitle}>COUNTERPARTY (WoW ΔLOTS)</Text>
      {(["pmpu","sd","mm","or","nr"] as const).map(cat => {
        const longV  = (m.cp.longs  as any)[cat] ?? 0;
        const shortV = (m.cp.shorts as any)[cat] ?? 0;
        if (longV === 0 && shortV === 0) return null;
        const labels: Record<string, string> = { pmpu: "PMPU", sd: "Swap Dealers", mm: "Managed Money", or: "Other Rep.", nr: "Non-Rep." };
        return (
          <MetricRow
            key={cat}
            label={labels[cat]}
            value={`L: ${s(longV/1000)}k  |  S: ${s(shortV/1000)}k`}
          />
        );
      })}
    </View>
  );
}

// ── Chart page helper ─────────────────────────────────────────────────────────

function ChartBlock({ title, src, comment }: { title: string; src: string | null; comment: string }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={S.subTitle}>{title}</Text>
      {src
        ? <Image style={S.chartImg} src={src} />
        : <View style={{ height: 80, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 8, color: "#94a3b8" }}>Chart unavailable</Text>
          </View>
      }
      <CommentBox text={comment} />
    </View>
  );
}

// ── Main document ─────────────────────────────────────────────────────────────

export function CotPdfReport({ d }: { d: ReportData }) {
  const ts = d.generatedAt.slice(0, 10);
  const header = `Week ${d.weekNumber}/${d.year} · ${d.cotDate}`;
  const totalPages = 7;

  return (
    <Document
      title={`COT Report — Week ${d.weekNumber}/${d.year}`}
      author="Coffee Intel Map"
      subject="Weekly Commitments of Traders"
    >

      {/* ── Page 1: Cover + Global Money Flow ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="GLOBAL MONEY FLOW" sub={header} />

        {/* Cover block */}
        <View style={{ marginBottom: 16 }}>
          <Text style={S.coverTitle}>COT Weekly</Text>
          <Text style={S.coverWeek}>Week {d.weekNumber}/{d.year}</Text>
          <Text style={S.coverDate}>As per positioning of {d.cotDate}</Text>
          <View style={S.coverDivider} />
        </View>

        {/* KPIs */}
        <View style={S.kpiRow}>
          <KpiPill label="Total Gross" value={`$${d.globalFlow.totalGrossB.toFixed(1)}B`} sub={`${d.globalFlow.wowDeltaB >= 0 ? "+" : ""}${d.globalFlow.wowDeltaB.toFixed(1)}B WoW`} color={d.globalFlow.wowDeltaB >= 0 ? BRAND.green : BRAND.red} />
          <KpiPill label="Net Exposure" value={`$${d.globalFlow.netExpB.toFixed(1)}B`} />
          <KpiPill label="Softs Share" value={`${d.globalFlow.softSharePct.toFixed(1)}%`} />
          <KpiPill label="Coffee Share" value={`${d.globalFlow.coffeeSharePct.toFixed(1)}%`} sub={`${d.globalFlow.coffeeDeltaB >= 0 ? "+" : ""}${d.globalFlow.coffeeDeltaB.toFixed(1)}B WoW`} />
        </View>

        {/* Chart */}
        {d.charts.globalFlow && <Image style={S.chartImg} src={d.charts.globalFlow} />}

        {/* Comments */}
        <CommentBox text={globalFlowComment(d.globalFlow)} />

        <PageFooter page={1} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 2: Coffee Combined Overview ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="COFFEE OVERVIEW" sub={header} />
        <Text style={S.sectionTitle}>Coffee — Combined NY + LDN</Text>

        <View style={S.kpiRow}>
          <KpiPill label="NY OI Rank"  value={`${d.coffeeOverview.nyCombinedOiRank.toFixed(0)}th pctl`}  color={d.coffeeOverview.nyCombinedOiRank  > 75 ? BRAND.red : d.coffeeOverview.nyCombinedOiRank  < 25 ? BRAND.green : BRAND.white} />
          <KpiPill label="LDN OI Rank" value={`${d.coffeeOverview.ldnCombinedOiRank.toFixed(0)}th pctl`} color={d.coffeeOverview.ldnCombinedOiRank > 75 ? BRAND.red : d.coffeeOverview.ldnCombinedOiRank < 25 ? BRAND.green : BRAND.white} />
          <KpiPill label="Combined Net" value={`${(d.coffeeOverview.combinedNetLots / 1000).toFixed(1)}k lots`} color={d.coffeeOverview.combinedNetLots >= 0 ? BRAND.green : BRAND.red} />
          <KpiPill label="Alignment" value={d.coffeeOverview.alignedDirection ? "✓ Aligned" : "⚠ Diverging"} color={d.coffeeOverview.alignedDirection ? BRAND.green : BRAND.amber} />
        </View>

        <CommentBox text={coffeeOverviewComment(d.ny, d.ldn)} isSignal />

        {/* Preview rows for each market */}
        <View style={[S.row, { marginTop: 12 }]}>
          {[d.ny, d.ldn].map(m => (
            <View key={m.market} style={S.col}>
              <Text style={S.sectionTitle}>{m.market}</Text>
              <MetricRow label="OI change"      value={`${(m.oiChangeLots >= 0 ? "+" : "−")}${Math.abs(m.oiChangeLots/1000).toFixed(1)}k lots`} />
              <MetricRow label="Price change"   value={`${m.priceChangePct >= 0 ? "+" : "−"}${Math.abs(m.priceChangePct).toFixed(1)}%`} />
              <MetricRow label="Front structure" value={m.structureType} flag={m.structureType === "backwardation" ? "green" : "amber"} />
              <MetricRow label="MM net"          value={`${((m.mmLong - m.mmShort) >= 0 ? "+" : "−")}${Math.abs((m.mmLong - m.mmShort)/1000).toFixed(1)}k lots`} />
              <MetricRow label="OB/OS"           value={m.obosFlag} flag={m.obosFlag === "overbought" ? "red" : m.obosFlag === "oversold" ? "green" : undefined} />
            </View>
          ))}
        </View>

        <Text style={{ fontSize: 7, color: BRAND.slate400, marginTop: 12 }}>
          → Full breakdown on following pages
        </Text>

        <PageFooter page={2} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 3: Arabica (NY) Deep Dive ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="NY ARABICA" sub={header} />
        <MarketColumn m={d.ny} />
        <PageFooter page={3} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 4: Robusta (LDN) Deep Dive ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="LDN ROBUSTA" sub={header} />
        <MarketColumn m={d.ldn} />
        <PageFooter page={4} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 5: Charts — Structural, Counterparty, Industry ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="MARKET STRUCTURE CHARTS" sub={header} />
        <ChartBlock
          title="Structural Integrity — OI Composition by Category"
          src={d.charts.structural}
          comment={structuralComment(d.ny, d.ldn)}
        />
        <ChartBlock
          title="Counterparty Mapping — Liquidity Handshake"
          src={d.charts.counterparty}
          comment={counterpartyComment(d.ny, d.ldn)}
        />
        <ChartBlock
          title="Industry Pulse — PMPU Gross Long & Short"
          src={d.charts.industryPulse}
          comment={industryPulseComment(d.ny, d.ldn)}
        />
        <PageFooter page={5} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 6: Charts — Dry Powder, OB/OS ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="POSITIONING INDICATORS" sub={header} />
        <View style={S.row}>
          <View style={S.col}>
            <ChartBlock
              title="Dry Powder Indicator"
              src={d.charts.dryPowder}
              comment={dryPowderComment(d.ny, d.ldn)}
            />
          </View>
          <View style={S.col}>
            <ChartBlock
              title="Cycle Location — OB/OS Matrix"
              src={d.charts.obosMatrix}
              comment={`NY: ${d.ny.obosFlag} (price ${d.ny.priceRank.toFixed(0)}th, OI ${d.ny.oiRank.toFixed(0)}th). LDN: ${d.ldn.obosFlag} (price ${d.ldn.priceRank.toFixed(0)}th, OI ${d.ldn.oiRank.toFixed(0)}th).`}
            />
          </View>
        </View>
        <PageFooter page={6} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 7: Disclaimer ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="DISCLAIMER" sub={header} />
        <Text style={S.disclaimerTitle}>Data Sources & Methodology</Text>
        <Text style={S.disclaimerText}>
          COT data sourced from the U.S. Commodity Futures Trading Commission (CFTC) disaggregated
          reports and ICE Europe equivalent filings. NY Arabica refers to Coffee C futures (ICE US).
          LDN Robusta refers to Robusta Coffee futures (ICE Europe). Data as of the COT report date
          (Tuesday close). Published weekly by CFTC, typically available the following Friday.
        </Text>
        <Text style={S.disclaimerTitle}>Definitions</Text>
        <Text style={S.disclaimerText}>
          MM (Managed Money): speculative fund participants.{"\n"}
          PMPU (Producer/Merchant/Processor/User): commercial participants hedging physical exposure.{"\n"}
          SD (Swap Dealers): financial intermediaries.{"\n"}
          OR (Other Reportables): other large reportable traders.{"\n"}
          NR (Non-Reportables): small traders below reporting threshold.{"\n"}
          Funds % maxed: current MM position as % of 52-week maximum.{"\n"}
          Front roll: annualised spread between M1 and M2 contract, sign convention: positive = backwardation (roll income).{"\n"}
          Coverage %: PMPU position normalised on 52-week min/max range.
        </Text>
        <Text style={S.disclaimerTitle}>Disclaimer</Text>
        <Text style={S.disclaimerText}>
          This report is generated automatically from public data for informational purposes only.
          It does not constitute investment advice. Past positioning is not indicative of future
          price movements. Coffee Intel Map and its contributors accept no liability for decisions
          made based on this report.
        </Text>
        <Text style={[S.disclaimerText, { marginTop: 16, color: BRAND.slate400 }]}>
          Generated: {d.generatedAt} · Coffee Intel Map
        </Text>
        <PageFooter page={7} total={totalPages} date={ts} />
      </Page>

    </Document>
  );
}
```

- [ ] **Step 2: Verify TypeScript (no SSR import needed)**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "pdf/PdfReport"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/pdf/PdfReport.tsx
git commit -m "feat(pdf): add A4 PDF document component (7 pages)"
```

---

## Chunk 4: Integration — Wire into Dashboard

### Task 8: Add chart refs to CotDashboard

**Files:**
- Modify: `frontend/components/futures/CotDashboard.tsx`

The plan is to wrap each of the 6 chart `<div>` containers with a `ref`. Search for each section's `<div className="bg-slate-900 border border-slate-800 ...">` that immediately contains a `<ResponsiveContainer>`.

- [ ] **Step 1: Add 6 refs near the top of the component**

Find the existing refs block (around line 570, after state declarations) and add:

```tsx
// PDF chart refs (one per section) — names match captureAllCharts() keys
const pdfRefGlobalFlow    = useRef<HTMLDivElement>(null);
const pdfRefStructural    = useRef<HTMLDivElement>(null);
const pdfRefCounterparty  = useRef<HTMLDivElement>(null);
const pdfRefIndustryPulse = useRef<HTMLDivElement>(null);
const pdfRefDryPowder     = useRef<HTMLDivElement>(null);
const pdfRefObosMatrix    = useRef<HTMLDivElement>(null);  // key: "obosMatrix"
```

- [ ] **Step 2: Attach refs to chart containers**

For each of the 6 sections, find the outermost `<div>` wrapping the chart (the `bg-slate-900` container) and add `ref={pdfRef<Name>}`:

- Step 1 (Global Money Flow) — macro AreaChart container → `ref={pdfRefGlobalFlow}`
- Step 2 (Structural Integrity) — AreaChart container → `ref={pdfRefStructural}`
- Step 3 (Counterparty) — RadarChart container → `ref={pdfRefCounterparty}`
- Step 4 (Industry Pulse) — ComposedChart container (Panel A) → `ref={pdfRefIndustryPulse}`
- Step 5 (Dry Powder) — ScatterChart container → `ref={pdfRefDryPowder}`
- Step 6 (OB/OS Matrix) — ScatterChart container → `ref={pdfRefObosMatrix}`

- [ ] **Step 3: Commit**

```bash
git add frontend/components/futures/CotDashboard.tsx
git commit -m "feat(pdf): add chart refs to CotDashboard"
```

---

### Task 9: Add Download PDF button and generation handler

**Files:**
- Modify: `frontend/components/futures/CotDashboard.tsx`

- [ ] **Step 1: Add download handler**

Add this function inside the component, after the refs:

```tsx
const [pdfGenerating, setPdfGenerating] = useState(false);

const handleDownloadPdf = async () => {
  if (!recent52.length || !macroData.length) return;
  setPdfGenerating(true);
  try {
    // 1. Capture charts
    const { captureAllCharts } = await import("@/lib/pdf/chartCapture");
    const capturedCharts = await captureAllCharts({
      globalFlow:    pdfRefGlobalFlow,
      structural:    pdfRefStructural,
      counterparty:  pdfRefCounterparty,
      industryPulse: pdfRefIndustryPulse,
      dryPowder:     pdfRefDryPowder,
      obosMatrix:    pdfRefObosMatrix,
    });

    // 2. Build report data
    const { buildGlobalFlowMetrics, buildMarketMetrics } = await import("@/lib/pdf/dataHelpers");
    const globalFlow = buildGlobalFlowMetrics(macroData);
    if (!globalFlow) throw new Error("Insufficient macro data");

    // IMPORTANT: pass `data` (raw /api/cot rows) not `recent52` (processed).
    // structure_ny, exch_oi_ny, t_mm_short only exist on the raw rows.
    const rawData = data;
    const ny  = buildMarketMetrics(recent52, rawData, "ny");
    const ldn = buildMarketMetrics(recent52, rawData, "ldn");
    if (!ny || !ldn) throw new Error("Insufficient COT data");

    const cur = recent52[recent52.length - 1];
    const cotDateObj = new Date(cur.date);
    const cotDate = cotDateObj.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const weekNum = Math.ceil(
      (cotDateObj.getTime() - new Date(cotDateObj.getFullYear(), 0, 1).getTime()) / (7 * 86400000)
    );

    const reportData = {
      weekNumber: weekNum,
      year: cotDateObj.getFullYear(),
      cotDate,
      generatedAt: new Date().toISOString(),
      globalFlow,
      coffeeOverview: {
        combinedNetLots:     (ny.mmLong - ny.mmShort) + (ldn.mmLong - ldn.mmShort),
        combinedNetMT:       (ny.mmLong - ny.mmShort) * 5.625 + (ldn.mmLong - ldn.mmShort) * 10,
        alignedDirection:    Math.sign(ny.mmLong - ny.mmShort) === Math.sign(ldn.mmLong - ldn.mmShort),
        nyCombinedOiRank:    cur.oiRank    ?? 50,
        ldnCombinedOiRank:   cur.oiRankLDN ?? 50,
      },
      ny,
      ldn,
      // Explicit mapping avoids key mismatches and bypasses unsafe cast
      charts: {
        globalFlow:    capturedCharts.globalFlow    ?? null,
        structural:    capturedCharts.structural    ?? null,
        counterparty:  capturedCharts.counterparty  ?? null,
        industryPulse: capturedCharts.industryPulse ?? null,
        dryPowder:     capturedCharts.dryPowder     ?? null,
        obosMatrix:    capturedCharts.obosMatrix     ?? null,
      },
    };

    // 3. Generate and download PDF
    const { pdf } = await import("@react-pdf/renderer");
    const { CotPdfReport } = await import("@/lib/pdf/PdfReport");
    const blob = await pdf(<CotPdfReport d={reportData} />).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `COT-Report-Week${weekNum}-${cotDateObj.getFullYear()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("PDF generation failed:", err);
  } finally {
    setPdfGenerating(false);
  }
};
```

- [ ] **Step 2: Add button to dashboard header**

Find the top-level header area of the CoT dashboard (the div that contains the step navigation tabs). Add the button alongside the existing controls:

```tsx
<button
  onClick={handleDownloadPdf}
  disabled={pdfGenerating || !recent52.length}
  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
>
  {pdfGenerating ? "Generating…" : "↓ Download PDF"}
</button>
```

- [ ] **Step 3: Test manually**

1. Open the CoT dashboard in the browser (`npm run dev`)
2. Ensure all 6 dashboard tabs have been visited (so charts are mounted in DOM)
3. Click "Download PDF"
4. Verify: button shows "Generating…" briefly, then a PDF downloads
5. Open the PDF — verify all 7 pages render correctly, charts appear, numbers are correct

- [ ] **Step 4: Final commit**

```bash
git add frontend/components/futures/CotDashboard.tsx
git commit -m "feat(pdf): add Download PDF button and generation handler"
```

---

## Known Limitations & Notes

1. **Charts must be rendered to DOM** — all 6 chart tabs must have been visited at least once before downloading, otherwise refs are null and chart images will show the "unavailable" placeholder. If this is a problem, add a prefetch step that briefly renders all tabs before capturing.

2. **`tradersNY.mm` is long-trader count only** — the position mismatch check compares `(mmLong - mmShort)` vs `(t_mm_long - t_mm_short)`. The `tradersNY` object currently only stores `t_mm_long` (long trader count), not `t_mm_short`. During integration (Task 8), verify whether `t_mm_short` is available in the processed data and add it if needed.

3. **`exch_oi_ny`** — this field is used for nearby OI split. Confirm at implementation time what it represents in the raw data. If it is not nearby OI, set `oiChangeNearby = 0` and `oiChangeForward = oiChangeLots` as a safe fallback.

4. **`@react-pdf/renderer` is client-only** — the `handleDownloadPdf` handler uses dynamic `import()` for all PDF-related code to prevent SSR issues. Never import `PdfReport.tsx` at the top level of a Next.js page.

5. **ISO week number** — the implementation uses a simple week-number formula. If exact ISO 8601 compliance is needed, replace with a `date-fns` call: `import { getISOWeek } from "date-fns"`.
