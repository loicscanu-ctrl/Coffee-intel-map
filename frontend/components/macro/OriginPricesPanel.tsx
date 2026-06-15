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

  useEffect(() => {
    fetch("/data/origin_prices_history.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
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

    // Rebase each series to 100 at first available point in window
    const base: Record<string, number | null> = {};
    for (const k of presentOrigins) {
      const hist = data.origins[k]?.history.filter(h => h.date >= cutoffIso);
      const first = hist?.find(h => h.price > 0)?.price ?? null;
      base[k] = first;
    }

    return dates.map(d => {
      const row: Record<string, number | string | null> = { date: d, label: fmtDateLabel(d) };
      for (const k of presentOrigins) {
        const hist = data.origins[k]?.history;
        const point = hist?.find(h => h.date === d);
        const b = base[k];
        row[k] = point?.price != null && b ? (point.price / b) * 100 : null;
      }
      return row;
    });
  }, [data, window, presentOrigins]);

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
      const first = inWindow.find(h => h.price > 0)?.price ?? null;
      const last  = inWindow.length ? inWindow[inWindow.length - 1] : null;
      const pct   = first && last?.price ? ((last.price - first) / first) * 100 : null;
      return {
        key: k, name: o.name, latest: last, pct,
        color: o.color, unit: o.unit, currency: o.currency,
        source: o.source, count: inWindow.length,
      };
    });
  }, [data, window, presentOrigins]);

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
                  {s.latest ? fmtNative(s.latest.price, s.unit, s.currency) : "—"}
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
          Rebased to 100 at start of {window} · local currency, native unit
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
