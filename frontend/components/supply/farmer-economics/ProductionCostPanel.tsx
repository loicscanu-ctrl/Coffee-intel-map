"use client";
import type { FarmerEconomicsData } from "./farmerEconomicsData";

interface Props {
  cost: FarmerEconomicsData["cost"];
}

export default function ProductionCostPanel({ cost }: Props) {
  const margin = cost.kc_spot - cost.total_usd_per_bag;
  const inputsUsd = cost.components.find((c) => c.label === "Inputs")?.usd ?? cost.inputs_detail.reduce((s, d) => s + d.usd, 0);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      {/* Header KPI */}
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">
          Production Cost — Brazil 2025/26
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-slate-100">
            ${cost.total_usd_per_bag}
          </span>
          <span className="text-xs text-slate-500">/ 60kg bag</span>
          <span className={`text-xs font-semibold ${cost.yoy_pct >= 0 ? "text-red-400" : "text-green-400"}`}>
            {cost.yoy_pct >= 0 ? "▲" : "▼"} {Math.abs(cost.yoy_pct).toFixed(1)}% YoY
          </span>
        </div>
      </div>

      {/* Stacked horizontal bar */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1">Cost breakdown</div>
        <div className="flex h-5 rounded overflow-hidden mb-2">
          {cost.components.map((c) => (
            <div
              key={c.label}
              style={{ width: `${c.share * 100}%`, background: c.color }}
              className="flex items-center justify-center text-[7px] font-bold text-white overflow-hidden"
            >
              {c.share >= 0.1 ? c.label.split(" ")[0].slice(0, 4) : ""}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {cost.components.map((c) => (
            <div key={c.label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="text-[10px] text-slate-400">
                {c.label} ${c.usd} ({Math.round(c.share * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Inputs sub-breakdown */}
      <div className="border-l-2 border-blue-500 pl-3 bg-slate-900 rounded-r-lg p-3">
        <div className="text-[10px] text-blue-400 uppercase tracking-wide mb-2">
          🌱 Inputs detail — ${inputsUsd}/bag total
        </div>
        <div className="space-y-1.5">
          {cost.inputs_detail.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div className="text-[10px] text-slate-400 w-40 flex-shrink-0">{item.label}</div>
              <div className="flex-1 bg-slate-800 rounded h-1.5">
                <div
                  className="h-full rounded bg-blue-400"
                  style={{ width: `${item.share * 100}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-300 font-semibold w-8 text-right">
                {Math.round(item.share * 100)}%
              </div>
              <div className="text-[10px] text-slate-500 w-8 text-right">${item.usd}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Margin line */}
      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700">
        KC spot{" "}
        <span className="text-green-400 font-bold">${cost.kc_spot}/bag</span>
        {" "}→ farmer margin ~
        <span className="text-green-400 font-bold">${margin}/bag</span>
      </div>
    </div>
  );
}
