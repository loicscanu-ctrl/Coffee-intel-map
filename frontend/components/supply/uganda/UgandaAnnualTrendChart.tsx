"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import {
  computeBalanceSheet, formatBalanceSheetTooltip, selectProjectionRows,
  usdaYearForCropYear, type BalanceSheetProjection, type PsdRow,
} from "@/lib/balanceSheetProjection";

interface ExportMonth {
  month: string;                // "YYYY-MM"
  total_bags: number;
  total_k_bags: number;
  robusta_bags?: number;
  arabica_bags?: number;
  robusta_k_bags?: number;
  arabica_k_bags?: number;
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };
const AMBER = "#f59e0b";
const GREEN = "#22c55e";
const INDIGO = "#818cf8";

/** Uganda crop year: Oct Y → Sep Y+1, labelled "Y/Y+1" (e.g. "2025/26") —
 *  matches both the local growing cycle (main crop Oct–Feb) and USDA's
 *  Coffee MY for Uganda. */
function ugCropYearKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 10 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

/** Thousand 60-kg bags → kt (thousand metric tons). */
function kBagsToKT(k_bags: number): number {
  return Math.round((k_bags * 60) / 1000 * 10) / 10;
}

/** Same Brazil-style annual trend chart: crop-year aggregation with type
 *  split (robusta / arabica), a balance-sheet-driven projection bar on the
 *  latest incomplete year, and a tooltip surfacing the USDA inputs.
 *
 *  Data inputs:
 *   - `monthly` (from uganda_supply.json) — per-month totals, optionally
 *     pre-split into robusta_k_bags / arabica_k_bags. When the split is
 *     absent the chart falls back to a single "Total" bar.
 *   - /data/demand_stocks.json producers.uganda.annual — drives the
 *     balance-sheet projection (forecastRow or proxy from latest realized). */
export default function UgandaAnnualTrendChart({ monthly }: { monthly: ExportMonth[] }) {
  const [psdRows, setPsdRows] = useState<PsdRow[] | null>(null);
  const [since, setSince] = useState(2020);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const a = d?.producers?.uganda?.annual ?? null;
        setPsdRows(Array.isArray(a) ? a : null);
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  const { data, projection, hasSplit } = useMemo(() => {
    const byCrop: Record<string, { robusta: number; arabica: number; total: number; months: number }> = {};
    let anyRobArab = false;
    monthly.forEach(r => {
      const key = ugCropYearKey(r.month);
      if (!byCrop[key]) byCrop[key] = { robusta: 0, arabica: 0, total: 0, months: 0 };
      const rob_kt = r.robusta_k_bags != null ? kBagsToKT(r.robusta_k_bags) : 0;
      const ara_kt = r.arabica_k_bags != null ? kBagsToKT(r.arabica_k_bags) : 0;
      if (r.robusta_k_bags != null || r.arabica_k_bags != null) anyRobArab = true;
      byCrop[key].robusta += rob_kt;
      byCrop[key].arabica += ara_kt;
      byCrop[key].total   += kBagsToKT(r.total_k_bags);
      byCrop[key].months  += 1;
    });
    const keys = Object.keys(byCrop).sort();
    const latestKey = keys[keys.length - 1];
    const latestData = latestKey ? byCrop[latestKey] : null;
    const incomplete = latestData && latestData.months < 12;

    let proj: BalanceSheetProjection | null = null;
    let projGap = 0;
    if (incomplete && latestKey && latestData) {
      const inYear = usdaYearForCropYear(latestKey);
      const { forecastRow, latestRow } = selectProjectionRows(psdRows, inYear);
      proj = computeBalanceSheet(forecastRow, latestRow, latestData.total);
      if (proj) projGap = proj.projected_gap_kt;
    }

    return {
      hasSplit: anyRobArab,
      data: keys
        .map(k => {
          const d = byCrop[k];
          const startYear = parseInt(k.split("/")[0], 10);
          const isIncomplete = k === latestKey && d.months < 12;
          return {
            year:      k,
            startYear,
            robusta:   Math.round(d.robusta * 10) / 10,
            arabica:   Math.round(d.arabica * 10) / 10,
            total:     Math.round(d.total * 10) / 10,
            proj_gap:  isIncomplete ? projGap : 0,
            months:    d.months,
          };
        })
        .filter(r => r.startYear >= since),
      projection: proj,
    };
  }, [monthly, psdRows, since]);

  if (data.length < 2) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Annual Export Volume — Crop Year (Oct–Sep)
          </div>
          <div className="text-[10px] text-slate-500">
            kt · stacked Robusta + Arabica · † projected when crop is incomplete
            {projection && (
              <span className="ml-1 italic" title={formatBalanceSheetTooltip(projection)}>
                · expected total {Math.round(projection.expected_total_kt).toLocaleString()} kt
                {projection.psd_year && (
                  <span className="text-slate-600 not-italic">
                    {" "}(USDA {projection.psd_year}{projection.mode === "proxy" ? " proxy" : ""})
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {[2015, 2020].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end"
            tickFormatter={v => {
              const row = data.find(d => d.year === v);
              return row && row.months < 12 ? `${v}†` : v;
            }}
          />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={((v, name) => {
              if (name === "proj_gap") return [`+${v} kt`, "Projected remaining" as NameType];
              if (name === "robusta")  return [`${v} kt`, "Robusta" as NameType];
              if (name === "arabica")  return [`${v} kt`, "Arabica" as NameType];
              if (name === "total")    return [`${v} kt`, "Total" as NameType];
              return [`${v} kt`, name as NameType];
            }) satisfies Formatter<ValueType, NameType>} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>{
                v === "proj_gap" ? "† Projected" :
                v === "robusta"  ? "Robusta" :
                v === "arabica"  ? "Arabica" :
                v === "total"    ? "Total" : v
              }</span>
            )} />
          {hasSplit
            ? <>
                <Bar dataKey="robusta" stackId="a" fill={AMBER} />
                <Bar dataKey="arabica" stackId="a" fill={GREEN} />
              </>
            : <Bar dataKey="total" stackId="a" fill={AMBER} />
          }
          <Bar dataKey="proj_gap" stackId="a" fill={INDIGO} fillOpacity={0.35} stroke={INDIGO} strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
