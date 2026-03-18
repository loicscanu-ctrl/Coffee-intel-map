# Exposure Attribution (OI Effect vs Price Effect) — Design Spec

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan.

**Goal:** For each commodity, decompose the week-over-week change in MM notional exposure into two components — the part driven by a change in position size (OI effect) and the part driven by a change in price (Price effect). Surface this in the COT dashboard Step 1 and in the PDF page 1 table.

**Architecture:** Pure frontend computation. All position data (mm_long, mm_short, close_price) is returned by `/api/macro-cot`. `contract_unit` is NOT in the API response — it is a static constant per symbol, duplicated as a TypeScript map `COMMODITY_SPECS_FRONTEND` in `dataHelpers.ts`. Attribution is computed in `dataHelpers.ts`, stored in `types.ts` data shapes, rendered as a toggle view in `CotDashboard.tsx`, and added as new columns in `PdfReport.tsx`. No backend changes.

**Tech Stack:** TypeScript, React, Recharts (existing), @react-pdf/renderer (existing)

---

## Formulas

For each commodity, comparing latest week (subscript `n`) to previous week (subscript `p`):

**Definitions:**
- `gross_oi = mm_long + mm_short` (MM gross lots — NOT `oi_total` which covers all participants)
- `net_oi   = mm_long - mm_short` (MM net lots)
- `price` = `close_price` from the API — already normalized to USD per base unit (cents-per-lb commodities such as corn, arabica, cotton have already been divided by 100 before storage; no additional unit conversion is needed in the frontend)

```
grossOiEffectUSD    = (gross_oi_n - gross_oi_p) × price_p × contract_unit
grossPriceEffectUSD = gross_oi_n              × (price_n - price_p) × contract_unit

netOiEffectUSD      = (net_oi_n - net_oi_p)   × price_p × contract_unit
netPriceEffectUSD   = net_oi_n                × (price_n - price_p) × contract_unit
```

**Convention note:** The price effect uses the *current-period* quantity (gross_oi_n / net_oi_n), which assigns the interaction term to the price effect. This is a deliberate choice — do not "correct" it to use the prior period. Under this convention the invariant holds with zero residual:

```
grossOiEffect + grossPriceEffect
  = (gross_oi_n - gross_oi_p) × price_p × cu + gross_oi_n × (price_n - price_p) × cu
  = gross_oi_n × price_n × cu  -  gross_oi_p × price_p × cu
  = gross_exposure_usd_n  -  gross_exposure_usd_p   ✓
```

This holds because the backend computes `gross_exposure_usd = (mm_long + mm_short) × close_price × contract_unit` (verified in `backend/routes/macro_cot.py`, `_compute_exposures()`). The same identity holds for net.

**Null conditions:** Both effects are `null` when:
- `close_price` is null in either the current or previous week for this symbol
- The symbol has no previous-week entry (new commodity, or first week of history)
- `contract_unit` is not found in `COMMODITY_SPECS_FRONTEND` for this symbol

---

## File Map

| File | Change |
|---|---|
| `frontend/lib/pdf/types.ts` | Add 4 fields (`number | null`) to `CommodityRow`; add 4 fields (`number | null`) to `sectorBreakdown` items in `GlobalFlowMetrics` |
| `frontend/lib/pdf/dataHelpers.ts` | Add `COMMODITY_SPECS_FRONTEND` constant (contract_unit per symbol); compute 4 attribution fields per commodity in `buildGlobalFlowMetrics()`; compute sector subtotals |
| `frontend/components/futures/CotDashboard.tsx` | Add `step1View` state; render Chart/Table toggle; render `AttributionTable` when in table mode |
| `frontend/lib/pdf/PdfReport.tsx` | Expand `CommodityTable` from 9 to 13 columns; add null-safe formatter; update `SectorRow` and commodity row JSX |

---

## Section 1 — types.ts

### `CommodityRow` — 4 new fields (all `number | null`)

```typescript
// Attribution: WoW notional change split by cause ($B)
// null when price data is unavailable for either week
grossOiEffectB:    number | null;
grossPriceEffectB: number | null;
netOiEffectB:      number | null;
netPriceEffectB:   number | null;
```

### `sectorBreakdown` array items — 4 new fields (all `number | null`)

```typescript
grossOiEffectB:    number | null;  // null if ALL commodities in sector have null attribution
grossPriceEffectB: number | null;
netOiEffectB:      number | null;
netPriceEffectB:   number | null;
```

