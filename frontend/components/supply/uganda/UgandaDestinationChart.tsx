"use client";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TT_STYLE, bagsToKT, type UgandaMonthlyRow } from "./helpers";

type Window = "L12M" | "L24M" | "CTD" | "ALL";

const WINDOW_LABELS: Record<Window, string> = {
  L12M: "Last 12 months",
  L24M: "Last 24 months",
  CTD:  "Crop-to-date",
  ALL:  "All time",
};

const COLORS = [
  "#f59e0b", "#fb923c", "#fbbf24", "#84cc16", "#22c55e",
  "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  "#f43f5e", "#ef4444", "#f97316", "#eab308", "#65a30d",
];

export default function UgandaDestinationChart({ monthly }: { monthly: UgandaMonthlyRow[] }) {
  const [window, setWindow] = useState<Window>("L12M");
  const [topN, setTopN]     = useState(10);

  // Filter `monthly` to the active window, then aggregate by_destination.
  const data = useMemo(() => {
    if (!monthly.length) return [];
    const sorted = monthly.slice().sort((a, b) => a.month.localeCompare(b.month));
    const latestYm = sorted[sorted.length - 1].month;
    const [latestY, latestM] = latestYm.split("-").map(Number);

    const inWindow = (ym: string) => {
      if (window === "ALL") return true;
      const [y, m] = ym.split("-").map(Number);
      if (window === "L12M") {
        const monthsBack = (latestY - y) * 12 + (latestM - m);
        return monthsBack < 12;
      }
      if (window === "L24M") {
        const monthsBack = (latestY - y) * 12 + (latestM - m);
        return monthsBack < 24;
      }
      // CTD: same crop year (Oct-Sep) as latest month.
      const cropStartY = latestM >= 10 ? latestY : latestY - 1;
      const cropEndY   = cropStartY + 1;
      const cropStart  = cropStartY * 12 + 10;        // Oct of start year
      const cropEnd    = cropEndY * 12 + 9;           // Sep of end year
      const idx        = y * 12 + m;
      return idx >= cropStart && idx <= cropEnd;
    };

    const agg: Record<string, number> = {};
    for (const r of sorted) {
      if (!inWindow(r.month) || !r.by_destination) continue;
      for (const d of r.by_destination) {
        agg[d.country] = (agg[d.country] ?? 0) + (d.bags ?? 0);
      }
    }
    const rows = Object.entries(agg)
      .map(([country, bags]) => ({ country, bags, kt: bagsToKT(bags) }))
      .sort((a, b) => b.bags - a.bags)
      .slice(0, topN);
    return rows;
  }, [monthly, window, topN]);

  if (data.length === 0) return null;
  const totalKt = data.reduce((s, r) => s + r.kt, 0);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-200">Top Export Destinations</div>
          <div className="text-[10px] text-slate-500">
            {WINDOW_LABELS[window]} · Top {topN} · kt
            <span className="ml-2 text-slate-600">· Total {Math.round(totalKt).toLocaleString()} kt</span>
          </div>
        </div>
        <div className="flex gap-1">
          {(["L12M", "L24M", "CTD", "ALL"] as Window[]).map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`text-[10px] px-2 py-0.5 rounded ${window === w ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {w}
            </button>
          ))}
          <span className="text-slate-700 mx-1">·</span>
          {[5, 10, 15].map(n => (
            <button key={n} onClick={() => setTopN(n)}
              className={`text-[10px] px-2 py-0.5 rounded ${topN === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              top {n}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 24)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis type="number" tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis dataKey="country" type="category" tick={{ fill: "#cbd5e1", fontSize: 10 }} width={90} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, _name, p) => {
              const row = p?.payload as { country?: string; bags?: number; kt?: number } | undefined;
              return [`${v} kt (${row?.bags?.toLocaleString() ?? "—"} bags)`, row?.country as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Bar dataKey="kt">
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
