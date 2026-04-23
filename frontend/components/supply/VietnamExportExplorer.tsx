"use client";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface ExportData {
  source: string;
  unit: string;
  date_range: string;
  monthly_total: Record<string, number>;
  monthly_by_type: Record<string, Record<string, number>>;
  monthly_by_country: Record<string, Record<string, number>>;
  monthly_by_buyer: Record<string, Record<string, number>>;
  monthly_by_shipper: Record<string, Record<string, number>>;
  top_countries: string[];
  top_buyers: string[];
  top_shippers: string[];
}

type Dimension = "type" | "country" | "buyer" | "shipper";
type ViewMode = "trend" | "total";

const DIM_LABELS: Record<Dimension, string> = {
  type:    "Coffee Type",
  country: "Destination",
  buyer:   "Buyer Group",
  shipper: "Shipper Group",
};

const PALETTE = [
  "#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#84cc16","#ec4899","#a78bfa",
  "#34d399","#fbbf24","#60a5fa","#fb7185","#4ade80",
  "#e879f9","#38bdf8","#facc15","#c084fc","#2dd4bf",
];

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function fmtMT(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}k`;
  return `${v}`;
}

function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m)-1];
  return `${mo}-${y.slice(2)}`;
}

interface Props { data: ExportData }

export default function VietnamExportExplorer({ data }: Props) {
  const [dim, setDim]   = useState<Dimension>("country");
  const [view, setView] = useState<ViewMode>("trend");
  const [topN, setTopN] = useState(8);

  const dimData: Record<string, Record<string, number>> = {
    type:    data.monthly_by_type,
    country: data.monthly_by_country,
    buyer:   data.monthly_by_buyer,
    shipper: data.monthly_by_shipper,
  }[dim];

  // Top N keys by all-time total
  const keys = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const vals of Object.values(dimData)) {
      for (const [k, v] of Object.entries(vals)) {
        totals[k] = (totals[k] ?? 0) + v;
      }
    }
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([k]) => k);
  }, [dimData, topN]);

  // TREND: X=month, one line per key
  const trendData = useMemo(() => {
    const months = Object.keys(data.monthly_total).sort();
    return months.map(ym => {
      const row: Record<string, string | number | null> = { month: shortMonth(ym) };
      for (const k of keys) row[k] = dimData[ym]?.[k] ?? null;
      return row;
    });
  }, [data, dimData, keys]);

  // TOTAL: X=key, bar with total MT
  const totalData = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const vals of Object.values(dimData)) {
      for (const [k, v] of Object.entries(vals)) {
        if (keys.includes(k)) totals[k] = (totals[k] ?? 0) + v;
      }
    }
    return keys.map(k => ({ name: k, mt: Math.round(totals[k] ?? 0) }));
  }, [dimData, keys]);

  const maxTopN = dim === "type" ? 3 : 20;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">
          Vietnam Green Bean Exports — Explorer
        </div>
        <div className="text-[8px] text-slate-600">{data.date_range} · {data.source}</div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Dimension */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500 uppercase">Group by</span>
          <div className="flex gap-1">
            {(["type","country","buyer","shipper"] as Dimension[]).map(d => (
              <button
                key={d}
                onClick={() => { setDim(d); if (d === "type") setTopN(3); else setTopN(8); }}
                className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                  dim === d
                    ? "bg-sky-600 text-white"
                    : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                }`}
              >
                {DIM_LABELS[d]}
              </button>
            ))}
          </div>
        </div>

        {/* View mode */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500 uppercase">View</span>
          <div className="flex gap-1">
            {(["trend","total"] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                  view === v
                    ? "bg-slate-500 text-white"
                    : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                }`}
              >
                {v === "trend" ? "Over time" : "All-time total"}
              </button>
            ))}
          </div>
        </div>

        {/* Top N slider (hide for type) */}
        {dim !== "type" && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase">Top</span>
            <input
              type="range" min={3} max={maxTopN} value={topN}
              onChange={e => setTopN(Number(e.target.value))}
              className="w-20 accent-sky-500"
            />
            <span className="text-[9px] text-slate-300 font-mono w-3">{topN}</span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {view === "trend" ? (
            <LineChart data={trendData} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} interval={5} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={fmtMT} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name: unknown) => [`${fmtMT(Number(v))} MT`, String(name)]} />
              <Legend wrapperStyle={{ fontSize: 8 }} formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
              {keys.map((k, i) => (
                <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={1.5} dot={false} connectNulls />
              ))}
            </LineChart>
          ) : (
            <BarChart data={totalData} layout="vertical" margin={{ top: 2, right: 40, left: 80, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={fmtMT} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 8, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={78} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${fmtMT(Number(v))} MT`, "Volume"]} />
              <Bar dataKey="mt" radius={[0, 3, 3, 0]}>
                {totalData.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="text-[8px] text-slate-600 italic">
        Green bean only · metric tons · Vietnam Customs data
      </div>
    </div>
  );
}
