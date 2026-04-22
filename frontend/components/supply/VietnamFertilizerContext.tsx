"use client";
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface FertMonth {
  month: string;
  urea_kt: number;
  kcl_kt: number;
  npk_kt: number;
  dap_kt: number;
  total_kt: number;
}

interface FertContext {
  source: string;
  note: string;
  key_suppliers: Record<string, string>;
  price_sensitivity: string;
  monthly?: FertMonth[];
}

interface Props { context: FertContext }

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

const COLORS = {
  urea: "#3b82f6",
  kcl:  "#8b5cf6",
  npk:  "#10b981",
  dap:  "#f59e0b",
};

const YEAR_COLORS = ["#64748b", "#3b82f6", "#22c55e", "#f59e0b"];

const SUPPLIER_COLORS: Record<string, string> = {
  urea:   "#3b82f6",
  npk:    "#10b981",
  potash: "#f59e0b",
};

export default function VietnamFertilizerContext({ context }: Props) {
  const monthly = context.monthly ?? [];

  // Group by month number → one row per month, one key per year
  const byMonth: Record<number, Record<string, number>> = {};
  const years = new Set<string>();
  for (const m of monthly) {
    const [yr, mo] = m.month.split("-");
    const moIdx = parseInt(mo) - 1;
    if (!byMonth[moIdx]) byMonth[moIdx] = {};
    byMonth[moIdx][yr] = m.total_kt;
    years.add(yr);
  }
  const sortedYears = Array.from(years).sort();
  const chartData = MONTH_ABBR.map((label, i) => {
    const vals = Object.values(byMonth[i] || {}).filter(v => v > 0);
    return {
      month: label,
      ...byMonth[i],
      min_range: vals.length > 1 ? Math.min(...vals) : null,
      max_range: vals.length > 1 ? Math.max(...vals) : null,
    };
  }).filter(row => sortedYears.some(yr => (row as Record<string, unknown>)[yr] != null));

  const last = monthly[monthly.length - 1];
  const avg12 = monthly.slice(-13, -1);
  const avgTotal = avg12.length
    ? Math.round(avg12.reduce((s, r) => s + r.total_kt, 0) / avg12.length)
    : null;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Vietnam Fertilizer Imports
        </div>
        <div className="text-[8px] text-slate-600">{context.source}</div>
      </div>

      {/* KPI row */}
      {last && (
        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
          {(["urea","kcl","npk","dap"] as const).map(k => {
            const val = last[`${k}_kt` as keyof FertMonth] as number;
            return (
              <div key={k}>
                <div className="text-[9px] mb-0.5 font-bold uppercase" style={{ color: COLORS[k] }}>{k}</div>
                <div className="text-white font-bold">{val}</div>
                <div className="text-[9px] text-slate-600">kt</div>
              </div>
            );
          })}
        </div>
      )}
      {avgTotal && (
        <div className="text-[9px] text-slate-500">
          12-mo avg total: <span className="text-slate-300 font-mono font-bold">{avgTotal} kt/month</span>
        </div>
      )}

      {/* Grouped bar chart — one bar per year, grouped by month */}
      {chartData.length > 0 && (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, left: -20, bottom: 0 }} barCategoryGap="20%" barGap={2}>
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}`} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name?: string | number) => [`${Number(v)} kt`, String(name)]}
              />
              {sortedYears.map((yr, i) => (
                <Bar
                  key={yr}
                  dataKey={yr}
                  name={yr}
                  fill={YEAR_COLORS[i % YEAR_COLORS.length]}
                  radius={[2,2,0,0]}
                  opacity={i === sortedYears.length - 1 ? 1 : 0.7}
                />
              ))}
              <Line dataKey="min_range" stroke="#334155" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
              <Line dataKey="max_range" stroke="#475569" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[7px] text-slate-500">
        {sortedYears.map((yr, i) => (
          <span key={yr} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: YEAR_COLORS[i % YEAR_COLORS.length] }} />
            {yr}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-3 h-px border-t border-dashed border-slate-500 inline-block" />yr range
        </span>
        <span className="text-slate-600 ml-1">· total kt/month</span>
      </div>

      {/* Supplier breakdown */}
      <div className="border-t border-slate-700 pt-3">
        <div className="text-[9px] text-slate-500 mb-2">Key suppliers by input</div>
        <div className="space-y-1.5">
          {Object.entries(context.key_suppliers).map(([type, suppliers]) => (
            <div key={type} className="flex gap-2 text-[9px]">
              <div
                className="px-1.5 py-0.5 rounded font-bold uppercase text-white flex-shrink-0"
                style={{ background: SUPPLIER_COLORS[type] ?? "#64748b", fontSize: "8px" }}
              >
                {type}
              </div>
              <div className="text-slate-400">{suppliers}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-amber-400/80 bg-amber-950/30 border border-amber-800/40 rounded px-2 py-1.5">
        {context.price_sensitivity}
      </div>

      <div className="text-[9px] text-slate-600 italic">{context.note}</div>
    </div>
  );
}
