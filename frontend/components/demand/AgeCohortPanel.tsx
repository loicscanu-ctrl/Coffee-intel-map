"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, ReferenceLine,
} from "recharts";

interface AnnualEntry {
  year: number;
  pop_18plus: number;
}

interface CountryEntry {
  name: string;
  location_id: number;
  annual: AnnualEntry[];
  latest_year: number | null;
  latest_pop: number | null;
}

interface AgeCohortData {
  source: string;
  last_updated: string;
  age_threshold: number;
  countries: Record<string, CountryEntry>;
}

interface DemandStocks {
  age_cohort_18plus?: AgeCohortData | null;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

const COUNTRY_COLORS: Record<string, string> = {
  eu:          "#10b981",
  japan:       "#0ea5e9",
  usa:         "#f59e0b",
  china:       "#dc2626",
  india:       "#f97316",
  brazil:      "#16a34a",
  indonesia:   "#0284c7",
  vietnam:     "#a855f7",
  russia:      "#3b82f6",
  mexico:      "#059669",
  turkey:      "#ef4444",
  philippines: "#06b6d4",
  egypt:       "#facc15",
  korea:       "#ec4899",
  ethiopia:    "#84cc16",
};

// Default visible — top-7 by population scale.
const DEFAULT_VISIBLE = ["china", "india", "usa", "indonesia", "brazil", "russia", "japan"];

function fmtPop(p: number | null | undefined): string {
  if (p == null) return "—";
  if (p >= 1_000_000_000) return `${(p / 1_000_000_000).toFixed(2)}B`;
  if (p >= 1_000_000)     return `${Math.round(p / 1_000_000)}M`;
  return String(p);
}

export default function AgeCohortPanel() {
  const [data, setData] = useState<AgeCohortData | null>(null);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: DemandStocks) => setData(d.age_cohort_18plus ?? null))
      .catch(() => setError(true));
  }, []);

  const { chartData, countries, currentYear } = useMemo(() => {
    if (!data) return { chartData: [], countries: [] as [string, CountryEntry][], currentYear: null as number | null };
    const entries = Object.entries(data.countries);
    const yearSet = new Set<number>();
    for (const [, c] of entries) for (const r of c.annual) yearSet.add(r.year);
    const years = Array.from(yearSet).sort((a, b) => a - b);
    const rows = years.map(y => {
      const row: Record<string, number | null> = { year: y };
      for (const [short, c] of entries) {
        const entry = c.annual.find(r => r.year === y);
        row[short] = entry?.pop_18plus ?? null;
      }
      return row;
    });
    const today = new Date().getFullYear();
    return { chartData: rows, countries: entries, currentYear: today };
  }, [data]);

  if (error || !data) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Coffee-drinking-age population data not yet available — requires UN WPP scraper run.
      </div>
    );
  }
  if (countries.length === 0) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading age-cohort data…</div>;
  }

  // Ranking by current/latest population
  const ranked = countries
    .map(([short, c]) => ({ short, name: c.name, latest_pop: c.latest_pop ?? 0, latest_year: c.latest_year }))
    .sort((a, b) => b.latest_pop - a.latest_pop);

  // Compute 2025 vs 2050 (or first/last in the series) growth
  function growthPct(c: CountryEntry, fromYear: number, toYear: number): number | null {
    const f = c.annual.find(r => r.year === fromYear)?.pop_18plus;
    const t = c.annual.find(r => r.year === toYear)?.pop_18plus;
    if (!f || !t) return null;
    return ((t - f) / f) * 100;
  }

  const refFrom = 2025;
  const refTo   = 2050;

  function toggle(short: string) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(short)) next.delete(short);
      else next.add(short);
      return next;
    });
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Coffee-Drinking-Age Population (18+)</h2>
          <p className="text-xs text-slate-400">
            Structural demand pool — UN WPP medium-variant projection · {data.last_updated}
          </p>
        </div>
        <div className="text-[10px] font-mono text-slate-500">
          {countries.length} markets · {data.source.split("(")[0].trim()}
        </div>
      </div>

      {/* Country toggle chips */}
      <div className="flex flex-wrap gap-1.5">
        {ranked.map(r => {
          const on = visible.has(r.short);
          const color = COUNTRY_COLORS[r.short] ?? "#6366f1";
          return (
            <button
              key={r.short}
              onClick={() => toggle(r.short)}
              className="px-2 py-0.5 rounded text-[10px] font-medium border transition-colors"
              style={{
                borderColor:     color,
                backgroundColor: on ? color + "22" : "transparent",
                color:           on ? color : "#94a3b8",
              }}
            >
              {r.name}
            </button>
          );
        })}
      </div>

      {/* Trend chart */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          18+ population trajectory · history → projection
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval={4} />
              <YAxis
                tick={{ fontSize: 9, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => fmtPop(v)}
              />
              {currentYear && (
                <ReferenceLine x={currentYear} stroke="#475569" strokeDasharray="4 4" label={{ value: "today", fontSize: 9, fill: "#94a3b8", position: "insideTopRight" }} />
              )}
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  const c = countries.find(([s]) => s === name);
                  return [v == null ? "—" : fmtPop(Number(v)), c?.[1]?.name ?? String(name)];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => countries.find(([s]) => s === v)?.[1]?.name ?? v} />
              {countries.map(([short]) => visible.has(short) && (
                <Line key={short} dataKey={short} type="monotone" stroke={COUNTRY_COLORS[short] ?? "#6366f1"} strokeWidth={1.7} dot={false} connectNulls name={short} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ranking table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-400 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left  px-2 py-1.5">Market</th>
              <th className="text-right px-2 py-1.5">2025 cohort</th>
              <th className="text-right px-2 py-1.5">2050 cohort</th>
              <th className="text-right px-2 py-1.5">2025–2050 Δ</th>
              <th className="text-right px-2 py-1.5">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(r => {
              const c = data.countries[r.short];
              const v2025 = c.annual.find(a => a.year === refFrom)?.pop_18plus ?? null;
              const v2050 = c.annual.find(a => a.year === refTo)?.pop_18plus ?? null;
              const delta = (v2025 != null && v2050 != null) ? v2050 - v2025 : null;
              const pct   = growthPct(c, refFrom, refTo);
              const pctCls = pct == null ? "text-slate-500" : pct >= 0 ? "text-emerald-400" : "text-red-400";
              return (
                <tr key={r.short} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="px-2 py-1 text-slate-200 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COUNTRY_COLORS[r.short] ?? "#6366f1" }} />
                    {r.name}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtPop(v2025)}</td>
                  <td className="px-2 py-1 text-right font-mono text-slate-200">{fmtPop(v2050)}</td>
                  <td className={`px-2 py-1 text-right font-mono ${delta != null ? (delta >= 0 ? "text-emerald-400" : "text-red-400") : "text-slate-500"}`}>
                    {delta != null ? `${delta >= 0 ? "+" : ""}${fmtPop(Math.abs(delta))}` : "—"}
                  </td>
                  <td className={`px-2 py-1 text-right font-mono ${pctCls}`}>
                    {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[9px] text-slate-500 italic">
        Cohort = total population aged 18+ ≈ Σ(5yr brackets) with the 15–19 bracket weighted ×3/5 (uniform-distribution
        assumption). Source: UN World Population Prospects, medium-variant projections.
      </div>
    </div>
  );
}
