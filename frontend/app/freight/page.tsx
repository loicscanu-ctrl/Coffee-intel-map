"use client";
import React, { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
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

const CHART_LINES = [
  { key: "vn-eu", label: "VN → EU", color: "#38bdf8" },
  { key: "br-eu", label: "BR → EU", color: "#4ade80" },
  { key: "vn-us", label: "VN → US", color: "#fb923c" },
  { key: "et-eu", label: "ET → EU", color: "#c084fc" },
];

export default function FreightPage() {
  const [data, setData] = useState<FreightData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/freight")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      <h1 className="text-lg font-bold text-white">Freight</h1>

      {/* Chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">
          Freight Rate Evolution — USD / FEU
        </div>
        {data?.updated && (
          <div className="text-[10px] text-slate-600 mb-3">
            Last updated: {data.updated}
          </div>
        )}

        {loading && (
          <div className="h-[260px] flex items-center justify-center text-slate-500 text-xs">
            Loading…
          </div>
        )}

        {!loading && (!data || data.history.length === 0) && (
          <div className="h-[260px] flex items-center justify-center text-slate-500 text-xs">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {!loading && data && data.history.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={50}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(v: number) => [`$${v.toLocaleString("en-US")}`, ""]}
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

        {loading && (
          <div className="px-4 py-6 text-xs text-slate-500">Loading…</div>
        )}

        {!loading && (!data || data.routes.length === 0) && (
          <div className="px-4 py-6 text-xs text-slate-500">
            Freight data not yet available — check back after the next scraper run.
          </div>
        )}

        {!loading && data && data.routes.length > 0 && (
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
                      {r.proxy && (
                        <span className="ml-1 text-[9px] text-slate-500 font-sans">~est.</span>
                      )}
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
    </div>
  );
}
