# Exports Tab Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four chart improvements to the Brazil Exports sub-tab: cumulative crop-year pace, type share evolution, seasonality heatmap, and hub share-change column.

**Architecture:** All additions are self-contained function components added to the existing `BrazilTab.tsx` file, following the established pattern. No new files, no new dependencies, no new data fetches — all data comes from the `series: VolumeSeries[]` already loaded.

**Tech Stack:** Next.js 14, React 18, TypeScript, Recharts 3, Tailwind CSS

---

## File Map

| Action | Path | Change |
|---|---|---|
| Modify | `frontend/components/supply/BrazilTab.tsx` | Add 3 new chart components + modify `DestinationChart` + wire into render |

---

## Task 1: CumulativePaceChart

**Files:**
- Modify: `frontend/components/supply/BrazilTab.tsx`

- [ ] **Step 1: Add the `CumulativePaceChart` component**

Insert this function in `BrazilTab.tsx` immediately after the `RollingAvgChart` function (around line 931, before `// ── Country/hub filter`):

```tsx
// ── Cumulative crop-year pace ─────────────────────────────────────────────

function CumulativePaceChart({ series, filteredSeries, typeFilter }: {
  series: VolumeSeries[];
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
}) {
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  // Group by crop year → crop month index → cumulative kt
  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    activeSeries.forEach(r => {
      const ck = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: bagsToKT(r[activeKey] ?? r.total) });
    });
    // Sort each year's entries by crop month index, compute cumulative
    const result: Record<string, (number | null)[]> = {};
    Object.entries(byYear).forEach(([ck, pts]) => {
      pts.sort((a, b) => a.mo - b.mo);
      const arr: (number | null)[] = Array(12).fill(null);
      let cum = 0;
      pts.forEach(({ mo, kt }) => { cum += kt; arr[mo] = Math.round(cum * 10) / 10; });
      result[ck] = arr;
    });
    return result;
  }, [activeSeries, activeKey]);

  const sortedKeys = Object.keys(grouped).sort();
  if (sortedKeys.length < 2) return null;

  const currentKey = sortedKeys[sortedKeys.length - 1];
  const prior1Key  = sortedKeys[sortedKeys.length - 2];
  const prior2Key  = sortedKeys.length >= 3 ? sortedKeys[sortedKeys.length - 3] : null;

  // Last non-null index for current year
  const currentArr = grouped[currentKey];
  const lastIdx    = currentArr.reduce((acc, v, i) => v !== null ? i : acc, -1);
  const lastKt     = lastIdx >= 0 ? currentArr[lastIdx] : null;

  // Pace vs prior year (same crop month)
  const prior1Arr   = grouped[prior1Key];
  const prior1AtIdx = lastIdx >= 0 ? prior1Arr[lastIdx] : null;
  const pacePct     = lastKt && prior1AtIdx && prior1AtIdx > 0
    ? Math.round((lastKt - prior1AtIdx) / prior1AtIdx * 100 * 10) / 10
    : null;

  const chartData = CROP_MONTH_LABELS.map((month, i) => ({
    month,
    [currentKey]: grouped[currentKey][i],
    [prior1Key]:  grouped[prior1Key][i],
    ...(prior2Key ? { [prior2Key]: grouped[prior2Key][i] } : {}),
  }));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Cumulative Crop-Year Pace
          </div>
          <div className="text-[10px] text-slate-500">
            Cumulative exports by crop month (Apr → Mar) · kt
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [v !== null ? `${v} kt` : "—", `Crop ${name}`]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>Crop {v}</span>} />
          {prior2Key && (
            <Line type="monotone" dataKey={prior2Key} stroke="#475569"
              strokeWidth={1} dot={false} connectNulls />
          )}
          <Line type="monotone" dataKey={prior1Key} stroke="#60a5fa"
            strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey={currentKey} stroke="#ef4444"
            strokeWidth={2.5} dot={(props: any) => {
              if (props.index !== lastIdx || props.payload?.[currentKey] == null) return <g key={props.key} />;
              return (
                <g key={props.key}>
                  <circle cx={props.cx} cy={props.cy} r={3} fill="#ef4444" />
                  <text x={props.cx + 6} y={props.cy - 4} fill="#f87171" fontSize={9} fontFamily="monospace">
                    {lastKt}kt
                  </text>
                </g>
              );
            }}
            connectNulls />
        </LineChart>
      </ResponsiveContainer>
      {pacePct !== null && (
        <div className="text-[10px] text-slate-500 mt-1">
          {currentKey} pace vs {prior1Key}:{" "}
          <span className={`font-bold ${pacePct >= 0 ? "text-green-400" : "text-red-400"}`}>
            {pacePct >= 0 ? "+" : ""}{pacePct}%
          </span>{" "}
          at same crop-month
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `CumulativePaceChart` into the BrazilTab render**

In the BrazilTab return, find the line:
```tsx
<AnnualTrendChart    series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
```

Insert immediately **before** it:
```tsx
<CumulativePaceChart series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
```

- [ ] **Step 3: Visual check**

```bash
cd frontend && npm run dev
```

Open http://localhost:3000/supply → Exports tab. Verify:
- Chart appears between Monthly Volume and Annual Trend charts
- Three lines visible (current red, prior blue, two-ago slate)
- Red line stops at current data month with a kt label
- Pace Δ% shown below chart
- Selecting a hub/country filter or type pill updates the chart

- [ ] **Step 4: Commit**

```bash
git add frontend/components/supply/BrazilTab.tsx
git commit -m "feat: add cumulative crop-year pace chart to Exports tab"
```

---

## Task 2: TypeShareChart

**Files:**
- Modify: `frontend/components/supply/BrazilTab.tsx`

- [ ] **Step 1: Add the `TypeShareChart` component**

Insert immediately after the `AnnualTrendChart` function (around line 757, before `// ── Y/Y change by type`):

