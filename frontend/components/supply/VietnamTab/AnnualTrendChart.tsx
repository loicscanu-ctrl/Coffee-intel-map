"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TT_STYLE, vnCropYearKey, kBagsToKT } from "./helpers";
import type { ExportMonth } from "./MonthlyVolumeChart";

/** USDA PSD row shape from demand_stocks.json. We may consult two of them:
 *  the latest realized year (proxy when no forecast exists) and the row
 *  that explicitly carries the in-progress USDA marketing-year forecast. */
interface VnPSDRow {
  year?: string;
  begin_stocks_mt?: number;
  stocks_mt?: number;
  production_mt?: number;
  consumption_mt?: number;
}

/** USDA MY for Vietnam (Oct–Sep) is labelled by the ENDING calendar year.
 *  Currently in MY 25/26 (Oct 2025–Sep 2026) → label "2026". From Oct
 *  onwards we roll into the next ending year. */
function _inProgressUsdaYear(today: Date): string {
  const m = today.getUTCMonth();      // 0..11
  const y = today.getUTCFullYear();
  return String(m >= 9 ? y + 1 : y);
}

export default function AnnualTrendChart({ monthly }: { monthly: ExportMonth[] }) {
  // Two rows: the forecast for the in-progress USDA MY (if USDA has
  // published it via GAIN already), and the latest realized row as a
  // fallback proxy. Pre-merger demand_stocks only carries realized data,
  // so we need both code paths.
  const [forecastRow, setForecastRow] = useState<VnPSDRow | null>(null);
  const [latestRow,   setLatestRow]   = useState<VnPSDRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const rows: VnPSDRow[] = d?.producers?.vietnam?.annual ?? [];
        if (!rows.length) return;
        const target = _inProgressUsdaYear(new Date());
        setForecastRow(rows.find(r => r.year === target) ?? null);
        setLatestRow(rows[rows.length - 1]);
      })
      .catch(() => { /* silent — projection falls back to "no gap" */ });
    return () => { cancelled = true; };
  }, []);

  const { data, projMeta } = useMemo(() => {
    const byCrop: Record<string, { kt: number; months: number }> = {};
    monthly.forEach(r => {
      const key = vnCropYearKey(r.month);
      if (!byCrop[key]) byCrop[key] = { kt: 0, months: 0 };
      byCrop[key].kt     += kBagsToKT(r.total_k_bags);
      byCrop[key].months += 1;
    });
    const keys = Object.keys(byCrop).sort();
    const latestKey = keys[keys.length - 1];

    // Balance-sheet projection (per user spec): for the in-progress crop year,
    //   total expected exports = prior year's ending stocks
    //                          + this year's production
    //                          − this year's consumption
    //
    // Two source rows depending on what demand_stocks.json carries:
    //   • `forecastRow` — USDA's GAIN forecast row for the in-progress MY
    //     (added by the usda_gain_pdf scraper). begin_stocks_mt = opening
    //     of THIS year; production/consumption are the published forecasts.
    //   • `latestRow`   — the latest realized row, used as a proxy when no
    //     GAIN forecast is in the file yet. The realized row's stocks_mt
    //     (= ENDING of last year) = opening of THIS year; production /
    //     consumption are used as proxies for the in-progress year.
    //
    // Linear pace extrapolation is intentionally NOT used — that overstated
    // the gap because Vietnam's crop is heavily front-loaded.
    let proj = 0;
    let projTotal = 0;
    let projOpening = 0;
    let projProd    = 0;
    let projCons    = 0;
    let psdYear: string | undefined;
    let psdMode: "forecast" | "proxy" | null = null;
    const incomplete = byCrop[latestKey].months < 12;
    if (incomplete) {
      const row = forecastRow ?? latestRow;
      if (row) {
        const openingMt = forecastRow
          ? (forecastRow.begin_stocks_mt ?? 0)   // GAIN row: opening of in-progress year
          : (latestRow?.stocks_mt        ?? 0);  // proxy: prior year's ENDING
        projOpening = openingMt           / 1000;        // MT → kt
        projProd    = (row.production_mt  ?? 0) / 1000;
        projCons    = (row.consumption_mt ?? 0) / 1000;
        projTotal   = projOpening + projProd - projCons;
        proj        = Math.max(0, projTotal - byCrop[latestKey].kt);
        proj        = Math.round(proj * 10) / 10;
        psdYear     = row.year;
        psdMode     = forecastRow ? "forecast" : "proxy";
      }
    }

    return {
      data: keys.map(k => ({
        year:      k,
        actual:    Math.round(byCrop[k].kt * 10) / 10,
        projected: k === latestKey ? proj : 0,
        months:    byCrop[k].months,
      })),
      projMeta: { proj, total: projTotal, opening: projOpening, prod: projProd, cons: projCons,
                  psdYear, psdMode, incomplete },
    };
  }, [monthly, forecastRow, latestRow]);

  if (data.length < 2) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Annual Export Volume</div>
        <div className="text-[10px] text-slate-500">
          Crop year totals (Oct–Sep) · kt · † projected when crop is incomplete
          {projMeta.incomplete && projMeta.total > 0 && (
            <span
              className="ml-1 italic"
              title={
                `Balance-sheet projection (USDA PSD ${projMeta.psdYear ?? "latest"}` +
                `${projMeta.psdMode === "forecast" ? " forecast" : " proxy"}):\n` +
                `  + Opening stocks   ${Math.round(projMeta.opening).toLocaleString()} kt\n` +
                `  + Production        ${Math.round(projMeta.prod).toLocaleString()} kt\n` +
                `  − Consumption       ${Math.round(projMeta.cons).toLocaleString()} kt\n` +
                `  = Expected exports  ${Math.round(projMeta.total).toLocaleString()} kt`
              }>
              · expected total {Math.round(projMeta.total).toLocaleString()} kt
              {projMeta.psdYear && (
                <span className="text-slate-600 not-italic">
                  {" "}(USDA {projMeta.psdYear}{projMeta.psdMode === "proxy" ? " proxy" : ""})
                </span>
              )}
            </span>
          )}
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
