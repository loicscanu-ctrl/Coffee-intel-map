"use client";
import React from "react";
import { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, ComposedChart, LineChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  VolumeSeries, CountryYear, SeriesKey, FilterState,
  GREEN, AMBER, BLUE, TEAL, CROP_YEAR_COLORS,
  TT_STYLE, CROP_MONTH_ORDER, CROP_MONTH_LABELS,
  HUB_COLORS, COUNTRY_HUB, HUB_ORDER,
  TYPE_FILTER_OPTS,
  BRAZIL_DOMESTIC_KT,
  bagsToKT, monthLabel,
  cropYearKey, toEn,
} from "./brazilTypes";

// ── StatCard ──────────────────────────────────────────────────────────────────

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Monthly Volume Chart ──────────────────────────────────────────────────────

interface DailyDataSlim {
  updated: string;
  arabica:  Record<string, Record<string, number>>;
  conillon: Record<string, Record<string, number>>;
  soluvel:  Record<string, Record<string, number>>;
}

export function MonthlyVolumeChart({ series, typeFilter, isFiltered }: {
  series: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isFiltered?: boolean;
}) {
  const activeKey: SeriesKey = typeFilter ?? "total";
  const [cropYears, setCropYears] = useState(3);
  const [dailyData, setDailyData] = useState<DailyDataSlim | null>(null);

  useEffect(() => {
    if (isFiltered) { setDailyData(null); return; }
    fetch("/data/cecafe_daily.json")
      .then(r => r.json()).then(setDailyData).catch((err) => console.error("[BrazilTab] cecafe_daily fetch failed:", err));
  }, [isFiltered]);

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
  const showCrops      = sortedCropKeys.slice(-cropYears).reverse();
  const YEAR_COLORS    = CROP_YEAR_COLORS.slice(0, cropYears);

  const forecast = useMemo(() => {
    if (!dailyData) return null;
    const ym = dailyData.updated.slice(0, 7);
    if (series.some(r => r.date === ym)) return null;

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
      case "torrado": case "total_verde": case "total_industria": return null;
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

  const EST_KEY = "__forecast__";

  const estColor = (() => {
    if (!forecast) return CROP_YEAR_COLORS[0];
    const idx = showCrops.indexOf(forecast.cropKey);
    return idx >= 0 ? YEAR_COLORS[idx] : CROP_YEAR_COLORS[0];
  })();

  const chartData = CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string> = { month: CROP_MONTH_LABELS[i] };
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
            formatter={(v: unknown, name: unknown) => [
              `${v} kt${name === EST_KEY ? " (est.)" : ""}`,
              name === EST_KEY ? `Crop ${forecast?.cropKey ?? ""} (forecast)` : `Crop ${name}`,
            ]} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => <span style={{ color: v === EST_KEY ? estColor : "#cbd5e1" }}>
              {v === EST_KEY ? `Crop ${forecast?.cropKey ?? ""} (forecast)` : `Crop ${v}`}
            </span>} />
          <Bar key={EST_KEY} dataKey={EST_KEY} name={EST_KEY}
            stackId="a" fill={estColor} fillOpacity={0.35} stroke={estColor} strokeWidth={1} />
          {showCrops.map((ck, i) => (
            <Bar key={ck} dataKey={ck} name={ck}
              stackId="a" fill={YEAR_COLORS[i]} radius={i === 0 ? [3, 3, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Annual Trend ──────────────────────────────────────────────────────────────

export function AnnualTrendChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const [since, setSince] = useState(2010);
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  const annualData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; total: number; months: number }> = {};
    activeSeries.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, total: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].total    += r.total;
      byCrop[key].months   += 1;
    });
    const sortedKeys = Object.keys(byCrop).sort();
    const latestKey  = sortedKeys[sortedKeys.length - 1];
    const prevKey    = sortedKeys.length >= 2 ? sortedKeys[sortedKeys.length - 2] : null;
    const latestData = byCrop[latestKey];
    const prevData   = prevKey ? byCrop[prevKey] : null;

    const skipProj  = isFiltered || !!typeFilter;
    let projGap = 0;
    if (!skipProj && prevData && latestData.months < 12) {
      const ctdMonths = new Set(
        series.filter(r => cropYearKey(r.date) === latestKey).map(r => parseInt(r.date.split("-")[1]))
      );
      const prevCTD = series
        .filter(r => cropYearKey(r.date) === prevKey && ctdMonths.has(parseInt(r.date.split("-")[1])))
        .reduce((s, r) => s + r.arabica + r.conillon + r.soluvel + r.torrado, 0);
      const currCTD = latestData.arabica + latestData.conillon + latestData.soluvel + latestData.torrado;
      if (prevCTD > 0) {
        const prevFull = prevData.arabica + prevData.conillon + prevData.soluvel + prevData.torrado;
        projGap = Math.max(0, prevFull * (currCTD / prevCTD) - currCTD);
      }
    }

    const showSingle = isFiltered || !!typeFilter;
    const typeLabel = typeFilter
      ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Selected")
      : "Total";

    return sortedKeys
      .map(k => {
        const d = byCrop[k];
        const isIncomplete = k === latestKey && d.months < 12;
        const row: Record<string, unknown> = {
          year: k,
          startYear: parseInt(k.split("/")[0]),
          domestic:  (!isFiltered && !typeFilter) ? (BRAZIL_DOMESTIC_KT[k] ?? null) : null,
          proj_gap:  isIncomplete ? Math.round(bagsToKT(projGap) * 10) / 10 : 0,
        };
        if (showSingle) {
          row[typeLabel] = bagsToKT((d as unknown as Record<string, number>)[activeKey]);
        } else {
          row["Arabica (green)"]  = bagsToKT(d.arabica);
          row["Conillon (green)"] = bagsToKT(d.conillon);
          row["Soluble"]          = bagsToKT(d.soluvel);
          row["Roasted & Ground"] = bagsToKT(d.torrado);
        }
        return row;
      })
      .filter(r => (r.startYear as number) >= since);
  }, [activeSeries, series, since, isFiltered, typeFilter, activeKey]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Annual Export by Coffee Type — Crop Year (Apr–Mar)</div>
          <div className="text-[10px] text-slate-500">
            kt · {isFiltered ? "Total exports for selected origin" : "incl. domestic consumption (USDA est.) · † projected full year"}
          </div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={annualData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => {
              const n = String(name ?? "");
              if (n === "domestic") return [`${v} kt`, "Domestic consumption (USDA est.)"];
              if (n === "proj_gap") return [`+${v} kt`, "Projected remaining"];
              return [`${v} kt`, n];
            }} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: v === "domestic" ? "#f97316" : "#cbd5e1" }}>{
                v === "domestic" ? "Domestic consump. (USDA)" :
                v === "proj_gap" ? "† Projected" : v
              }</span>
            )} />
          {(isFiltered || typeFilter)
            ? <Bar dataKey={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total"}
                stackId="a" fill={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.color ?? BLUE) : BLUE} />
            : <>
                <Bar dataKey="Arabica (green)"  stackId="a" fill={GREEN} />
                <Bar dataKey="Conillon (green)" stackId="a" fill={TEAL}  />
                <Bar dataKey="Soluble"          stackId="a" fill={AMBER} />
                <Bar dataKey="Roasted & Ground" stackId="a" fill={BLUE}  />
              </>
          }
          <Bar dataKey="proj_gap" stackId="a" fill="#818cf8" fillOpacity={0.35} stroke="#818cf8" strokeWidth={1} />
          {!isFiltered && (
            <Line dataKey="domestic" type="monotone" stroke="#f97316" strokeWidth={2}
              strokeDasharray="5 3" dot={false} connectNulls />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Coffee type share evolution ───────────────────────────────────────────────

export function TypeShareChart({ series }: { series: VolumeSeries[] }) {
  const [since, setSince] = useState(2010);

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; months: number }> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].months   += 1;
    });

    return Object.entries(byCrop)
      .filter(([k]) => parseInt(k.split("/")[0]) >= since)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, d]) => {
        const total = d.arabica + d.conillon + d.soluvel + d.torrado;
        if (total === 0) return null;
        return {
          year:     k,
          Arabica:  Math.round(d.arabica  / total * 1000) / 10,
          Conillon: Math.round(d.conillon / total * 1000) / 10,
          Soluble:  Math.round(d.soluvel  / total * 1000) / 10,
          Roasted:  Math.round(d.torrado  / total * 1000) / 10,
        };
      })
      .filter(Boolean) as { year: string; Arabica: number; Conillon: number; Soluble: number; Roasted: number }[];
  }, [series, since]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Coffee Type Share — Crop Year Mix</div>
          <div className="text-[10px] text-slate-500">% of total exports per type · complete and partial crop years</div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => [`${v}%`, String(name ?? "")]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          <Bar dataKey="Arabica"  stackId="s" fill={GREEN} />
          <Bar dataKey="Conillon" stackId="s" fill={TEAL}  />
          <Bar dataKey="Soluble"  stackId="s" fill={AMBER} />
          <Bar dataKey="Roasted"  stackId="s" fill={BLUE}  />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Monthly seasonality heatmap ───────────────────────────────────────────────

