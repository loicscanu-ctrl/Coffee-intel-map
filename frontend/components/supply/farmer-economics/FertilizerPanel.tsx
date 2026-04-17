"use client";
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  LineChart,
} from "recharts";
import type { FarmerEconomicsData, FertilizerItem, FertilizerImportMonth } from "./farmerEconomicsData";
import { fertCostDelta, netFertImpact } from "./farmerEconomicsUtils";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatMonthLabel(m: string): string {
  // "2024-01" → "Jan-24"
  const [yr, mo] = m.split("-");
  return `${MONTH_ABBR[parseInt(mo) - 1]}-${yr.slice(2)}`;
}

function buildChartData(monthly: FertilizerImportMonth[]) {
  // Last 18 months for readability
  const recent = monthly.slice(-18);
  return recent.map((m) => ({
    month:        formatMonthLabel(m.month),
    urea_kt:      m.urea_kt,
    kcl_kt:       m.kcl_kt,
    map_dap_kt:   m.map_dap_kt,
    urea_price:   m.urea_price_usd_mt,
    kcl_price:    m.kcl_price_usd_mt,
    map_price:    m.map_dap_price_usd_mt,
  }));
}

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

  const chartData = imports ? buildChartData(imports.monthly) : [];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide flex items-baseline justify-between">
        <span>Fertilizer Prices</span>
        {fertilizer.prices_as_of && (
          <span className="text-[8px] text-slate-600 normal-case font-normal">
            Comex Stat · FOB implied · {fertilizer.prices_as_of}
          </span>
        )}
      </div>

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

      {/* Volume + Price dual-axis chart */}
      {chartData.length > 0 && (
        <div className="pt-2 border-t border-slate-700">
          <div className="text-[9px] text-slate-400 mb-1 flex justify-between">
            <span>
              Brazil Imports (kt) &amp; FOB Price ($/mt)
            </span>
            <span className="text-slate-600">Comex Stat · {imports!.last_updated}</span>
          </div>
          <div className="flex gap-3 mb-1 flex-wrap">
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-blue-500" /><span className="text-[7px] text-slate-500">Urea kt</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-violet-500" /><span className="text-[7px] text-slate-500">KCl kt</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-emerald-500" /><span className="text-[7px] text-slate-500">MAP kt</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-blue-300" /><span className="text-[7px] text-slate-500">Urea $/mt</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-violet-300" /><span className="text-[7px] text-slate-500">KCl $/mt</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-emerald-300" /><span className="text-[7px] text-slate-500">MAP $/mt</span></div>
          </div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 2, right: 28, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
                <YAxis yAxisId="vol" orientation="left"  tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="prc" orientation="right" tick={{ fontSize: 7, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown, name?: string | number) => {
                    const s = String(name ?? "");
                    if (s.includes("price")) return [`$${Number(v).toFixed(0)}/mt`, s];
                    return [`${Number(v).toFixed(0)} kt`, s];
                  }}
                />
                <Bar yAxisId="vol" dataKey="urea_kt"    name="Urea kt"  stackId="vol" fill="#3b82f6" />
                <Bar yAxisId="vol" dataKey="kcl_kt"     name="KCl kt"   stackId="vol" fill="#8b5cf6" />
                <Bar yAxisId="vol" dataKey="map_dap_kt" name="MAP kt"   stackId="vol" fill="#10b981" />
                <Line yAxisId="prc" dataKey="urea_price"  name="Urea price"  type="monotone" stroke="#93c5fd" strokeWidth={1.5} dot={false} connectNulls />
                <Line yAxisId="prc" dataKey="kcl_price"   name="KCl price"   type="monotone" stroke="#c4b5fd" strokeWidth={1.5} dot={false} connectNulls />
                <Line yAxisId="prc" dataKey="map_price"   name="MAP price"   type="monotone" stroke="#6ee7b7" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
