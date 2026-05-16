"use client";
import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TT_STYLE, vnCropYearKey, kBagsToKT } from "./helpers";
import type { ExportMonth } from "./MonthlyVolumeChart";

export default function AnnualTrendChart({ monthly }: { monthly: ExportMonth[] }) {
  const data = useMemo(() => {
    const byCrop: Record<string, { kt: number; months: number }> = {};
    monthly.forEach(r => {
      const key = vnCropYearKey(r.month);
      if (!byCrop[key]) byCrop[key] = { kt: 0, months: 0 };
      byCrop[key].kt     += kBagsToKT(r.total_k_bags);
      byCrop[key].months += 1;
    });
    const keys = Object.keys(byCrop).sort();
    const latestKey = keys[keys.length - 1];
    const prevKey   = keys.length >= 2 ? keys[keys.length - 2] : null;

    // Project current crop if incomplete: scale by same-period prior year ratio
    let proj = 0;
    if (prevKey && byCrop[latestKey].months < 12) {
      const ratio = byCrop[latestKey].kt / Math.max(byCrop[prevKey].kt * (byCrop[latestKey].months / 12), 1);
      proj = Math.max(0, byCrop[prevKey].kt * ratio - byCrop[latestKey].kt);
      proj = Math.round(proj * 10) / 10;
    }

    return keys.map(k => ({
      year:      k,
      actual:    Math.round(byCrop[k].kt * 10) / 10,
      projected: k === latestKey ? proj : 0,
      months:    byCrop[k].months,
    }));
  }, [monthly]);

  if (data.length < 2) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Annual Export Volume</div>
        <div className="text-[10px] text-slate-500">
          Crop year totals (Oct–Sep) · kt · † projected when crop is incomplete
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }}
            tickFormatter={v => {
              const row = data.find(d => d.year === v);
              return row && row.months < 12 ? `${v}†` : v;
            }}
          />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => [`${v} kt`, name === "actual" ? "Reported" : "Projected (gap)"]) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v === "actual" ? "Reported" : "Projected (gap)"}</span>} />
          <Bar dataKey="actual"    stackId="a" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
          <Bar dataKey="projected" stackId="a" fill="#0ea5e9" fillOpacity={0.35} stroke="#0ea5e9" strokeDasharray="3 3" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
