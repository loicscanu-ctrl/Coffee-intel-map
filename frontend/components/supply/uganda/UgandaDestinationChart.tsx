"use client";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TT_STYLE, bagsToKT, type UgandaMonthlyRow } from "./helpers";

type Window = "L12M" | "L24M" | "CTD" | "ALL";
type Mode   = "total" | "stack";

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

interface AggRow {
  country: string;
  robusta_bags: number;
  arabica_bags: number;
  total_bags: number;
  robusta_kt: number;
  arabica_kt: number;
  total_kt:   number;
}

export default function UgandaDestinationChart({ monthly }: { monthly: UgandaMonthlyRow[] }) {
  const [window, setWindow] = useState<Window>("L12M");
  const [topN, setTopN]     = useState(10);
  const [mode, setMode]     = useState<Mode>("stack");

  // Filter `monthly` to the active window, then aggregate by_destination
  // with Robusta + Arabica + Total. The R/A split lands on each row once
  // the UCDA scraper writes the enriched schema (PR #296 onwards). Rows
  // from older runs only carry `bags`; we treat their R/A as 0 so the
  // stacked view still renders a meaningful column.
  const { data, hasSplit } = useMemo<{ data: AggRow[]; hasSplit: boolean }>(() => {
    if (!monthly.length) return { data: [], hasSplit: false };
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
      const cropStart  = cropStartY * 12 + 10;
      const cropEnd    = cropEndY * 12 + 9;
      const idx        = y * 12 + m;
      return idx >= cropStart && idx <= cropEnd;
    };

    interface Acc { robusta_bags: number; arabica_bags: number; total_bags: number }
    const agg: Record<string, Acc> = {};
    let anySplit = false;
    for (const r of sorted) {
      if (!inWindow(r.month) || !r.by_destination) continue;
      for (const d of r.by_destination) {
        const dRec = d as { country: string; bags?: number;
          robusta_bags?: number; arabica_bags?: number };
        if (!agg[dRec.country]) agg[dRec.country] = { robusta_bags: 0, arabica_bags: 0, total_bags: 0 };
        const rob = dRec.robusta_bags ?? 0;
        const ara = dRec.arabica_bags ?? 0;
        if (rob || ara) anySplit = true;
        agg[dRec.country].robusta_bags += rob;
        agg[dRec.country].arabica_bags += ara;
        agg[dRec.country].total_bags   += dRec.bags ?? 0;
      }
    }
    const rows = Object.entries(agg)
      .map(([country, a]) => ({
        country,
        robusta_bags: a.robusta_bags,
        arabica_bags: a.arabica_bags,
        total_bags:   a.total_bags,
        robusta_kt:   bagsToKT(a.robusta_bags),
        arabica_kt:   bagsToKT(a.arabica_bags),
        total_kt:     bagsToKT(a.total_bags),
      }))
      .sort((a, b) => b.total_bags - a.total_bags)
      .slice(0, topN);
    return { data: rows, hasSplit: anySplit };
  }, [monthly, window, topN]);

  if (data.length === 0) return null;
  const totalKt = data.reduce((s, r) => s + r.total_kt, 0);
  const effectiveMode: Mode = hasSplit ? mode : "total";

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
        <div className="flex gap-1 flex-wrap">
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
          {hasSplit && (
            <>
              <span className="text-slate-700 mx-1">·</span>
              {(["total", "stack"] as Mode[]).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`text-[10px] px-2 py-0.5 rounded ${mode === m ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
                  title={m === "stack" ? "Stack Robusta + Arabica per country" : "Show Total only"}>
                  {m === "stack" ? "R/A split" : "Total"}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 26)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis type="number" tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis dataKey="country" type="category" tick={{ fill: "#cbd5e1", fontSize: 10 }} width={90} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name, p) => {
              const row = p?.payload as AggRow | undefined;
              if (name === "robusta_kt") return [`${v} kt`, "Robusta" as NameType];
              if (name === "arabica_kt") return [`${v} kt`, "Arabica" as NameType];
              return [`${v} kt (${row?.total_bags.toLocaleString() ?? "—"} bags)`, row?.country as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          {effectiveMode === "stack" ? (
            <>
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                formatter={v => (
                  <span style={{ color: "#cbd5e1" }}>
                    {v === "robusta_kt" ? "Robusta" : v === "arabica_kt" ? "Arabica" : v}
                  </span>
                )} />
              <Bar dataKey="robusta_kt" name="robusta_kt" stackId="a" fill="#f59e0b" />
              <Bar dataKey="arabica_kt" name="arabica_kt" stackId="a" fill="#22c55e" />
            </>
          ) : (
            <Bar dataKey="total_kt">
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
