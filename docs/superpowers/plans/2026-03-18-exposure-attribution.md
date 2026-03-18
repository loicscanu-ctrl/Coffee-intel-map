# Exposure Attribution (OI Effect vs Price Effect) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose each commodity's WoW notional exposure change into two components (OI-driven vs price-driven), displayed as a Chart/Table toggle in the COT dashboard Step 1 and as 4 new columns in the PDF page 1 commodity table.

**Architecture:** Pure frontend computation using data already returned by `/api/macro-cot`. Attribution fields are computed in `dataHelpers.ts` (which already builds the `GlobalFlowMetrics` object), stored in `types.ts` interfaces, wired into `CotDashboard.tsx` via a new `useMemo`, and rendered in both an inline `AttributionTable` component and the existing `CommodityTable` in `PdfReport.tsx`.

**Tech Stack:** TypeScript, React, Vitest (tests), @react-pdf/renderer (PDF)

---

## File Map

| File | What changes |
|---|---|
| `frontend/lib/pdf/types.ts` | Add 4 `number \| null` fields to `CommodityRow`; add 4 `number \| null` fields to `sectorBreakdown` items in `GlobalFlowMetrics` |
| `frontend/lib/pdf/dataHelpers.ts` | Add `COMMODITY_SPECS_FRONTEND` constant; compute attribution in `buildGlobalFlowMetrics()` commodity loop; add sector subtotals |
| `frontend/lib/pdf/__tests__/dataHelpers.test.ts` | Add tests for attribution computation |
| `frontend/components/futures/CotDashboard.tsx` | Add `step1View` state + toggle buttons + `globalFlowMetrics` useMemo + `AttributionTable` inline component |
| `frontend/lib/pdf/PdfReport.tsx` | Expand `CommodityTable` from 9 to 13 columns; add `dBN`/`sgnN` helpers; update `SectorRow`, `CommodityRow_`, header, and total row |

---

## Chunk 1: Data Layer — types.ts + dataHelpers.ts

### Task 1: Extend types.ts with attribution fields

**Files:**
- Modify: `frontend/lib/pdf/types.ts`

- [ ] **Step 1: Open `frontend/lib/pdf/types.ts` and read the current `CommodityRow` interface**

  It currently ends at line ~55 with `mmConcentrationPct` and `cp`. Find the closing `}` of `CommodityRow`.

- [ ] **Step 2: Add 4 attribution fields to `CommodityRow`**

  Insert immediately before the closing `}` of `CommodityRow`:

  ```typescript
  // Attribution: WoW notional change split by cause ($B)
  // null when price data is unavailable for either week, or no previous-week entry
  grossOiEffectB:    number | null;
  grossPriceEffectB: number | null;
  netOiEffectB:      number | null;
  netPriceEffectB:   number | null;
  ```

- [ ] **Step 3: Add 4 attribution subtotal fields to `sectorBreakdown` items in `GlobalFlowMetrics`**

  `GlobalFlowMetrics` has a `sectorBreakdown` array. Each element currently has fields like `grossB`, `netB`, `deltaB`, etc. Add after `netDeltaPct`:

  ```typescript
  grossOiEffectB:    number | null;
  grossPriceEffectB: number | null;
  netOiEffectB:      number | null;
  netPriceEffectB:   number | null;
  ```

- [ ] **Step 4: Verify TypeScript compiles with no errors**

  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: errors only about missing implementations in dataHelpers.ts (e.g. "Property 'grossOiEffectB' is missing") — those are fine at this stage. Zero errors in types.ts itself.

---

### Task 2: Add COMMODITY_SPECS_FRONTEND and attribution computation to dataHelpers.ts

**Files:**
- Modify: `frontend/lib/pdf/dataHelpers.ts`
- Modify: `frontend/lib/pdf/__tests__/dataHelpers.test.ts`

