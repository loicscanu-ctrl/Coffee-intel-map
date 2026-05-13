"use client";
import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, BarChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine,
} from "recharts";

type Region = "eu" | "japan" | "usa";

interface MonthlyEntry {
  period?: string;
  month?: string;
  value_raw?: number;
  value_mt?: number;
  note?: string;
  arabica_washed_mt?: number | null;
  arabica_unwashed_mt?: number | null;
  robusta_mt?: number | null;
  other_mt?: number | null;
}

interface EcfData {
  source: string;
  last_updated: string;
  monthly: MonthlyEntry[];
  latest_bags: number;
  latest_m_bags: number | null;
  source_url?: string | null;
  latest_post?: string | null;
  latest_pdf?: string | null;
  yearly_pdfs?: { year: string; pdf_url: string }[];
}

interface PsdAnnualEntry {
  year: string;
  imports_mt?: number | null;
  consumption_mt?: number | null;
  stocks_mt?: number | null;
  begin_stocks_mt?: number | null;
  exports_mt?: number | null;
  production_mt?: number | null;
}

interface PsdData {
  source: string;
  last_updated: string;
  annual: PsdAnnualEntry[];
  latest_year: string | null;
  latest_imports_mt: number | null;
  latest_consumption_mt: number | null;
  latest_stocks_mt: number | null;
}

interface AjcaData {
  source: string;
  source_url?: string | null;
  last_updated: string;
  latest_year: string | null;
  latest_imports_mt: number | null;
  latest_consumption_mt: number | null;
  monthly_imports_pdf?: string | null;
  monthly_exports_pdf?: string | null;
  supply_demand_pdf?: string | null;
  yearly_imports_pdf?: string | null;
  latest_origin_breakdown?: { country: string; imports_mt: number }[] | null;
  latest_origin_pdf?: string | null;
}

interface ProducerEntry {
  latest_year: string | null;
  latest_production_mt: number | null;
  latest_exports_mt: number | null;
  latest_consumption_mt: number | null;
  latest_stocks_mt: number | null;
  annual: PsdAnnualEntry[];
}

