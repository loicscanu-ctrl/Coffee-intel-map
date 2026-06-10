"use client";
// Standardized Supply & Demand balance — same visual format as the Ethiopia
// (StoneX) S&D, but fed by USDA PSD per-origin data from demand_stocks.json, so
// every origin renders an identical balance view. Self-contained (own fetch).
import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, Line, LabelList, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid, ReferenceLine,
} from "recharts";

interface AnnualRow {
  year: string;
  begin_stocks_mt?: number;
  production_mt?: number;
  imports_mt?: number;
  exports_mt?: number;
  consumption_mt?: number;
  stocks_mt?: number;
}

/** Subset of BrazilProjection consumed for the projected S&D row. Kept
 *  local + minimal so this generic component doesn't depend on Brazil-tab
 *  types. */
export interface SDForecast {
  crop_year:     string;     // "26/27" — used as the row's Year column.
  exports_bags:  number;     // sum of monthly_curve, in 60-kg bags
  safeguard?:    boolean;
}

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const MT_PER_KBAG = 60;                         // 1 thousand 60-kg bags = 60 MT
const kbags = (mt: number | undefined) => Math.round((mt ?? 0) / MT_PER_KBAG);
const chgCls = (v: number) => (v >= 0 ? "text-emerald-400" : "text-red-400");

type SDUnit = "kbags" | "tons";
// Internal data lives in thousand 60-kg bags ("kbags"); the toggle converts to
// metric tons on display only (× 60). Keeping a single source of truth in
// kbags avoids drift between the chart, tooltip, table and segment labels.
const _toMt = (kbagsValue: number) => kbagsValue * MT_PER_KBAG;
const _unitLong  = (u: SDUnit) => u === "tons" ? "metric tons" : "thousand 60-kg bags";
const _unitShort = (u: SDUnit) => u === "tons" ? "MT" : "k bags";
// Segment labels need to stay short — switch to a {value}{magnitude} formatter
// that adapts per unit so both modes read cleanly on small bars.
const _segLabel = (u: SDUnit) => (v: unknown) => {
  const n = Number(v);
  if (!n || Math.abs(n) < 1) return "";
  const native = u === "tons" ? _toMt(n) : n;
  return Math.round(native).toLocaleString();
};

/** Optional `projection` lets callers (currently only the Brazil tab) append a
 *  forward-looking row for the in-progress crop year. The row is rendered
 *  faded/italic with an asterisk on the year label so it's visibly a forecast.
 *  We only override Exports (the field our engine actually projects) — Opening
 *  carries over from the last realized year and the other columns are blanked
 *  rather than guessed.
 *
 *  The forecast row is added to BOTH the stacked-bar chart and the bottom
 *  table so the two stay in sync.
 */
