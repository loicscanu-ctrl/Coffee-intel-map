"use client";
import { useEffect, useState } from "react";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, ReferenceLine, ReferenceArea,
} from "recharts";
import { K_CEILING, logisticIntensity, MODEL_LIMITS } from "@/lib/demandCeilings";

interface AnnualEntry {
  year: string;
  consumption_mt?: number | null;
  imports_mt?: number | null;
}

interface GrowthMarket {
  short: string;
  name: string;
  latest_year: string | null;
  consumption_mt: number | null;
  population: number | null;
  per_capita_kg: number | null;
  annual: AnnualEntry[];
}

interface CohortCountry {
  name: string;
  annual: { year: number; pop_18plus: number }[];
}

interface DemandStocks {
  growth_markets?: GrowthMarket[];
  populations?: { source: string; last_updated: string };
  age_cohort_18plus?: { countries: Record<string, CohortCountry> };
}

// Bridge growth_markets' full-name keys → age_cohort_18plus' ISO3 keys so the
// per-country consumption series can be joined to its drinking-age population.
const NAME_ISO3: Record<string, string> = {
  brazil: "bra", china: "chn", vietnam: "vnm", indonesia: "idn",
  russia: "rus", ethiopia: "eth", korea: "kor", mexico: "mex",
  turkey: "tur", india: "ind", egypt: "egy", philippines: "phl",
};

const PROJ_END = 2050;

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

// Stable color per country — also used in the trend chart
const COUNTRY_COLORS: Record<string, string> = {
  china:       "#dc2626",
  india:       "#f59e0b",
  brazil:      "#16a34a",
  indonesia:   "#0ea5e9",
  vietnam:     "#a855f7",
  russia:      "#3b82f6",
  mexico:      "#10b981",
  turkey:      "#ef4444",
  philippines: "#06b6d4",
  egypt:       "#facc15",
  korea:       "#ec4899",
  ethiopia:    "#84cc16",
};

function fmtMt(mt: number | null | undefined): string {
  if (mt == null) return "—";
  if (mt >= 1_000_000) return `${(mt / 1_000_000).toFixed(2)}Mt`;
  if (mt >= 1_000)     return `${Math.round(mt / 1000)}kt`;
  return `${Math.round(mt)}t`;
}

function fmtPop(p: number | null | undefined): string {
  if (p == null) return "—";
  if (p >= 1_000_000_000) return `${(p / 1_000_000_000).toFixed(2)}B`;
  if (p >= 1_000_000)     return `${Math.round(p / 1_000_000)}M`;
  return String(p);
}