- [ ] **Step 1: Write failing tests first**

  Add to `frontend/lib/pdf/__tests__/dataHelpers.test.ts`:

  ```typescript
  import { buildGlobalFlowMetrics } from "../dataHelpers";
  import type { MacroCotWeek } from "@/lib/api";

  // Minimal MacroCotWeek factory
  function makeWeek(
    date: string,
    commodities: Array<{
      symbol: string; sector: "hard" | "grains" | "meats" | "softs" | "micros";
      mm_long: number; mm_short: number; close_price: number | null;
    }>
  ): MacroCotWeek {
    return {
      date,
      commodities: commodities.map(c => ({
        ...c,
        name: c.symbol,
        mm_spread: 0,
        oi_total: c.mm_long + c.mm_short,
        gross_exposure_usd: c.close_price != null
          ? (c.mm_long + c.mm_short) * c.close_price * 1000
          : null,
        net_exposure_usd: c.close_price != null
          ? (c.mm_long - c.mm_short) * c.close_price * 1000
          : null,
      })),
    };
  }

  describe("buildGlobalFlowMetrics — attribution", () => {
    const prev = makeWeek("2026-03-03", [
      { symbol: "wti", sector: "hard", mm_long: 100, mm_short: 50, close_price: 80 },
    ]);
    const latest = makeWeek("2026-03-10", [
      { symbol: "wti", sector: "hard", mm_long: 120, mm_short: 60, close_price: 90 },
    ]);

    it("grossOiEffectB: Δgross_oi × old_price × contract_unit / 1e9", () => {
      // Δgross_oi = (120+60)-(100+50) = 30; old_price = 80; contract_unit(wti) = 1000
      // = 30 × 80 × 1000 / 1e9 = 2_400_000 / 1e9 = 0.0024
      const result = buildGlobalFlowMetrics([prev, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(wti?.grossOiEffectB).toBeCloseTo(0.0024, 6);
    });

    it("grossPriceEffectB: gross_oi_new × Δprice × contract_unit / 1e9", () => {
      // gross_oi_new = 180; Δprice = 10; contract_unit = 1000
      // = 180 × 10 × 1000 / 1e9 = 0.0018
      const result = buildGlobalFlowMetrics([prev, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(wti?.grossPriceEffectB).toBeCloseTo(0.0018, 6);
    });

    it("invariant: grossOiEffect + grossPriceEffect === gross WoW change", () => {
      const result = buildGlobalFlowMetrics([prev, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      const totalChange = wti!.deltaB; // gross WoW $B
      expect((wti!.grossOiEffectB ?? 0) + (wti!.grossPriceEffectB ?? 0)).toBeCloseTo(totalChange, 6);
    });

    it("netOiEffectB: Δnet_oi × old_price × contract_unit / 1e9", () => {
      // Δnet_oi = (120-60)-(100-50) = 60-50 = 10; old_price = 80; cu = 1000
      // = 10 × 80 × 1000 / 1e9 = 0.0008
      const result = buildGlobalFlowMetrics([prev, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(wti?.netOiEffectB).toBeCloseTo(0.0008, 6);
    });

    it("netPriceEffectB: net_oi_new × Δprice × contract_unit / 1e9", () => {
      // net_oi_new = 120-60 = 60; Δprice = 10; cu = 1000
      // = 60 × 10 × 1000 / 1e9 = 0.0006
      const result = buildGlobalFlowMetrics([prev, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(wti?.netPriceEffectB).toBeCloseTo(0.0006, 6);
    });

    it("invariant: netOiEffect + netPriceEffect === net WoW change", () => {
      const result = buildGlobalFlowMetrics([prev, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect((wti!.netOiEffectB ?? 0) + (wti!.netPriceEffectB ?? 0)).toBeCloseTo(wti!.netDeltaB, 6);
    });

    it("returns null for all effects when close_price is null in current week", () => {
      const latestNullPrice = makeWeek("2026-03-10", [
        { symbol: "wti", sector: "hard", mm_long: 120, mm_short: 60, close_price: null },
      ]);
      const result = buildGlobalFlowMetrics([prev, latestNullPrice]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(wti?.grossOiEffectB).toBeNull();
      expect(wti?.grossPriceEffectB).toBeNull();
    });

    it("returns null for all effects when close_price is null in prev week", () => {
      const prevNullPrice = makeWeek("2026-03-03", [
        { symbol: "wti", sector: "hard", mm_long: 100, mm_short: 50, close_price: null },
      ]);
      const result = buildGlobalFlowMetrics([prevNullPrice, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(wti?.grossOiEffectB).toBeNull();
    });

    it("returns null for all effects when symbol is missing from previous week", () => {
      const prevEmpty = makeWeek("2026-03-03", []);
      const result = buildGlobalFlowMetrics([prevEmpty, latest]);
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(wti?.grossOiEffectB).toBeNull();
    });

    it("sector grossOiEffectB subtotal sums non-null commodity values", () => {
      const result = buildGlobalFlowMetrics([prev, latest]);
      const energySector = result?.sectorBreakdown.find(s => s.sector === "energy");
      // WTI is the only energy commodity in this test — subtotal should equal wti's value
      const wti = result?.commodityTable.find(c => c.symbol === "wti");
      expect(energySector?.grossOiEffectB).toBeCloseTo(wti!.grossOiEffectB!, 6);
    });

    it("sector grossOiEffectB is null when all commodities in sector have null attribution", () => {
      const prevNull = makeWeek("2026-03-03", [
        { symbol: "wti", sector: "hard", mm_long: 100, mm_short: 50, close_price: null },
      ]);
      const latestNull = makeWeek("2026-03-10", [
        { symbol: "wti", sector: "hard", mm_long: 120, mm_short: 60, close_price: null },
      ]);
      const result = buildGlobalFlowMetrics([prevNull, latestNull]);
      const energySector = result?.sectorBreakdown.find(s => s.sector === "energy");
      expect(energySector?.grossOiEffectB).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they all fail (functions not yet implemented)**

  ```bash
  cd frontend && npm test -- --reporter=verbose 2>&1 | tail -30
  ```

  Expected: all new attribution tests FAIL. Existing tests still pass.

- [ ] **Step 3: Verify `COMMODITY_SPECS_FRONTEND` values against the backend**

  Before writing the constant, read the backend source to confirm every value:

  ```bash
  grep -A 60 "COMMODITY_SPECS" backend/scraper/sources/macro_cot.py | head -80
  ```

  Cross-check each of the 28 `contract_unit` values in the table below against what the backend file shows. Fix any discrepancies before proceeding.

  | symbol | expected contract_unit |
  |---|---|
  | wti | 1000 | brent | 1000 | natgas | 10000 | heating_oil | 42000 | rbob | 42000 |
  | lsgo | 100 | gold | 100 | silver | 5000 | copper | 25000 | corn | 5000 |
  | wheat | 5000 | soybeans | 5000 | soy_meal | 100 | soy_oil | 60000 | live_cattle | 40000 |
  | feeder_cattle | 50000 | lean_hogs | 40000 | sugar11 | 112000 | white_sugar | 50 | cotton | 50000 |
  | arabica | 37500 | robusta | 10 | cocoa_ny | 10 | cocoa_ldn | 10 | oj | 15000 |
  | oats | 5000 | rough_rice | 2000 | lumber | 110000 |

- [ ] **Step 4: Add `COMMODITY_SPECS_FRONTEND` to `dataHelpers.ts`**

  Add near the top of `frontend/lib/pdf/dataHelpers.ts`, after the existing imports:

  ```typescript
  // Static contract_unit lookup — mirrors COMMODITY_SPECS in backend/scraper/sources/macro_cot.py.
  // close_price from the API is already normalized to USD per base unit
  // (e.g. ZC=F corn is stored as USD/bushel after the scraper divides cents by 100).
  // No additional unit conversion needed here.
  const COMMODITY_SPECS_FRONTEND: Record<string, { contract_unit: number }> = {
    wti:           { contract_unit: 1000    },
    brent:         { contract_unit: 1000    },
    natgas:        { contract_unit: 10000   },
    heating_oil:   { contract_unit: 42000   },
    rbob:          { contract_unit: 42000   },
    lsgo:          { contract_unit: 100     },
    gold:          { contract_unit: 100     },
    silver:        { contract_unit: 5000    },
    copper:        { contract_unit: 25000   },
    corn:          { contract_unit: 5000    },
    wheat:         { contract_unit: 5000    },
    soybeans:      { contract_unit: 5000    },
    soy_meal:      { contract_unit: 100     },
    soy_oil:       { contract_unit: 60000   },
    live_cattle:   { contract_unit: 40000   },
    feeder_cattle: { contract_unit: 50000   },
    lean_hogs:     { contract_unit: 40000   },
    sugar11:       { contract_unit: 112000  },
    white_sugar:   { contract_unit: 50      },
    cotton:        { contract_unit: 50000   },
    arabica:       { contract_unit: 37500   },
    robusta:       { contract_unit: 10      },
    cocoa_ny:      { contract_unit: 10      },
    cocoa_ldn:     { contract_unit: 10      },
    oj:            { contract_unit: 15000   },
    oats:          { contract_unit: 5000    },
    rough_rice:    { contract_unit: 2000    },
    lumber:        { contract_unit: 110000  },
  };
  ```

- [ ] **Step 5: Add attribution computation to `buildGlobalFlowMetrics()` — commodity loop**

  In `dataHelpers.ts`, inside `buildGlobalFlowMetrics()`, find the per-commodity `.map()` that builds `CommodityRow` objects (around line 175). The loop already has access to `entry` (current week) and `prevEntry` (previous week). Add attribution computation inside the map, before the `return { ... }`:

  ```typescript
  // Attribution computation
  const cu = COMMODITY_SPECS_FRONTEND[sym]?.contract_unit ?? null;
  const prevMmLong  = prevEntry?.mm_long  ?? null;
  const prevMmShort = prevEntry?.mm_short ?? null;
  const prevPrice   = prevEntry?.close_price ?? null;
  const curPrice    = entry.close_price ?? null;

  // gross_oi = mm_long + mm_short (MM lots only, NOT oi_total which covers all participants)
  // net_oi   = mm_long - mm_short
  let grossOiEffectB:    number | null = null;
  let grossPriceEffectB: number | null = null;
  let netOiEffectB:      number | null = null;
  let netPriceEffectB:   number | null = null;

  if (
    cu !== null &&
    prevPrice !== null && curPrice !== null &&
    prevMmLong !== null && prevMmShort !== null
    // entry.mm_long / mm_short are typed as number (never null) per MacroCotEntry
  ) {
    const curMmLong  = entry.mm_long;
    const curMmShort = entry.mm_short;
    const dGrossOi   = (curMmLong + curMmShort) - (prevMmLong + prevMmShort);
    const dNetOi     = (curMmLong - curMmShort)  - (prevMmLong - prevMmShort);
    const dPrice     = curPrice - prevPrice;

    // Price effect uses current-period quantity (deliberate — assigns interaction term to price)
    grossOiEffectB    = (dGrossOi                  * prevPrice * cu) / 1e9;
    grossPriceEffectB = ((curMmLong + curMmShort)  * dPrice    * cu) / 1e9;
    netOiEffectB      = (dNetOi                    * prevPrice * cu) / 1e9;
    netPriceEffectB   = ((curMmLong - curMmShort)  * dPrice    * cu) / 1e9;
  }
  ```

  Then include these four variables in the returned `CommodityRow` object:

  ```typescript
  return {
    // ... all existing fields ...
    grossOiEffectB,
    grossPriceEffectB,
    netOiEffectB,
    netPriceEffectB,
  };
  ```

- [ ] **Step 6: Reorder `buildGlobalFlowMetrics()` — ensure `commodityTable` is declared before `sectorBreakdown`**

  Open `frontend/lib/pdf/dataHelpers.ts` and locate the body of `buildGlobalFlowMetrics()`. Find where `commodityTable` and `sectorBreakdown` are built. **The `sectorBreakdown` map must come AFTER `commodityTable` is fully assigned to a variable** — because we will iterate over `commodityTable` to compute attribution subtotals.

  If you see `sectorBreakdown` computed first (around line 135) and `commodityTable` second (around line 175): **move the commodity table block above the sector breakdown block.** Specifically:
  1. Cut the entire `const commodityTable = ...` expression (including the `.filter(...)`, `.map(...)`, and `.sort(...)`).
  2. Paste it above the `const sectorBreakdown = ...` line.
  3. Verify the function still returns `{ commodityTable, sectorBreakdown, ... }` correctly.

- [ ] **Step 7: Add attribution sector subtotals to `buildGlobalFlowMetrics()` — sectorBreakdown**

  In the `sectorBreakdown` map, after computing the existing fields per sector, add attribution subtotals using `commodityTable` (which is now available above):

  ```typescript
  // Then use commodityTable in sectorBreakdown
  const sectorBreakdown = DISPLAY_SECTORS.map(s => {
    // ... existing code ...
    const attrSubtotals = (() => {
      const fields = ["grossOiEffectB", "grossPriceEffectB", "netOiEffectB", "netPriceEffectB"] as const;
      return Object.fromEntries(fields.map(field => {
        const vals = commodityTable
          .filter(c => c.displaySector === s)
          .map(c => c[field]);
        const nonNull = vals.filter((v): v is number => v !== null);
        return [field, nonNull.length === 0 ? null : nonNull.reduce((a, b) => a + b, 0)];
      }));
    })();
    return {
      // ... existing fields ...
      ...attrSubtotals,
    };
  });
  ```

- [ ] **Step 8: Run tests — all attribution tests should pass**

  ```bash
  cd frontend && npm test -- --reporter=verbose 2>&1 | tail -40
  ```

  Expected: ALL tests pass (existing + new attribution tests). Zero failures.

- [ ] **Step 9: Verify TypeScript**

  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: zero errors (or only pre-existing errors unrelated to this feature).

- [ ] **Step 10: Commit**

  ```bash
  cd frontend
  git add lib/pdf/types.ts lib/pdf/dataHelpers.ts lib/pdf/__tests__/dataHelpers.test.ts
  git commit -m "feat: add attribution fields to types and dataHelpers"
  ```

---

## Chunk 2: Dashboard — CotDashboard.tsx toggle + AttributionTable

### Task 3: Add step1View state and toggle buttons to CotDashboard.tsx

**Files:**
- Modify: `frontend/components/futures/CotDashboard.tsx`

- [ ] **Step 1: Add the import for `buildGlobalFlowMetrics`**

  At the top of `CotDashboard.tsx`, find the existing import from `@/lib/api`. Add below it:

  ```typescript
  import { buildGlobalFlowMetrics } from "@/lib/pdf/dataHelpers";
  import type { GlobalFlowMetrics } from "@/lib/pdf/types";
  ```

  **Important:** `dataHelpers.ts` does NOT import from `@react-pdf/renderer` — only from `./types` and `@/lib/api`. It is safe to import statically. The existing dynamic `await import("@/lib/pdf/dataHelpers")` in the PDF handler remains as-is (the bundler deduplicates the module). The `PdfReport.tsx` file still must remain a dynamic import (it imports react-pdf).

- [ ] **Step 2: Add `step1View` state**

  Find the block where existing state variables are declared (around line 578 — `const [step, setStep]`, `const [macroToggle, setMacroToggle]`). Add:

  ```typescript
  const [step1View, setStep1View] = useState<"chart" | "table">("chart");
  ```

- [ ] **Step 3: Add `globalFlowMetrics` useMemo**

  Below the `macroChartData` useMemo (around line 643), add:

  ```typescript
  const globalFlowMetrics = useMemo(
    (): GlobalFlowMetrics | null =>
      macroData.length >= 2 ? buildGlobalFlowMetrics(macroData) : null,
    [macroData]
  );
  ```

- [ ] **Step 4: Add the Chart/Table toggle buttons to the Step 1 header**

  Find the Step 1 toggle div (line ~944, the `<div style={{ display: "flex", gap: 8, marginBottom: 12 }}>` that contains the gross/net buttons). Wrap that div and a new "view" toggle in a flex row:

  Replace:
  ```tsx
  {/* Toggle */}
  <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
    {(["gross", "gross_long", "gross_short", "net"] as const).map(m => {
  ```

  With:
  ```tsx
  {/* Controls row: view toggle + mode toggle */}
  <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
    {/* View toggle */}
    {(["chart", "table"] as const).map(v => (
      <button
        key={v}
        onClick={() => setStep1View(v)}
        style={{
          padding: "4px 12px", borderRadius: 4, border: "1px solid #374151",
          background: step1View === v ? "#065f46" : "#1f2937",
          color: "#f9fafb", cursor: "pointer", fontSize: 12,
        }}
      >
        {v === "chart" ? "Chart" : "Attribution Table"}
      </button>
    ))}
    <span style={{ width: 1, height: 20, background: "#374151", margin: "0 4px" }} />
    {/* Existing mode toggle — gross/net/long/short */}
    {(["gross", "gross_long", "gross_short", "net"] as const).map(m => {
  ```

  Close the wrapping div properly — it should close after the existing `</div>` that closes the mode toggle map.

- [ ] **Step 5: Wrap Panel A + Panel B in `step1View === "chart"` conditional**

  Find the `{/* Panel A — MM Exposure by Sector */}` block (line ~993) and the `{/* Panel B — Weekly Change */}` block (line ~1095). Both run inside the `{step === 1 && ( ... )}` block. Wrap them together:

  ```tsx
  {step1View === "chart" && (
    <>
      {/* Panel A — MM Exposure by Sector */}
      <div style={{ marginBottom: 8 }}>
        {/* ... unchanged Panel A code ... */}
      </div>

      {/* Panel B — Weekly Change */}
      {/* ... unchanged Panel B code ... */}
    </>
  )}
  ```

  Panel C (Softs contract exposure, line ~1143) is NOT wrapped — it stays always visible.

- [ ] **Step 6: Verify the app renders correctly — chart mode still works**

  Run dev server and open the app in the browser. Navigate to Futures > Step 1. Confirm:
  - Default view shows the existing charts (unchanged)
  - Clicking "Attribution Table" hides Panel A + B
  - Clicking "Chart" restores them

  ```bash
  cd frontend && npm run dev
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/components/futures/CotDashboard.tsx
  git commit -m "feat: add chart/table toggle to Step 1 in CotDashboard"
  ```

---

### Task 4: Add AttributionTable component to CotDashboard.tsx

**Files:**
- Modify: `frontend/components/futures/CotDashboard.tsx`

- [ ] **Step 1: Add the `AttributionTable` component at MODULE scope (outside `CotDashboard`)**

  Define this component at the TOP LEVEL of `CotDashboard.tsx`, outside the `CotDashboard` function — add it just before `export default function CotDashboard()`. **Do NOT define it inside the component body** — React will unmount/remount it on every render if it is nested.

  The component accepts `GlobalFlowMetrics` as a prop. Its style helpers use plain HTML `style` objects (NOT `@react-pdf/renderer` style arrays — do not copy the `sgn`/`sgnN` helpers from `PdfReport.tsx`).

  ```typescript
  // ── Attribution helpers (HTML inline styles — NOT react-pdf styles) ──────────
  const SECTOR_ORDER_ATTR = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;
  const SECTOR_LABELS_ATTR: Record<string, string> = {
    energy: "Energy", metals: "Metals", grains: "Grains",
    meats: "Meats", softs: "Softs", micros: "Micros",
  };
  function fmtAttr(n: number | null): string {
    if (n == null) return "—";
    return (n >= 0 ? "+" : "") + n.toFixed(2) + "B";
  }
  function attrColor(n: number | null): string {
    if (n == null) return "#6b7280";
    return n >= 0 ? "#10b981" : "#ef4444";
  }
  ```

  Then define `AttributionTable`:

  Add this component definition at module scope in `CotDashboard.tsx`, just before the main `CotDashboard` function. It reads from `globalFlowMetrics`:

  ```tsx
  function AttributionTable({ gfm }: { gfm: GlobalFlowMetrics }) {
    // Sort commodity rows: by sector order, then by absolute deltaB descending within each sector
    const sortedRows = [...gfm.commodityTable].sort((a, b) => {
      const ai = SECTOR_ORDER_ATTR.indexOf(a.displaySector as any);
      const bi = SECTOR_ORDER_ATTR.indexOf(b.displaySector as any);
      if (ai !== bi) return ai - bi;
      return Math.abs(b.deltaB) - Math.abs(a.deltaB);
    });

    const headerCell = (label: string, align: "left" | "right" = "right") => ({
      padding: "4px 8px", fontSize: 10, color: "#9ca3af", fontWeight: 600,
      textAlign: align, borderBottom: "1px solid #374151", whiteSpace: "nowrap" as const,
    });
    const dataCell = (color: string, bold = false) => ({
      padding: "3px 8px", fontSize: 10, color, textAlign: "right" as const,
      fontWeight: bold ? 700 : 400, fontFamily: "monospace",
    });
    const nameCell = (bold = false, color = "#e5e7eb") => ({
      padding: "3px 8px 3px 16px", fontSize: 10, color, fontWeight: bold ? 700 : 400,
      textAlign: "left" as const,
    });

    // Group rows by sector for clean rendering (avoids nested .map returning arrays)
    const grouped = SECTOR_ORDER_ATTR.map(sector => ({
      sector,
      label: SECTOR_LABELS_ATTR[sector],
      sd: gfm.sectorBreakdown.find(s => s.sector === sector) ?? null,
      rows: sortedRows.filter(r => r.displaySector === sector),
    })).filter(g => g.rows.length > 0);

    return (
      <div style={{ overflowX: "auto", marginTop: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <th style={headerCell("Commodity", "left")}>Commodity</th>
              <th style={headerCell("Gross WoW $B")}>Gross WoW $B</th>
              <th style={headerCell("OI Effect")}>OI Δ</th>
              <th style={headerCell("Price Effect")}>Px Δ</th>
              <th style={headerCell("Net WoW $B")}>Net WoW $B</th>
              <th style={headerCell("OI Effect")}>OI Δ</th>
              <th style={headerCell("Price Effect")}>Px Δ</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ sector, label, sd, rows: sectorRows }) => (
              <React.Fragment key={sector}>
                {/* Sector subtotal row */}
                {sd && (
                  <tr style={{ background: "#1e293b" }}>
                    <td style={{ ...nameCell(true, "#f9fafb"), paddingLeft: 8 }}>{label}</td>
                    <td style={dataCell(attrColor(sd.deltaB), true)}>{fmtAttr(sd.deltaB)}</td>
                    <td style={dataCell(attrColor(sd.grossOiEffectB), true)}>{fmtAttr(sd.grossOiEffectB)}</td>
                    <td style={dataCell(attrColor(sd.grossPriceEffectB), true)}>{fmtAttr(sd.grossPriceEffectB)}</td>
                    <td style={dataCell(attrColor(sd.netDeltaB), true)}>{fmtAttr(sd.netDeltaB)}</td>
                    <td style={dataCell(attrColor(sd.netOiEffectB), true)}>{fmtAttr(sd.netOiEffectB)}</td>
                    <td style={dataCell(attrColor(sd.netPriceEffectB), true)}>{fmtAttr(sd.netPriceEffectB)}</td>
                  </tr>
                )}
                {/* Commodity rows */}
                {sectorRows.map((row, idx) => (
                  <tr key={row.symbol} style={{ background: idx % 2 === 0 ? "transparent" : "#0f172a" }}>
                    <td style={nameCell(row.isCoffee, row.isCoffee ? "#f59e0b" : "#d1d5db")}>
                      {row.isCoffee ? "► " : ""}{row.name}
                    </td>
                    <td style={dataCell(attrColor(row.deltaB))}>{fmtAttr(row.deltaB)}</td>
                    <td style={dataCell(attrColor(row.grossOiEffectB))}>{fmtAttr(row.grossOiEffectB)}</td>
                    <td style={dataCell(attrColor(row.grossPriceEffectB))}>{fmtAttr(row.grossPriceEffectB)}</td>
                    <td style={dataCell(attrColor(row.netDeltaB))}>{fmtAttr(row.netDeltaB)}</td>
                    <td style={dataCell(attrColor(row.netOiEffectB))}>{fmtAttr(row.netOiEffectB)}</td>
                    <td style={dataCell(attrColor(row.netPriceEffectB))}>{fmtAttr(row.netPriceEffectB)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  ```

- [ ] **Step 2: Render AttributionTable in Step 1 when `step1View === "table"`**

  After the `{step1View === "chart" && (...)}` block (after Panel B), but still inside `{step === 1 && (...)}`, add:

  ```tsx
  {step1View === "table" && (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
      {globalFlowMetrics
        ? <AttributionTable gfm={globalFlowMetrics} />
        : <p style={{ color: "#6b7280", fontSize: 12 }}>Loading attribution data…</p>
      }
    </div>
  )}
  ```

- [ ] **Step 3: Test in browser**

  Navigate to Step 1 in the app. Click "Attribution Table". Verify:
  - Table renders with all 6 sectors (Energy, Metals, Grains, Meats, Softs, Micros)
  - Sector rows are bold with subtotals
  - Commodity rows have correct sign coloring (green positive, red negative)
  - Null values show "—" (e.g. lumber)
  - Clicking "Chart" restores the original charts

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/components/futures/CotDashboard.tsx
  git commit -m "feat: add AttributionTable view to Step 1 in CotDashboard"
  ```

---

## Chunk 3: PDF — PdfReport.tsx 13-column table

### Task 5: Expand CommodityTable to 13 columns in PdfReport.tsx

**Files:**
- Modify: `frontend/lib/pdf/PdfReport.tsx`

- [ ] **Step 1: Update the column width array `C` from 9 to 13 elements**

  Find in `CommodityTable` component (around line 221):
  ```typescript
  const C = [1.5, 0.85, 0.85, 0.6, 0.85, 0.85, 0.6, 0.7, 0.6];
  ```

  Replace with (13 columns):
  ```typescript
  // 13 columns: [0]name [1]grossB [2]grsWoW [3]grossOiΔ [4]grossPxΔ [5]grs%
  //             [6]netB  [7]netWoW [8]netOiΔ  [9]netPxΔ  [10]net%
  //             [11]share% [12]Δshr
  const C = [1.2, 0.75, 0.70, 0.60, 0.60, 0.50, 0.75, 0.70, 0.60, 0.60, 0.50, 0.65, 0.50];
  ```

- [ ] **Step 2: Add null-safe helpers `dBN` and `sgnN`**

  In `CommodityTable`, after the existing helper definitions (`fB`, `dB`, `dPct`, `dPp`, `hR`, `hL`, `pos`, `neg`, `neu`, `sgn`), add:

  ```typescript
  // Null-safe formatter: null → "—"
  const dBN = (n: number | null): string => n == null ? "—" : dB(n);
  // Null-safe style: null → neutral grey, otherwise sign-colored
  const sgnN = (v: number | null, flex: number) => v == null ? neu(flex) : sgn(v, flex);
  ```

- [ ] **Step 3: Update the table header row to 13 columns**

  Replace the current 9-header block:
  ```tsx
  <View style={[S.tHeadRow, { paddingVertical: 2 }]}>
    <Text style={hL(C[0])}>COMMODITY</Text>
    <Text style={hR(C[1])}>GROSS $B</Text>
    <Text style={hR(C[2])}>GRS WoW</Text>
    <Text style={hR(C[3])}>GRS %</Text>
    <Text style={hR(C[4])}>NET $B</Text>
    <Text style={hR(C[5])}>NET WoW</Text>
    <Text style={hR(C[6])}>NET %</Text>
    <Text style={hR(C[7])}>SHARE %</Text>
    <Text style={hR(C[8])}>Δ SHR</Text>
  </View>
  ```

  With:
  ```tsx
  <View style={[S.tHeadRow, { paddingVertical: 2 }]}>
    <Text style={hL(C[0])}>COMMODITY</Text>
    <Text style={hR(C[1])}>GROSS $B</Text>
    <Text style={hR(C[2])}>GRS WoW</Text>
    <Text style={hR(C[3])}>OI Δ</Text>
    <Text style={hR(C[4])}>Px Δ</Text>
    <Text style={hR(C[5])}>GRS %</Text>
    <Text style={hR(C[6])}>NET $B</Text>
    <Text style={hR(C[7])}>NET WoW</Text>
    <Text style={hR(C[8])}>OI Δ</Text>
    <Text style={hR(C[9])}>Px Δ</Text>
    <Text style={hR(C[10])}>NET %</Text>
    <Text style={hR(C[11])}>SHARE %</Text>
    <Text style={hR(C[12])}>Δ SHR</Text>
  </View>
  ```

- [ ] **Step 4: Update `SectorRow` to 13 columns**

  Find the `SectorRow` function inside `CommodityTable`. It currently renders 9 column groups. Replace it entirely:

  ```tsx
  function SectorRow({ sd }: { sd: (typeof g.sectorBreakdown)[0] }) {
    return (
      <View style={{ flexDirection: "row", paddingVertical: 1, paddingHorizontal: 6, backgroundColor: "#1e293b", borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
        <Text style={[S.tHCell, { flex: C[0], fontSize: FS, textTransform: "capitalize" }]}>{SECTOR_LABELS[sd.sector]}</Text>
        <View style={{ flex: C[1], alignItems: "flex-end" }}>
          <Text style={[S.tHCellR, { fontSize: FS }]}>{fB(sd.grossB)}</Text>
          <MiniBar rank={sd.histRankGrossPct} />
        </View>
        <Text style={[sd.deltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[2], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dB(sd.deltaB)}</Text>
        <Text style={[sgnN(sd.grossOiEffectB, C[3]), { fontFamily: "Helvetica-Bold" }]}>{dBN(sd.grossOiEffectB)}</Text>
        <Text style={[sgnN(sd.grossPriceEffectB, C[4]), { fontFamily: "Helvetica-Bold" }]}>{dBN(sd.grossPriceEffectB)}</Text>
        <Text style={[sd.deltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[5], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dPct(sd.deltaPct)}</Text>
        <View style={{ flex: C[6], alignItems: "flex-end" }}>
          <Text style={[sd.netB >= 0 ? S.tCellPos : S.tCellNeg, { fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{sd.netB >= 0 ? "+" : "-"}{fB(sd.netB)}</Text>
          <MiniBar rank={sd.histRankNetPct} />
        </View>
        <Text style={[sd.netDeltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[7], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dB(sd.netDeltaB)}</Text>
        <Text style={[sgnN(sd.netOiEffectB, C[8]), { fontFamily: "Helvetica-Bold" }]}>{dBN(sd.netOiEffectB)}</Text>
        <Text style={[sgnN(sd.netPriceEffectB, C[9]), { fontFamily: "Helvetica-Bold" }]}>{dBN(sd.netPriceEffectB)}</Text>
        <Text style={[sd.netDeltaPct >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[10], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dPct(sd.netDeltaPct)}</Text>
        <View style={{ flex: C[11], alignItems: "flex-end" }}>
          <Text style={[S.tHCellR, { fontSize: FS }]}>{sd.shareOfTotalPct.toFixed(1)}%</Text>
          <MiniBar rank={sd.histRankSharePct} />
        </View>
        <Text style={[sd.shareDeltaPp >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[12], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dPp(sd.shareDeltaPp)}</Text>
      </View>
    );
  }
  ```

- [ ] **Step 5: Update `CommodityRow_` to 13 columns**

  Find `CommodityRow_` function inside `CommodityTable`. Replace it entirely:

  ```tsx
  function CommodityRow_({ row, i }: { row: import("@/lib/pdf/types").CommodityRow; i: number }) {
    const bg = row.isCoffee ? "#fffbeb" : i % 2 === 0 ? "transparent" : "#f8fafc";
    const nameStyle = row.isCoffee
      ? [S.tCell, { flex: C[0], color: BRAND.amber, fontSize: FS, paddingLeft: 10 }]
      : [S.tCell, { flex: C[0], fontSize: FS, paddingLeft: 10 }];
    return (
      <View style={{ flexDirection: "row", paddingVertical: 0, paddingHorizontal: 6, backgroundColor: bg, borderBottomWidth: 0.3, borderBottomColor: "#e2e8f0" }}>
        <Text style={nameStyle}>{row.isCoffee ? "► " : ""}{row.name}</Text>
        <View style={{ flex: C[1], alignItems: "flex-end" }}>
          <Text style={neu(0)}>{fB(row.grossB)}</Text>
          <MiniBar rank={row.histRankGrossPct} />
        </View>
        <Text style={sgn(row.deltaB, C[2])}>{dB(row.deltaB)}</Text>
        <Text style={sgnN(row.grossOiEffectB, C[3])}>{dBN(row.grossOiEffectB)}</Text>
        <Text style={sgnN(row.grossPriceEffectB, C[4])}>{dBN(row.grossPriceEffectB)}</Text>
        <Text style={sgn(row.deltaPct, C[5])}>{dPct(row.deltaPct)}</Text>
        <View style={{ flex: C[6], alignItems: "flex-end" }}>
          <Text style={[row.netB >= 0 ? S.tCellPos : S.tCellNeg, { fontSize: FS }]}>{row.netB >= 0 ? "+" : "-"}{fB(row.netB)}</Text>
          <MiniBar rank={row.histRankNetPct} />
        </View>
        <Text style={sgn(row.netDeltaB, C[7])}>{dB(row.netDeltaB)}</Text>
        <Text style={sgnN(row.netOiEffectB, C[8])}>{dBN(row.netOiEffectB)}</Text>
        <Text style={sgnN(row.netPriceEffectB, C[9])}>{dBN(row.netPriceEffectB)}</Text>
        <Text style={sgn(row.netDeltaPct, C[10])}>{dPct(row.netDeltaPct)}</Text>
        <View style={{ flex: C[11], alignItems: "flex-end" }}>
          <Text style={neu(0)}>{row.shareOfTotalPct.toFixed(1)}%</Text>
          <MiniBar rank={row.histRankSharePct} />
        </View>
        <Text style={sgn(row.shareDeltaPp, C[12])}>{dPp(row.shareDeltaPp)}</Text>
      </View>
    );
  }
  ```

- [ ] **Step 6: Update the total row to 13 columns**

  Find the total row block:
  ```tsx
  {/* Total row */}
  <View style={S.tTotalRow}>
    <Text style={[S.tHCell, { flex: C[0], fontSize: FS }]}>TOTAL</Text>
    <Text style={[S.tHCellR, { flex: C[1], fontSize: FS }]}>${g.totalGrossB.toFixed(1)}B</Text>
    <Text style={[S.tHCellR, { flex: C[2] + C[3], fontSize: FS, color: ... }]}>...</Text>
    <Text style={[S.tHCellR, { flex: C[4], fontSize: FS }]}>...</Text>
    <Text style={[S.tHCellR, { flex: C[5] + C[6], fontSize: FS, color: ... }]}>...</Text>
    <Text style={[S.tHCellR, { flex: C[7] + C[8], fontSize: FS }]}>100% share</Text>
  </View>
  ```

  Replace with (13 columns, attribution cells use `dBN` on grand totals computed from sectorBreakdown):

  ```tsx
  {/* Total row */}
  {(() => {
    const nonNull = (field: "grossOiEffectB" | "grossPriceEffectB" | "netOiEffectB" | "netPriceEffectB") => {
      const vals = g.sectorBreakdown.map(s => s[field]).filter((v): v is number => v !== null);
      return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0);
    };
    const gOi  = nonNull("grossOiEffectB");
    const gPx  = nonNull("grossPriceEffectB");
    const nOi  = nonNull("netOiEffectB");
    const nPx  = nonNull("netPriceEffectB");
    return (
      <View style={S.tTotalRow}>
        <Text style={[S.tHCell, { flex: C[0], fontSize: FS }]}>TOTAL</Text>
        <Text style={[S.tHCellR, { flex: C[1], fontSize: FS }]}>${g.totalGrossB.toFixed(1)}B</Text>
        <Text style={[S.tHCellR, { flex: C[2], fontSize: FS, color: g.wowDeltaB >= 0 ? BRAND.green : BRAND.red }]}>{g.wowDeltaB >= 0 ? "+" : "-"}${Math.abs(g.wowDeltaB).toFixed(2)}B</Text>
        <Text style={[sgnN(gOi, C[3]), { fontFamily: "Helvetica-Bold" }]}>{dBN(gOi)}</Text>
        <Text style={[sgnN(gPx, C[4]), { fontFamily: "Helvetica-Bold" }]}>{dBN(gPx)}</Text>
        <Text style={[S.tHCellR, { flex: C[5], fontSize: FS }]}> </Text>
        <Text style={[S.tHCellR, { flex: C[6], fontSize: FS }]}>${g.netExpB.toFixed(1)}B</Text>
        <Text style={[S.tHCellR, { flex: C[7], fontSize: FS, color: g.wowDeltaNetB >= 0 ? BRAND.green : BRAND.red }]}>{g.wowDeltaNetB >= 0 ? "+" : "-"}${Math.abs(g.wowDeltaNetB).toFixed(2)}B</Text>
        <Text style={[sgnN(nOi, C[8]), { fontFamily: "Helvetica-Bold" }]}>{dBN(nOi)}</Text>
        <Text style={[sgnN(nPx, C[9]), { fontFamily: "Helvetica-Bold" }]}>{dBN(nPx)}</Text>
        <Text style={[S.tHCellR, { flex: C[10], fontSize: FS }]}> </Text>
        <Text style={[S.tHCellR, { flex: C[11] + C[12], fontSize: FS }]}>100% share</Text>
      </View>
    );
  })()}
  ```

- [ ] **Step 7: Verify TypeScript compiles clean**

  ```bash
  cd frontend && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: zero errors.

- [ ] **Step 8: Run all tests**

  ```bash
  cd frontend && npm test 2>&1 | tail -20
  ```

  Expected: all tests pass.

- [ ] **Step 9: Visual validation — generate a PDF**

  In the running app, click "↓ Download PDF" and open the PDF. Check:
  - Page 1 commodity table has 13 readable column headers at 6pt
  - Commodity names are not truncated beyond recognition (if they are, reduce `C[0]` from 1.2 to 1.0 and re-generate)
  - Attribution columns (OI Δ, Px Δ) have correct sign coloring — green for inflows, red for outflows
  - Null cells (e.g. lumber) show "—"
  - Sector rows show subtotals in bold
  - Total row shows grand totals for WoW and attribution columns

- [ ] **Step 10: Commit**

  ```bash
  git add frontend/lib/pdf/PdfReport.tsx
  git commit -m "feat: expand PDF commodity table to 13 columns with attribution"
  ```

---

## Final verification

- [ ] Run full test suite one last time

  ```bash
  cd frontend && npm test 2>&1 | tail -20
  ```

  Expected: all tests pass.

- [ ] Check TypeScript

  ```bash
  cd frontend && npx tsc --noEmit 2>&1
  ```

  Expected: zero errors.

- [ ] Open app, test Chart/Table toggle in Step 1, download PDF, verify both features work end to end.
