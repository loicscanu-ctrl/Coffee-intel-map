"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  CROP_MONTH_LABELS, CROP_MONTH_ORDER, CROP_YEAR_COLORS, TT_STYLE,
  TYPE_FILTER_OPTS,
} from "./constants";
import { bagsToKT, cropYearKey } from "./helpers";
import type { DailyData, SeriesKey, VolumeSeries } from "./types";

export default function MonthlyVolumeChart({ series, typeFilter, isFiltered }: {
  series: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isFiltered?: boolean;
}) {
  const activeKey: SeriesKey = typeFilter ?? "total";
  const [cropYears, setCropYears] = useState(3);
  const [dailyData, setDailyData] = useState<DailyData | null>(null);

  useEffect(() => {
    if (isFiltered) { setDailyData(null); return; }
    fetch("/data/cecafe_daily.json")
      .then(r => r.json()).then(setDailyData).catch(() => {});
  }, [isFiltered]);

  // Group by crop year key → month number → record
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

  // Registration-based forecast for the current unreleased month
  const forecast = useMemo(() => {
    if (!dailyData) return null;
    const ym = dailyData.updated.slice(0, 7); // "YYYY-MM"
    if (series.some(r => r.date === ym)) return null; // Cecafe already released it

    const [fy, fm] = ym.split("-").map(Number);
    const daysInMonth = new Date(fy, fm, 0).getDate();

    const latestVal = (monthMap: Record<string, Record<string, number>> | undefined) => {
      const md = monthMap?.[ym] ?? {};
      const keys = Object.keys(md).map(Number).sort((a, b) => b - a);
      return keys.length ? { val: md[String(keys[0])], day: keys[0] } : { val: 0, day: 0 };
    };

    const arab = latestVal(dailyData.arabica);
    const coni = latestVal(dailyData.conillon);
    const solv = latestVal(dailyData.soluvel);

    let cum = 0, refDay = 0;
    switch (activeKey) {
      case "arabica":  cum = arab.val; refDay = arab.day; break;
      case "conillon": cum = coni.val; refDay = coni.day; break;
      case "soluvel":  cum = solv.val; refDay = solv.day; break;
      case "torrado": return null;
      // Defensive: SeriesKey doesn't list total_verde/total_industria but the
      // original code branched on them — preserve the safety net.
      default:
        refDay = Math.max(arab.day, coni.day, solv.day);
        cum = arab.val + coni.val + solv.val;
    }

    if (!cum || !refDay) return null;
    return {
      kt:       Math.round(bagsToKT((cum / refDay) * daysInMonth) * 10) / 10,
      monthNum: fm,
      cropKey:  cropYearKey(ym),
      refDay,
      daysInMonth,
    };
  }, [dailyData, series, activeKey]);

  // Fixed key so Bar is always in DOM — avoids recharts reordering on dynamic add
  const EST_KEY = "__forecast__";

  const estColor = (() => {
    if (!forecast) return CROP_YEAR_COLORS[0];
    const idx = showCrops.indexOf(forecast.cropKey);
    return idx >= 0 ? YEAR_COLORS[idx] : CROP_YEAR_COLORS[0];
  })();

  const chartData = CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string> = { month: CROP_MONTH_LABELS[i] };
    // Always include estimate key (0 when no forecast or wrong month) so bar slot is stable
    row[EST_KEY] = forecast && mo === forecast.monthNum ? forecast.kt : 0;
    showCrops.forEach(ck => {
      const r = cropGroups[ck]?.[mo];
      row[ck] = r ? bagsToKT(r[activeKey] ?? r.total) : 0;
    });
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Monthly Export Volume — {typeFilter ? TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label : "Total (All Types)"}
          </div>
          <div className="text-[10px] text-slate-500">
            Crop year (Apr–Mar) · Thousand metric tons (60 kg bags)
            {forecast && (
              <span className="ml-2 text-slate-600 italic">
                · est. based on registrations day {forecast.refDay}/{forecast.daysInMonth}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {[2, 3, 5].map(n => (
            <button key={n} onClick={() => setCropYears(n)}
              className={`text-[10px] px-2 py-0.5 rounded ${cropYears === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {n}Y
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [
              `${v} kt${name === EST_KEY ? " (est.)" : ""}`,
              name === EST_KEY ? `Crop ${forecast?.cropKey ?? ""} (forecast)` : `Crop ${name}`,
            ]} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>
                {v === EST_KEY
                  ? forecast ? `Crop ${forecast.cropKey} (est.)` : ""
                  : `Crop ${v}`}
              </span>
            )} />
          {/* Always first = leftmost; hidden until forecast loads */}
          <Bar key={EST_KEY} dataKey={EST_KEY} name={EST_KEY}
            fill={estColor} fillOpacity={forecast ? 0.35 : 0}
            legendType={forecast ? "square" : "none"} />
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