// ── Demand projection ───────────────────────────────────────────────────────
// Joins each market's USDA consumption series with its projected 18+ population
// to (a) express consumption per drinking-age adult ("intensity") and (b) carry
// demand past 2025 to 2050: base case freezes intensity (demand moves only with
// the adult population); the S-curve scenario bends intensity toward the market's
// saturation ceiling K (per the Demand-modelling research methodology) at the
// observed recent growth rate. Both ride the same projected-adult population.
function DemandProjection({ markets, cohorts }: {
  markets: GrowthMarket[];
  cohorts: Record<string, CohortCountry>;
}) {
  // Only markets we can both join (have a cohort) and that carry consumption.
  const joinable = markets.filter(m => cohorts[NAME_ISO3[m.short] ?? ""]);
  const [sel, setSel] = useState(joinable[0]?.short ?? "");
  const [metric, setMetric] = useState<"total" | "intensity">("total");
  const [showLimits, setShowLimits] = useState(false);

  const mkt = joinable.find(m => m.short === sel) ?? joinable[0];
  if (!mkt) return null;
  const cohort = cohorts[NAME_ISO3[mkt.short]];

  const pop: Record<number, number> = {};
  for (const a of cohort.annual) pop[a.year] = a.pop_18plus;
  const cons: Record<number, number> = {};
  for (const a of mkt.annual) {
    if (a.consumption_mt != null) cons[Number(a.year)] = a.consumption_mt;
  }
  // Per-adult intensity (kg/adult/yr) for years present in BOTH series.
  const inten: Record<number, number> = {};
  for (const ys of Object.keys(cons)) {
    const y = Number(ys);
    const p = pop[y];
    if (p) inten[y] = (cons[y] * 1000) / p;
  }
  const overlap = Object.keys(inten).map(Number).sort((a, b) => a - b);
  const consYears = Object.keys(cons).map(Number);
  const ly = consYears.length ? Math.max(...consYears) : 0;
  const i0 = inten[ly];
  if (!overlap.length || i0 == null) return null;

  // Full-window CAGR of intensity — seeds the S-curve's initial growth rate.
  const y0 = overlap[0];
  const g = Math.pow(inten[ly] / inten[y0], 1 / (ly - y0)) - 1;

  // Saturation ceiling (kg/adult) for this market, and the bounded logistic
  // intensity path toward it. Replaces the old uncapped CAGR extrapolation:
  // fast-growers now bend to a credible plateau instead of exploding.
  const K = K_CEILING[mkt.short] ?? i0 * 3;
  const projI = logisticIntensity(i0, g, K, ly, PROJ_END);

  const color = COUNTRY_COLORS[mkt.short] ?? "#6366f1";
  const isTotal = metric === "total";
  const limitsForMkt = MODEL_LIMITS.filter(l => l.markets.includes(mkt.short));

  // One row per year (2000 → 2050). actual stops at the latest year; base/trend
  // start there (sharing the latest point so the lines connect seamlessly).
  const chart: Record<string, number | null>[] = [];
  for (let y = 2000; y <= PROJ_END; y++) {
    const p = pop[y];
    const iy = projI[y];
    const row: Record<string, number | null> = { year: y };
    if (isTotal) {
      row.actual = y <= ly && cons[y] != null ? cons[y] / 1000 : null;
      row.base   = y >= ly && p ? i0 * p / 1e6 : null;
      row.trend  = y >= ly && p && iy != null ? iy * p / 1e6 : null;
    } else {
      row.actual = y <= ly && inten[y] != null ? inten[y] : null;
      row.base   = y >= ly ? i0 : null;
      row.trend  = y >= ly && iy != null ? iy : null;
    }
    chart.push(row);
  }

  const p2050 = pop[PROJ_END] ?? 0;
  const base2050 = i0 * p2050 / 1e6;
  const trend2050 = (projI[PROJ_END] ?? i0) * p2050 / 1e6;
  const act = cons[ly] / 1000;
  const adultGrowth = pop[ly] ? p2050 / pop[ly] - 1 : 0;
  const unit = isTotal ? "kt" : "kg/adult";
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

  const Stat = ({ label, value, sub, tone }: {
    label: string; value: string; sub?: string; tone?: string;
  }) => (
    <div className="bg-slate-900/60 rounded px-2.5 py-1.5">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-mono ${tone ?? "text-slate-100"}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500 font-mono">{sub}</div>}
    </div>
  );

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Demand Projection to 2050 — per-adult intensity × drinking-age population
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLimits(s => !s)}
            className={`text-[9px] px-2 py-0.5 rounded border ${showLimits ? "border-amber-500/60 text-amber-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
            ⚠ Model limits
          </button>
          <div className="flex rounded overflow-hidden border border-slate-700 text-[9px]">
            {([["total", "Total demand (kt)"], ["intensity", "Per-adult (kg)"]] as const).map(([m, lbl]) => (
              <button key={m} onClick={() => setMetric(m)}
                className={`px-2 py-0.5 ${metric === m ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showLimits && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
          <div className="text-[9px] uppercase tracking-wide text-amber-400/90">
            Confidence &amp; limits — the S-curve ceiling K is a research anchor, not a measured value
          </div>
          {MODEL_LIMITS.map(l => {
            const hits = l.markets.includes(mkt.short);
            return (
              <div key={l.title} className="text-[10px] leading-snug">
                <span className={hits ? "text-amber-300 font-medium" : "text-slate-300 font-medium"}>
                  {hits ? "▸ " : ""}{l.title}
                  {hits && <span className="text-amber-400/80"> · flagged for {mkt.name}</span>}
                </span>
                <span className="text-slate-400"> — {l.detail}</span>
              </div>
            );
          })}
          {limitsForMkt.length === 0 && (
            <div className="text-[10px] text-slate-500 italic">No specific caveat flagged for {mkt.name}; general limits still apply.</div>
          )}
          <div className="text-[9px] text-slate-500 pt-0.5">
            Full methodology &amp; the per-market K table: Research → Demand modelling.
          </div>
        </div>
      )}

      {/* Country selector */}
      <div className="flex flex-wrap gap-1">
        {joinable.map(m => (
          <button key={m.short} onClick={() => setSel(m.short)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              m.short === sel
                ? "border-transparent text-white"
                : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
            style={m.short === sel ? { background: COUNTRY_COLORS[m.short] ?? "#6366f1" } : undefined}>
            {m.name}
          </button>
        ))}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart} margin={{ top: 4, right: 12, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <ReferenceArea x1={ly} x2={PROJ_END} fill="#64748b" fillOpacity={0.06} />
            <ReferenceLine x={ly} stroke="#64748b" strokeDasharray="2 2"
              label={{ value: "projection →", position: "insideTopRight", fontSize: 9, fill: "#94a3b8" }} />
            {!isTotal && (
              <ReferenceLine y={K} stroke={color} strokeDasharray="4 3" strokeOpacity={0.55}
                label={{ value: `ceiling K = ${K.toFixed(1)}`, position: "insideTopLeft", fontSize: 8, fill: color }} />
            )}
            <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
              type="number" domain={[2000, PROJ_END]} ticks={[2000, 2010, 2020, 2030, 2040, 2050]} />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={v => isTotal ? `${v}kt` : `${v}`} width={38} />
            <Tooltip contentStyle={TT_STYLE}
              labelFormatter={l => `${l}`}
              formatter={(v: unknown, name: unknown) => {
                if (v == null) return ["—", String(name)];
                const lbl = name === "actual" ? "Actual"
                  : name === "base" ? "Projection (flat intensity)"
                  : "Projection (S-curve to ceiling)";
                const num = isTotal ? `${Number(v).toLocaleString()} kt` : `${Number(v).toFixed(2)} kg/adult`;
                return [num, lbl];
              }} />
            <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) =>
              v === "actual" ? "Actual (USDA)"
                : v === "base" ? "Flat intensity"
                : "S-curve → ceiling"} />
            <Line dataKey="actual" stroke={color} strokeWidth={2.2} dot={false} connectNulls />
            <Line dataKey="base"   stroke={color} strokeWidth={2.2} dot={false} connectNulls strokeOpacity={0.85} />
            <Line dataKey="trend"  stroke={color} strokeWidth={1.8} dot={false} connectNulls strokeDasharray="2 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat label={`Intensity ${ly}`} value={`${(i0 as number).toFixed(2)}`} sub="kg/adult/yr" tone="text-amber-300" />
        <Stat label="Ceiling K" value={K.toFixed(1)} sub={`${(K / i0).toFixed(1)}× now`} tone="text-amber-300" />
        <Stat label="Initial rate" value={`${g >= 0 ? "+" : ""}${(g * 100).toFixed(1)}%`} sub="per yr" />
        <Stat label="Adults 2050" value={pct(adultGrowth)} sub={`vs ${ly}`} />
        <Stat label="2050 demand · flat" value={`${Math.round(base2050)} kt`} sub={pct(base2050 / act - 1)} tone="text-slate-100" />
        <Stat label="2050 demand · S-curve" value={`${Math.round(trend2050)} kt`} sub={pct(trend2050 / act - 1)} tone="text-slate-100" />
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Intensity = USDA domestic consumption ÷ UN WPP 18+ population (true {unit} per drinking-age adult, vs {mkt.per_capita_kg?.toFixed(2) ?? "—"} kg per total head).
        Flat case holds {ly} intensity and scales by projected adults; dotted case bends intensity from the {y0}–{ly} growth rate ({(g * 100).toFixed(1)}%/yr) toward the saturation ceiling K = {K.toFixed(1)} kg/adult via a logistic g·(1−i/K) — see Research → Demand modelling.
      </div>
    </div>
  );
}

