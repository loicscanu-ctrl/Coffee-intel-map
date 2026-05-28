"use client";
/**
 * Test sandbox for new certified-stocks visuals.
 *
 * Lives at /demand?tab=test alongside the production CertifiedStocksPanel.
 * Drops in alternative layouts (KPI cards, unified stacked-area chart,
 * 5Y-range tightness gauges, collapsible raw-data table) without touching
 * the proven panel. Real data is read from the same JSON sources used in
 * production — no dummy series here.
 *
 * Things to play with in here can later be promoted into the main panel.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ── Data shapes (subset of the rich JSON — only what this view consumes) ─────

interface ArabicaSnap { date: string; total_bags: number }
interface RobustaSnap { date: string; total_lots_certified: number }
interface ArabicaJson { snapshots: ArabicaSnap[]; as_of?: string | null }
interface RobustaJson { snapshots: RobustaSnap[]; as_of?: string | null }

// Deep-chunk shape is lighter still — only need date + total here.
interface DeepRow { date: string; total: number }

// ── Unit math ────────────────────────────────────────────────────────────────

const KG_PER_BAG = 60;
const TONNES_PER_LOT = 10;
const BAGS_PER_LOT = (TONNES_PER_LOT * 1000) / KG_PER_BAG;   // 166.67

const fmtNum = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";
const fmtShortDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "2-digit" });
};

// ── Reusable bits ────────────────────────────────────────────────────────────

interface KPICardProps {
  title: string;
  value: number | null;
  unit: string;
  delta: number | null;
  deltaPct: number | null;
  // For inventory: a drop is bullish (tight) — color the drop red, gain green.
  // Pass false to invert (e.g. for "passing rate" where up is good).
  dropIsBullish?: boolean;
}
function KPICard({ title, value, unit, delta, deltaPct, dropIsBullish = true }: KPICardProps) {
  const hasDelta = delta != null && deltaPct != null;
  const isDrop = (delta ?? 0) < 0;
  const isGain = (delta ?? 0) > 0;
  let toneCls = "text-slate-500";
  let arrow = "→";
  if (isDrop) {
    toneCls = dropIsBullish ? "text-rose-400" : "text-emerald-400";
    arrow = "▼";
  } else if (isGain) {
    toneCls = dropIsBullish ? "text-emerald-400" : "text-rose-400";
    arrow = "▲";
  }
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{title}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <div className="text-2xl font-semibold text-slate-100 font-mono">
          {value == null ? "—" : fmtNum(value)}
        </div>
        <div className="text-xs text-slate-500">{unit}</div>
      </div>
      <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${toneCls}`}>
        <span>{arrow}</span>
        <span>
          {hasDelta
            ? `${delta! > 0 ? "+" : ""}${fmtNum(delta!)} (${deltaPct! > 0 ? "+" : ""}${deltaPct!.toFixed(1)}%) · 14d`
            : "no 14d baseline"}
        </span>
      </div>
    </div>
  );
}

interface GaugeProps {
  title: string;
  current: number | null;
  min: number | null;
  max: number | null;
  // Range source label ("5Y", "2Y" if 5Y data isn't loaded yet, etc.)
  rangeLabel: string;
  // Color tone: emerald=high, rose=low, default=slate. Computed inside.
  tightThreshold?: number;   // % of range below which we color rose (default 30)
}
function TightnessGauge({ title, current, min, max, rangeLabel, tightThreshold = 30 }: GaugeProps) {
  if (current == null || min == null || max == null || max <= min) {
    return (
      <div>
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-sm font-semibold text-slate-300">{title}</span>
          <span className="text-[10px] text-slate-600">no range data</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full" />
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, ((current - min) / (max - min)) * 100));
  const isTight = pct < tightThreshold;
  const barCls = isTight ? "bg-rose-500" : pct > 70 ? "bg-emerald-500" : "bg-slate-500";
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-sm font-semibold text-slate-300">{title}</span>
        <span className="text-[10px] text-slate-500">
          {Math.round(pct)}% of {rangeLabel} range
        </span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full relative overflow-hidden">
        <div className={`h-full absolute left-0 top-0 rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-slate-600 font-mono">
        <span>{fmtNum(min)}</span>
        <span>{fmtNum(max)}</span>
      </div>
    </div>
  );
}

// ── Main test panel ──────────────────────────────────────────────────────────

export default function CertifiedStocksTestPanel() {
  const [arabica, setArabica] = useState<ArabicaJson | null>(null);
  const [robusta, setRobusta] = useState<RobustaJson | null>(null);
  // Deep history merged across 5Y. Loaded lazily; gauges show "loading" while
  // it streams in.
  const [deepArabica, setDeepArabica] = useState<DeepRow[] | null>(null);
  const [deepRobusta, setDeepRobusta] = useState<DeepRow[] | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Primary feeds.
  useEffect(() => {
    Promise.all([
      fetch("/data/certified_stocks_arabica.json").then((r) => (r.ok ? r.json() : null)),
      fetch("/data/certified_stocks_robusta.json").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([a, b]) => { setArabica(a); setRobusta(b); })
      .catch(() => { /* leave nulls — KPI cards render dashes */ });
  }, []);

  // 5Y deep-history chunks. Today is 2026 so chunks 2020–2024 + 2025–2029
  // cover the full 5-year window. Light shape; quick parse.
  useEffect(() => {
    const flatten = (json: { snapshots?: Array<{ date: string; total_bags?: number; total_lots_certified?: number }> } | null): DeepRow[] => {
      if (!json?.snapshots) return [];
      return json.snapshots.map((s) => ({
        date: s.date,
        total: Number(s.total_bags ?? s.total_lots_certified ?? 0),
      }));
    };
    Promise.all([
      fetch("/data/certified_stocks_arabica_deep_2020-2024.json").then((r) => (r.ok ? r.json() : null)),
      fetch("/data/certified_stocks_arabica_deep_2025-2029.json").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([a, b]) => setDeepArabica([...flatten(a), ...flatten(b)]))
      .catch(() => setDeepArabica([]));
    Promise.all([
      fetch("/data/certified_stocks_robusta_deep_2020-2024.json").then((r) => (r.ok ? r.json() : null)),
      fetch("/data/certified_stocks_robusta_deep_2025-2029.json").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([a, b]) => setDeepRobusta([...flatten(a), ...flatten(b)]))
      .catch(() => setDeepRobusta([]));
  }, []);

  // ── 90-day series, unified to bag-equivalents ───────────────────────────
  const series = useMemo(() => {
    const aSnaps = arabica?.snapshots ?? [];
    const rSnaps = robusta?.snapshots ?? [];
    // Build a date → {kc, rc} map; cover the last 90 days only.
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const byDate = new Map<string, { kcBags: number | null; rcLots: number | null }>();
    for (const s of aSnaps) {
      if (new Date(s.date) < cutoff) continue;
      const cur = byDate.get(s.date) ?? { kcBags: null, rcLots: null };
      cur.kcBags = s.total_bags;
      byDate.set(s.date, cur);
    }
    for (const s of rSnaps) {
      if (new Date(s.date) < cutoff) continue;
      const cur = byDate.get(s.date) ?? { kcBags: null, rcLots: null };
      cur.rcLots = s.total_lots_certified;
      byDate.set(s.date, cur);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const rcBagsEq = (v.rcLots ?? 0) * BAGS_PER_LOT;
        const kcBags = v.kcBags ?? 0;
        return {
          date,
          displayDate: fmtShortDate(date),
          kcBags,
          rcLots: v.rcLots ?? 0,
          rcBagsEq,
          totalBagsEq: kcBags + rcBagsEq,
        };
      });
  }, [arabica, robusta]);

  // ── KPIs: latest vs 14d ago ────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (series.length === 0) return null;
    const latest = series[series.length - 1];
    // Find the snapshot closest to 14 days before `latest.date` (workdays
    // may shift; nearest match is fine for a delta).
    const target = new Date(latest.date); target.setDate(target.getDate() - 14);
    let baseline = series[0];
    let bestDist = Infinity;
    for (const s of series) {
      const dist = Math.abs(new Date(s.date).getTime() - target.getTime());
      if (dist < bestDist) { baseline = s; bestDist = dist; }
    }
    const delta = (a: number, b: number) => a - b;
    const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / b) * 100);
    return {
      latest,
      baseline,
      kcDelta:    delta(latest.kcBags,     baseline.kcBags),
      kcPct:      pct(latest.kcBags,       baseline.kcBags),
      rcDelta:    delta(latest.rcLots,     baseline.rcLots),
      rcPct:      pct(latest.rcLots,       baseline.rcLots),
      totalDelta: delta(latest.totalBagsEq, baseline.totalBagsEq),
      totalPct:   pct(latest.totalBagsEq,   baseline.totalBagsEq),
    };
  }, [series]);

  // ── 5Y min/max for the gauges ─────────────────────────────────────────
  const ranges = useMemo(() => {
    const lookback = new Date(); lookback.setFullYear(lookback.getFullYear() - 5);
    const minMax = (rows: DeepRow[] | null) => {
      if (!rows || rows.length === 0) return { min: null as number | null, max: null as number | null };
      let lo = Infinity, hi = -Infinity;
      for (const r of rows) {
        if (new Date(r.date) < lookback) continue;
        if (r.total < lo) lo = r.total;
        if (r.total > hi) hi = r.total;
      }
      if (lo === Infinity) return { min: null, max: null };
      return { min: lo, max: hi };
    };
    return {
      arabica: minMax(deepArabica),
      robusta: minMax(deepRobusta),
      label:   deepArabica == null || deepRobusta == null ? "loading" : "5Y",
    };
  }, [deepArabica, deepRobusta]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <span className="inline-block w-1.5 h-5 bg-blue-500 rounded-sm" />
          Exchange Certified Inventory — visual sandbox
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Experimental layout. Live data from the same JSON sources as the production panel.
          Promote anything that works to <code className="text-amber-400/80">CertifiedStocksPanel.tsx</code>.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KPICard
          title="ICE Arabica (KC)"
          value={kpis?.latest.kcBags ?? null}
          unit="bags"
          delta={kpis?.kcDelta ?? null}
          deltaPct={kpis?.kcPct ?? null}
        />
        <KPICard
          title="ICE Robusta (RC)"
          value={kpis?.latest.rcLots ?? null}
          unit="lots"
          delta={kpis?.rcDelta ?? null}
          deltaPct={kpis?.rcPct ?? null}
        />
        <KPICard
          title="Total deliverable supply"
          value={kpis?.latest.totalBagsEq ?? null}
          unit="bag eq."
          delta={kpis?.totalDelta ?? null}
          deltaPct={kpis?.totalPct ?? null}
        />
      </div>

      {/* Main chart + gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 90-day unified stacked area */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-slate-200">90-day inventory trajectory</h3>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-slate-800 text-slate-400 rounded border border-slate-700">
              normalized · 60kg bag equivalents
            </span>
          </div>
          <div className="h-72 w-full">
            {series.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-600">
                loading snapshots…
              </div>
            ) : (
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-kc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="grad-rc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="displayDate"
                    stroke="#475569"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickMargin={8}
                    minTickGap={30}
                  />
                  <YAxis
                    stroke="#475569"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                    width={56}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", fontSize: 12 }}
                    itemStyle={{ fontSize: 12 }}
                    labelStyle={{ color: "#94a3b8" }}
                    formatter={(v, name) => [
                      `${fmtNum(Number(v ?? 0))} bag eq.`,
                      name === "kcBags" ? "Arabica" : "Robusta",
                    ]}
                  />
                  {/* Robusta (bag-eq) on the bottom, arabica stacked on top.
                      Y-axis becomes a single deliverable-supply ruler. */}
                  <Area type="monotone" dataKey="rcBagsEq" stackId="1"
                        stroke="#ea580c" fill="url(#grad-rc)" isAnimationActive={false} name="rcBagsEq" />
                  <Area type="monotone" dataKey="kcBags"   stackId="1"
                        stroke="#2563eb" fill="url(#grad-kc)" isAnimationActive={false} name="kcBags" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Tightness gauges */}
        <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col gap-4">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500">historical context</h3>
          <TightnessGauge
            title="Arabica (KC)"
            current={kpis?.latest.kcBags ?? null}
            min={ranges.arabica.min}
            max={ranges.arabica.max}
            rangeLabel={ranges.label}
          />
          <TightnessGauge
            title="Robusta (RC)"
            current={kpis?.latest.rcLots ?? null}
            min={ranges.robusta.min}
            max={ranges.robusta.max}
            rangeLabel={ranges.label}
          />
          <p className="text-[10px] text-slate-600 italic mt-auto">
            * Rose bar = current sits in the bottom 30% of the 5-year range
            (tight market). Emerald = top 30% (loose). 5Y window pulled from
            the deep-history chunks.
          </p>
        </div>
      </div>

      {/* Collapsible raw data table */}
      <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900">
        <button
          onClick={() => setShowRaw((x) => !x)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800/50 transition-colors"
        >
          <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
            Raw data — last 10 days
          </span>
          <span className="text-slate-500 text-sm">{showRaw ? "▾" : "▸"}</span>
        </button>
        {showRaw && (
          <div className="overflow-x-auto border-t border-slate-800">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-950">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Arabica (bags)</th>
                  <th className="px-4 py-2 text-right">Robusta (lots)</th>
                  <th className="px-4 py-2 text-right">Robusta (bag eq)</th>
                  <th className="px-4 py-2 text-right">Total supply (eq)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {series.slice(-10).reverse().map((row) => (
                  <tr key={row.date} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-4 py-1.5 text-slate-300">{row.displayDate}</td>
                    <td className="px-4 py-1.5 text-right text-slate-200">{fmtNum(row.kcBags)}</td>
                    <td className="px-4 py-1.5 text-right text-slate-200">{fmtNum(row.rcLots)}</td>
                    <td className="px-4 py-1.5 text-right text-slate-400">{fmtNum(row.rcBagsEq)}</td>
                    <td className="px-4 py-1.5 text-right text-slate-100 font-semibold">{fmtNum(row.totalBagsEq)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
