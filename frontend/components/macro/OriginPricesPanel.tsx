"use client";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid, ReferenceLine,
} from "recharts";

import { fmtDateLabel } from "@/lib/formatters";

interface HistoryPoint {
  date:  string;
  price: number;
}

interface Origin {
  name:      string;
  source:    string;
  currency:  string;
  unit:      string;
  color:     string;
  commodity?: "robusta" | "arabica";
  history:   HistoryPoint[];
}

interface OriginPricesData {
  scraped_at: string;
  origins:    Record<string, Origin>;
}

const TT_STYLE = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 10,
};

// Display order; the panel filters this to the selected commodity + origins
// that actually have a price history.
const ORIGIN_ORDER = [
  "vietnam", "brazil_conilon", "uganda",          // robusta
  "brazil_arabica", "uganda_drugar", "uganda_wugar", // arabica
] as const;
type OriginKey = string;
type Commodity = "robusta" | "arabica";

type Window = "1M" | "3M" | "6M" | "1Y" | "2Y";
const WINDOW_DAYS: Record<Window, number> = {
  "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730,
};

// Native unit → metric tonne multiplier, so every origin converts to a single
// comparable USD/MT figure (1 cwt = 45.359237 kg; 1 saca = 60 kg; ¢/lb via
// 2204.62 lb/MT ÷ 100). USD/cwt and ¢/lb are numerically identical (×22.0462).
const UNIT_TO_MT: Record<string, number> = {
  per_kg:            1000,
  per_saca_60kg:     1000 / 60,
  per_cwt:           1000 / 45.359237,
  cents_lb:          2204.62 / 100,
  per_quintal_100lb: 1000 / 45.359237,   // Guatemala café oro quintal = 100 lb
};
// KC arabica ¢/lb → USD/MT (1 MT = 2204.62 lb, 1¢ = $0.01).
const KC_CENTS_TO_USD_MT = 2204.62 / 100;

const FUTURES_COLOR = "#e2e8f0";
const FUTURES_KEY   = "__futures";

// Daily FX close (units of currency per 1 USD), ascending by date.
type FxSeries = Record<string, { date: string; close: number }[]>;

interface OiContract { symbol: string; oi: number; last_price: number }
interface OiSnapshot { date: string; contracts: OiContract[] }
interface OiHistory  { arabica?: OiSnapshot[]; robusta?: OiSnapshot[] }

// Rate on a given date: the last close on or before it (forward-fill across
// weekends/holidays / dates past the last FX point). Falls back to the earliest
// close for dates before the series starts.
function rateOnDate(hist: { date: string; close: number }[] | undefined, date: string): number | null {
  if (!hist?.length) return null;
  let rate: number | null = null;
  for (const h of hist) {
    if (h.date <= date) rate = h.close;
    else break;
  }
  return rate ?? hist[0].close;
}

// Convert a native-currency, native-unit farmgate price to USD/MT using the FX
// rate for THAT day. USD-quoted origins (Uganda) need the unit factor only.
function toUsdMtOnDate(price: number, unit: string, currency: string, date: string, fx: FxSeries): number | null {
  const factor = UNIT_TO_MT[unit];
  if (factor == null) return null;
  if (currency === "USD") return price * factor;
  const rate = rateOnDate(fx[currency], date);
  if (!rate) return null;
  return (price / rate) * factor;
}

function fmtNative(price: number, unit: string, currency: string): string {
  if (unit === "cents_lb") return `${price.toFixed(2)} ¢/lb`;
  if (unit === "per_quintal_100lb") {
    const n = price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency === "GTQ" ? `Q${n}/qq` : `$${n}/qq`;
  }
  const big = Math.abs(price) >= 1000;
  const n = big
    ? price.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : price.toFixed(2);
  const unitLabel = unit === "per_kg" ? "/kg"
                  : unit === "per_saca_60kg" ? "/saca"
                  : unit === "per_cwt" ? "/cwt"
                  : "";
  const sym = currency === "BRL" ? "R$ " : currency === "USD" ? "$ " : "";
  return `${sym}${n}${unitLabel}${!sym ? ` ${currency}` : ""}`;
}