```tsx
// ── Coffee type share evolution ───────────────────────────────────────────

function TypeShareChart({ series }: { series: VolumeSeries[] }) {
  const [since, setSince] = useState(2010);

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; months: number }> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].months   += 1;
    });

    return Object.entries(byCrop)
      .filter(([k]) => parseInt(k.split("/")[0]) >= since)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, d]) => {
        const total = d.arabica + d.conillon + d.soluvel + d.torrado;
        if (total === 0) return null;
        return {
          year:     k,
          Arabica:  Math.round(d.arabica  / total * 1000) / 10,
          Conillon: Math.round(d.conillon / total * 1000) / 10,
          Soluble:  Math.round(d.soluvel  / total * 1000) / 10,
          Roasted:  Math.round(d.torrado  / total * 1000) / 10,
        };
      })
      .filter(Boolean) as { year: string; Arabica: number; Conillon: number; Soluble: number; Roasted: number }[];
  }, [series, since]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Coffee Type Share — Crop Year Mix</div>
          <div className="text-[10px] text-slate-500">% of total exports per type · complete and partial crop years</div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [`${v}%`, name]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          <Bar dataKey="Arabica"  stackId="s" fill={GREEN} />
          <Bar dataKey="Conillon" stackId="s" fill={TEAL}  />
          <Bar dataKey="Soluble"  stackId="s" fill={AMBER} />
          <Bar dataKey="Roasted"  stackId="s" fill={BLUE}  />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Wire `TypeShareChart` into the BrazilTab render**

Find:
```tsx
<YoYByTypeChart      series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
```

Insert immediately **before** it:
```tsx
<TypeShareChart series={series} />
```

- [ ] **Step 3: Visual check**

Verify in browser:
- Chart appears between Annual Trend and Y/Y Change charts
- Each bar sums to ~100% with 4 color segments
- Year filter buttons (2000+/2010+/2015+) work correctly
- Tooltip shows type name and % on hover

- [ ] **Step 4: Commit**

```bash
git add frontend/components/supply/BrazilTab.tsx
git commit -m "feat: add coffee type share evolution chart to Exports tab"
```

---

## Task 3: SeasonalityHeatmap

**Files:**
- Modify: `frontend/components/supply/BrazilTab.tsx`

- [ ] **Step 1: Add helper and the `SeasonalityHeatmap` component**

Insert immediately after the `TypeShareChart` function (before `// ── Rolling average trend`):

