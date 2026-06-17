"use client";
// Standardized Supply & Demand balance — same visual format as the Ethiopia
// (StoneX) S&D, but fed by USDA PSD per-origin data from demand_stocks.json, so
// every origin renders an identical balance view. Self-contained (own fetch).
import { useEffect, useState } from "react";
import React from "react";
import {
  ComposedChart, Bar, Cell, Line, LabelList, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid, ReferenceLine, ErrorBar,
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

/** Multi-source enrichment (option-in): when the calling tab has a richer
 *  per-source production estimate (e.g. Vietnam's vn_farmer_economics
 *  carries USDA + MARD + ICO numbers), pass it here to:
 *    • show production as `avg (min–max)` in the table for matching crops,
 *    • render an error bar on the production line over the same crops,
 *    • append any season the USDA backbone doesn't carry (typically the
 *      next crop's forecast) as a forecast row.
 *  Values are in MILLION 60-kg bags to match the upstream balance-sheet JSON. */
export interface MultiSourceSeason {
  /** Full crop-year label, e.g. "2024/25". */
  cropYear: string;
  /** Marks the row visually as italic and includes it in the chart with
   *  a striped pattern overlay. */
  forecast: boolean;
  /** sourceKey → million 60-kg bags. */
  production: Record<string, number>;
  /** Million 60-kg bags. */
  exports?:     number;
  /** Million 60-kg bags. */
  consumption?: number;
}

export interface MultiSourceOverlay {
  /** Sources for the production spread, in legend order. */
  sources: { key: string; label: string; color: string }[];
  seasons: MultiSourceSeason[];
}

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const MT_PER_KBAG = 60;                         // 1 thousand 60-kg bags = 60 MT
const MBAGS_PER_KBAGS = 1 / 1000;               // 1 thousand bags  = 0.001 million bags
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

/** Convert "2025" → "24/25" when `cropYearMonths` is set; otherwise keep
 *  the last 2 digits of the year unchanged. USDA marketing-year labels are
 *  always the ENDING year, so the crop year span starts at (end − 1). */
function cropYearShort(usdaYear: string, cropYearMonths?: string): string {
  if (!cropYearMonths) return usdaYear.slice(-2);
  const end = parseInt(usdaYear, 10);
  if (!Number.isFinite(end)) return usdaYear.slice(-2);
  const start = end - 1;
  return `${String(start).slice(-2)}/${String(end).slice(-2)}`;
}

/** Full marketing-year label for hover tooltips. */
function cropYearLong(usdaYear: string, cropYearMonths?: string): string {
  if (!cropYearMonths) return `Year ${usdaYear}`;
  const end = parseInt(usdaYear, 10);
  if (!Number.isFinite(end)) return `Year ${usdaYear}`;
  return `MY ${end - 1}/${String(end).slice(-2)} (${cropYearMonths})`;
}

/** Optional `projection` lets callers (currently only the Brazil tab) append a
 *  forward-looking row for the in-progress crop year. The row is rendered
 *  faded/italic with an asterisk on the year label so it's visibly a forecast.
 *  We only override Exports (the field our engine actually projects) — Opening
 *  carries over from the last realized year and the other columns are blanked
 *  rather than guessed.
 *
 *  The forecast row is added to BOTH the stacked-bar chart and the bottom
 *  table so the two stay in sync.
 *
 *  `cropYearMonths` (e.g. "Oct–Sep") switches the Year column from USDA's
 *  ending-year shorthand ("25") to a crop-year span ("24/25") and adds a
 *  hover tooltip with the full MY window.
 *
 *  `multiSource` overlays per-source production estimates onto matching
 *  crops — `avg (min–max)` in the table + an error bar on the production
 *  line. Seasons in `multiSource` that don't match a USDA backbone row are
 *  appended as forecast rows, even if no `projection` is supplied.
 */
export default function SupplyDemandBalance({
  origin, label, years = 12, projection,
  cropYearMonths, multiSource,
}: {
  origin: string; label: string; years?: number;
  projection?: { crop_year: string; annual_target: number; monthly_curve?: { value: number }[]; safeguard_triggered?: boolean } | null;
  cropYearMonths?: string;
  multiSource?: MultiSourceOverlay | null;
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

  // Build the lookup from USDA ending year → multi-source season ("2025" → "24/25").
  const msByCropYear = new Map<string, MultiSourceSeason>(
    (multiSource?.seasons ?? []).map(s => [s.cropYear, s]),
  );
  const msByEndYear = new Map<string, MultiSourceSeason>(
    (multiSource?.seasons ?? []).flatMap(s => {
      const end = s.cropYear.split("/")[1];
      // Recover the full ending year (USDA writes years as 4 digits).
      if (!end) return [];
      const startCentury = parseInt(s.cropYear.split("/")[0], 10);
      const fullEnd = String(Math.floor(startCentury / 100) * 100 + parseInt(end, 10));
      return [[fullEnd, s] as const];
    }),
  );

  type Row = {
    year: string;            // USDA ending year (for matching), e.g. "2025"
    yearLabel: string;       // displayed in the table, e.g. "24/25"
    yearTooltip: string;     // hover label
    opening: number;
    production: number;      // single-source kbags
    exports: number;
    consumption: number;
    ending: number;
    stockBuild: number;
    stockDraw: number;
    isForecast: boolean;
    // multi-source production overlay, in kbags
    prodAvg?: number;
    prodMin?: number;
    prodMax?: number;
    prodSources?: { key: string; label: string; value_kbags: number; color: string }[];
  };

  const buildMultiSourceFields = (season: MultiSourceSeason | undefined): Partial<Row> => {
    if (!season || !multiSource) return {};
    const values = multiSource.sources
      .map(s => ({ key: s.key, label: s.label, color: s.color, mBags: season.production[s.key] }))
      .filter(s => Number.isFinite(s.mBags));
    if (values.length === 0) return {};
    const kbagsArr = values.map(v => Math.round((v.mBags as number) / MBAGS_PER_KBAGS));
    const avg = kbagsArr.reduce((s, v) => s + v, 0) / kbagsArr.length;
    return {
      prodAvg: Math.round(avg),
      prodMin: Math.min(...kbagsArr),
      prodMax: Math.max(...kbagsArr),
      prodSources: values.map((v, i) => ({
        key: v.key, label: v.label, color: v.color, value_kbags: kbagsArr[i],
      })),
    };
  };

  const recent: Row[] = rows.slice(-years).map(r => {
    const opening = kbags(r.begin_stocks_mt);
    const ending  = kbags(r.stocks_mt);
    const delta   = ending - opening;
    const year    = r.year ?? "";
    const ms      = msByEndYear.get(year);
    return {
      year,
      yearLabel:   cropYearShort(year, cropYearMonths),
      yearTooltip: cropYearLong(year, cropYearMonths),
      opening, production: kbags(r.production_mt), exports: kbags(r.exports_mt),
      consumption: kbags(r.consumption_mt), ending,
      stockBuild: Math.max(delta, 0), stockDraw: Math.min(delta, 0),
      isForecast: false,
      ...buildMultiSourceFields(ms),
    };
  });

  // Append in-progress crop year as a faded row. `projection` (annual_target
  // in 60kg bags ÷ 1000 → kbags) wins when present. Otherwise, if multiSource
  // carries a forecast season the USDA backbone doesn't know about yet,
  // append it so the chart and table both show the forward outlook.
  const usdaYearsSeen = new Set(recent.map(r => r.year));
  if (projection && projection.crop_year) {
    const lastRealized = recent[recent.length - 1];
    const projectedKbags = Math.round(projection.annual_target / 1000);
    // Brazil projection's crop_year is already "26/27" — match it against the
    // multiSource map's cropYear key directly to pick up production ranges.
    const ms = msByCropYear.get(projection.crop_year);
    recent.push({
      year:        projection.crop_year,
      yearLabel:   `${projection.crop_year}*`,
      yearTooltip: cropYearMonths ? `Forecast · ${projection.crop_year} (${cropYearMonths})`
                                  : `Forecast · ${projection.crop_year}`,
      opening:     lastRealized?.ending ?? 0,
      production:  0,
      exports:     projectedKbags,
      consumption: 0,
      ending:      0,
      stockBuild:  0,
      stockDraw:   0,
      isForecast:  true,
      ...buildMultiSourceFields(ms),
    });
  } else if (multiSource) {
    for (const s of multiSource.seasons) {
      if (!s.forecast) continue;
      const endStr = s.cropYear.split("/")[1];
      const startCentury = parseInt(s.cropYear.split("/")[0], 10);
      const fullEnd = String(Math.floor(startCentury / 100) * 100 + parseInt(endStr ?? "", 10));
      if (!fullEnd || usdaYearsSeen.has(fullEnd)) continue;
      const lastRealized = recent[recent.length - 1];
      const fields = buildMultiSourceFields(s);
      recent.push({
        year:        fullEnd,
        yearLabel:   `${cropYearShort(fullEnd, cropYearMonths)}*`,
        yearTooltip: `Forecast · ${cropYearLong(fullEnd, cropYearMonths)}`,
        opening:     lastRealized?.ending ?? 0,
        production:  fields.prodAvg ?? 0,
        exports:     s.exports != null ? Math.round(s.exports / MBAGS_PER_KBAGS) : 0,
        consumption: s.consumption != null ? Math.round(s.consumption / MBAGS_PER_KBAGS) : 0,
        ending:      0,
        stockBuild:  0,
        stockDraw:   0,
        isForecast:  true,
        ...fields,
      });
    }
  }

  // Production line + error-bar data. We feed every row (history + forecast)
  // into the chart so the projection sits visibly to the right of the
  // realized data. The error bar leans on multi-source range when present,
  // and the bar/cell `isForecast` flag drives the striped fill via a Cell.
  const chartData = recent.map(r => ({
    year:        r.yearLabel,
    yearTooltip: r.yearTooltip,
    opening:     r.opening,
    exports:     r.exports,
    consumption: r.consumption,
    stockBuild:  r.stockBuild,
    stockDraw:   r.stockDraw,
    production:  r.prodAvg ?? r.production,
    prod_err: r.prodAvg != null && r.prodMin != null && r.prodMax != null
      ? [r.prodAvg - r.prodMin, r.prodMax - r.prodAvg]
      : undefined,
    isForecast:  r.isForecast,
  }));

  const seriesPattern = (kind: "exp" | "open" | "cons" | "build" | "draw") =>
    `url(#sd-stripe-${kind})`;
  const stripedCellFill = (i: number, native: string, kind: "exp" | "open" | "cons" | "build" | "draw") =>
    chartData[i].isForecast ? seriesPattern(kind) : native;

  return (
    <div className="space-y-3">
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            {label} — Supply &amp; Demand ({_unitLong(unit)})
            {cropYearMonths && (
              <span className="ml-2 text-slate-600 normal-case">
                · crop year ({cropYearMonths})
              </span>
            )}
          </div>
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
            <div className="text-[8px] text-slate-600">
              USDA FAS PSD
              {multiSource && multiSource.sources.length > 0 && (
                <span className="ml-1">
                  · +{multiSource.sources.map(s => s.label).join(" / ")} range
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} stackOffset="sign" margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
              {/* Striped patterns for the forecast row's stacked bars — same
                  visual language as the per-origin MonthlyVolumeChart
                  seasonality stripes, so a quick glance flags the year as
                  projected. */}
              <defs>
                {([
                  { id: "sd-stripe-open",  c: "#64748b" },
                  { id: "sd-stripe-exp",   c: "#f59e0b" },
                  { id: "sd-stripe-cons",  c: "#3b82f6" },
                  { id: "sd-stripe-build", c: "#22c55e" },
                  { id: "sd-stripe-draw",  c: "#ef4444" },
                ] as const).map(p => (
                  <pattern key={p.id} id={p.id} patternUnits="userSpaceOnUse"
                           width="6" height="6" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={p.c} fillOpacity="0.18" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke={p.c} strokeWidth="2" />
                  </pattern>
                ))}
              </defs>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={v => unit === "tons"
                  ? `${(_toMt(v) / 1e6).toFixed(1)}M`
                  : `${(v / 1000).toFixed(0)}M`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip contentStyle={TT}
                labelFormatter={(label: unknown, items) => {
                  const t = items?.[0]?.payload?.yearTooltip;
                  return typeof t === "string" ? t : String(label);
                }}
                formatter={(v: unknown, n) => {
                  if (n === "Production range") {
                    // The error-bar series's nominal value IS the avg already;
                    // the +/- pair is passed via dataKey="prod_err" and isn't
                    // surfaced here directly.
                    return [null, null];
                  }
                  const native = unit === "tons" ? _toMt(Number(v)) : Number(v);
                  return [`${Math.round(native).toLocaleString()} ${_unitShort(unit)}`, String(n)];
                }} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="opening"     name="Opening"     stackId="a" fill="#64748b">
                {chartData.map((_, i) => <Cell key={`o-${i}`} fill={stripedCellFill(i, "#64748b", "open")} />)}
                <LabelList dataKey="opening"     position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="exports"     name="Exports"     stackId="a" fill="#f59e0b">
                {chartData.map((_, i) => <Cell key={`e-${i}`} fill={stripedCellFill(i, "#f59e0b", "exp")} />)}
                <LabelList dataKey="exports"     position="center" fontSize={8} fill="#1e293b" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="consumption" name="Consumption" stackId="a" fill="#3b82f6">
                {chartData.map((_, i) => <Cell key={`c-${i}`} fill={stripedCellFill(i, "#3b82f6", "cons")} />)}
                <LabelList dataKey="consumption" position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="stockBuild"  name="Stock build" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]}>
                {chartData.map((_, i) => <Cell key={`b-${i}`} fill={stripedCellFill(i, "#22c55e", "build")} />)}
                <LabelList dataKey="stockBuild" position="center" fontSize={8} fill="#0b1220" formatter={_segLabel(unit)} />
              </Bar>
              <Bar dataKey="stockDraw"   name="Stock draw"  stackId="a" fill="#ef4444">
                {chartData.map((_, i) => <Cell key={`d-${i}`} fill={stripedCellFill(i, "#ef4444", "draw")} />)}
                <LabelList dataKey="stockDraw" position="center" fontSize={8} fill="#f8fafc" formatter={_segLabel(unit)} />
              </Bar>
              <Line dataKey="production" name="Production"  type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 2 }}>
                <ErrorBar dataKey="prod_err" width={4} stroke="#a78bfa" strokeWidth={1} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-slate-500 leading-relaxed">
          Each column stacks Opening + Exports + Consumption + stock change. Green = stock build; red below axis = destock.
          The purple Production line is a reference — any gap above the stack is imports + non-bean (roast/soluble) disappearance
          &amp; adjustments. Source: USDA FAS PSD (green-bean balance).
          {multiSource && (
            <span className="ml-1">
              · Whiskers on the production line show the spread across{" "}
              {multiSource.sources.map(s => (
                <span key={s.key} style={{ color: s.color }} className="font-semibold">{s.label}</span>
              )).reduce<React.ReactNode[]>((acc, el, i, arr) =>
                i === arr.length - 1 ? [...acc, el] : [...acc, el, ", "], [])
              }.
            </span>
          )}
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
                // Multi-source production cell: avg with min–max range underneath,
                // and a tooltip enumerating each source's value.
                const prodCell = (() => {
                  if (r.prodAvg == null) {
                    return <span>{dash(r.production)}</span>;
                  }
                  const tip = (r.prodSources ?? []).map(s =>
                    `${s.label}: ${fmt(s.value_kbags)} ${_unitShort(unit)}`).join("\n");
                  return (
                    <span title={tip} className="cursor-help">
                      <span>{fmt(r.prodAvg)}</span>
                      <span className="text-slate-500 text-[8px] ml-1">
                        ({fmt(r.prodMin ?? 0)}–{fmt(r.prodMax ?? 0)})
                      </span>
                    </span>
                  );
                })();
                return (
                  <tr key={r.year + "_" + r.yearLabel} className={`border-t border-slate-700/50 ${rowCls}`}>
                    <td className="py-0.5 pr-2" title={r.yearTooltip}>{r.yearLabel}</td>
                    <td className="py-0.5 px-1 text-right">{dash(r.opening)}</td>
                    <td className="py-0.5 px-1 text-right">{prodCell}</td>
                    <td className="py-0.5 px-1 text-right">{fmt(r.exports)}</td>
                    <td className="py-0.5 px-1 text-right">{dash(r.consumption)}</td>
                    <td className={`py-0.5 pl-1 text-right ${r.isForecast ? "" : chgCls(r.ending - r.opening)}`}>{dash(r.ending)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(projection || (multiSource?.seasons ?? []).some(s => s.forecast)) && (
            <div className="text-[8px] text-slate-600 italic mt-1">
              * Forecast row — italic; striped bars in the chart.
              {projection?.safeguard_triggered && (
                <span className="ml-1 text-amber-500 not-italic font-semibold">Safeguard active.</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
