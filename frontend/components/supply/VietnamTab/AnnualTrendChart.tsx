"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { TT_STYLE, vnCropYearKey, kBagsToKT } from "./helpers";
import type { ExportMonth } from "./MonthlyVolumeChart";

/** Latest USDA PSD row the component needs for the balance-sheet projection.
 *  Read from /data/demand_stocks.json → producers.vietnam.annual[last]. */
interface VnPSDRow {
  year?: string;
  stocks_mt?: number;        // ending stocks of THIS USDA row (= opening for the next)
  production_mt?: number;
  consumption_mt?: number;
}

export default function AnnualTrendChart({ monthly }: { monthly: ExportMonth[] }) {
  const [psd, setPsd] = useState<VnPSDRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const rows = d?.producers?.vietnam?.annual ?? [];
        setPsd(rows.length ? rows[rows.length - 1] : null);
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
    // The chart "projected (gap)" bar = expected_total − already_exported.
    //
    // `psd` is the latest USDA row in demand_stocks.json. USDA's Coffee MY
    // for Vietnam (Oct–Sep) aligns 1:1 with our chart's crop year, so the
    // latest row's `stocks_mt` = last year's ending = this year's opening,
    // and its `production_mt` / `consumption_mt` are the best-available
    // proxy for the in-progress year until USDA publishes the forward
    // forecast (the GAIN PDF scraper backfills that on its next monthly
    // run). Linear pace extrapolation is intentionally NOT used — that
    // over-stated the gap because Vietnam's crop is heavily front-loaded.
    let proj = 0;
    let projTotal = 0;
    let projOpening = 0;
    let projProd    = 0;
    let projCons    = 0;
    const incomplete = byCrop[latestKey].months < 12;
    if (psd && incomplete) {
      projOpening = (psd.stocks_mt       ?? 0) / 1000;   // MT → kt
      projProd    = (psd.production_mt   ?? 0) / 1000;
      projCons    = (psd.consumption_mt  ?? 0) / 1000;
      projTotal   = projOpening + projProd - projCons;
      proj        = Math.max(0, projTotal - byCrop[latestKey].kt);
      proj        = Math.round(proj * 10) / 10;
    }

    return {
      data: keys.map(k => ({
        year:      k,
        actual:    Math.round(byCrop[k].kt * 10) / 10,
        projected: k === latestKey ? proj : 0,
        months:    byCrop[k].months,
      })),
      projMeta: { proj, total: projTotal, opening: projOpening, prod: projProd, cons: projCons,
                  psdYear: psd?.year, incomplete },
    };
  }, [monthly, psd]);

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
                `Balance-sheet projection (USDA PSD ${projMeta.psdYear ?? "latest"} proxy):\n` +
                `  + Opening stocks  ${Math.round(projMeta.opening).toLocaleString()} kt\n` +
                `  + Production       ${Math.round(projMeta.prod).toLocaleString()} kt\n` +
                `  − Consumption      ${Math.round(projMeta.cons).toLocaleString()} kt\n` +
                `  = Expected exports ${Math.round(projMeta.total).toLocaleString()} kt`
              }>
              · expected total {Math.round(projMeta.total).toLocaleString()} kt
              {projMeta.psdYear && (
                <span className="text-slate-600 not-italic"> (USDA {projMeta.psdYear})</span>
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
