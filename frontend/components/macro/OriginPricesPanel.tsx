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
  name:     string;
  source:   string;
  currency: string;
  unit:     string;
  color:    string;
  history:  HistoryPoint[];
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

const ORIGIN_ORDER = ["vietnam", "brazil_arabica", "brazil_conilon", "uganda"] as const;
type OriginKey = typeof ORIGIN_ORDER[number];

type Window = "1M" | "3M" | "6M" | "1Y" | "2Y";
const WINDOW_DAYS: Record<Window, number> = {
  "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "2Y": 730,
};

// Native unit → metric tonne multiplier, so every origin converts to a single
// comparable USD/MT figure (1 cwt = 45.359237 kg; 1 saca = 60 kg).
const UNIT_TO_MT: Record<string, number> = {
  per_kg:         1000,
  per_saca_60kg:  1000 / 60,
  per_cwt:        1000 / 45.359237,
};

// Daily FX close (units of currency per 1 USD), ascending by date.
type FxSeries = Record<string, { date: string; close: number }[]>;

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
// rate for THAT day. Uganda's series is already USD (factor only).
function toUsdMtOnDate(price: number, unit: string, currency: string, date: string, fx: FxSeries): number | null {
  const factor = UNIT_TO_MT[unit];
  if (factor == null) return null;
  if (currency === "USD") return price * factor;
  const rate = rateOnDate(fx[currency], date);
  if (!rate) return null;
  return (price / rate) * factor;
}

function fmtNative(price: number, unit: string, currency: string): string {
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
  const [data,    setData]    = useState<OriginPricesData | null>(null);
  const [error,   setError]   = useState(false);
  const [window,  setWindow]  = useState<Window>("3M");
  const [usd,     setUsd]     = useState(false);
  const [fx,      setFx]      = useState<FxSeries>({});

  useEffect(() => {
    fetch("/data/origin_prices_history.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
    // Daily FX history (one close per day per pair) for the USD-equivalent
    // toggle, so each historical local price converts at its own day's rate.
    // Best-effort: on failure the toggle simply has no rates and falls back to
    // native display.
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
  }, []);

  // Only render origins that actually have a price history — otherwise an
  // origin like brazil_arabica (no published series yet) shows a dead "—" card
  // and a blank line.
  const presentOrigins = useMemo<OriginKey[]>(
    () => ORIGIN_ORDER.filter(k => (data?.origins?.[k]?.history?.length ?? 0) > 0),
    [data]
  );

  const chartData = useMemo(() => {
    if (!data) return [];
    const days = WINDOW_DAYS[window];

    // Collect union of dates across origins, restricted to the window
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    const dateSet = new Set<string>();
    for (const k of presentOrigins) {
      const hist = data.origins[k]?.history;
      if (!hist) continue;
      for (const h of hist) if (h.date >= cutoffIso) dateSet.add(h.date);
    }
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) return [];

    // Per-point chart value: native price, or USD/MT converted at THAT day's FX
    // (so a moving exchange rate shows up in the rebased USD trend).
    const valueOf = (k: OriginKey, h: HistoryPoint): number | null => {
      if (h.price == null) return null;
      if (!usd) return h.price;
      const o = data.origins[k];
      return o ? toUsdMtOnDate(h.price, o.unit, o.currency, h.date, fx) : null;
    };

    // Rebase each series to 100 at first available point in window
    const base: Record<string, number | null> = {};
    for (const k of presentOrigins) {
      const hist  = data.origins[k]?.history.filter(h => h.date >= cutoffIso) ?? [];
      const first = hist.map(h => valueOf(k, h)).find(v => v != null && v > 0) ?? null;
      base[k] = first;
    }

    return dates.map(d => {
      const row: Record<string, number | string | null> = { date: d, label: fmtDateLabel(d) };
      for (const k of presentOrigins) {
        const point = data.origins[k]?.history.find(h => h.date === d);
        const v = point ? valueOf(k, point) : null;
        const b = base[k];
        row[k] = v != null && b ? (v / b) * 100 : null;
      }
      return row;
    });
  }, [data, window, presentOrigins, usd, fx]);

  const stats = useMemo(() => {
    if (!data) return [] as { key: OriginKey; name: string; latest: HistoryPoint | null; pct: number | null; color: string; unit: string; currency: string; source: string; count: number }[];
    const days = WINDOW_DAYS[window];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    return presentOrigins.map(k => {
      const o = data.origins[k];
      if (!o) {
        return { key: k, name: k, latest: null, pct: null, color: "#64748b", unit: "", currency: "", source: "", count: 0 };
      }
      const inWindow = o.history.filter(h => h.date >= cutoffIso);
      const firstPt  = inWindow.find(h => h.price > 0) ?? null;
      const last     = inWindow.length ? inWindow[inWindow.length - 1] : null;
      // % move in the active denomination: USD (per-day FX) when toggled, else
      // native. Keeps the headline % consistent with the displayed price.
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

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Origin Farmgate Prices</h2>
          <p className="text-xs text-slate-400">
            Local farmgate prices in each origin, rebased to 100 at the start of the window so cross-origin % moves are comparable.
            Brazil Arabica and Conilon are sourced from CEPEA/ESALQ via BCB SGS (multi-year archive on first run).
            Vietnam FAQ-2 and Uganda Screen 15 accumulate one row per day from their respective scrapers — sparse charts at first, fills in over time.
            Last update {new Date(data.scraped_at).toISOString().slice(0,10)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Native ⇄ USD/MT toggle */}
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {([["native","Native"],["usd","USD/MT"]] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setUsd(mode === "usd")}
                className={`px-2.5 py-1.5 transition ${(usd ? "usd" : "native") === mode ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[10px]">
            {(["1M","3M","6M","1Y","2Y"] as Window[]).map(w => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`px-2.5 py-1.5 transition ${window === w ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip — one per origin */}
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
                      // Fall back to native if FX/unit conversion isn't available.
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

      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
          Rebased to 100 at start of {window} · {usd ? "USD/MT, per-day FX" : "local currency, native unit"}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 9 }} minTickGap={20} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} domain={["auto","auto"]} />
              <Tooltip
                contentStyle={TT_STYLE}
                labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                formatter={(v) => typeof v === "number" ? v.toFixed(2) : "—"}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              <ReferenceLine y={100} stroke="#475569" strokeDasharray="3 3" />
              {presentOrigins.map(k => {
                const o = data.origins[k];
                if (!o) return null;
                return (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    name={o.name}
                    stroke={o.color}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