interface StocksPayload {
  generated_at: string;
  ecf: EcfData | null;
  eu: PsdData | null;
  japan: PsdData | null;
  usa: PsdData | null;
  ajca: AjcaData | null;
  producers: Record<string, ProducerEntry> | null;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtPeriod(p: string): string {
  const m = p.match(/(\d{4})-(\d{2})/);
  if (m) return `${MONTH_ABBR[parseInt(m[2]) - 1]}-${m[1].slice(2)}`;
  return p.slice(0, 7);
}

function fmtThousands(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(decimals)}k`;
  return String(Math.round(n));
}

function deltaArrow(v: number | null): { symbol: string; cls: string } {
  if (v == null) return { symbol: "—", cls: "text-slate-500" };
  if (v > 0) return { symbol: `+${v.toFixed(1)}%`, cls: "text-emerald-400" };
  if (v < 0) return { symbol: `${v.toFixed(1)}%`, cls: "text-red-400" };
  return { symbol: "0%", cls: "text-slate-400" };
}

// ── ECF Monthly Panel ─────────────────────────────────────────────────────────

function EcfPanel({ ecf }: { ecf: EcfData }) {
  const monthly = ecf.monthly;

  // Build period → value_mt map for YoY lookup
  const byPeriod = new Map<string, number>();
  for (const m of monthly) {
    const p = m.period ?? m.month ?? "";
    if (p && m.value_mt != null) byPeriod.set(p, m.value_mt);
  }

  const chartData = monthly.map(m => {
    const p = m.period ?? m.month ?? "";
    const mt = m.value_mt ?? null;
    let yoy: number | null = null;
    if (mt != null && p.match(/(\d{4})-(\d{2})/)) {
      const match = p.match(/(\d{4})-(\d{2})/)!;
      const prevPeriod = `${parseInt(match[1]) - 1}-${match[2]}`;
      const prevMt = byPeriod.get(prevPeriod);
      if (prevMt != null) yoy = ((mt - prevMt) / prevMt) * 100;
    }
    return {
      period: fmtPeriod(p),
      mt: mt != null ? Math.round(mt / 1000) : null,
      washed:   m.arabica_washed_mt   != null ? Math.round(m.arabica_washed_mt   / 1000) : null,
      unwashed: m.arabica_unwashed_mt != null ? Math.round(m.arabica_unwashed_mt / 1000) : null,
      robusta:  m.robusta_mt          != null ? Math.round(m.robusta_mt          / 1000) : null,
      other:    m.other_mt            != null ? Math.round(m.other_mt            / 1000) : null,
      yoy,
    };
  }).filter(d => d.mt != null);

  const latest = chartData[chartData.length - 1];
  const latestMt = ecf.latest_bags ? ecf.latest_bags * 0.06 / 1000 : null;
  const latestBagsM = ecf.latest_m_bags ?? (ecf.latest_bags ? +(ecf.latest_bags / 1_000_000).toFixed(1) : null);
  const yoyArrow = latest?.yoy != null ? deltaArrow(latest.yoy) : null;
  const hasBreakdown = chartData.some(d => d.washed != null || d.robusta != null);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          ECF European Port Stocks
        </div>
        <div className="text-[8px] text-slate-600">ECF · {ecf.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest stocks</div>
          <div className="text-white font-bold">{latestBagsM != null ? `${latestBagsM}M` : "—"}</div>
          <div className="text-[9px] text-slate-600">60-kg bags</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">In MT</div>
          <div className="text-white font-bold">
            {latestMt != null ? `${Math.round(latestMt)}k` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">metric tons</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">vs Prior Year</div>
          {yoyArrow ? (
            <div className={`font-bold text-[11px] ${yoyArrow.cls}`}>{yoyArrow.symbol}</div>
          ) : (
            <div className="text-slate-600 text-[10px] italic">building…</div>
          )}
          <div className="text-[9px] text-slate-600">YoY Δ</div>
        </div>
      </div>

      {chartData.length > 1 ? (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            {hasBreakdown ? (
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 7, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  interval={Math.max(0, Math.floor(chartData.length / 6) - 1)}
                />
                <YAxis
                  tick={{ fontSize: 7, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${v}k`}
                />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown, name: string) => {
                    const labels: Record<string, string> = {
                      washed: "Arabica Washed", unwashed: "Arabica Unwashed",
                      robusta: "Robusta", other: "Other",
                    };
                    return [`${Number(v).toLocaleString()}k MT`, labels[name] ?? name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 8 }}
                  formatter={(v: string) => ({
                    washed: "Arabica Washed", unwashed: "Arabica Unwashed",
                    robusta: "Robusta", other: "Other",
                  }[v] ?? v)}
                />
                <Bar dataKey="washed"   stackId="s" fill="#6366f1" opacity={0.9} name="washed" />
                <Bar dataKey="unwashed" stackId="s" fill="#8b5cf6" opacity={0.9} name="unwashed" />
                <Bar dataKey="robusta"  stackId="s" fill="#a78bfa" opacity={0.9} radius={[2,2,0,0]} name="robusta" />
                {chartData.some(d => d.other) && (
                  <Bar dataKey="other" stackId="s" fill="#c4b5fd" opacity={0.8} radius={[2,2,0,0]} name="other" />
                )}
              </BarChart>
            ) : (
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 7, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  interval={Math.max(0, Math.floor(chartData.length / 6) - 1)}
                />
                <YAxis
                  yAxisId="mt"
                  tick={{ fontSize: 7, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${v}k`}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown) => [`${Number(v).toLocaleString()}k MT`, "ECF Stocks"]}
                />
                <Bar yAxisId="mt" dataKey="mt" fill="#6366f1" opacity={0.8} radius={[2,2,0,0]} />
                <Line yAxisId="mt" dataKey="mt" type="monotone" stroke="#a5b4fc" strokeWidth={1.5} dot={{ r: 3, fill: "#a5b4fc" }} />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-36 flex items-center justify-center text-[10px] text-slate-600 italic">
          Bi-monthly series accumulating — {chartData.length} data point{chartData.length !== 1 ? "s" : ""} so far.
        </div>
      )}

      <div className="text-[9px] text-slate-500 italic">
        {hasBreakdown
          ? "Type breakdown parsed from ECF PDF (Arabica Washed · Arabica Unwashed · Robusta)."
          : "Type breakdown pending — parsed from ECF PDF on next monthly scraper run."}
        {" "}YoY comparison appears once 13+ months are collected.
      </div>

      <div className="text-[9px] text-slate-500 space-y-0.5">
        {ecf.latest_post && (
          <div>
            Latest report:{" "}
            <a href={ecf.latest_post} target="_blank" rel="noopener noreferrer"
               className="text-indigo-400 hover:text-indigo-300 underline">post</a>
            {ecf.latest_pdf && (
              <>{" · "}<a href={ecf.latest_pdf} target="_blank" rel="noopener noreferrer"
                         className="text-indigo-400 hover:text-indigo-300 underline">PDF</a></>
            )}
          </div>
        )}
        {ecf.yearly_pdfs && ecf.yearly_pdfs.length > 0 && (
          <div>
            Yearly PDFs:{" "}
            {ecf.yearly_pdfs.slice(0, 6).map((y, i) => (
              <span key={y.year}>
                {i > 0 && " · "}
                <a href={y.pdf_url} target="_blank" rel="noopener noreferrer"
                   className="text-slate-400 hover:text-slate-200 underline">{y.year}</a>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Japan Panel (PSD trend + AJCA origin) ────────────────────────────────────

function JapanPanel({ japan, ajca }: { japan: PsdData | null; ajca: AjcaData | null }) {
  const annual = (japan?.annual ?? []).filter(p => p.imports_mt != null);
  const chartData = annual.map(p => ({
    year: p.year.slice(2),
    imports: Math.round((p.imports_mt ?? 0) / 1000),
    stocks:  p.stocks_mt  != null ? Math.round(p.stocks_mt  / 1000) : null,
    consumption: p.consumption_mt != null ? Math.round(p.consumption_mt / 1000) : null,
  }));

  const latest = annual[annual.length - 1];
  const prev   = annual[annual.length - 2];
  const importsDelta = (latest && prev && latest.imports_mt != null && prev.imports_mt != null)
    ? ((latest.imports_mt - prev.imports_mt) / prev.imports_mt) * 100 : null;
  const stocksDelta = (latest && prev && latest.stocks_mt != null && prev.stocks_mt != null)
    ? ((latest.stocks_mt - prev.stocks_mt) / prev.stocks_mt) * 100 : null;

  const breakdown = ajca?.latest_origin_breakdown;
  const total = breakdown?.reduce((s, r) => s + r.imports_mt, 0) || 0;
  const topRows = breakdown
    ? [...breakdown].sort((a, b) => b.imports_mt - a.imports_mt).slice(0, 6)
    : null;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Japan Green Coffee</div>
        <div className="text-[8px] text-slate-600">USDA PSD · {japan?.last_updated ?? "—"}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Imports {latest?.year}</div>
          <div className="text-sky-300 font-bold">{fmtThousands(latest?.imports_mt)}</div>
          {importsDelta != null && (
            <div className={`text-[9px] ${importsDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {importsDelta >= 0 ? "+" : ""}{importsDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Consumption</div>
          <div className="text-white font-bold">{fmtThousands(latest?.consumption_mt)}</div>
          <div className="text-[9px] text-slate-600">MT</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Ending stocks</div>
          <div className="text-violet-300 font-bold">{fmtThousands(latest?.stocks_mt)}</div>
          {stocksDelta != null && (
            <div className={`text-[9px] ${stocksDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {stocksDelta >= 0 ? "+" : ""}{stocksDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
      </div>

      {chartData.length > 1 ? (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="year" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={3} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}k`} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: string) => [
                  `${Number(v).toLocaleString()}k MT`,
                  name === "imports" ? "Imports" : name === "stocks" ? "End Stocks" : "Consumption",
                ]}
              />
              <Bar dataKey="imports" fill="#0ea5e9" opacity={0.7} radius={[2,2,0,0]} name="imports" />
              <Line dataKey="stocks" type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="stocks" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-32 flex items-center justify-center text-[10px] text-slate-600 italic">
          Annual history not available.
        </div>
      )}

      {topRows && topRows.length > 0 && (
        <div>
          <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wide">
            Origin breakdown (AJCA · {ajca?.latest_year})
            {ajca?.latest_origin_pdf && (
              <a href={ajca.latest_origin_pdf} target="_blank" rel="noopener noreferrer"
                 className="ml-1 text-sky-600 hover:text-sky-400 normal-case">PDF</a>
            )}
          </div>
          <div className="space-y-0.5">
            {topRows.map(r => {
              const pct = total > 0 ? (r.imports_mt / total) * 100 : 0;
              return (
                <div key={r.country} className="flex items-center gap-1.5">
                  <div className="text-[9px] text-slate-400 w-20 truncate">{r.country}</div>
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                    <div className="bg-sky-500 h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="text-[9px] text-slate-400 font-mono w-10 text-right">{fmtThousands(r.imports_mt)}</div>
                  <div className="text-[9px] text-slate-600 w-8 text-right">{pct.toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ajca?.supply_demand_pdf && (
        <div className="text-[9px] text-slate-500">
          <a href={ajca.supply_demand_pdf} target="_blank" rel="noopener noreferrer"
             className="text-sky-400 hover:text-sky-300 underline">AJCA Supply &amp; Demand PDF</a>
          {ajca.source_url && (
            <>{" · "}<a href={ajca.source_url} target="_blank" rel="noopener noreferrer"
                       className="text-slate-500 hover:text-slate-300 underline">AJCA →</a></>
          )}
        </div>
      )}
    </div>
  );
}

// ── PSD Analytical Panel ──────────────────────────────────────────────────────

const REGION_LABELS: Record<Region, string> = { eu: "European Union", japan: "Japan", usa: "United States" };
const REGION_ACCENT: Record<Region, string> = { eu: "#10b981", japan: "#0ea5e9", usa: "#f59e0b" };
const REGION_BAR: Record<Region, string>    = { eu: "#059669", japan: "#0284c7", usa: "#d97706" };

function PsdAnalyticalPanel({ eu, japan, usa }: { eu: PsdData | null; japan: PsdData | null; usa: PsdData | null }) {
  const [region, setRegion] = useState<Region>("eu");
  const sources: Record<Region, PsdData | null> = { eu, japan, usa };
  const data = sources[region];
  const accent = REGION_ACCENT[region];
  const barColor = REGION_BAR[region];

  if (!data) return null;

  const annual = (data.annual ?? []).filter(p => p.imports_mt != null);

  // Main 24-year chart data
  const mainChart = annual.map(p => ({
    year: p.year,
    imports: Math.round((p.imports_mt ?? 0) / 1000),
    consumption: p.consumption_mt != null ? Math.round(p.consumption_mt / 1000) : null,
    stocks: p.stocks_mt != null ? Math.round(p.stocks_mt / 1000) : null,
  }));

  // Delta chart: YoY changes for last 12 years
  const deltaYears = annual.slice(-13);
  const deltaChart = deltaYears.slice(1).map((entry, i) => {
    const prev = deltaYears[i];
    const dImports = ((entry.imports_mt ?? 0) - (prev.imports_mt ?? 0)) / 1000;
    const dConsumption = ((entry.consumption_mt ?? 0) - (prev.consumption_mt ?? 0)) / 1000;
    const dStocks = ((entry.stocks_mt ?? 0) - (prev.stocks_mt ?? 0)) / 1000;
    return {
      year: entry.year.slice(2),
      dImports:    +dImports.toFixed(1),
      dConsumption: +-dConsumption.toFixed(1),  // negative: more consumption = negative stock impact
      dStocks:     +dStocks.toFixed(1),
    };
  });

  // KPIs: latest vs prior year
  const latest = annual[annual.length - 1];
  const prev   = annual[annual.length - 2];

  function kpiDelta(curr: number | null | undefined, prior: number | null | undefined) {
    if (curr == null || prior == null || prior === 0) return null;
    return ((curr - prior) / prior) * 100;
  }

  const importsDelta  = kpiDelta(latest?.imports_mt, prev?.imports_mt);
  const consumDelta   = kpiDelta(latest?.consumption_mt, prev?.consumption_mt);
  const stocksDelta   = kpiDelta(latest?.stocks_mt, prev?.stocks_mt);
  const stocksToUse   = (latest?.stocks_mt != null && latest?.consumption_mt != null && latest.consumption_mt > 0)
    ? (latest.stocks_mt / latest.consumption_mt) * 12 : null;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      {/* Header + region tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">USDA PSD — Annual Stock Analysis</div>
          <div className="text-[8px] text-slate-600 mt-0.5">{REGION_LABELS[region]} · {data.last_updated}</div>
        </div>
        <div className="flex gap-1">
          {(["eu","japan","usa"] as Region[]).map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide transition-colors ${
                region === r
                  ? "bg-slate-600 text-white"
                  : "bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200"
              }`}
            >
              {r === "eu" ? "EU" : r === "japan" ? "Japan" : "USA"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Imports {latest?.year}</div>
          <div className="font-bold" style={{ color: accent }}>{fmtThousands(latest?.imports_mt)}</div>
          {importsDelta != null && (
            <div className={`text-[9px] ${importsDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {importsDelta >= 0 ? "+" : ""}{importsDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Consumption {latest?.year}</div>
          <div className="text-white font-bold">{fmtThousands(latest?.consumption_mt)}</div>
          {consumDelta != null && (
            <div className={`text-[9px] ${consumDelta >= 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {consumDelta >= 0 ? "+" : ""}{consumDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">End Stocks {latest?.year}</div>
          <div className="text-violet-300 font-bold">{fmtThousands(latest?.stocks_mt)}</div>
          {stocksDelta != null && (
            <div className={`text-[9px] ${stocksDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {stocksDelta >= 0 ? "+" : ""}{stocksDelta.toFixed(1)}% YoY
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Stock-to-Use</div>
          <div className="text-amber-300 font-bold">
            {stocksToUse != null ? `${stocksToUse.toFixed(1)} mo` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">months coverage</div>
        </div>
      </div>

      {/* Main 24-year trend chart */}
      <div>
        <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wide">Annual Series — imports · consumption · ending stocks</div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mainChart} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <XAxis
                dataKey="year"
                tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                interval={3}
              />
              <YAxis
                tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v}k`}
              />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: string) => [
                  `${Number(v).toLocaleString()}k MT`,
                  name === "imports" ? "Imports" : name === "consumption" ? "Consumption" : "End Stocks",
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 8, paddingTop: 4 }}
                formatter={(v: string) => (
                  v === "imports" ? "Imports" : v === "consumption" ? "Consumption" : "End Stocks"
                )}
              />
              <Bar dataKey="imports" fill={barColor} opacity={0.75} radius={[1,1,0,0]} name="imports" />
              <Line dataKey="consumption" type="monotone" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="consumption" strokeDasharray="4 2" />
              <Line dataKey="stocks" type="monotone" stroke="#a78bfa" strokeWidth={2} dot={false} name="stocks" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Δ Stocks waterfall — last 12 years */}
      <div>
        <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wide">
          YoY Δ Stock Drivers (k MT) — blue = import swing · orange = consumption drag · line = net stock Δ
        </div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={deltaChart} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <XAxis dataKey="year" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v > 0 ? "+" : ""}${v}k`}
              />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name: string) => {
                  const n = Number(v);
                  const label =
                    name === "dImports" ? "Import swing" :
                    name === "dConsumption" ? "Consumption drag" :
                    "Net Δ stocks";
                  return [`${n >= 0 ? "+" : ""}${n.toFixed(1)}k MT`, label];
                }}
              />
              <Bar dataKey="dImports" fill="#3b82f6" opacity={0.8} radius={[2,2,0,0]} name="dImports" />
              <Bar dataKey="dConsumption" fill="#f97316" opacity={0.8} radius={[2,2,0,0]} name="dConsumption" />
              <Line dataKey="dStocks" type="monotone" stroke="#e2e8f0" strokeWidth={2} dot={{ r: 2, fill: "#e2e8f0" }} name="dStocks" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[8px] text-slate-600 mt-1">
          Reading: blue bar above zero = imports grew vs prior year (positive for stocks); orange bar below zero = consumption grew (drains stocks). White line = net stock change.
        </div>
      </div>

      <div className="text-[9px] text-slate-600">
        USDA FAS PSD database — marketing-year figures (Oct–Sep for EU/Japan, Oct–Sep for USA).
        All values in metric tons.
      </div>
    </div>
  );
}

// ── Page section ─────────────────────────────────────────────────────────────

export default function StocksPanel() {
  const [data, setData] = useState<StocksPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-xs text-slate-500 animate-pulse p-4">Loading stocks data...</div>
    );
  }

  if (!data || (!data.ecf && !data.eu && !data.japan && !data.ajca && !data.usa)) {
    return (
      <div className="bg-slate-900 border-b border-slate-700 p-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Consumer Market Stocks</div>
        <div className="text-xs text-slate-500">
          Stock data not yet available — requires scraper run.
        </div>
      </div>
    );
  }

  const hasPsd = data.eu || data.japan || data.usa;

  return (
    <div className="bg-slate-900 border-b border-slate-700 p-4 space-y-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Consumer Market Stocks</div>

      {/* Row 1: ECF + Japan */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.ecf ? (
          <EcfPanel ecf={data.ecf} />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            ECF monthly data pending scraper run
          </div>
        )}
        {(data.japan || data.ajca) ? (
          <JapanPanel japan={data.japan} ajca={data.ajca} />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            Japan data pending scraper run
          </div>
        )}
      </div>

      {/* Row 2: PSD Analytical (full width, EU/Japan/USA tabs) */}
      {hasPsd && (
        <PsdAnalyticalPanel eu={data.eu} japan={data.japan} usa={data.usa} />
      )}
    </div>
  );
}