export default function OriginPricesPanel() {
  const [data,      setData]      = useState<OriginPricesData | null>(null);
  const [error,     setError]     = useState(false);
  const [window,    setWindow]    = useState<Window>("3M");
  const [usd,       setUsd]       = useState(false);
  const [axisMode,  setAxisMode]  = useState<"index" | "value">("index");
  const [commodity, setCommodity] = useState<Commodity>("robusta");
  const [fx,        setFx]        = useState<FxSeries>({});
  const [oiHist,    setOiHist]    = useState<OiHistory | null>(null);

  useEffect(() => {
    fetch("/data/origin_prices_history.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
    // Daily FX history (one close per day per pair) for the USD-equivalent
    // toggle, so each historical local price converts at its own day's rate.
    fetch("/data/fx_history.json")
      .then(r => r.ok ? r.json() : null)
      .then((fh: { pairs?: Record<string, { history?: { date: string; close: number }[] }> } | null) => {
        if (!fh?.pairs) return;
        const series: FxSeries = {};
        for (const [pair, v] of Object.entries(fh.pairs)) {
          const m = pair.match(/^([A-Z]{3})=X$/);   // "VND=X" → "VND"
          if (m && v?.history?.length) {
            series[m[1]] = [...v.history].sort((a, b) => a.date.localeCompare(b.date));
          }
        }
        setFx(series);
      })
      .catch(() => { /* native-only */ });
    // Daily futures price history (per-contract last_price) for the KC/RC overlay.
    fetch("/data/oi_history.json")
      .then(r => r.ok ? r.json() : null)
      .then((oi: OiHistory | null) => { if (oi) setOiHist(oi); })
      .catch(() => { /* no overlay */ });
  }, []);

  // Origins of the selected commodity that actually have a price history.
  const presentOrigins = useMemo<OriginKey[]>(
    () => ORIGIN_ORDER.filter(k => {
      const o = data?.origins?.[k];
      return o && o.commodity === commodity && (o.history?.length ?? 0) > 0;
    }),
    [data, commodity]
  );

  // Front-month futures price (USD/MT) per day, for the active commodity. Front
  // = highest open interest. KC is ¢/lb → USD/MT; RC is already $/MT.
  const futuresSeries = useMemo(() => {
    const snaps = commodity === "arabica" ? oiHist?.arabica : oiHist?.robusta;
    if (!snaps?.length) return [] as { date: string; value: number }[];
    return snaps
      .map(s => {
        const cs = s.contracts ?? [];
        if (!cs.length) return null;
        const front = cs.reduce((b, c) => (c.oi ?? 0) > (b.oi ?? 0) ? c : b, cs[0]);
        if (front?.last_price == null) return null;
        const usdMt = commodity === "arabica" ? front.last_price * KC_CENTS_TO_USD_MT : front.last_price;
        return { date: s.date, value: usdMt };
      })
      .filter((x): x is { date: string; value: number } => x != null)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [oiHist, commodity]);

  const futuresName = commodity === "arabica" ? "ICE NY Arabica (KC)" : "ICE London Robusta (RC)";
  // The futures price is a USD/MT figure, so only overlay it where the origins
  // share that scale: any index view, or a USD/MT value view.
  const showFutures = futuresSeries.length > 0 && (axisMode === "index" || usd);

  const chartData = useMemo(() => {
    if (!data) return [];
    const days = WINDOW_DAYS[window];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    // Per-point chart value: native price, or USD/MT at THAT day's FX.
    const valueOf = (k: OriginKey, h: HistoryPoint): number | null => {
      if (h.price == null) return null;
      if (!usd) return h.price;
      const o = data.origins[k];
      return o ? toUsdMtOnDate(h.price, o.unit, o.currency, h.date, fx) : null;
    };

    // Union of dates across present origins + the futures overlay, in window.
    const dateSet = new Set<string>();
    for (const k of presentOrigins) {
      for (const h of data.origins[k]?.history ?? []) if (h.date >= cutoffIso) dateSet.add(h.date);
    }
    if (showFutures) for (const f of futuresSeries) if (f.date >= cutoffIso) dateSet.add(f.date);
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) return [];

    const rebase = axisMode === "index";

    // Bases for rebasing (first in-window value > 0).
    const base: Record<string, number | null> = {};
    for (const k of presentOrigins) {
      const hist = data.origins[k]?.history.filter(h => h.date >= cutoffIso) ?? [];
      base[k] = hist.map(h => valueOf(k, h)).find(v => v != null && v > 0) ?? null;
    }
    const fMap   = new Map(futuresSeries.map(f => [f.date, f.value]));
    const fBase  = futuresSeries.filter(f => f.date >= cutoffIso).find(f => f.value > 0)?.value ?? null;

    return dates.map(d => {
      const row: Record<string, number | string | null> = { date: d, label: fmtDateLabel(d) };
      for (const k of presentOrigins) {
        const point = data.origins[k]?.history.find(h => h.date === d);
        const v = point ? valueOf(k, point) : null;
        row[k] = v == null ? null : rebase ? (base[k] ? (v / base[k]!) * 100 : null) : v;
      }
      if (showFutures) {
        const fv = fMap.get(d) ?? null;
        row[FUTURES_KEY] = fv == null ? null : rebase ? (fBase ? (fv / fBase) * 100 : null) : fv;
      }
      return row;
    });
  }, [data, window, presentOrigins, usd, fx, axisMode, futuresSeries, showFutures]);

  const stats = useMemo(() => {
    if (!data) return [] as { key: OriginKey; name: string; latest: HistoryPoint | null; pct: number | null; color: string; unit: string; currency: string; source: string; count: number }[];
    const days = WINDOW_DAYS[window];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    return presentOrigins.map(k => {
      const o = data.origins[k];
      const inWindow = o.history.filter(h => h.date >= cutoffIso);
      const firstPt  = inWindow.find(h => h.price > 0) ?? null;
      const last     = inWindow.length ? inWindow[inWindow.length - 1] : null;
      const conv = (h: HistoryPoint) => usd ? toUsdMtOnDate(h.price, o.unit, o.currency, h.date, fx) : h.price;
      const fv = firstPt ? conv(firstPt) : null;
      const lv = last ? conv(last) : null;
      const pct = fv && lv ? ((lv - fv) / fv) * 100 : null;
      return {
        key: k, name: o.name, latest: last, pct,
        color: o.color, unit: o.unit, currency: o.currency,
        source: o.source, count: inWindow.length,
      };
    });
  }, [data, window, presentOrigins, usd, fx]);

  if (error) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Origin prices unavailable — origin_prices_history.json failed to load.
        Will populate after the next export-and-publish run.
      </div>
    );
  }
  if (!data) {
    return <div className="p-4 text-xs text-slate-500 animate-pulse">Loading origin prices…</div>;
  }

  const fmtTick = (v: number) => axisMode === "index" ? v.toFixed(0) : v.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Origin Farmgate Prices</h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            Local farmgate prices per origin. Index view rebases each series to 100 at the start of the window
            (cross-origin % moves); Value view plots the actual price (USD/MT when the USD toggle is on).
            The {futuresName} front month is overlaid for context. Last update {new Date(data.scraped_at).toISOString().slice(0,10)}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Robusta ⇄ Arabica */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["robusta","Robusta"],["arabica","Arabica"]] as const).map(([c, label]) => (
              <button key={c} onClick={() => setCommodity(c)}
                className={`px-2.5 py-1.5 transition ${commodity === c ? "bg-amber-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Index ⇄ Value axis */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["index","Index"],["value","Value"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => setAxisMode(m)}
                className={`px-2.5 py-1.5 transition ${axisMode === m ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Native ⇄ USD/MT */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["native","Native"],["usd","USD/MT"]] as const).map(([mode, label]) => (
              <button key={mode} onClick={() => setUsd(mode === "usd")}
                className={`px-2.5 py-1.5 transition ${(usd ? "usd" : "native") === mode ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Window */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {(["1M","3M","6M","1Y","2Y"] as Window[]).map(w => (
              <button key={w} onClick={() => setWindow(w)}
                className={`px-2.5 py-1.5 transition ${window === w ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}>
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip — one per origin */}
      {stats.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {stats.map(s => {
            const cls = s.pct == null ? "text-slate-500"
                      : s.pct >= 0   ? "text-emerald-400"
                                     : "text-red-400";
            return (
              <div key={s.key} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="text-slate-200 text-[11px]">{s.name}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <div className="text-base font-bold font-mono text-slate-100">
                    {(() => {
                      if (!s.latest) return "—";
                      if (usd) {
                        const v = toUsdMtOnDate(s.latest.price, s.unit, s.currency, s.latest.date, fx);
                        if (v != null) return `$${Math.round(v).toLocaleString()}/MT`;
                      }
                      return fmtNative(s.latest.price, s.unit, s.currency);
                    })()}
                  </div>
                  <div className={`text-sm font-bold font-mono ${cls}`}>
                    {s.pct == null ? "—" : `${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(1)}%`}
                  </div>
                </div>
                <div className="text-[9px] text-slate-500 mt-1">
                  {s.count} pt{s.count === 1 ? "" : "s"} in window · {s.source}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 italic">
          No {commodity} origin price history yet — it accumulates from the scrapers and fills in over time.
        </div>
      )}

      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          {axisMode === "index" ? `Rebased to 100 at start of ${window}` : "Price level"}
          {" · "}{usd ? "USD/MT, per-day FX" : "local currency, native unit"}
          {showFutures ? ` · ${futuresName} overlay` : ""}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={20} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} domain={["auto","auto"]} tickFormatter={fmtTick} width={48} />
              <Tooltip
                contentStyle={TT_STYLE}
                labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                formatter={(v) => typeof v === "number"
                  ? (axisMode === "index"
                      ? v.toFixed(1)
                      : usd ? `$${Math.round(v).toLocaleString()}/MT` : v.toLocaleString())
                  : "—"}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              {axisMode === "index" && <ReferenceLine y={100} stroke="#475569" strokeDasharray="3 3" />}
              {presentOrigins.map(k => {
                const o = data.origins[k];
                if (!o) return null;
                return (
                  <Line key={k} type="monotone" dataKey={k} name={o.name}
                    stroke={o.color} strokeWidth={1.5} dot={false} connectNulls />
                );
              })}
              {showFutures && (
                <Line type="monotone" dataKey={FUTURES_KEY} name={futuresName}
                  stroke={FUTURES_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
