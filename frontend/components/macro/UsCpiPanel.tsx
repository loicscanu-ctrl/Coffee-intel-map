"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, ReferenceLine,
} from "recharts";

interface MonthlyEntry {
  period:  string;   // YYYY-MM
  index:   number;
  yoy_pct: number | null;
}

interface SeriesEntry {
  name:       string;
  series_id?: string;
  source_url: string;
  monthly:    MonthlyEntry[];
}

interface UsCpi {
  source:       string;
  source_url?:  string;
  last_updated: string;
  series:       Record<string, SeriesEntry>;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

const SERIES_ORDER = ["all_items", "core", "food", "energy"] as const;
const SERIES_LABEL: Record<string, string> = {
  all_items: "Headline (all items)",
  core:      "Core (ex food & energy)",
  food:      "Food",
  energy:    "Energy",
};
const SERIES_COLOR: Record<string, string> = {
  all_items: "#0ea5e9",
  core:      "#a855f7",
  food:      "#10b981",
  energy:    "#f59e0b",
};

function fmtPeriodLabel(p: string): string {
  // YYYY-MM → MM/YY for the X axis
  const [y, m] = p.split("-");
  return `${m}/${y.slice(2)}`;
}

export default function UsCpiPanel() {
  const [data, setData] = useState<UsCpi | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/us_cpi.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const chartData = useMemo(() => {
    if (!data) return [];
    const all = new Set<string>();
    for (const s of Object.values(data.series)) for (const m of s.monthly) all.add(m.period);
    const periods = Array.from(all).sort();
    return periods.map(p => {
      const row: Record<string, number | string | null> = { period: p, label: fmtPeriodLabel(p) };
      for (const key of SERIES_ORDER) {
        const entry = data.series[key]?.monthly.find(m => m.period === p);
        row[key] = entry?.yoy_pct ?? null;
      }
      return row;
    });
  }, [data]);

  if (error || !data) {
    return (
      <div className="p-4 text-xs text-slate-500">
        US CPI data not yet available — requires the BLS CPI-U scraper run.
      </div>
    );
  }
  if (chartData.length === 0) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading US CPI data…</div>;
  }

  // Latest YoY per series for the KPI strip
  type SeriesKey = typeof SERIES_ORDER[number];
  type LatestRow = { key: SeriesKey; period: string; yoy: number };
  const latest: LatestRow[] = SERIES_ORDER.flatMap(key => {
    const series = data.series[key];
    if (!series) return [];
    for (let i = series.monthly.length - 1; i >= 0; i--) {
      const m = series.monthly[i];
      if (m.yoy_pct != null) return [{ key, period: m.period, yoy: m.yoy_pct }];
    }
    return [];
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">US Inflation (CPI-U)</h2>
          <p className="text-xs text-slate-400">
            Headline US consumer prices — the macro backdrop for the Fed-path / USD / real-rate
            regime that frames the whole commodity complex. Source:{" "}
            <a href={data.source_url ?? "https://www.bls.gov/news.release/cpi.t01.htm"}
               target="_blank" rel="noreferrer"
               className="underline hover:text-slate-200">{data.source}</a>{" "}
            · {data.last_updated}
          </p>
        </div>
      </div>

      {/* KPI strip — latest YoY per series */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {latest.map(l => {
          const cls = l.yoy >= 0 ? "text-red-400" : "text-emerald-400";
          return (
            <div key={l.key} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: SERIES_COLOR[l.key] }} />
                <span className="text-[10px] text-slate-300">{SERIES_LABEL[l.key]}</span>
              </div>
              <div className={`text-xl font-bold font-mono ${cls}`}>
                {l.yoy >= 0 ? "+" : ""}{l.yoy.toFixed(1)}%
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">YoY · {l.period}</div>
            </div>
          );
        })}
      </div>

      {/* YoY trend chart */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          12-month change (YoY %)
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 12) - 1)} />
              <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
              <ReferenceLine y={2} stroke="#475569" strokeDasharray="4 3" strokeWidth={1} label={{ value: "2% target", position: "insideTopRight", fontSize: 8, fill: "#64748b" }} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [
                  v == null ? "—" : `${Number(v).toFixed(1)}%`,
                  SERIES_LABEL[String(name)] ?? String(name),
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 9 }} formatter={(v: string) => SERIES_LABEL[v] ?? v} />
              {SERIES_ORDER.map(key => (
                data.series[key] && (
                  <Line
                    key={key}
                    dataKey={key}
                    type="monotone"
                    stroke={SERIES_COLOR[key]}
                    strokeWidth={key === "all_items" ? 2 : 1.5}
                    dot={false}
                    connectNulls
                    name={key}
                  />
                )
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-slate-500 mt-2 italic">
          NSA 12-month change, the basis BLS quotes in the headline release (Table 1). Core strips
          out food & energy to show the persistent trend; the dashed line marks the Fed&apos;s 2% goal.
        </div>
      </div>
    </div>
  );
}
