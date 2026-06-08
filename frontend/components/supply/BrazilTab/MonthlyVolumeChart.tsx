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
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { bagsToKT, cropYearKey, normalizeSources } from "./helpers";
import type { DailyData, SeriesKey, VolumeSeries } from "./types";

export default function MonthlyVolumeChart({ series, typeFilter, isFiltered, isReportMode = false }: {
  series: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isFiltered?: boolean;
  isReportMode?: boolean;
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

  // Registration-based forecast for every month present in the daily
  // registration that Cecafé hasn't yet published in the official `series`.
  // Reads through the v2 schema (sources.certificados) with v1 fallback,
  // because the historical monthly series is Certificados-based — using
  // Embarques here would mix two different counting bases on one chart.
  const forecasts = useMemo<Array<{
    kt: number; monthNum: number; cropKey: string; refDay: number;
    daysInMonth: number; ym: string;
  }>>(() => {
    if (!dailyData) return [];
    const cert = normalizeSources(dailyData).certificados;
    if (activeKey === "torrado") return [];   // not tracked daily

    // Collect every YYYY-MM that has at least one day in any tracked type.
    const allMonths = new Set<string>();
    for (const t of ["arabica", "conillon", "soluvel"] as const) {
      for (const ym of Object.keys(cert[t] ?? {})) allMonths.add(ym);
    }
    const released = new Set(series.map(r => r.date));

    const latestDay = (md: Record<string, number> | undefined) => {
      const keys = Object.keys(md ?? {}).map(Number).sort((a, b) => b - a);
      return keys.length ? { val: md![String(keys[0])], day: keys[0] } : { val: 0, day: 0 };
    };

    const out: Array<{
      kt: number; monthNum: number; cropKey: string; refDay: number;
      daysInMonth: number; ym: string;
    }> = [];
    for (const ym of Array.from(allMonths)) {
      if (released.has(ym)) continue;        // Cecafé already published it
      const [fy, fm] = ym.split("-").map(Number);
      const daysInMonth = new Date(fy, fm, 0).getDate();
      const arab = latestDay(cert.arabica?.[ym]);
      const coni = latestDay(cert.conillon?.[ym]);
      const solv = latestDay(cert.soluvel?.[ym]);

      let cum = 0, refDay = 0;
      switch (activeKey) {
        case "arabica":  cum = arab.val; refDay = arab.day; break;
        case "conillon": cum = coni.val; refDay = coni.day; break;
        case "soluvel":  cum = solv.val; refDay = solv.day; break;
        default:
          refDay = Math.max(arab.day, coni.day, solv.day);
          cum = arab.val + coni.val + solv.val;
      }
      if (!cum || !refDay) continue;
      out.push({
        kt:       Math.round(bagsToKT((cum / refDay) * daysInMonth) * 10) / 10,
        monthNum: fm,
        cropKey:  cropYearKey(ym),
        refDay,
        daysInMonth,
        ym,
      });
    }
    return out.sort((a, b) => a.ym.localeCompare(b.ym));
  }, [dailyData, series, activeKey]);

  // Fast lookup by calendar month, and the latest forecast for the header
  // sub-line / color picker (the chart only has one fill-color per bar key,
  // so multi-month forecasts share the latest one's color — they're
  // typically in the same crop year anyway).
  const forecastByMonth = useMemo(() => {
    const m: Record<number, (typeof forecasts)[number]> = {};
    for (const f of forecasts) m[f.monthNum] = f;
    return m;
  }, [forecasts]);
  const forecast = forecasts.length ? forecasts[forecasts.length - 1] : null;

  // Fixed key so Bar is always in DOM — avoids recharts reordering on dynamic add
  const EST_KEY = "__forecast__";

  const estColor = (() => {
    if (!forecast) return CROP_YEAR_COLORS[0];
    const idx = showCrops.indexOf(forecast.cropKey);
    return idx >= 0 ? YEAR_COLORS[idx] : CROP_YEAR_COLORS[0];
  })();

  const chartData = CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string> = { month: CROP_MONTH_LABELS[i] };
    // EST_KEY carries every forecast month — they share a single bar series
    // but populate different month slots, so the visualization shows one
    // semi-transparent bar per unreleased month.
    row[EST_KEY] = forecastByMonth[mo]?.kt ?? 0;
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
            {forecasts.length > 0 && (
              <span className="ml-2 text-slate-600 italic">
                · est. from Certificados de Origem (
                {forecasts.map((f, i) => (
                  <span key={f.ym}>
                    {i > 0 && ", "}
                    {f.ym.slice(5)} day {f.refDay}/{f.daysInMonth}
                  </span>
                ))}
                )
              </span>
            )}
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
            formatter={((v, name) => [
              `${v} kt${name === EST_KEY ? " (est.)" : ""}`,
              (name === EST_KEY ? `Crop ${forecast?.cropKey ?? ""} (forecast)` : `Crop ${name}`) as NameType,
            ]) satisfies Formatter<ValueType, NameType>} />
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
