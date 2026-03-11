"use client";
import React from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const FREIGHT_ROUTES = [
  { id: "vn-eu",  from: "Ho Chi Minh",  to: "Rotterdam",   lane: "VN → EU",  rate: 2850, prev: 3100, unit: "USD/TEU" },
  { id: "vn-ham", from: "Ho Chi Minh",  to: "Hamburg",     lane: "VN → HAM", rate: 2920, prev: 3200, unit: "USD/TEU" },
  { id: "br-eu",  from: "Santos",       to: "Rotterdam",   lane: "BR → EU",  rate: 1650, prev: 1580, unit: "USD/TEU" },
  { id: "co-eu",  from: "Cartagena",    to: "Rotterdam",   lane: "CO → EU",  rate: 1780, prev: 1700, unit: "USD/TEU" },
  { id: "et-eu",  from: "Djibouti",     to: "Rotterdam",   lane: "ET → EU",  rate: 2100, prev: 1950, unit: "USD/TEU" },
  { id: "vn-us",  from: "Ho Chi Minh",  to: "Los Angeles", lane: "VN → US",  rate: 3200, prev: 3450, unit: "USD/TEU" },
  { id: "br-us",  from: "Santos",       to: "New York",    lane: "BR → US",  rate: 1400, prev: 1380, unit: "USD/TEU" },
];

const FREIGHT_HISTORY = [
  { week: "W-11", "VN→EU": 4100, "BR→EU": 1480, "VN→US": 4400, "ET→EU": 2600 },
  { week: "W-10", "VN→EU": 3950, "BR→EU": 1510, "VN→US": 4250, "ET→EU": 2520 },
  { week: "W-9",  "VN→EU": 3800, "BR→EU": 1540, "VN→US": 4050, "ET→EU": 2450 },
  { week: "W-8",  "VN→EU": 3650, "BR→EU": 1570, "VN→US": 3880, "ET→EU": 2380 },
  { week: "W-7",  "VN→EU": 3500, "BR→EU": 1590, "VN→US": 3720, "ET→EU": 2300 },
  { week: "W-6",  "VN→EU": 3350, "BR→EU": 1610, "VN→US": 3600, "ET→EU": 2250 },
  { week: "W-5",  "VN→EU": 3200, "BR→EU": 1630, "VN→US": 3480, "ET→EU": 2180 },
  { week: "W-4",  "VN→EU": 3080, "BR→EU": 1645, "VN→US": 3380, "ET→EU": 2150 },
  { week: "W-3",  "VN→EU": 2970, "BR→EU": 1650, "VN→US": 3300, "ET→EU": 2120 },
  { week: "W-2",  "VN→EU": 2900, "BR→EU": 1650, "VN→US": 3250, "ET→EU": 2110 },
  { week: "W-1",  "VN→EU": 2870, "BR→EU": 1640, "VN→US": 3220, "ET→EU": 2105 },
  { week: "Now",  "VN→EU": 2850, "BR→EU": 1650, "VN→US": 3200, "ET→EU": 2100 },
];

const CHART_LINES = [
  { key: "VN→EU", color: "#38bdf8" },
  { key: "BR→EU", color: "#4ade80" },
  { key: "VN→US", color: "#fb923c" },
  { key: "ET→EU", color: "#c084fc" },
];

export default function FreightPage() {
  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      <h1 className="text-lg font-bold text-white">Freight</h1>

      {/* Chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-4">
          Freight Rate Evolution — USD / TEU
          <span className="text-slate-600 normal-case font-normal ml-2">(dummy data — replace with live feed)</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={FREIGHT_HISTORY} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="week" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} width={50}
              tickFormatter={v => `$${(Number(v) / 1000).toFixed(1)}k`} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: "#94a3b8" }}
              formatter={(v) => [`$${Number(v).toLocaleString()}`, ""]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
            {CHART_LINES.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color}
                strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Route table */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
          <span className="text-xs font-semibold text-slate-300">Current Spot Rates — Coffee Corridors</span>
          <span className="text-[10px] text-slate-500 ml-3">20ft container · indicative · dummy data</span>
        </div>
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
            {FREIGHT_ROUTES.map(r => {
              const chg = r.rate - r.prev;
              const chgColor = chg <= 0 ? "text-emerald-400" : "text-red-400";
              return (
                <tr key={r.id} className="border-t border-slate-800 text-slate-300">
                  <td className="px-4 py-2">{r.from}</td>
                  <td className="px-4 py-2">{r.to}</td>
                  <td className="px-4 py-2 text-right font-bold text-sky-300">${r.rate.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-slate-500">${r.prev.toLocaleString()}</td>
                  <td className={`px-4 py-2 text-right font-bold ${chgColor}`}>
                    {chg >= 0 ? "+" : ""}{chg.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500">{r.unit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
