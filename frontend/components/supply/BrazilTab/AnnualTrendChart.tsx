"use client";
import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  AMBER, BLUE, BRAZIL_DOMESTIC_KT, GREEN, TEAL, TT_STYLE, TYPE_FILTER_OPTS,
} from "./constants";
import { bagsToKT, cropYearKey } from "./helpers";
import type { SeriesKey, VolumeSeries } from "./types";

export default function AnnualTrendChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
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

    // Projection gap for incomplete current crop (skip if destination or type filter active)
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

    // Determine which bars to show
    const showSingle = isFiltered || !!typeFilter;
    const typeLabel = typeFilter
      ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Selected")
      : "Total";

    return sortedKeys
      .map(k => {
        const d = byCrop[k];
        const isIncomplete = k === latestKey && d.months < 12;
        const row: Record<string, any> = {
          year: k,
          startYear: parseInt(k.split("/")[0]),
          domestic:  (!isFiltered && !typeFilter) ? (BRAZIL_DOMESTIC_KT[k] ?? null) : null,
          proj_gap:  isIncomplete ? Math.round(bagsToKT(projGap) * 10) / 10 : 0,
        };
        if (showSingle) {
          row[typeLabel] = bagsToKT(d[activeKey]);
        } else {
          row["Arabica (green)"]  = bagsToKT(d.arabica);
          row["Conillon (green)"] = bagsToKT(d.conillon);
          row["Soluble"]          = bagsToKT(d.soluvel);
          row["Roasted & Ground"] = bagsToKT(d.torrado);
        }
        return row;
      })
      .filter(r => r.startYear >= since);
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
            formatter={(v: any, name: any) => {
              if (name === "domestic") return [`${v} kt`, "Domestic consumption (USDA est.)"];
              if (name === "proj_gap") return [`+${v} kt`, "Projected remaining"];
              return [`${v} kt`, name];
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
