"use client";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import {
  VN_CROP_MONTH_LABELS, VN_CROP_MONTH_ORDER, VN_CROP_YEAR_COLORS,
  TT_STYLE, vnCropYearKey, kBagsToKT,
} from "./helpers";

export interface ExportMonth {
  month:        string;
  total_k_bags: number;
  yoy_pct:      number | null;
}

export default function MonthlyVolumeChart({ monthly, isReportMode = false }: { monthly: ExportMonth[]; isReportMode?: boolean }) {
  const [cropYears, setCropYears] = useState(3);

  // Group by crop year key → month number → kt
  const cropGroups = useMemo(() => {
    const m: Record<string, Record<number, number>> = {};
    monthly.forEach(r => {
      const key = vnCropYearKey(r.month);
      const mo  = parseInt(r.month.split("-")[1]);
      if (!m[key]) m[key] = {};
      m[key][mo] = kBagsToKT(r.total_k_bags);
    });
    return m;
  }, [monthly]);

  const sortedCropKeys = Object.keys(cropGroups).sort();
  const latestCrop     = sortedCropKeys[sortedCropKeys.length - 1];
  const showCrops      = sortedCropKeys.slice(-cropYears).reverse();
  const YEAR_COLORS    = VN_CROP_YEAR_COLORS.slice(0, cropYears);

  const chartData = VN_CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string> = { month: VN_CROP_MONTH_LABELS[i] };
    showCrops.forEach(ck => {
      row[ck] = cropGroups[ck]?.[mo] ?? 0;
    });
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Monthly Export Volume
          </div>
          <div className="text-[10px] text-slate-500">
            Crop year (Oct–Sep) · Thousand metric tons (60 kg bags)
          </div>
        </div>
        {!isReportMode && (
          <div className="flex gap-1">
            {[2, 3, 5].map(n => (
              <button key={n} onClick={() => setCropYears(n)}
                className={`text-[10px] px-2 py-0.5 rounded ${cropYears === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
                {n}Y
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [`${v} kt`, `Crop ${name}` as NameType]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>Crop {v}</span>} />
          {showCrops.map((ck, i) => (
            <Bar key={ck} dataKey={ck} name={ck}
              fill={YEAR_COLORS[i % YEAR_COLORS.length]}
              opacity={ck === latestCrop ? 1 : 0.65}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
