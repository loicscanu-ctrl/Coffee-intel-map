"use client";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { FarmerEconomicsData, FertilizerItem, FertilizerImportMonth } from "./farmerEconomicsData";
import { fertCostDelta, netFertImpact } from "./farmerEconomicsUtils";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YEAR_COLORS: Record<string, string> = {
  "2023": "#475569",
  "2024": "#94a3b8",
  "2025": "#f59e0b",
  "2026": "#3b82f6",
};

function buildYoYData(monthly: FertilizerImportMonth[]) {
  // Build { monthIdx: { "2024": total_kt, "2025": total_kt, ... } }
  const byMonth: Record<number, Record<string, number>> = {};
  for (const m of monthly) {
    const [yr, mo] = m.month.split("-");
    const idx = parseInt(mo) - 1;
    if (!byMonth[idx]) byMonth[idx] = {};
    byMonth[idx][yr] = (byMonth[idx][yr] ?? 0) + m.total_kt;
  }
  const years = [...new Set(monthly.map(m => m.month.slice(0, 4)))].sort();
  return {
    years,
    rows: MONTH_ABBR.map((label, i) => ({ month: label, ...byMonth[i] })),
  };
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

  const yoy = imports ? buildYoYData(imports.monthly) : null;

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

      {/* Fertilizer imports YoY line chart */}
      {yoy && yoy.rows.length > 0 && (
        <div className="pt-2 border-t border-slate-700">
          <div className="text-[9px] text-slate-400 mb-1 flex justify-between">
            <span>Brazil Fertilizer Imports — Total (kt, YoY)</span>
            <span className="text-slate-600">Comex Stat · {imports!.last_updated}</span>
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yoy.rows} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown, name?: string | number) => [`${Number(v).toFixed(0)} kt`, String(name ?? "")]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 8, color: "#94a3b8", paddingTop: 2 }}
                  iconType="line"
                  iconSize={8}
                />
                {yoy.years.map((yr) => (
                  <Line
                    key={yr}
                    type="monotone"
                    dataKey={yr}
                    stroke={YEAR_COLORS[yr] ?? "#64748b"}
                    strokeWidth={yr === yoy.years[yoy.years.length - 1] ? 2 : 1.5}
                    strokeDasharray={yr === yoy.years[yoy.years.length - 1] ? undefined : undefined}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
