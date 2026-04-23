"use client";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

interface ExportMonth { month: string; total_k_bags: number; }
interface SharesData { source: string; shares: Record<string, number>; }

interface Props {
  monthlyExports: ExportMonth[];   // from vietnam_supply.json
  sharesData: SharesData;          // from vn_country_shares.json
}

const TOP_N_OPTIONS = [5, 8, 10, 15];

const PALETTE = [
  "#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#84cc16","#ec4899","#a78bfa",
  "#34d399","#fbbf24","#60a5fa","#fb7185","#4ade80",
];

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function fmtMT(v: number) {
  if (v >= 1_000_000) return `${(v/1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${(v/1_000).toFixed(0)}k`;
  return `${Math.round(v)}`;
}

function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m)-1];
  return `${mo}-${y.slice(2)}`;
}

// k_bags × 60 = MT
const toMT = (k: number) => k * 60;

export default function VietnamDestinationEstimate({ monthlyExports, sharesData }: Props) {
  const [topN, setTopN] = useState(8);
  const [refPeriod, setRefPeriod] = useState<"2020-2024" | "2022-2024">("2022-2024");

  const allShares = sharesData.shares;

  // For 2022-2024 period, recompute top countries — shares file already has 2020-2024 avg
  // We use the same shares for both periods for now (data is from 2020-2024 avg)
  // Top N countries by share
  const topCountries = useMemo(() =>
    Object.entries(allShares)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([c]) => c),
    [allShares, topN]
  );

  // Normalize top-N shares to sum to 1 (rest = "Other")
  const topShareSum = topCountries.reduce((s, c) => s + allShares[c], 0);
  const normalizedShares: Record<string, number> = {};
  topCountries.forEach(c => { normalizedShares[c] = allShares[c] / topShareSum; });

  // Only show 2025+ months (estimated)
  const estimatedMonths = useMemo(() =>
    monthlyExports
      .filter(m => m.month >= "2025-01")
      .map(m => {
        const totalMT = toMT(m.total_k_bags);
        const row: Record<string, string | number> = { month: shortMonth(m.month) };
        topCountries.forEach(c => {
          row[c] = Math.round(totalMT * normalizedShares[c]);
        });
        return row;
      }),
    [monthlyExports, topCountries, normalizedShares]
  );

  // YTD 2025 estimated breakdown
  const ytd2025 = useMemo(() => {
    const rows = monthlyExports.filter(m => m.month.startsWith("2025"));
    const totalMT = rows.reduce((s, r) => s + toMT(r.total_k_bags), 0);
    return topCountries.map(c => ({
      country: c,
      mt: Math.round(totalMT * normalizedShares[c]),
      share: (normalizedShares[c] * 100).toFixed(1),
    }));
  }, [monthlyExports, topCountries, normalizedShares]);

  const ytdTotal = ytd2025.reduce((s, r) => s + r.mt, 0);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      {/* Header */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">
            Estimated Destination Breakdown · 2025–2026
          </div>
          <div className="text-[8px] text-amber-400/80 mt-0.5">
            ⚠ Estimated — applying {refPeriod} historical country shares to 2025+ total volumes
          </div>
        </div>
        <div className="text-[8px] text-slate-600">{sharesData.source}</div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500 uppercase">Countries</span>
          <div className="flex gap-1">
            {TOP_N_OPTIONS.map(n => (
              <button key={n} onClick={() => setTopN(n)}
                className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                  topN === n ? "bg-sky-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                }`}>
                Top {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500 uppercase">Ref period</span>
          <div className="flex gap-1">
            {(["2020-2024","2022-2024"] as const).map(p => (
              <button key={p} onClick={() => setRefPeriod(p)}
                className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                  refPeriod === p ? "bg-slate-500 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                }`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stacked bar chart */}
      {estimatedMonths.length > 0 ? (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={estimatedMonths} margin={{ top: 2, right: 4, left: -12, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={fmtMT} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: unknown) => [`${fmtMT(Number(v))} MT`, String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 8 }} formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
              {topCountries.map((c, i) => (
                <Bar key={c} dataKey={c} stackId="a" fill={PALETTE[i % PALETTE.length]}
                  opacity={0.85} radius={i === topCountries.length - 1 ? [2,2,0,0] : [0,0,0,0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-[10px] text-slate-500 italic py-4 text-center">No 2025+ data available</div>
      )}

      {/* YTD 2025 breakdown table */}
      <div className="border-t border-slate-700 pt-3">
        <div className="text-[9px] text-slate-500 mb-2 uppercase tracking-wide">
          YTD 2025 estimated · total {fmtMT(ytdTotal)} MT
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {ytd2025.map((r, i) => (
            <div key={r.country} className="flex items-center justify-between text-[9px]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="text-slate-300">{r.country}</span>
              </span>
              <span className="font-mono text-slate-400">
                {fmtMT(r.mt)} MT
                <span className="text-slate-600 ml-1">({r.share}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[8px] text-slate-600 italic border-t border-slate-700 pt-2">
        Destination = country of cargo arrival (not buyer HQ). Historical share = avg % of Vietnam green bean exports 2020–2024 by destination.
        Actual 2025 country breakdown unavailable — BL-level data required for exact split.
      </div>
    </div>
  );
}
