"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, CartesianGrid,
} from "recharts";
import VietnamFertilizerContext from "@/components/supply/VietnamFertilizerContext";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FertPrice { name: string; price_usd_mt: number; mom_pct: number; sparkline: number[]; }
interface BrazilImportMonth {
  month: string;
  urea_kt: number; kcl_kt: number;
  map_kt?: number; dap_kt?: number; an_kt?: number; as_kt?: number; superp_kt?: number;
  map_dap_kt: number; total_kt: number;
  urea_price_usd_mt: number | null; kcl_price_usd_mt: number | null; map_dap_price_usd_mt: number | null;
}
interface VnFertMonth { month: string; urea_kt: number; kcl_kt: number; npk_kt: number; dap_kt: number; total_kt: number; }
interface VnFertContext { source: string; note: string; key_suppliers: Record<string,string>; price_sensitivity: string; monthly?: VnFertMonth[]; }
interface ComtradeRow { reporter: string; reporter_code: string; period: string; hs_code: string; qty_mt: number; value_usd: number; }
interface GlobalFertData {
  updated: string;
  global_exports: Record<string, ComtradeRow[]>;
  country_imports: Record<string, Record<string, ComtradeRow[]>>;
  static_seed: { global_exports_2024: Record<string, { country: string; qty_mt_k: number }[]> };
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YEAR_COLORS = ["#475569", "#64748b", "#3b82f6", "#22c55e", "#f59e0b"];

const HS_META: Record<string, { label: string; color: string }> = {
  "3102": { label: "Nitrogen / Urea",  color: "#3b82f6" },
  "3104": { label: "Potash (KCl)",     color: "#8b5cf6" },
  "3105": { label: "DAP / MAP / NPK",  color: "#10b981" },
};

function fmtMo(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTH_ABBR[+m-1]}-${y.slice(2)}`;
}

// ── Price spark card ───────────────────────────────────────────────────────────

function PriceCard({ item }: { item: FertPrice }) {
  const up = item.mom_pct > 0;
  const sparkData = item.sparkline.map((v, i) => ({ i, v }));
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 flex-1 min-w-0">
      <div className="text-[9px] text-slate-400 mb-0.5 uppercase tracking-wide">{item.name}</div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-base font-extrabold text-slate-100">${item.price_usd_mt}</span>
        <span className="text-[9px] text-slate-500">/MT</span>
      </div>
      <div className="text-[8px] text-slate-600 mb-1">FOB implied · Brazil</div>
      <div className="h-8 mb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Line type="monotone" dataKey="v" stroke={up ? "#ef4444" : "#22c55e"} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`text-[10px] font-semibold ${up ? "text-red-400" : "text-green-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(item.mom_pct).toFixed(1)}% MoM
      </div>
    </div>
  );
}

// ── Brazil import chart — seasonal grouped view (same pattern as Vietnam) ──────

