"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegionRow {
  label: string;
  code: string;
  current: number;
  prev_month: number;
  avg_5y: number;
}

interface ProgressionRow {
  month: string;
  [col: string]: number | string;
}

interface ChartPoint {
  x: string;
  avg: number | null;
  y2223: number | null;
  y2324: number | null;
  y2425: number | null;
  y2526: number | null;
}

interface SellingData {
  brazil: { current: number; prev_month: number; avg_5y: number };
  regions: RegionRow[];
  progression_months: string[];
  progression: ProgressionRow[];
  chart: ChartPoint[];
}

interface FarmerSellingFile {
  source: string;
  report_date: string;
  arabica: SellingData;
  robusta: SellingData;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function cellColor(v: number): string {
  if (v >= 90) return "#22c55e";
  if (v >= 75) return "#86efac";
  if (v >= 60) return "#fde68a";
  if (v >= 45) return "#fdba74";
  return "#fca5a5";
}

function gapColor(gap: number): string {
  if (gap >= 5)  return "#22c55e";
  if (gap >= 0)  return "#86efac";
  if (gap >= -5) return "#fde68a";
  if (gap >= -15)return "#fb923c";
  return "#ef4444";
}

// ── Regional cards ────────────────────────────────────────────────────────────

function RegionCard({ r }: { r: RegionRow }) {
  const momDelta = r.current - r.prev_month;
  const avgGap   = r.current - r.avg_5y;
  const gc       = gapColor(avgGap);
  return (
    <div className="bg-slate-900 border border-slate-700/60 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-bold text-slate-300 uppercase tracking-wide">{r.label}</span>
        <span className="text-[8px] font-mono text-slate-600">{r.code}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-extrabold" style={{ color: cellColor(r.current) }}>
          {r.current}
        </span>
        <span className="text-[8px] text-slate-500">%</span>
      </div>
      <div className="flex gap-2 text-[7px]">
        <span className="text-slate-500">
          MoM <span className={momDelta >= 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
            {momDelta > 0 ? "+" : ""}{momDelta}pp
          </span>
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">
          vs avg <span className="font-bold" style={{ color: gc }}>
            {avgGap > 0 ? "+" : ""}{avgGap}pp
          </span>
        </span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${r.current}%`, background: cellColor(r.current) }} />
      </div>
      <div className="text-[6px] text-slate-700">5yr avg: {r.avg_5y}%</div>
    </div>
  );
}

// ── Seasonal line chart ────────────────────────────────────────────────────────

function SeasonChart({ chart }: { chart: ChartPoint[] }) {
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="x" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v}%`} />
          <ReferenceLine y={100} stroke="#334155" strokeDasharray="2 4" />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => {
              const n = String(name);
              const labels: Record<string, string> = { avg: "5yr avg", y2223: "22/23", y2324: "23/24", y2425: "24/25", y2526: "25/26" };
              return [`${v}%`, labels[n] ?? n];
            }}
          />
          <Line type="monotone" dataKey="y2223" stroke="#475569" strokeWidth={1} dot={false} strokeOpacity={0.7} />
          <Line type="monotone" dataKey="y2324" stroke="#64748b" strokeWidth={1} dot={false} strokeOpacity={0.7} />
          <Line type="monotone" dataKey="y2425" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeOpacity={0.8} />
          <Line type="monotone" dataKey="avg"   stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          <Line type="monotone" dataKey="y2526" stroke="#f59e0b" strokeWidth={2.5}
            dot={{ r: 3, fill: "#f59e0b", strokeWidth: 0 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Progression heatmap table ─────────────────────────────────────────────────

function ProgressionTable({ data }: { data: SellingData }) {
  const columns = Object.keys(data.progression[0]).filter(k => k !== "month");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[8px] border-collapse">
        <thead>
          <tr>
            <th className="text-left text-slate-600 font-bold pb-1.5 pr-2 sticky left-0 bg-slate-800">Month</th>
            {columns.map(col => (
              <th key={col} className="text-center text-slate-500 font-bold pb-1.5 px-1 min-w-[36px]">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.progression.map((row) => {
            const isLatest = row === data.progression[data.progression.length - 1];
            return (
              <tr key={row.month}
                className={`border-t border-slate-700/40 ${isLatest ? "border-t-2 border-t-amber-500/40" : ""}`}>
                <td className={`py-1 pr-2 font-bold sticky left-0 bg-slate-800 ${isLatest ? "text-amber-400" : "text-slate-500"}`}>
                  {row.month}
                </td>
                {columns.map(col => {
                  const v = Number(row[col]);
                  return (
                    <td key={col} className="text-center py-1 px-0.5">
                      <span className="px-1 py-0.5 rounded text-[7px] font-bold"
                        style={{ color: cellColor(v), background: cellColor(v) + "22" }}>
                        {v}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FarmerSellingPanel() {
  const [data, setData] = useState<FarmerSellingFile | null>(null);
  const [variety, setVariety] = useState<"arabica" | "robusta">("arabica");

  useEffect(() => {
    fetch("/data/farmer_selling_brazil.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return null;

  const vd = data[variety];
  const brazil = vd.brazil;
  const momDelta = brazil.current - brazil.prev_month;
  const avgGap   = brazil.current - brazil.avg_5y;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
            Farmer Selling Pace · Brazil
          </div>
          <div className="text-[8px] text-slate-600 mt-0.5">
            % of total crop committed to market · as of {data.report_date}
          </div>
        </div>
        {/* Variety tabs */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(["arabica", "robusta"] as const).map(v => (
            <button key={v} onClick={() => setVariety(v)}
              className={`px-3 py-1 rounded text-[10px] font-semibold transition-colors ${
                variety === v ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Brazil headline */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex items-center gap-6">
        <div>
          <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-1">Brazil · 25/26</div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold" style={{ color: cellColor(brazil.current) }}>
              {brazil.current}
            </span>
            <span className="text-sm text-slate-500">%</span>
          </div>
        </div>
        <div className="space-y-1.5 text-[9px]">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-24">vs prev month</span>
            <span className={`font-bold ${momDelta >= 0 ? "text-green-400" : "text-red-400"}`}>
              {momDelta > 0 ? "+" : ""}{momDelta} pp
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-24">vs 5yr avg ({brazil.avg_5y}%)</span>
            <span className="font-bold" style={{ color: gapColor(avgGap) }}>
              {avgGap > 0 ? "+" : ""}{avgGap} pp
            </span>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[7px] text-slate-600 mb-1">Selling progress</div>
          <div className="w-32 bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${brazil.current}%`, background: cellColor(brazil.current) }} />
          </div>
          <div className="text-[7px] text-slate-700 mt-0.5">
            5yr avg: <span className="text-slate-500">{brazil.avg_5y}%</span>
          </div>
        </div>
      </div>

      {/* Regional cards */}
      <div>
        <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-2">By region</div>
        <div className={`grid gap-2 ${variety === "arabica" ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4"}`}>
          {vd.regions.map(r => <RegionCard key={r.code} r={r} />)}
        </div>
      </div>

      {/* Chart + progression side by side on wide screens */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-4">
        {/* Seasonal chart */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[8px] text-slate-500 uppercase tracking-wide">Seasonal progression</div>
            <div className="flex gap-3 text-[7px] text-slate-600">
              <span className="flex items-center gap-1"><span className="w-3 h-px bg-slate-600 inline-block" />22/23–24/25</span>
              <span className="flex items-center gap-1 text-indigo-400"><span className="w-3 h-px bg-indigo-400 inline-block" />avg</span>
              <span className="flex items-center gap-1 text-amber-400"><span className="w-3 h-px bg-amber-400 inline-block" />25/26</span>
            </div>
          </div>
          <SeasonChart chart={vd.chart} />
        </div>

        {/* Progression table */}
        <div>
          <div className="text-[8px] text-slate-500 uppercase tracking-wide mb-2">Monthly detail · 25/26</div>
          <ProgressionTable data={vd} />
        </div>
      </div>

      <div className="text-[7px] text-slate-700 italic border-t border-slate-700 pt-2">
        Source: {data.source}. Historical chart lines estimated from chart visual — exact data from progression table.
        Avg = 5-year average. Gap vs avg indicates pace relative to historical norm.
      </div>
    </div>
  );
}
