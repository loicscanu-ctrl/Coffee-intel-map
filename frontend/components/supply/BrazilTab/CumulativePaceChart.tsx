"use client";
import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  CROP_MONTH_LABELS, CROP_MONTH_ORDER, CROP_YEAR_COLORS, TT_STYLE,
} from "./constants";
import { bagsToKT, cropYearKey } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";

export default function CumulativePaceChart({ series, filteredSeries, typeFilter }: {
  series: VolumeSeries[];
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
}) {
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  // Group by crop year → crop month index → cumulative kt
  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    activeSeries.forEach(r => {
      const ck = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: bagsToKT(r[activeKey] ?? r.total) });
    });
    // Sort each year's entries by crop month index, compute cumulative
    const result: Record<string, (number | null)[]> = {};
    Object.entries(byYear).forEach(([ck, pts]) => {
      pts.sort((a, b) => a.mo - b.mo);
      const arr: (number | null)[] = Array(12).fill(null);
      let cum = 0;
      pts.forEach(({ mo, kt }) => { cum += kt; arr[mo] = Math.round(cum * 10) / 10; });
      result[ck] = arr;
    });
    return result;
  }, [activeSeries, activeKey]);

  const sortedKeys = Object.keys(grouped).sort();
  if (sortedKeys.length < 2) return null;

  const currentKey = sortedKeys[sortedKeys.length - 1];
  const prior1Key  = sortedKeys[sortedKeys.length - 2];
  const prior2Key  = sortedKeys.length >= 3 ? sortedKeys[sortedKeys.length - 3] : null;

  // Last non-null index for current year
  const currentArr = grouped[currentKey];
  const lastIdx    = currentArr.reduce<number>((acc, v, i) => v !== null ? i : acc, -1);
  const lastKt     = lastIdx >= 0 ? (currentArr[lastIdx] ?? null) : null;

  // Pace vs prior year (same crop month)
  const prior1Arr   = grouped[prior1Key];
  const prior1AtIdx = lastIdx >= 0 ? (prior1Arr[lastIdx] ?? null) : null;
  const pacePct     = lastKt && prior1AtIdx && prior1AtIdx > 0
    ? Math.round((lastKt - prior1AtIdx) / prior1AtIdx * 100 * 10) / 10
    : null;

  const chartData = CROP_MONTH_LABELS.map((month, i) => ({
    month,
    [currentKey]: grouped[currentKey][i],
    [prior1Key]:  grouped[prior1Key][i],
    ...(prior2Key ? { [prior2Key]: grouped[prior2Key][i] } : {}),
  }));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Cumulative Crop-Year Pace
          </div>
          <div className="text-[10px] text-slate-500">
            Cumulative exports by crop month (Apr → Mar) · kt
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => [v !== null ? `${v} kt` : "—", `Crop ${name}`]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>Crop {v}</span>} />
          {prior2Key && (
            <Line type="monotone" dataKey={prior2Key} stroke={CROP_YEAR_COLORS[2]}
              strokeWidth={1} dot={false} connectNulls />
          )}
          <Line type="monotone" dataKey={prior1Key} stroke={CROP_YEAR_COLORS[1]}
            strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey={currentKey} stroke={CROP_YEAR_COLORS[0]}
            strokeWidth={2.5} dot={(props: any) => {
              if (props.index !== lastIdx || props.payload?.[currentKey] == null) return <g key={props.key} />;
              return (
                <g key={props.key}>
                  <circle cx={props.cx} cy={props.cy} r={3} fill={CROP_YEAR_COLORS[0]} />
                  <text x={props.cx} y={(props.cy ?? 0) + 16} fill="#f87171" fontSize={9} fontFamily="monospace" textAnchor="middle">
                    {Number(lastKt).toLocaleString("en-US")}kt
                  </text>
                </g>
              );
            }}
            connectNulls />
        </LineChart>
      </ResponsiveContainer>
      {pacePct !== null && (
        <div className="text-[10px] text-slate-500 mt-1">
          {currentKey} pace vs {prior1Key}:{" "}
          <span className={`font-bold ${pacePct >= 0 ? "text-green-400" : "text-red-400"}`}>
            {pacePct >= 0 ? "+" : ""}{pacePct}%
          </span>{" "}
          at same crop-month
        </div>
      )}
    </div>
  );
}
