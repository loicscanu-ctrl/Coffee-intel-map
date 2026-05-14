"use client";
import { useEffect, useState } from "react";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid,
} from "recharts";

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

interface DemandStocks {
  growth_markets?: GrowthMarket[];
  populations?: { source: string; last_updated: string };
}

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
