"use client";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { FarmerEconomicsData, FertilizerItem } from "./farmerEconomicsData";
import { fertCostDelta, netFertImpact } from "./farmerEconomicsUtils";

interface Props {
  fertilizer: FarmerEconomicsData["fertilizer"];
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function FertCard({ item }: { item: FertilizerItem }) {
  const delta     = fertCostDelta(item);
  const priceRose = item.mom_pct > 0;
  const sparkData = item.sparkline.map((v, i) => ({ i, v }));

  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 flex-1 min-w-0">
      <div className="text-[10px] text-slate-400 mb-0.5">{item.name}</div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-base font-extrabold text-slate-100">${item.price_usd_mt}</span>
        <span className="text-[9px] text-slate-500">/mt</span>
      </div>
      <div className="text-[8px] text-slate-600 mb-1">CFR Brazil</div>

      <div className="h-10 mb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown) => [`$${v}/mt`, item.name]}
              labelFormatter={() => ""}
            />
            <Line
              type="monotone" dataKey="v"
              stroke={priceRose ? "#ef4444" : "#22c55e"}
              strokeWidth={1.5} dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={`text-[10px] font-semibold mb-1 ${priceRose ? "text-red-400" : "text-green-400"}`}>
        {priceRose ? "▲" : "▼"} {Math.abs(item.mom_pct).toFixed(1)}% MoM
      </div>
      <div className={`text-[9px] font-semibold px-1.5 py-0.5 rounded inline-block ${
        delta > 0 ? "bg-red-950 text-red-300" : delta < 0 ? "bg-green-950 text-green-300" : "bg-slate-800 text-slate-500"
      }`}>
        {delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {delta > 0 ? "+" : ""}{delta.toFixed(1)}/bag est.
      </div>
    </div>
  );
}

export default function FertilizerPanel({ fertilizer }: Props) {
  const net = netFertImpact(fertilizer.items);
  const imports = fertilizer.imports;

  // Bar chart data: total import volume (kt) by month
  const importChartData = imports?.monthly.map((m) => ({
    month:   m.month.slice(5),   // "2026-01" → "01"
    total:   m.total_kt,
    urea:    m.urea_kt,
    kcl:     m.kcl_kt,
    map_dap: m.map_dap_kt,
  })) ?? [];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Fertilizer Prices</div>

      <div className="flex gap-3">
        {fertilizer.items.map((item) => (
          <FertCard key={item.name} item={item} />
        ))}
      </div>

      <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-700">
        Net input cost impact:{" "}
        <span className={`font-bold ${net > 0 ? "text-amber-400" : "text-green-400"}`}>
          {net > 0 ? "+" : ""}{net.toFixed(1)}/bag vs last month
        </span>
        {" "}· Next application window: {fertilizer.next_application}
      </div>

      {/* Fertilizer imports bar chart */}
      {imports && importChartData.length > 0 && (
        <div className="pt-2 border-t border-slate-700">
          <div className="text-[9px] text-slate-400 mb-1 flex justify-between">
            <span>Brazil Fertilizer Imports (kt)</span>
            <span className="text-slate-600">Source: Comex Stat · {imports.last_updated}</span>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={importChartData} barSize={6} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown, name?: string | number) => [`${v} kt`, String(name ?? "")]}
                />
                <Bar dataKey="urea"    name="Urea"    fill="#3b82f6" stackId="a" />
                <Bar dataKey="kcl"     name="KCl"     fill="#8b5cf6" stackId="a" />
                <Bar dataKey="map_dap" name="MAP+DAP" fill="#22c55e" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