Subtotals are null when every commodity in the sector has a null value for that field (meaning data is genuinely unavailable, not zero). If at least one commodity has a non-null value, the subtotal is a numeric sum (null commodities contribute 0 to the sum).

---

## Section 2 — dataHelpers.ts

### `COMMODITY_SPECS_FRONTEND` constant

A plain object keyed by symbol string, value is `{ contract_unit: number }`. Values copied from `COMMODITY_SPECS` in `backend/scraper/sources/macro_cot.py`. Only `contract_unit` is needed. All 28 symbols must be present:

```typescript
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

This constant is module-private (not exported) — only used inside `dataHelpers.ts`.

### Attribution computation in `buildGlobalFlowMetrics()`

Inside the per-commodity `map` loop (where `prevEntry` is already available):

```typescript
const cu = COMMODITY_SPECS_FRONTEND[sym]?.contract_unit ?? null;
const prevMmLong  = prevEntry?.mm_long  ?? null;
const prevMmShort = prevEntry?.mm_short ?? null;
const prevPrice   = prevEntry?.close_price ?? null;
const curPrice    = entry.close_price ?? null;

let grossOiEffectB:    number | null = null;
let grossPriceEffectB: number | null = null;
let netOiEffectB:      number | null = null;
let netPriceEffectB:   number | null = null;

if (
  cu !== null &&
  prevPrice !== null && curPrice !== null &&
  prevMmLong !== null && prevMmShort !== null
  // curMmLong / curMmShort are typed number (never null) per MacroCotEntry — no guard needed
) {
  const curMmLong  = entry.mm_long;
  const curMmShort = entry.mm_short;
  const dGrossOi   = (curMmLong + curMmShort) - (prevMmLong + prevMmShort);
  const dNetOi     = (curMmLong - curMmShort)  - (prevMmLong - prevMmShort);
  const dPrice     = curPrice - prevPrice;

  grossOiEffectB    = (dGrossOi             * prevPrice * cu) / 1e9;
  grossPriceEffectB = ((curMmLong + curMmShort) * dPrice * cu) / 1e9;
  netOiEffectB      = (dNetOi               * prevPrice * cu) / 1e9;
  netPriceEffectB   = ((curMmLong - curMmShort)  * dPrice * cu) / 1e9;
}
```

These 4 values are then included in the `CommodityRow` object returned by the `.map()`.

### Sector subtotals

After the commodity map, compute sector attribution subtotals. For each of the 4 fields:
- If ALL commodities in a sector have `null` for that field → sector subtotal = `null`
- If at least one commodity has a non-null value → sector subtotal = sum of non-null values (null treated as 0)

Add these to the existing `sectorBreakdown` map computation.

---

## Section 3 — CotDashboard.tsx (Step 1 toggle)

### State

```typescript
const [step1View, setStep1View] = useState<"chart" | "table">("chart");
```

This state is local to Step 1. Navigating away and back resets to "chart" is acceptable.

### Toggle UI placement

Place the Chart / Table toggle **to the left** of the existing gross/net/long/short mode switcher, in the same flex row that contains the step header controls. Both controls are visible simultaneously. The toggle has two pill buttons: "Chart" and "Table".

### Behavior when "Table" is active

**Both Panel A (stacked area chart) and Panel B (MM sector bar chart) are hidden.** The `AttributionTable` replaces the entire chart area for Step 1. The gross/net/long/short mode switcher remains visible but has no effect in table mode (it only affects the chart). This is acceptable — the table always shows all four attribution fields regardless of the chart mode.

### Data wiring

`CotDashboard.tsx` currently calls `fetchMacroCot()` and passes the result to `transformMacroData()` for chart rendering, but does NOT currently call `buildGlobalFlowMetrics()`. The `commodityTable` (with attribution fields) only exists in the PDF generation path.

To wire the `AttributionTable`, `CotDashboard.tsx` must also call `buildGlobalFlowMetrics(macroData)` and store the result in a `useMemo`:

```typescript
const globalFlowMetrics = useMemo(
  () => macroData.length >= 2 ? buildGlobalFlowMetrics(macroData) : null,
  [macroData]
);
```

The `globalFlowMetrics` object (and its `commodityTable` / `sectorBreakdown`) is then available for `AttributionTable`. The PDF generation path already calls `buildGlobalFlowMetrics()` independently — no changes needed there.

### `AttributionTable` component

Reads from `globalFlowMetrics.commodityTable` and `globalFlowMetrics.sectorBreakdown`.

**Columns:**
```
Commodity | Gross WoW $B | OI Δ $B | Px Δ $B | Net WoW $B | OI Δ $B | Px Δ $B
```

**Row types:**
1. **Sector header rows** — slightly darker background (`#1e293b`), bold. Show subtotals from `sectorBreakdown`. If a subtotal is null, display `—`.
2. **Commodity rows** — alternating `transparent` / `#0f172a`. Show per-commodity values. Null → `—`.