```tsx
// ── Monthly seasonality heatmap ───────────────────────────────────────────

function intensityColor(ratio: number): string {
  if (ratio >= 0.90) return "#60a5fa";
  if (ratio >= 0.75) return "#2563eb";
  if (ratio >= 0.60) return "#1d4ed8";
  if (ratio >= 0.40) return "#1e3a5f";
  if (ratio >= 0.20) return "#1e293b";
  return "#0f172a";
}

function SeasonalityHeatmap({ series }: { series: VolumeSeries[] }) {
  const ROWS = 7; // show last 7 crop years

  const { cropKeys, grid, latestCropMonth } = useMemo(() => {
    // Group by crop year → crop month index → kt
    const byYear: Record<string, number[]> = {};
    series.forEach(r => {
      const ck  = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = Array(12).fill(0);
      byYear[ck][idx] += bagsToKT(r.total);
    });

    const sorted = Object.keys(byYear).sort();
    const shown  = sorted.slice(-ROWS);
    const currentCk = sorted[sorted.length - 1];

    // Find latest crop month index in current crop year
    const currentData = byYear[currentCk] ?? [];
    let lastIdx = -1;
    currentData.forEach((v, i) => { if (v > 0) lastIdx = i; });

    // Build grid: for each year, normalize by that year's peak month
    const grid = shown.map(ck => {
      const row = byYear[ck];
      const peak = Math.max(...row.filter(v => v > 0), 1);
      return { ck, cells: row.map(v => v > 0 ? v / peak : null), raw: row };
    });

    return { cropKeys: shown, grid, latestCropMonth: lastIdx };
  }, [series]);

  const currentCk = cropKeys[cropKeys.length - 1];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-200">Monthly Seasonality Heatmap</div>
        <div className="text-[10px] text-slate-500">
          Cell shade = volume relative to each year's peak month · dashed = not yet elapsed
        </div>
      </div>
      <div
        className="grid gap-[3px] text-[8px]"
        style={{ gridTemplateColumns: `44px repeat(12, 1fr)` }}
      >
        {/* Header row */}
        <div />
        {CROP_MONTH_LABELS.map(m => (
          <div key={m} className="text-center text-slate-500 pb-1">{m}</div>
        ))}

        {/* Data rows — newest first */}
        {[...grid].reverse().map(({ ck, cells, raw }) => (
          <>
            <div
              key={`${ck}-label`}
              className={`text-right pr-2 flex items-center justify-end ${
                ck === currentCk ? "text-slate-200 font-bold" : "text-slate-500"
              }`}
            >
              {ck.split("/")[1] ? `${ck.split("/")[0].slice(2)}/${ck.split("/")[1]}` : ck}
            </div>
            {cells.map((ratio, i) => {
              const isFuture = ck === currentCk && i > latestCropMonth;
              const kt       = Math.round(raw[i] * 10) / 10;
              const pct      = ratio !== null ? Math.round(ratio * 100) : null;
              return (
                <div
                  key={i}
                  title={ratio !== null ? `${CROP_MONTH_LABELS[i]}: ${kt}kt (${pct}% of peak)` : "No data"}
                  className={`h-5 rounded-[2px] ${isFuture ? "border border-dashed border-slate-700" : ""}`}
                  style={{
                    background: isFuture ? "#0f172a" : (ratio !== null ? intensityColor(ratio) : "#0f172a"),
                  }}
                />
              );
            })}
          </>
        ))}
      </div>

      {/* Color scale legend */}
      <div className="flex items-center gap-2 mt-3 text-[9px] text-slate-500">
        <span>Low</span>
        {[0.1, 0.3, 0.5, 0.68, 0.83, 0.95].map(r => (
          <div key={r} className="w-5 h-3 rounded-[2px]" style={{ background: intensityColor(r) }} />
        ))}
        <span>Peak</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `SeasonalityHeatmap` into the BrazilTab render**

Find:
```tsx
<RollingAvgChart     series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
```

Insert immediately **before** it:
```tsx
<SeasonalityHeatmap series={series} />
```

- [ ] **Step 3: Visual check**

Verify in browser:
- Grid shows 7 rows (crop years) × 12 columns (Apr–Mar), newest crop at top
- Blue intensity varies by month — darker in slow months, brighter in peak months
- Current crop year's future months show dashed empty cells
- Hovering a cell shows a tooltip with `[Month]: X kt (Y% of peak)`
- Color scale legend appears below

- [ ] **Step 4: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/supply/BrazilTab.tsx
git commit -m "feat: add monthly seasonality heatmap to Exports tab"
```

---

## Task 4: Hub Share-Change Column in DestinationChart

**Files:**
- Modify: `frontend/components/supply/BrazilTab.tsx` — `DestinationChart` function and `hubRows` useMemo

- [ ] **Step 1: Add share Δpp to `hubRows` computation**

Find the `hubRows` useMemo inside `DestinationChart` (around line 1263). Replace it with:

```tsx
const hubRows = useMemo(() => {
  const totalCurrent = Object.values(hubTotals).reduce((s, v) => s + v.current, 0);
  const totalPrev    = Object.values(hubTotals).reduce((s, v) => s + v.prev,    0);

  return HUB_ORDER
    .map(hub => {
      const v = hubTotals[hub] ?? { current: 0, prev: 0 };
      const shareCurrent = totalCurrent > 0 ? v.current / totalCurrent * 100 : 0;
      const sharePrev    = totalPrev    > 0 ? v.prev    / totalPrev    * 100 : 0;
      const shareDelta   = Math.round((shareCurrent - sharePrev) * 10) / 10;
      return {
        label:      hub,
        current:    bagsToKT(v.current),
        prev:       bagsToKT(v.prev),
        pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
        shareDelta: totalPrev > 0 ? shareDelta : null,
      };
    })
    .filter(r => r.current > 0 || r.prev > 0)
    .sort((a, b) => b.current - a.current);
}, [hubTotals]);
```

