"use client";
import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import {
  VN_CROP_MONTH_LABELS, VN_CROP_MONTH_ORDER, VN_CROP_YEAR_COLORS,
  TT_STYLE, vnCropYearKey, kBagsToKT,
} from "./helpers";
import type { ExportMonth } from "./MonthlyVolumeChart";

export default function CumulativePaceChart({ monthly }: { monthly: ExportMonth[] }) {
  // Group by crop year → crop-month-index → cumulative kt
  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    monthly.forEach(r => {
      const ck  = vnCropYearKey(r.month);
      const mo  = parseInt(r.month.split("-")[1]);
      const idx = VN_CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: kBagsToKT(r.total_k_bags) });
    });
    const result: Record<string, (number | null)[]> = {};
    Object.entries(byYear).forEach(([ck, pts]) => {
      pts.sort((a, b) => a.mo - b.mo);
      const arr: (number | null)[] = Array(12).fill(null);
      let cum = 0;
      pts.forEach(({ mo, kt }) => { cum += kt; arr[mo] = Math.round(cum * 10) / 10; });
      result[ck] = arr;
    });
    return result;
  }, [monthly]);

  const sortedKeys = Object.keys(grouped).sort();
  if (sortedKeys.length < 2) return null;

  const currentKey = sortedKeys[sortedKeys.length - 1];
  const prior1Key  = sortedKeys[sortedKeys.length - 2];
  const prior2Key  = sortedKeys.length >= 3 ? sortedKeys[sortedKeys.length - 3] : null;

  const currentArr  = grouped[currentKey];
  const lastIdx     = currentArr.reduce<number>((acc, v, i) => v !== null ? i : acc, -1);
  const lastKt      = lastIdx >= 0 ? (currentArr[lastIdx] ?? null) : null;
  const prior1AtIdx = lastIdx >= 0 ? (grouped[prior1Key][lastIdx] ?? null) : null;
  const pacePct     = lastKt && prior1AtIdx && prior1AtIdx > 0
    ? Math.round((lastKt - prior1AtIdx) / prior1AtIdx * 100 * 10) / 10
    : null;

  const chartData = VN_CROP_MONTH_LABELS.map((month, i) => ({
    month,
    [currentKey]: grouped[currentKey][i],
    [prior1Key]:  grouped[prior1Key][i],
    ...(prior2Key ? { [prior2Key]: grouped[prior2Key][i] } : {}),
  }));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Cumulative Crop-Year Pace</div>
          <div className="text-[10px] text-slate-500">
            Cumulative exports by crop month (Oct → Sep) · kt
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [v != null ? `${v} kt` : "—", `Crop ${name}` as NameType]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>Crop {v}</span>} />
          {prior2Key && (
            <Line type="monotone" dataKey={prior2Key} stroke={VN_CROP_YEAR_COLORS[2]}
              strokeWidth={1} dot={false} connectNulls />
          )}
          <Line type="monotone" dataKey={prior1Key} stroke={VN_CROP_YEAR_COLORS[1]}
            strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey={currentKey} stroke={VN_CROP_YEAR_COLORS[0]}
            strokeWidth={2.5} dot={(props) => {
              const p = props.payload as Record<string, number | null> | undefined;
              if (props.index !== lastIdx || p?.[currentKey] == null) return <g key={props.key as string} />;
              return (
                <g key={props.key as string}>
                  <circle cx={props.cx} cy={props.cy} r={3} fill={VN_CROP_YEAR_COLORS[0]} />
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
