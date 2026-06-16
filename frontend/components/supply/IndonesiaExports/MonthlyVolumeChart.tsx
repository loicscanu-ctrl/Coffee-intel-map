"use client";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  CROP_MONTH_LABELS, CROP_MONTH_ORDER, CROP_YEAR_COLORS, TT_STYLE,
  TYPE_FILTER_OPTS,
} from "./constants";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { cropYearKey, kgToKT } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";

/** Monthly Export Volume — Total (All Types). Mirrors Brazil's
 *  MonthlyVolumeChart minus the projection overlay (no Indonesia
 *  forecast engine yet). Stacked-by-crop-year view. */
export default function MonthlyVolumeChart({
  series, typeFilter, isFiltered = false, isReportMode = false,
}: {
  series: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isFiltered?: boolean;
  isReportMode?: boolean;
}) {
  const activeKey: SeriesKey = typeFilter ?? "total";
  const [cropYears, setCropYears] = useState(3);

  const cropGroups = useMemo(() => {
    const m: Record<string, Record<number, VolumeSeries>> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      if (!m[key]) m[key] = {};
      m[key][mo] = r;
    });
    return m;
  }, [series]);

  const sortedCropKeys = Object.keys(cropGroups).sort();
  const latestCrop     = sortedCropKeys[sortedCropKeys.length - 1];
  const showCrops      = sortedCropKeys.slice(-cropYears).reverse();
  const YEAR_COLORS    = CROP_YEAR_COLORS.slice(0, cropYears);

  const chartData = CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string | null> = { month: CROP_MONTH_LABELS[i] };
    showCrops.forEach(ck => {
      const r = cropGroups[ck]?.[mo];
      row[ck] = r ? kgToKT(r[activeKey] ?? r.total) : 0;
    });
    return row;
  });

  const typeLabel = typeFilter
    ? TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total"
    : "Total (All Types)";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Monthly Export Volume — {typeLabel}
          </div>
          <div className="text-[10px] text-slate-500">
            Crop year (Apr–Mar) · Thousand metric tons (kg ÷ 1M)
            {isFiltered && <span className="ml-2 text-slate-600 italic">· filtered</span>}
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
              opacity={ck === latestCrop ? 1.0 : 0.6}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