- [ ] **Step 2: Update the YoY change table to show share Δpp when in hub mode**

Find the YoY change table (starts `{/* YoY change table */}`, around line 1364). Replace the entire block with:

```tsx
{/* YoY change table */}
<div className="mt-4 text-[10px]">
  {/* Header */}
  <div className={`grid pb-1 border-b border-slate-700 text-slate-500 font-medium gap-x-6`}
    style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}>
    <span>Destination</span>
    <span className="text-right">YoY vol. (same period)</span>
    {mode === "hub" && <span className="text-right">Share Δpp</span>}
  </div>

  {rows.map(r => {
    const hubRow = r as typeof hubRows[0];
    return (
      <div
        key={r.label}
        className="grid gap-x-6 py-0.5 border-b border-slate-800"
        style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}
      >
        <span className="text-slate-300 truncate">{r.label}</span>
        <span className={`text-right ${
          r.pct === null ? "text-slate-500" : r.pct >= 0 ? "text-green-400" : "text-red-400"
        }`}>
          {r.pct === null ? "n/a" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}
        </span>
        {mode === "hub" && (
          <span className={`text-right ${
            hubRow.shareDelta === null ? "text-slate-500"
            : hubRow.shareDelta > 0   ? "text-green-400"
            : hubRow.shareDelta < 0   ? "text-red-400"
            : "text-slate-500"
          }`}>
            {hubRow.shareDelta === null ? "n/a"
              : `${hubRow.shareDelta > 0 ? "+" : ""}${hubRow.shareDelta}pp`}
          </span>
        )}
      </div>
    );
  })}
</div>
```

Note: The `rows` variable is typed as `typeof countryRows` in the existing code. TypeScript may warn on `hubRow.shareDelta` since `countryRows` entries don't have that field. Add `shareDelta?: number | null` to the return type of `countryRows` by adding `shareDelta: null` to each country row:

Find the `countryRows` useMemo and add `shareDelta: null` to each mapped object:
```tsx
const countryRows = useMemo(() =>
  Object.entries(countryTotals)
    .sort((a, b) => b[1].current - a[1].current)
    .slice(0, topN)
    .map(([pt, v]) => {
      const en = toEn(pt);
      return {
        label:      en.length > 20 ? en.slice(0, 19) + "…" : en,
        current:    bagsToKT(v.current),
        prev:       bagsToKT(v.prev),
        pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
        shareDelta: null as number | null,
      };
    })
, [countryTotals, topN]);
```

- [ ] **Step 3: Visual check**

Switch to "By Hub" mode in the destination chart. Verify:
- Table below the bar chart shows three columns: Destination | YoY vol. | Share Δpp
- Share Δpp values are green for positive, red for negative
- Switching to "By Country" mode hides the Share Δpp column (only 2 columns visible)
- Values sum to ~0pp across all hubs (net zero-sum)

- [ ] **Step 4: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/supply/BrazilTab.tsx
git commit -m "feat: add share Δpp column to hub view in destination chart"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| Cumulative pace chart — 3 lines, pace Δ%, respects type filter | Task 1 |
| Type share chart — 100% stacked, 4 types, year filter | Task 2 |
| Seasonality heatmap — 7 years × 12 months, blue intensity, dashed future | Task 3 |
| Heatmap tooltip with kt + % of peak | Task 3 |
| Color scale legend | Task 3 |
| Hub share Δpp column — computed from totals, hidden in country mode | Task 4 |
| Render order in BrazilTab | Tasks 1–4 wire steps |

**Placeholder scan:** All code blocks are complete. No TBDs.

**Type consistency:**
- `cropYearKey`, `bagsToKT`, `CROP_MONTH_ORDER`, `CROP_MONTH_LABELS`, `TT_STYLE`, `GREEN`, `TEAL`, `AMBER`, `BLUE`, `SLATE` — all defined earlier in `BrazilTab.tsx` ✓
- `VolumeSeries`, `SeriesKey` — defined at top of `BrazilTab.tsx` ✓
- `countryRows` and `hubRows` now both have `shareDelta` field ✓
- `hubTotals` useMemo already computed above `hubRows` in `DestinationChart` ✓
