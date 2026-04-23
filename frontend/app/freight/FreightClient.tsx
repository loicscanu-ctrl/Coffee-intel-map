"use client";
import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Bar,
} from "recharts";

type FreightRoute = {
  id: string;
  from: string;
  to: string;
  rate: number;
  prev: number;
  unit: string;
  proxy: boolean;
};

type FreightData = {
  updated: string;
  routes: FreightRoute[];
  history: Record<string, number | string>[];
};

interface DryBulkData {
  ticker: string; name: string; description: string;
  last_price: number; last_date: string;
  mom_pct: number | null; wow_pct: number | null;
  week52_low: number | null; week52_high: number | null;
  series: { date: string; close: number }[];
  source: string;
}

const TT_STYLE = { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

const CHART_LINES = [
  { key: "vn-eu", label: "VN → EU", color: "#38bdf8" },
  { key: "br-eu", label: "BR → EU", color: "#4ade80" },
  { key: "vn-us", label: "VN → US", color: "#fb923c" },
  { key: "et-eu", label: "ET → EU", color: "#c084fc" },
];

interface Props { data: FreightData | null; }

function BdryPanel({ data }: { data: DryBulkData }) {
  const chartData = useMemo(() => {
    const s = data.series;
    const step = Math.max(1, Math.floor(s.length / 26));
    const sampled: { label: string; close: number }[] = [];
    for (let i = 0; i < s.length; i += step)
      sampled.push({ label: s[i].date.slice(5), close: s[i].close });
    if (sampled[sampled.length - 1]?.label !== s[s.length - 1].date.slice(5))
      sampled.push({ label: s[s.length - 1].date.slice(5), close: s[s.length - 1].close });
    return sampled;
  }, [data]);

  const momColor = data.mom_pct == null ? "#64748b" : data.mom_pct >= 0 ? "#22c55e" : "#ef4444";
  const wowColor = data.wow_pct == null ? "#64748b" : data.wow_pct >= 0 ? "#22c55e" : "#ef4444";
  const w52Range = data.week52_high != null && data.week52_low != null ? data.week52_high - data.week52_low : null;
  const w52Pos   = w52Range && w52Range > 0 ? ((data.last_price - (data.week52_low ?? 0)) / w52Range) * 100 : null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
            Dry Bulk Freight · {data.ticker}
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">{data.description}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-mono font-bold text-slate-100">${data.last_price.toFixed(2)}</div>
          <div className="text-[9px] font-mono" style={{ color: momColor }}>
            {data.mom_pct != null ? `${data.mom_pct >= 0 ? "+" : ""}${data.mom_pct}% MoM` : "—"}
          </div>
        </div>
      </div>

      {w52Pos != null && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[8px] text-slate-600 font-mono">
            <span>52w L ${data.week52_low?.toFixed(2)}</span>
            <span>52w H ${data.week52_high?.toFixed(2)}</span>
          </div>
          <div className="relative h-2 bg-slate-800 rounded-full">
            <div className="absolute h-full bg-blue-500/30 rounded-full" style={{ width: `${w52Pos}%` }} />
            <div className="absolute w-2 h-2 bg-blue-400 rounded-full top-0 -translate-x-1/2" style={{ left: `${Math.min(98, w52Pos)}%` }} />
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={v => `$${Number(v).toFixed(0)}`} />
            <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, data.ticker]} />
            <Bar dataKey="close" fill="#3b82f6" opacity={0.75} radius={[2,2,0,0]} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="grid grid-cols-3 gap-3 text-[9px] font-mono border-t border-slate-800 pt-2">
        <div>
          <div className="text-slate-600">WoW</div>
          <div style={{ color: wowColor }}>
            {data.wow_pct != null ? `${data.wow_pct >= 0 ? "+" : ""}${data.wow_pct}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-slate-600">As of</div>
          <div className="text-slate-400">{data.last_date}</div>
        </div>
        <div>
          <div className="text-slate-600">Exchange</div>
          <div className="text-slate-400">NYSE Arca</div>
        </div>
      </div>

      <div className="text-[9px] text-slate-600 italic border-t border-slate-800 pt-2">
        Rising {data.ticker} → tighter dry bulk freight → higher CIF fertilizer cost into Brazil.
        Tracks Capesize + Supramax freight futures. Source: {data.source}.
      </div>
    </div>
  );
}

export default function FreightClient({ data }: Props) {
  const [dryBulk, setDryBulk] = useState<DryBulkData | null>(null);

  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then(r => r.json())
      .then(d => setDryBulk(d.fertilizer?.dry_bulk ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      <h1 className="text-lg font-bold text-white">Freight</h1>

      {/* Container freight chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">
          Freight Rate Evolution — USD / FEU
        </div>
        {data?.updated && (
          <div className="text-[10px] text-slate-600 mb-3">Last updated: {data.updated}</div>
        )}

        {(!data || data.history.length === 0) && (
          <div className="h-[260px] flex items-center justify-center text-slate-500 text-xs">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {data && data.history.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={50}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(v: unknown) => [`$${Number(v).toLocaleString("en-US")}`, ""]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "#94a3b8" }}
                formatter={(value) => CHART_LINES.find((l) => l.key === value)?.label ?? value}
              />
              {CHART_LINES.map((l) => (
                <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Route table */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
          <span className="text-xs font-semibold text-slate-300">Current Spot Rates — Coffee Corridors</span>
          <span className="text-[10px] text-slate-500 ml-3">40ft container · FBX index</span>
        </div>

        {(!data || data.routes.length === 0) && (
          <div className="px-4 py-6 text-xs text-slate-500">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {data && data.routes.length > 0 && (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-slate-500 bg-slate-800/40">
                <th className="text-left px-4 py-2">Origin</th>
                <th className="text-left px-4 py-2">Destination</th>
                <th className="text-right px-4 py-2">Rate</th>
                <th className="text-right px-4 py-2">Prev</th>
                <th className="text-right px-4 py-2">Chg</th>
                <th className="text-right px-4 py-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.map((r) => {
                const chg = r.rate - r.prev;
                const chgColor = chg <= 0 ? "text-emerald-400" : "text-red-400";
                return (
                  <tr key={r.id} className="border-t border-slate-800 text-slate-300">
                    <td className="px-4 py-2">{r.from}</td>
                    <td className="px-4 py-2">
                      {r.to}
                      {r.proxy && <span className="ml-1 text-[9px] text-slate-500 font-sans">~est.</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-sky-300">
                      ${r.rate.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      ${r.prev.toLocaleString("en-US")}
                    </td>
                    <td className={`px-4 py-2 text-right font-bold ${chgColor}`}>
                      {chg >= 0 ? "+" : ""}{chg.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{r.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Dry bulk freight indicator */}
      {dryBulk ? (
        <BdryPanel data={dryBulk} />
      ) : (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-[10px] text-slate-600 italic">
          Loading dry bulk indicator…
        </div>
      )}
    </div>
  );
}