function intensityColor(ratio: number): string {
  if (ratio >= 0.90) return "#60a5fa";
  if (ratio >= 0.75) return "#2563eb";
  if (ratio >= 0.60) return "#1d4ed8";
  if (ratio >= 0.40) return "#1e3a5f";
  if (ratio >= 0.20) return "#1e293b";
  return "#0f172a";
}

export function SeasonalityHeatmap({ series }: { series: VolumeSeries[] }) {
  const ROWS = 7;

  const { cropKeys, grid, latestCropMonth } = useMemo(() => {
    const byYear: Record<string, number[]> = {};
    series.forEach(r => {
      const ck  = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = Array(12).fill(0);
      byYear[ck][idx] += bagsToKT(r.total);
    });

    const sorted = Object.keys(byYear).sort();
    const shown  = sorted.slice(-ROWS);
    const currentCk = sorted[sorted.length - 1];

    const currentData = byYear[currentCk] ?? [];
    let lastIdx = -1;
    currentData.forEach((v, i) => { if (v > 0) lastIdx = i; });

    const grid = shown.map(ck => {
      const row = byYear[ck];
      const peak = Math.max(...row.filter(v => v > 0), 1);
      return { ck, cells: row.map(v => v > 0 ? v / peak : null), raw: row };
    });

    return { cropKeys: shown, grid, latestCropMonth: lastIdx };
  }, [series]);

  const currentCk = cropKeys[cropKeys.length - 1];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-200">Monthly Seasonality Heatmap</div>
        <div className="text-[10px] text-slate-500">
          Cell shade = volume relative to each year&apos;s peak month · dashed = not yet elapsed
        </div>
      </div>
      <div
        className="grid gap-[3px] text-[8px]"
        style={{ gridTemplateColumns: `44px repeat(12, 1fr)` }}
      >
        <div />
        {CROP_MONTH_LABELS.map(m => (
          <div key={m} className="text-center text-slate-500 pb-1">{m}</div>
        ))}

        {[...grid].reverse().map(({ ck, cells, raw }) => (
          <React.Fragment key={ck}>
            <div
              className={`text-right pr-2 flex items-center justify-end ${
                ck === currentCk ? "text-slate-200 font-bold" : "text-slate-500"
              }`}
            >
              {ck.split("/")[1] ? `${ck.split("/")[0].slice(2)}/${ck.split("/")[1]}` : ck}
            </div>
            {cells.map((ratio, i) => {
              const isFuture = ck === currentCk && i > latestCropMonth;
              const kt       = Math.round(raw[i] * 10) / 10;
              const pct      = ratio !== null ? Math.round(ratio * 100) : null;
              return (
                <div
                  key={i}
                  title={ratio !== null ? `${CROP_MONTH_LABELS[i]}: ${kt}kt (${pct}% of peak)` : "No data"}
                  className={`h-5 rounded-[2px] ${isFuture ? "border border-dashed border-slate-700" : ""}`}
                  style={{
                    background: isFuture ? "#0f172a" : (ratio !== null ? intensityColor(ratio) : "#0f172a"),
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3 text-[9px] text-slate-500">
        <span>Low</span>
        {[0.1, 0.3, 0.5, 0.68, 0.83, 0.95].map(r => (
          <div key={r} className="w-5 h-3 rounded-[2px]" style={{ background: intensityColor(r) }} />
        ))}
        <span>Peak</span>
      </div>
    </div>
  );
}

// ── Y/Y change by type ────────────────────────────────────────────────────────

const TYPE_SERIES = [
  { key: "arabica"  as const, label: "Arabica",  color: GREEN },
  { key: "conillon" as const, label: "Conillon", color: TEAL  },
  { key: "soluvel"  as const, label: "Soluble",  color: AMBER },
  { key: "torrado"  as const, label: "Roasted",  color: BLUE  },
];

export function YoYByTypeChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const [since, setSince] = useState(2010);
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const showSingle = isFiltered || !!typeFilter;

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; total: number; months: number }> = {};
    activeSeries.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, total: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].total    += r.total;
      byCrop[key].months   += 1;
    });
    const sortedKeys = Object.keys(byCrop).sort();
    const latestKey  = sortedKeys[sortedKeys.length - 1];
    const completeKeys = sortedKeys.filter(k => k !== latestKey || byCrop[k].months === 12);
    const delta = (curr: number, prev: number) =>
      prev > 0 ? Math.round(bagsToKT(curr - prev) * 10) / 10 : null;

    return completeKeys
      .slice(1)
      .map((k, i) => {
        const prev = byCrop[completeKeys[i]];
        const curr = byCrop[k];
        const row: Record<string, unknown> = { year: k, startYear: parseInt(k.split("/")[0]) };
        if (showSingle) {
          const tf = typeFilter;
          const label = tf ? (TYPE_FILTER_OPTS.find(t => t.key === tf)?.label ?? "Total") : "Total";
          const key   = tf ?? "total";
          row[label] = delta((curr as unknown as Record<string, number>)[key], (prev as unknown as Record<string, number>)[key]);
        } else {
          row["Arabica"]  = delta(curr.arabica,  prev.arabica);
          row["Conillon"] = delta(curr.conillon, prev.conillon);
          row["Soluble"]  = delta(curr.soluvel,  prev.soluvel);
          row["Roasted"]  = delta(curr.torrado,  prev.torrado);
        }
        return row;
      })
      .filter(r => (r.startYear as number) >= since);
  }, [activeSeries, since, showSingle, typeFilter]);

  const bars = showSingle
    ? [{ label: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total",
         color: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.color ?? BLUE) : BLUE }]
    : TYPE_SERIES.map(t => ({ label: t.label, color: t.color }));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Y/Y Change by Coffee Type — Crop Year</div>
          <div className="text-[10px] text-slate-500">Volume change vs prior crop year (kt) · complete crop years only</div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }} barCategoryGap="20%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
          <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name: unknown) => [v !== null ? `${Number(v) > 0 ? "+" : ""}${v} kt` : "—", String(name ?? "")]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {bars.map(b => (
            <Bar key={b.label} dataKey={b.label} fill={b.color} radius={[2, 2, 0, 0]} maxBarSize={14} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Rolling average trend vs LY ───────────────────────────────────────────────

const WINDOWS = [
  { label: "L1M", n: 1  },
  { label: "L3M", n: 3  },
  { label: "L6M", n: 6  },
  { label: "MAT", n: 12 },
];

const WINDOW_COLORS: Record<string, string> = {
  "MAT": "#475569",
  "L6M": "#64748b",
  "L3M": BLUE,
  "L1M": GREEN,
};

export function RollingAvgChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const showSingle = isFiltered || !!typeFilter;

  const avg = (arr: VolumeSeries[], key: SeriesKey) =>
    arr.length > 0 ? arr.reduce((s, r) => s + (r as unknown as Record<string, number>)[key], 0) / arr.length : 0;

  const delta = (curr: number, prev: number) =>
    prev > 0 ? Math.round(bagsToKT(curr - prev) * 10) / 10 : null;

  const TYPES_WITH_TOTAL = showSingle
    ? [{ key: (typeFilter ?? "total") as SeriesKey, label: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total" }]
    : [
        { key: "arabica"  as const, label: "Arabica"  },
        { key: "conillon" as const, label: "Conillon" },
        { key: "soluvel"  as const, label: "Soluble"  },
        { key: "torrado"  as const, label: "Roasted"  },
        { key: "total"    as const, label: "Total"    },
      ];

  const chartData = useMemo(() =>
    TYPES_WITH_TOTAL.map(t => {
      const row: Record<string, unknown> = { type: t.label };
      WINDOWS.forEach(w => {
        const curr = activeSeries.slice(-w.n);
        const prev = activeSeries.slice(-(w.n + 12), -12);
        row[w.label] = delta(avg(curr, t.key), avg(prev, t.key));
      });
      return row;
    })
  , [activeSeries, showSingle, typeFilter]);

  const latest = activeSeries[activeSeries.length - 1]?.date ?? "";
  const subtitle = latest ? `Latest: ${monthLabel(latest)} ${latest.split("-")[0]} · L1M→MAT = short-term to moving annual total` : "";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Trend Tracker</div>
        <div className="text-[10px] text-slate-500">
          Volume delta vs same window one year prior (kt) · {subtitle}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="25%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="type" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => [v !== null ? `${Number(v) > 0 ? "+" : ""}${v} kt` : "—", String(name ?? "")]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {WINDOWS.map(w => (
            <Bar key={w.label} dataKey={w.label} fill={WINDOW_COLORS[w.label]} radius={[2, 2, 0, 0]} maxBarSize={18} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Cumulative crop-year pace ─────────────────────────────────────────────────

export function CumulativePaceChart({ series, filteredSeries, typeFilter }: {
  series: VolumeSeries[];
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
}) {
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    activeSeries.forEach(r => {
      const ck = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: bagsToKT((r as unknown as Record<string, number>)[activeKey] ?? r.total) });
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
  }, [activeSeries, activeKey]);

  const sortedKeys = Object.keys(grouped).sort();
  if (sortedKeys.length < 2) return null;

  const currentKey = sortedKeys[sortedKeys.length - 1];
  const prior1Key  = sortedKeys[sortedKeys.length - 2];
  const prior2Key  = sortedKeys.length >= 3 ? sortedKeys[sortedKeys.length - 3] : null;

  const currentArr = grouped[currentKey];
  const lastIdx    = currentArr.reduce<number>((acc, v, i) => v !== null ? i : acc, -1);
  const lastKt     = lastIdx >= 0 ? (currentArr[lastIdx] ?? null) : null;

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
          <div className="text-sm font-semibold text-slate-200">Cumulative Crop-Year Pace</div>
          <div className="text-[10px] text-slate-500">Cumulative exports by crop month (Apr → Mar) · kt</div>
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
            strokeWidth={2.5} dot={(props) => {
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

// ── Country / Hub filter ──────────────────────────────────────────────────────

export function CountryHubFilter({
  byCountry,
  filter,
  onChange,
}: {
  byCountry: CountryYear;
  filter: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const sortedCountries = useMemo(() =>
    Object.entries(byCountry.countries ?? {})
      .sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0))
      .map(([pt]) => pt)
  , [byCountry]);

  const hubCountries = filter.hub
    ? sortedCountries.filter(pt => COUNTRY_HUB[pt] === filter.hub)
    : sortedCountries;

  const isActive = filter.hub !== null || filter.country !== null || filter.type !== null;
  const activeLabels = [
    filter.type ? TYPE_FILTER_OPTS.find(t => t.key === filter.type)?.label : null,
    filter.country ? toEn(filter.country) : filter.hub,
  ].filter(Boolean).join(" · ");

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide font-medium">Filter charts</span>
        {isActive && (
          <button onClick={() => onChange({ hub: null, country: null, type: null })}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-800 text-indigo-200 hover:bg-indigo-700">
            ✕ Clear ({activeLabels || "all"})
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-14 shrink-0">Type</span>
        <div className="flex flex-wrap gap-1">
          {TYPE_FILTER_OPTS.map(t => (
            <button key={t.key}
              onClick={() => onChange({ ...filter, type: filter.type === t.key ? null : t.key })}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                filter.type === t.key
                  ? "border-transparent text-slate-900 font-semibold"
                  : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              }`}
              style={filter.type === t.key ? { background: t.color } : { borderLeftColor: t.color, borderLeftWidth: 3 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-14 shrink-0">Hub</span>
        <div className="flex flex-wrap gap-1">
          {HUB_ORDER.map(hub => (
            <button key={hub}
              onClick={() => onChange({ ...filter, hub: filter.hub === hub ? null : hub, country: null })}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                filter.hub === hub
                  ? "border-indigo-500 bg-indigo-900 text-indigo-200"
                  : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              }`}
              style={filter.hub === hub ? {} : { borderLeftColor: HUB_COLORS[hub], borderLeftWidth: 3 }}>
              {hub}
            </button>
          ))}
        </div>
      </div>

      {hubCountries.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-[10px] text-slate-500 w-14 shrink-0 pt-0.5">Country</span>
          <div className="flex flex-wrap gap-1">
            {hubCountries.slice(0, 20).map(pt => (
              <button key={pt}
                onClick={() => onChange({ ...filter, country: filter.country === pt ? null : pt })}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  filter.country === pt
                    ? "bg-indigo-700 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                }`}>
                {toEn(pt)}
              </button>
            ))}
            {hubCountries.length > 20 && (
              <span className="text-[10px] text-slate-600 self-center">+{hubCountries.length - 20} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