export default function SupplyDemandBalance({ origin, label, years = 12, projection }: {
  origin: string; label: string; years?: number;
  projection?: { crop_year: string; annual_target: number; monthly_curve?: { value: number }[]; safeguard_triggered?: boolean } | null;
}) {
  const [rows, setRows] = useState<AnnualRow[] | null>(null);
  const [error, setError] = useState(false);
  const [unit, setUnit] = useState<SDUnit>("kbags");

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const annual = d?.producers?.[origin]?.annual;
        if (Array.isArray(annual) && annual.length) setRows(annual);
        else setError(true);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [origin]);

  if (error) return <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">USDA PSD supply & demand data unavailable for {label}.</div>;
  if (!rows) return <div className="text-xs text-slate-500 animate-pulse py-12 text-center">Loading supply &amp; demand…</div>;

  const recent = rows.slice(-years).map(r => {
    const opening = kbags(r.begin_stocks_mt);
    const ending  = kbags(r.stocks_mt);
    const delta   = ending - opening;
    return {
      year: (r.year ?? "").slice(-2),
      opening, production: kbags(r.production_mt), exports: kbags(r.exports_mt),
      consumption: kbags(r.consumption_mt), ending,
      stockBuild: Math.max(delta, 0), stockDraw: Math.min(delta, 0),
      isForecast: false,
    };
  });

  // Append the in-progress crop year as a faded row. Annual_target is in 60kg
  // bags; the rest of the table is in *thousand* 60-kg bags, so divide by 1000.
  if (projection && projection.crop_year) {
    const lastRealized = recent[recent.length - 1];
    const projectedKbags = Math.round(projection.annual_target / 1000);
    recent.push({
      year:        `${projection.crop_year}*`,
      opening:     lastRealized?.ending ?? 0,
      production:  0,
      exports:     projectedKbags,
      consumption: 0,
      ending:      0,
      stockBuild:  0,
      stockDraw:   0,
      isForecast:  true,
    });
  }

  return (
    <div className="space-y-3">
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label} — Supply &amp; Demand ({_unitLong(unit)})</div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded border border-slate-700 overflow-hidden">
              {(["kbags", "tons"] as SDUnit[]).map(u => (
                <button key={u} onClick={() => setUnit(u)}
                  className={`text-[9px] px-1.5 py-0.5 transition-colors ${
                    unit === u ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                  }`}
                  title={u === "tons" ? "Display in metric tons" : "Display in thousand 60-kg bags"}>
                  {u === "tons" ? "MT" : "k bags"}
                </button>
              ))}
            </div>
            <div className="text-[8px] text-slate-600">USDA FAS PSD</div>
          </div>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={recent.filter(r => !r.isForecast)} stackOffset="sign" margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={v => unit === "tons"
                  ? `${(_toMt(v) / 1e6).toFixed(1)}M`
                  : `${(v / 1000).toFixed(0)}M`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip contentStyle={TT}
                formatter={(v: unknown, n) => {
                  const native = unit === "tons" ? _toMt(Number(v)) : Number(v);
                  return [`${Math.round(native).toLocaleString()} ${_unitShort(unit)}`, String(n)];
                }} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="opening"     name="Opening"     stackId="a" fill="#64748b"><LabelList dataKey="opening"     position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} /></Bar>
              <Bar dataKey="exports"     name="Exports"     stackId="a" fill="#f59e0b"><LabelList dataKey="exports"     position="center" fontSize={8} fill="#1e293b" formatter={_segLabel(unit)} /></Bar>
              <Bar dataKey="consumption" name="Consumption" stackId="a" fill="#3b82f6"><LabelList dataKey="consumption" position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} /></Bar>
              <Bar dataKey="stockBuild"  name="Stock build" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]}><LabelList dataKey="stockBuild" position="center" fontSize={8} fill="#0b1220" formatter={_segLabel(unit)} /></Bar>
              <Bar dataKey="stockDraw"   name="Stock draw"  stackId="a" fill="#ef4444"><LabelList dataKey="stockDraw" position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} /></Bar>
              <Line dataKey="production" name="Production"  type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-slate-500 leading-relaxed">
          Each column stacks Opening + Exports + Consumption + stock change. Green = stock build; red below axis = destock.
          The purple Production line is a reference — any gap above the stack is imports + non-bean (roast/soluble) disappearance
          &amp; adjustments. Source: USDA FAS PSD (green-bean balance).
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1 pr-2 font-medium">Year</th>
                <th className="py-1 px-1 text-right font-medium">Open</th>
                <th className="py-1 px-1 text-right font-medium">Prod</th>
                <th className="py-1 px-1 text-right font-medium">Exports</th>
                <th className="py-1 px-1 text-right font-medium">Cons</th>
                <th className="py-1 pl-1 text-right font-medium">End</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => {
                const isLatestRealized = !r.isForecast && i === recent.findLastIndex(x => !x.isForecast);
                const rowCls = r.isForecast ? "text-slate-500 italic"
                                            : isLatestRealized ? "text-amber-300" : "text-slate-300";
                const fmt = (kbagsValue: number) => {
                  const native = unit === "tons" ? _toMt(kbagsValue) : kbagsValue;
                  return Math.round(native).toLocaleString();
                };
                const dash = (n: number) => r.isForecast && n === 0 ? "—" : fmt(n);
                return (
                  <tr key={r.year} className={`border-t border-slate-700/50 ${rowCls}`}>
                    <td className="py-0.5 pr-2">{r.year}</td>
                    <td className="py-0.5 px-1 text-right">{dash(r.opening)}</td>
                    <td className="py-0.5 px-1 text-right">{dash(r.production)}</td>
                    <td className="py-0.5 px-1 text-right">{fmt(r.exports)}</td>
                    <td className="py-0.5 px-1 text-right">{dash(r.consumption)}</td>
                    <td className={`py-0.5 pl-1 text-right ${r.isForecast ? "" : chgCls(r.ending - r.opening)}`}>{dash(r.ending)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {projection && (
            <div className="text-[8px] text-slate-600 italic mt-1">
              * Crop-year forecast from brazil_export_projection.json — exports only.
              {projection.safeguard_triggered && (
                <span className="ml-1 text-amber-500 not-italic font-semibold">Safeguard active.</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