export default function GrowthMarketsPanel() {
  const [data, setData] = useState<DemandStocks | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!data) return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading growth-market data…</div>;

  const rows = data.growth_markets ?? [];
  if (rows.length === 0) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Growth-market data not yet available — requires PSD + World Bank scraper runs.
      </div>
    );
  }

  // Total + per-capita ranking data (already sorted by consumption desc from backend)
  const totalRanked = rows.map(r => ({
    name: r.name,
    consumption_kt: r.consumption_mt != null ? Math.round(r.consumption_mt / 1000) : null,
    short: r.short,
  }));

  const perCapRanked = rows
    .filter(r => r.per_capita_kg != null)
    .slice()
    .sort((a, b) => (b.per_capita_kg ?? 0) - (a.per_capita_kg ?? 0))
    .map(r => ({
      name:          r.name,
      per_capita_kg: r.per_capita_kg,
      short:         r.short,
    }));

  // Trend chart — top 6 by latest consumption
  const trendCountries = rows.slice(0, 6);
  const yearSet = new Set<string>();
  for (const c of trendCountries) {
    for (const r of c.annual) yearSet.add(r.year);
  }
  const years = Array.from(yearSet).sort();
  const trendChart = years.map(y => {
    const row: Record<string, number | string | null> = { year: y.slice(2) };
    for (const c of trendCountries) {
      const entry = c.annual.find(a => a.year === y);
      row[c.short] = entry?.consumption_mt != null ? Math.round(entry.consumption_mt / 1000) : null;
    }
    return row;
  });

  const totalConsumption = rows.reduce((s, r) => s + (r.consumption_mt ?? 0), 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Emerging Demand Markets</h2>
          <p className="text-xs text-slate-400">
            Where coffee demand is actually growing — {rows.length} countries · USDA PSD ÷ World Bank population
          </p>
        </div>
        <div className="text-[10px] font-mono text-slate-400">
          Σ consumption: <span className="text-white">{fmtMt(totalConsumption)}</span>
        </div>
      </div>

      {/* Ranking pair */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Total consumption */}
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Total Domestic Consumption (kt/yr)
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={totalRanked} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} width={88} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toLocaleString()} kt/yr`, "Consumption"]} />
                <Bar dataKey="consumption_kt" radius={[0, 2, 2, 0]}>
                  {totalRanked.map(r => (
                    <Bar key={r.short} dataKey="consumption_kt" fill={COUNTRY_COLORS[r.short] ?? "#6366f1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Per-capita consumption */}
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Per-Capita Consumption (kg/person/yr)
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perCapRanked} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kg`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} width={88} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(2)} kg/person/yr`, "Per-capita"]} />
                <Bar dataKey="per_capita_kg" fill="#f59e0b" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Trend lines — top 6 */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Consumption Trajectory — top 6 markets (kt/yr)
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendChart} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}kt`} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name: unknown) => {
                const country = trendCountries.find(c => c.short === name);
                return [v == null ? "—" : `${Number(v).toLocaleString()} kt`, country?.name ?? String(name)];
              }} />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => trendCountries.find(c => c.short === v)?.name ?? v} />
              {trendCountries.map(c => (
                <Line key={c.short} dataKey={c.short} type="monotone" stroke={COUNTRY_COLORS[c.short] ?? "#6366f1"} strokeWidth={1.6} dot={false} connectNulls name={c.short} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Demand projection — joins consumption with the 18+ cohort */}
      {data.age_cohort_18plus?.countries && (
        <DemandProjection markets={rows} cohorts={data.age_cohort_18plus.countries} />
      )}

      {/* Detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left  px-2 py-1.5">Market</th>
              <th className="text-right px-2 py-1.5">Year</th>
              <th className="text-right px-2 py-1.5">Consumption</th>
              <th className="text-right px-2 py-1.5">Population</th>
              <th className="text-right px-2 py-1.5">Per-capita</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.short} className="border-b border-slate-800 hover:bg-slate-800/40">
                <td className="px-2 py-1 text-slate-200 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COUNTRY_COLORS[r.short] ?? "#6366f1" }} />
                  {r.name}
                </td>
                <td className="px-2 py-1 text-right text-slate-500 font-mono">{r.latest_year ?? "—"}</td>
                <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtMt(r.consumption_mt)}</td>
                <td className="px-2 py-1 text-right font-mono text-slate-300">{fmtPop(r.population)}</td>
                <td className="px-2 py-1 text-right font-mono text-amber-300">
                  {r.per_capita_kg != null ? `${r.per_capita_kg.toFixed(2)} kg` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Population via World Bank SP.POP.TOTL. Per-capita = USDA PSD domestic consumption (MT) × 1000 / latest population.
        Brazil/Indonesia/Vietnam/India/Mexico/Ethiopia are origin countries with substantial domestic demand.
      </div>
    </div>
  );
}