**Sort order:** Render-time only. Sort by sector (using `SECTOR_ORDER`), then within each sector by absolute `deltaB` (gross WoW) descending. Do NOT mutate `commodityTable` — create a sorted copy for rendering.

**Formatting:**
- Non-null numbers: `formatAttr(n: number | null): string` — if null return `"—"`, otherwise `(n >= 0 ? "+" : "") + n.toFixed(2) + "B"`
- Color: green (`#10b981`) for positive, red (`#ef4444`) for negative, grey (`#6b7280`) for null/zero

---

## Section 4 — PdfReport.tsx (CommodityTable)

### Column layout — 13 columns

The two new OI Δ / Px Δ column pairs are **inserted between** the existing WoW columns and the existing % columns. The column order changes — this is a deliberate reorder, not just an append.

Old layout (9 columns, indices 0–8):
```
[0] COMMODITY  [1] GROSS $B  [2] GRS WoW  [3] GRS %
[4] NET $B     [5] NET WoW   [6] NET %
[7] SHARE %    [8] Δ SHR
```

New layout (13 columns, indices 0–12):
```
[0] COMMODITY  [1] GROSS $B  [2] GRS WoW  [3] OI Δ   [4] Px Δ  [5] GRS %
[6] NET $B     [7] NET WoW   [8] OI Δ    [9] Px Δ  [10] NET %
[11] SHARE %  [12] Δ SHR
```

New `C` array (13 elements):
```typescript
const C = [1.2, 0.75, 0.70, 0.60, 0.60, 0.50, 0.75, 0.70, 0.60, 0.60, 0.50, 0.65, 0.50];
```

**All** hardcoded index references in `SectorRow`, `CommodityRow_`, the header row, and any total/span calculations must be updated to use the new indices. There are no spans or merged cells that reference `C[n] + C[m]` — each cell uses its own single `C[n]` flex. Verify this during implementation.

### Null-safe formatter

Add a new formatter alongside the existing `dB`:

```typescript
const dBN = (n: number | null): string => n == null ? "—" : dB(n);
```

This is used for the 4 attribution columns only.

### Attribution cell rendering

Attribution columns use:
- `dBN(row.grossOiEffectB)` / `dBN(row.grossPriceEffectB)` / `dBN(row.netOiEffectB)` / `dBN(row.netPriceEffectB)`
- Style: `sgn(n ?? 0, C[3])` for color, but if null use neutral style instead (no red/green)
- Null-safe style helper: `const sgnN = (v: number | null, flex: number) => v == null ? neu(flex) : sgn(v, flex);`

### `SectorRow` update

Sector rows show attribution subtotals. Columns 3, 4, 8, 9 use `dBN()` and `sgnN()` with the sector's attribution fields from `sectorBreakdown`.

### Total row behavior

The PDF table has a grand-total row at the bottom. For the four attribution columns (indices 3, 4, 8, 9), the total row shows the sector-subtotal sums (sum of all non-null attribution values across all sectors). If all are null, display `—`. Use `dBN()` and `sgnN()` for these cells.

### Visual validation requirement

After implementation, generate a sample PDF and visually verify that:
- All 13 column headers are readable at 6pt
- No commodity name is truncated beyond recognition (if truncation occurs, reduce C[0] further to 1.0 and/or abbreviate long names like "NY Harbor ULSD (Heating Oil)" → "ULSD Heating Oil")
- Attribution values display with correct sign coloring
- Null cells show `—` cleanly

---

## Out of Scope

- No backend changes
- No new API endpoint
- No changes to Steps 2–6 of the dashboard
- No changes to PDF pages 2+
- No historical attribution chart (only current WoW)