function BrazilImportChart({ monthly }: { monthly: BrazilImportMonth[] }) {
  // Group by month number → one row per month, value per year
  const byMonth: Record<number, Record<string, number>> = {};
  const years = new Set<string>();
  for (const m of monthly) {
    const [yr, mo] = m.month.split("-");
    const moIdx = parseInt(mo) - 1;
    if (!byMonth[moIdx]) byMonth[moIdx] = {};
    byMonth[moIdx][yr] = m.total_kt;
    years.add(yr);
  }
  const sortedYears = Array.from(years).sort();

  const chartData = MONTH_ABBR.map((label, i) => {
    const vals = Object.values(byMonth[i] || {}).filter(v => v > 0);
    return {
      month: label,
      ...byMonth[i],
      min_range: vals.length > 1 ? Math.min(...vals) : null,
      max_range: vals.length > 1 ? Math.max(...vals) : null,
    };
  }).filter(row => sortedYears.some(yr => (row as Record<string, unknown>)[yr] != null));

  const latestYear = sortedYears[sortedYears.length - 1];
  const latest = monthly[monthly.length - 1];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Brazil Fertilizer Imports</div>
          <div className="text-[8px] text-slate-600 mt-0.5">Comex Stat · HS 31 · all types · kt/month · {sortedYears[0]}–{latestYear}</div>
        </div>
        {latest && (
          <div className="text-right">
            <div className="text-[8px] text-slate-500">Latest ({fmtMo(latest.month)})</div>
            <div className="text-sm font-bold text-amber-400">{latest.total_kt.toLocaleString()} kt</div>
          </div>
        )}
      </div>

      {/* Grouped bar chart by month, one bar per year */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="20%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
            <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name: unknown) => {
              const s = String(name);
              if (s === "max_range" || s === "min_range") return [`${Number(v).toFixed(0)} kt`, s === "max_range" ? "3yr max" : "3yr min"];
              return [`${Number(v).toFixed(0)} kt`, s];
            }} />
            {sortedYears.map((yr, i) => (
              <Bar key={yr} dataKey={yr} name={yr} fill={YEAR_COLORS[i + (YEAR_COLORS.length - sortedYears.length)]}
                opacity={yr === latestYear ? 1 : 0.65} radius={yr === latestYear ? [2,2,0,0] : [0,0,0,0]} />
            ))}
            <Line dataKey="min_range" stroke="#334155" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
            <Line dataKey="max_range" stroke="#475569" strokeDasharray="3 2" strokeWidth={1} dot={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Year legend + type breakdown for latest month */}
      <div className="flex items-start justify-between flex-wrap gap-3 border-t border-slate-700 pt-2">
        <div className="flex flex-wrap gap-3">
          {sortedYears.map((yr, i) => (
            <span key={yr} className="flex items-center gap-1 text-[7px] text-slate-500">
              <span className="w-2 h-2 rounded-sm" style={{ background: YEAR_COLORS[i + (YEAR_COLORS.length - sortedYears.length)] }} />
              {yr}
            </span>
          ))}
          <span className="flex items-center gap-1 text-[7px] text-slate-600">
            <span className="w-3 h-px border-t border-dashed border-slate-500 inline-block" />3yr range
          </span>
        </div>
        {latest && (
          <div className="flex flex-wrap gap-2 text-[7px] text-slate-500">
            {[
              { label: "Urea",   val: latest.urea_kt,    color: "#3b82f6" },
              { label: "KCl",    val: latest.kcl_kt,     color: "#8b5cf6" },
              { label: "MAP",    val: latest.map_kt,     color: "#10b981" },
              { label: "DAP",    val: latest.dap_kt,     color: "#06b6d4" },
              { label: "AN",     val: latest.an_kt,      color: "#f59e0b" },
              { label: "AS",     val: latest.as_kt,      color: "#ec4899" },
              { label: "Superp", val: latest.superp_kt,  color: "#84cc16" },
            ].filter(x => x.val != null && x.val! > 0).map(x => (
              <span key={x.label} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: x.color }} />
                {x.label}: {x.val!.toFixed(0)} kt
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Global exports: stacked annual reference + live 3104 trend ────────────────

function GlobalExportsPanel({ data, prices, pricesAsOf }: {
  data: GlobalFertData; prices: FertPrice[]; pricesAsOf: string;
}) {
  // 2024 annual static_seed totals per HS code
  const seedTotals = Object.entries(data.static_seed.global_exports_2024).map(([hs, rows]) => ({
    hs,
    label: HS_META[hs]?.label ?? hs,
    color: HS_META[hs]?.color ?? "#64748b",
    total_mt_k: rows.reduce((s, r) => s + r.qty_mt_k, 0),
  }));

  // Live 3104 monthly data (most reliable HS code in Comtrade)
  const live3104 = useMemo(() => {
    const rows3104 = data.global_exports["3104"] ?? [];
    const byPeriod: Record<string, number> = {};
    for (const r of rows3104) {
      byPeriod[r.period] = (byPeriod[r.period] ?? 0) + r.qty_mt;
    }
    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, qty_mt]) => ({
        period: `${MONTH_ABBR[parseInt(period.slice(4)) - 1]}-${period.slice(2,4)}`,
        qty_kt: Math.round(qty_mt / 1000),
      }));
  }, [data]);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">
          Global Export Volume · HS 3102 / 3104 / 3105
        </div>
        <div className="text-[8px] text-slate-600 mt-0.5">2024 annual reference · UN Comtrade static seed</div>
      </div>

      {/* 2024 stacked overview: total by HS code */}
      <div className="space-y-1.5">
        {seedTotals.map(({ hs, label, color, total_mt_k }) => (
          <div key={hs} className="space-y-0.5">
            <div className="flex items-center justify-between text-[8px]">
              <span className="text-slate-400"><span className="font-mono text-slate-500">{hs}</span> {label}</span>
              <span className="font-mono text-slate-300">{total_mt_k.toLocaleString()}k MT</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${Math.min(100, total_mt_k / Math.max(...seedTotals.map(s => s.total_mt_k)) * 100)}%`,
                background: color,
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Live 3104 monthly trend (only reliable live code) */}
      {live3104.length > 0 && (
        <div className="border-t border-slate-700 pt-3">
          <div className="text-[9px] text-slate-400 mb-2">
            3104 (Potash) live monthly exports — top reporters · UN Comtrade
            <span className="text-slate-600 ml-1">· other HS codes not yet available from public endpoint</span>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={live3104} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="period" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(0)} kt`, "Potash exports"]} />
                <Bar dataKey="qty_kt" fill="#8b5cf6" opacity={0.85} radius={[2,2,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Static 2024 top exporters per HS */}
      <div className="border-t border-slate-700 pt-3 space-y-3">
        <div className="text-[8px] text-slate-500 uppercase tracking-wide">Top exporters by product · 2024</div>
        {Object.entries(data.static_seed.global_exports_2024).map(([hs, rows]) => (
          <div key={hs}>
            <div className="text-[8px] font-bold mb-1" style={{ color: HS_META[hs]?.color }}>
              {hs} · {HS_META[hs]?.label}
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
              {rows.map((r, i) => (
                <div key={r.country} className="flex items-center gap-1 text-[8px]">
                  <span className="text-slate-600 font-mono w-3">{i+1}</span>
                  <span className="text-slate-300 truncate">{r.country}</span>
                  <span className="text-slate-500 font-mono ml-auto">{r.qty_mt_k.toLocaleString()}k</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Key global exporters: horizontal bar chart ────────────────────────────────

function KeyExporterChart({ data }: { data: GlobalFertData }) {
  const [selected, setSelected] = useState<string>("3102");
  const rows = data.static_seed.global_exports_2024[selected] ?? [];
  const maxVal = Math.max(...rows.map(r => r.qty_mt_k));
  const { color } = HS_META[selected] ?? { color: "#64748b" };

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Key Global Exporters</div>
          <div className="text-[8px] text-slate-600 mt-0.5">2024 annual · UN Comtrade · kt</div>
        </div>
        <div className="flex gap-1">
          {Object.entries(HS_META).map(([code, { label }]) => (
            <button key={code} onClick={() => setSelected(code)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                selected === code ? "text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"
              }`}
              style={selected === code ? { background: HS_META[code].color } : {}}>
              {code}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[9px] text-slate-400">{HS_META[selected]?.label}</div>

      {/* Horizontal bar chart */}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.country} className="space-y-0.5">
            <div className="flex items-center justify-between text-[8px]">
              <span className="flex items-center gap-1.5">
                <span className="text-slate-600 font-mono w-3 text-right">{i+1}</span>
                <span className="text-slate-300">{r.country}</span>
              </span>
              <span className="font-mono text-slate-400">{r.qty_mt_k.toLocaleString()}k MT</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${(r.qty_mt_k / maxVal) * 100}%`, background: color, opacity: 1 - i * 0.1 }} />
            </div>
          </div>
        ))}
      </div>

      <div className="text-[8px] text-slate-600 italic border-t border-slate-700 pt-2">
        Source: UN Comtrade static reference · 2024 annual data · live updates planned via comtradeapicall
      </div>
    </div>
  );
}

// ── Vessel leading indicator placeholder ──────────────────────────────────────

function VesselLeadingIndicator() {
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 border-dashed space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Bulk Carriers in Transit</div>
        <div className="text-[8px] text-amber-500/70">Planned · requires MarineTraffic / MyShipTracking API</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { port: "Bandar Abbas (Iran)", type: "Urea" },
          { port: "St. Petersburg (Russia)", type: "Urea + Potash" },
          { port: "Casablanca (Morocco/OCP)", type: "DAP/MAP" },
          { port: "Qingdao (China)", type: "Urea + DAP" },
        ].map(p => (
          <div key={p.port} className="bg-slate-900/50 rounded p-2">
            <div className="text-[9px] text-slate-400 font-medium">{p.port}</div>
            <div className="text-[8px] text-slate-600">{p.type}</div>
            <div className="text-[8px] text-slate-700 italic mt-0.5">Vessel count: —</div>
          </div>
        ))}
      </div>
      <div className="text-[8px] text-slate-700 italic">
        Logic: bulk carrier departures from key origin ports = 30-day leading indicator before customs.
        A 50%+ weekly drop signals supply disruption before official data confirms.
        Free AIS data sources (MarineTraffic free tier, VesselFinder) lack bulk carrier filtering needed for this signal.
      </div>
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export default function FertilizersTab() {
  const [prices, setPrices]         = useState<FertPrice[] | null>(null);
  const [brazil, setBrazil]         = useState<BrazilImportMonth[] | null>(null);
  const [vnFert, setVnFert]         = useState<VnFertContext | null>(null);
  const [pricesAsOf, setPricesAsOf] = useState<string>("");
  const [globalFert, setGlobalFert] = useState<GlobalFertData | null>(null);

  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then(r => r.json())
      .then(d => {
        setPrices(d.fertilizer?.items ?? null);
        setBrazil(d.fertilizer?.imports?.monthly ?? null);
        setPricesAsOf(d.fertilizer?.prices_as_of ?? "");
      })
      .catch(() => {});
    fetch("/data/vietnam_supply.json")
      .then(r => r.json())
      .then(d => setVnFert(d.fertilizer_context ?? null))
      .catch(() => {});
    fetch("/data/global_fertilizers.json")
      .then(r => r.json())
      .then(setGlobalFert)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-5">

      {/* Global price panel */}
      <div>
        <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
          Global Fertilizer Prices · FOB Brazil
        </h2>
        {prices ? (
          <div className="flex gap-3">
            {prices.map(p => <PriceCard key={p.name} item={p} />)}
          </div>
        ) : (
          <div className="text-slate-600 text-xs italic">Loading prices…</div>
        )}
        {pricesAsOf && (
          <div className="text-[8px] text-slate-600 mt-1">As of {pricesAsOf} · Comex Stat implied FOB</div>
        )}
      </div>

      {/* Brazil imports — seasonal view */}
      <div>
        <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
          Brazil Imports · HS 31
        </h2>
        {brazil ? (
          <BrazilImportChart monthly={brazil} />
        ) : (
          <div className="text-slate-600 text-xs italic">Loading…</div>
        )}
      </div>

      {/* Vietnam imports */}
      {vnFert && (
        <div>
          <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
            Vietnam Imports · HS 31
          </h2>
          <VietnamFertilizerContext context={vnFert} />
        </div>
      )}

      {/* Global exports panel */}
      {globalFert && (
        <div>
          <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
            Global Export Volume · HS 3102 / 3104 / 3105
          </h2>
          <GlobalExportsPanel data={globalFert} prices={prices ?? []} pricesAsOf={pricesAsOf} />
        </div>
      )}

      {/* Key exporters bar chart */}
      {globalFert && (
        <div>
          <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
            Key Global Exporters · HS 3102 / 3104 / 3105
          </h2>
          <KeyExporterChart data={globalFert} />
        </div>
      )}

      {/* Vessel leading indicator */}
      <div>
        <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
          Vessel Leading Indicator
        </h2>
        <VesselLeadingIndicator />
      </div>

    </div>
  );
}
