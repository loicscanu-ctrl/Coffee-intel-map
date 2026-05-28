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
  AreaChart, Area, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";

// ── Data shapes (subset of the rich JSON — only what this view consumes) ─────

interface ArabicaSectionHierarchy {
  grand_total: number;
  by_port: Record<string, number>;
  by_origin: Record<string, { by_port: Record<string, number>; group: string; total: number }>;
}
interface ArabicaSnap {
  date: string;
  total_bags: number;
  passed_today_bags?: number;
  failed_today_bags?: number;
  pending_grading_bags?: number;
  by_port?: Record<string, number>;
  sections?: { total_certified?: ArabicaSectionHierarchy; pending_grading?: ArabicaSectionHierarchy };
}
interface RobustaSnap { date: string; total_lots_certified: number; by_port_lots?: Record<string, number> }
interface ArabicaAgeBucketRow { age_bucket: string; bags: number }
interface ArabicaJson {
  snapshots: ArabicaSnap[];
  as_of?: string | null;
  latest_detail?: { age_detail?: Record<string, ArabicaAgeBucketRow[]>; age_detail_date?: string | null };
}

interface RobustaAgeBucket { months_since_graded: number; by_port: Record<string, number>; grand_total_mt: number }
interface RobustaAgeMonth  { month_end: string; valid?: { ports?: string[]; buckets?: RobustaAgeBucket[] } | null }
interface RobustaGradingEntry { port?: string; origin?: string; class?: number | null; tenderable?: boolean; lots: number }
interface RobustaGradingEvent { date: string; entries?: RobustaGradingEntry[] }
interface RobustaOverviewEvent { date: string; total_pending_lots?: number | null; queue_lots?: number | null; forecast_lots?: number | null }
interface RobustaJson {
  snapshots: RobustaSnap[];
  as_of?: string | null;
  monthly?: { age_allowance?: RobustaAgeMonth[] };
  recent_activity?: { gradings?: RobustaGradingEvent[]; grading_overview?: RobustaOverviewEvent[] };
}

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

// ── Age bins (shared by system-flow density grid) ─────────────────────────
type BeanBin = "fresh" | "mid" | "old" | "stale";
interface AgeDist { fresh: number; mid: number; old: number; stale: number }   // shares 0..1

// Port-name lookup for the arabica system-flow row labels (full version
// lives in CertifiedStocksPanel).
const ARABICA_PORT_NAMES: Record<string, string> = {
  ANT: "Antwerp", "HA/BR": "Hamburg/Bremen", HA: "Hamburg/Bremen", HAM: "Hamburg",
  HOU: "Houston", HO: "Houston", MIA: "Miami", MI: "Miami",
  NO: "New Orleans", NOR: "Norfolk", NY: "New York", NYK: "New York", VIR: "Virginia",
};

// ── Origin colors (shared by the system-flow density grid) ──────────────────
// Static palette so a given origin paints the same shade across every port and
// every animation. Unknown origins fall through to slate.
const ORIGIN_COLORS: Record<string, string> = {
  "Brazil":          "#a855f7",   // purple
  "Brazilian Conillon": "#7c3aed",
  "Honduras":        "#3b82f6",   // blue
  "Colombia":        "#6366f1",   // indigo
  "Vietnam":         "#14b8a6",   // teal
  "Indonesia":       "#10b981",   // emerald
  "Guatemala":       "#f59e0b",   // amber
  "El Salvador":     "#eab308",   // yellow
  "Nicaragua":       "#84cc16",   // lime
  "Costa Rica":      "#06b6d4",   // cyan
  "Mexico":          "#f97316",   // orange
  "Peru":            "#ec4899",   // pink
  "India":           "#ef4444",   // red
  "Burundi":         "#22d3ee",   // sky
  "Uganda":          "#a3e635",   // lime-light
  "Ethiopia":        "#f472b6",   // pink-light
  "Tanzania":        "#fb923c",   // orange-light
  "Venezuela":       "#fb7185",   // rose-light
};
const ORIGIN_DEFAULT = "#64748b";  // slate-500
const _originColor = (origin: string): string => ORIGIN_COLORS[origin] ?? ORIGIN_DEFAULT;

// Squares per 1 unit (so 2,000 bags = 1 square in the density grid). Tunable
// per market — arabica uses 2,000 bags; robusta would use ~10 lots (skipped
// here because we lack origin-per-port data for robusta).
const BAGS_PER_SQUARE = 2000;
const DENSITY_COLS = 20;
const DENSITY_MAX_SQUARES = 240;   // safety cap so MAX-volume ports don't blow up the DOM

interface DensitySquare { status: "filled" | "empty"; color: string; opacity: number }

// Build the density grid for one port given current state + 7-day flows.
// Filled count = current / 2,000 bags (capped). Each filled square gets:
//  • color = origin sampled proportionally from the latest by_origin × by_port
//    matrix (so visual share matches the actual mix)
//  • opacity = sampled proportionally from the port's age distribution
function buildDensityGrid(
  current: number,
  byOrigin: Record<string, number>,
  age: AgeDist,
): { squares: DensitySquare[]; total: number } {
  const total = Math.min(Math.ceil(current / BAGS_PER_SQUARE), DENSITY_MAX_SQUARES);
  const filledCount = current > 0 ? Math.max(1, Math.round((current / BAGS_PER_SQUARE) > DENSITY_MAX_SQUARES
    ? DENSITY_MAX_SQUARES * 0.92
    : (current / BAGS_PER_SQUARE))) : 0;
  // Pad to a whole number of rows (DENSITY_COLS = 20).
  const grandTotal = Math.max(total, filledCount);
  const totalRowsAligned = Math.ceil(grandTotal / DENSITY_COLS) * DENSITY_COLS;

  // Distribute origins proportionally to byOrigin totals.
  const originPool: string[] = [];
  const originSum = Object.values(byOrigin).reduce((a, b) => a + b, 0) || 1;
  for (const [origin, bags] of Object.entries(byOrigin)) {
    const n = Math.round(filledCount * (bags / originSum));
    for (let i = 0; i < n; i++) originPool.push(_originColor(origin));
  }
  while (originPool.length < filledCount) originPool.push(ORIGIN_DEFAULT);
  while (originPool.length > filledCount) originPool.pop();

  // Distribute opacity (age) proportionally.
  const opacityPool: number[] = [];
  const freshN = Math.round(filledCount * age.fresh);
  const midN   = Math.round(filledCount * age.mid);
  const oldN   = Math.round(filledCount * age.old);
  const staleN = Math.max(0, filledCount - freshN - midN - oldN);
  for (let i = 0; i < freshN; i++) opacityPool.push(1.0);
  for (let i = 0; i < midN;   i++) opacityPool.push(0.75);
  for (let i = 0; i < oldN;   i++) opacityPool.push(0.45);
  for (let i = 0; i < staleN; i++) opacityPool.push(0.18);

  const squares: DensitySquare[] = [];
  for (let i = 0; i < filledCount; i++) {
    squares.push({ status: "filled", color: originPool[i], opacity: opacityPool[i] ?? 0.85 });
  }
  while (squares.length < totalRowsAligned) {
    squares.push({ status: "empty", color: ORIGIN_DEFAULT, opacity: 0.18 });
  }
  return { squares, total: squares.length };
}

interface OriginFlow { origin: string; bags: number; color: string }
interface ArabicaPortFlow {
  code: string;
  name: string;
  current: number;
  capacity: number;
  pctFull: number;
  byOrigin: Record<string, number>;
  age: AgeDist;
  inflow: OriginFlow[];   // sorted desc by bags
  outflow: OriginFlow[];  // sorted desc by bags (positive numbers)
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

  // ── Grading velocity & yield (Robusta — last 14 days) ─────────────────────
  // Daily passed (premium / borderline) + failed bars, line = pending queue.
  // Premium  = tenderable & class ∈ {null, 1, 2}
  // Borderline = tenderable & class ∈ {3, 4}  — same poison criteria the
  //               main panel uses; reuse for visual continuity.
  // Failed   = not tenderable.
  // Pending  = grading_overview.total_pending_lots for the same day (nearest).
  const pipelineFlow = useMemo(() => {
    const grad  = robusta?.recent_activity?.gradings        ?? [];
    const overv = robusta?.recent_activity?.grading_overview ?? [];
    if (grad.length === 0 && overv.length === 0) return [];
    const overviewByDate = new Map(overv.map((o) => [o.date, o]));
    // Pull the last 14 unique dates seen across the two streams.
    const allDates = new Set<string>();
    grad.forEach((g) => allDates.add(g.date));
    overv.forEach((o) => allDates.add(o.date));
    const sorted = Array.from(allDates).sort();
    const last14 = sorted.slice(-14);

    return last14.map((d) => {
      let passedPremium = 0, passedBorderline = 0, failed = 0;
      const ev = grad.find((g) => g.date === d);
      for (const e of (ev?.entries || [])) {
        const lots = e.lots || 0;
        if (e.tenderable === false) { failed += lots; continue; }
        const cls = e.class;
        if (cls === 3 || cls === 4) passedBorderline += lots;
        else passedPremium += lots;
      }
      const pending = overviewByDate.get(d)?.total_pending_lots ?? null;
      return {
        date: d,
        displayDate: fmtShortDate(d),
        passedPremium,
        passedBorderline,
        failed,
        pending,
      };
    });
  }, [robusta]);

  // ── Today's robusta certification pipeline ────────────────────────────
  // Counts come from the most recent gradings event + grading_overview.
  // "Decertified today" is computed as the day-over-day stock delta minus
  // the day's passed lots (i.e. coffee that left the certified pool).
  const todaysPipeline = useMemo(() => {
    const grad = robusta?.recent_activity?.gradings ?? [];
    const overv = robusta?.recent_activity?.grading_overview ?? [];
    const snaps = robusta?.snapshots ?? [];
    if (grad.length === 0 && overv.length === 0 && snaps.length < 2) return null;
    // Most recent gradings event drives the pass/fail breakdown.
    const lastGrad = grad.length ? grad[grad.length - 1] : null;
    let passedPremium = 0, passedBorderline = 0, failed = 0;
    for (const e of (lastGrad?.entries || [])) {
      const lots = e.lots || 0;
      if (e.tenderable === false) { failed += lots; continue; }
      if (e.class === 3 || e.class === 4) passedBorderline += lots;
      else passedPremium += lots;
    }
    const graded = passedPremium + passedBorderline + failed;
    // Pending: nearest grading_overview to lastGrad.date (within 14 days).
    let pendingQueue = 0, pendingForecast = 0;
    if (lastGrad) {
      const target = new Date(lastGrad.date).getTime();
      let best: RobustaOverviewEvent | null = null; let bestDist = Infinity;
      for (const o of overv) {
        const dist = Math.abs(new Date(o.date).getTime() - target);
        if (dist < bestDist) { best = o; bestDist = dist; }
      }
      if (best && bestDist < 14 * 86_400_000) {
        pendingQueue    = best.queue_lots    ?? 0;
        pendingForecast = best.forecast_lots ?? 0;
      }
    }
    const tendered = graded + pendingQueue;
    // Decertified ≈ −(stock_delta) + passed_tenderable (those that entered).
    // Use the latest two snapshots that bracket lastGrad.date.
    let decertified = 0;
    if (snaps.length >= 2) {
      const cur = snaps[snaps.length - 1];
      const prev = snaps[snaps.length - 2];
      const delta = (cur.total_lots_certified || 0) - (prev.total_lots_certified || 0);
      const passed = passedPremium + passedBorderline;
      decertified = Math.max(0, passed - delta);
    }
    return {
      date: lastGrad?.date ?? null,
      tendered, pendingQueue, pendingForecast,
      graded, passedPremium, passedBorderline, failed,
      decertified,
    };
  }, [robusta]);

  // ── Lifecycle: 30-day issued vs decertified ───────────────────────────
  // Per snapshot date (last 30): issued = passed tenderable lots from
  // gradings on that date; decertified = previous_total + issued - current_total.
  // Issued plotted positive, decertified plotted negative for the drawdown
  // visual. `net` line = issued − decertified.
  const lifecycle = useMemo(() => {
    const snaps = robusta?.snapshots ?? [];
    const grad = robusta?.recent_activity?.gradings ?? [];
    if (snaps.length < 2) return [];
    const gradByDate = new Map<string, RobustaGradingEvent>();
    for (const g of grad) gradByDate.set(g.date, g);
    const last30 = snaps.slice(-30);
    const out: Array<{ date: string; displayDate: string; issued: number; decertified: number; net: number }> = [];
    for (let i = 1; i < last30.length; i++) {
      const cur = last30[i];
      const prev = last30[i - 1];
      const g = gradByDate.get(cur.date);
      let issuedToday = 0;
      for (const e of (g?.entries || [])) {
        if (e.tenderable !== false) issuedToday += e.lots || 0;
      }
      const stockDelta = (cur.total_lots_certified || 0) - (prev.total_lots_certified || 0);
      const decertifiedToday = Math.max(0, issuedToday - stockDelta);
      out.push({
        date: cur.date,
        displayDate: fmtShortDate(cur.date),
        issued: issuedToday,
        decertified: -decertifiedToday,
        net: issuedToday - decertifiedToday,
      });
    }
    return out;
  }, [robusta]);

  // ── Arabica system flow — per-port current state + 7-day flows ─────────
  // Uses sections.total_certified.by_origin × by_port for rich origin data.
  // Inflow / outflow per (port, origin) = positive / negative day-over-day
  // delta over the last 7 snapshot days.
  const arabicaPortFlows = useMemo<{ ports: ArabicaPortFlow[]; intake: { passed: number; failed: number; pending: number; passedPremium: number; passedBorderline: number } | null }>(() => {
    const snaps = arabica?.snapshots ?? [];
    if (snaps.length === 0) return { ports: [], intake: null };
    const latest = snaps[snaps.length - 1];
    const lookbackIdx = Math.max(0, snaps.length - 8);
    const base = snaps[lookbackIdx];

    const latestSec = latest.sections?.total_certified;
    if (!latestSec) return { ports: [], intake: null };

    // Capacity proxy: 365-day per-port max.
    const maxByPort = new Map<string, number>();
    for (const s of snaps) {
      for (const [p, v] of Object.entries(s.by_port || {})) {
        if (v > (maxByPort.get(p) ?? 0)) maxByPort.set(p, v);
      }
    }

    // Pre-bin age distribution per port from latest_detail.age_detail.
    const ageByPort: Record<string, AgeDist> = {};
    const ageDetail = arabica?.latest_detail?.age_detail ?? {};
    for (const [port, rows] of Object.entries(ageDetail)) {
      const dist: AgeDist = { fresh: 0, mid: 0, old: 0, stale: 0 };
      for (const r of rows) {
        const m = r.age_bucket?.match(/^(\d+)/);
        const days = m ? parseInt(m[1], 10) : 0;
        const bin: BeanBin = days < 180 ? "fresh" : days < 360 ? "mid" : days < 720 ? "old" : "stale";
        dist[bin] += r.bags || 0;
      }
      const sum = dist.fresh + dist.mid + dist.old + dist.stale;
      if (sum > 0) {
        ageByPort[port] = { fresh: dist.fresh / sum, mid: dist.mid / sum, old: dist.old / sum, stale: dist.stale / sum };
      }
    }

    // Walk every port in the latest snap.
    const ports: ArabicaPortFlow[] = [];
    for (const [code, current] of Object.entries(latestSec.by_port)) {
      if (current <= 0) continue;
      const byOrigin: Record<string, number> = {};
      for (const [origin, od] of Object.entries(latestSec.by_origin)) {
        const v = od.by_port?.[code] ?? 0;
        if (v > 0) byOrigin[origin] = v;
      }
      // Inflow / outflow per origin from delta.
      const baseSec = base.sections?.total_certified;
      const baseByOrigin: Record<string, number> = {};
      for (const [origin, od] of Object.entries(baseSec?.by_origin ?? {})) {
        const v = od.by_port?.[code] ?? 0;
        if (v > 0) baseByOrigin[origin] = v;
      }
      const allOrigins = new Set([...Object.keys(byOrigin), ...Object.keys(baseByOrigin)]);
      const inflow: OriginFlow[] = [];
      const outflow: OriginFlow[] = [];
      for (const origin of Array.from(allOrigins)) {
        const delta = (byOrigin[origin] ?? 0) - (baseByOrigin[origin] ?? 0);
        if (delta > 0) inflow.push({ origin, bags: delta, color: _originColor(origin) });
        else if (delta < 0) outflow.push({ origin, bags: -delta, color: _originColor(origin) });
      }
      inflow.sort((a, b) => b.bags - a.bags);
      outflow.sort((a, b) => b.bags - a.bags);

      ports.push({
        code,
        name: ARABICA_PORT_NAMES[code] ?? code,
        current,
        capacity: Math.max(maxByPort.get(code) ?? current, current),
        pctFull: ((current / Math.max(maxByPort.get(code) ?? current, current)) * 100),
        byOrigin,
        age: ageByPort[code] ?? { fresh: 1, mid: 0, old: 0, stale: 0 },
        inflow,
        outflow,
      });
    }
    ports.sort((a, b) => b.current - a.current);

    // Intake summary — latest day's passed/failed + pending.
    const passed = latest.passed_today_bags ?? 0;
    const failed = latest.failed_today_bags ?? 0;
    // Premium/borderline split: arabica has no grading-class breakdown, so
    // apportion by the Group 0/1/2 vs Group 3/4 share of the latest stock
    // (a reasonable proxy: today's grading mix tracks the standing inventory
    // mix).
    let premiumShare = 0, borderlineShare = 0;
    for (const od of Object.values(latestSec.by_origin)) {
      if (od.group === "Group 3" || od.group === "Group 4") borderlineShare += od.total;
      else premiumShare += od.total;
    }
    const grossPassedSum = premiumShare + borderlineShare || 1;
    const passedPremium    = Math.round(passed * (premiumShare    / grossPassedSum));
    const passedBorderline = Math.round(passed * (borderlineShare / grossPassedSum));
    return {
      ports,
      intake: {
        passed,
        failed,
        pending: latest.pending_grading_bags ?? 0,
        passedPremium,
        passedBorderline,
      },
    };
  }, [arabica]);

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

      {/* Grading velocity & yield */}
      <div>
        <h3 className="text-base font-bold text-slate-100 pb-2 border-b border-slate-800 mb-4">
          Grading velocity &amp; yield
          <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-2">robusta</span>
        </h3>

        <div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-amber-400">◈</span>
              <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-300">
                Grading velocity &amp; yield (pipeline × quality)
              </h4>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Last {pipelineFlow.length || 14} days. Bars = daily graded lots
              split by quality outcome. Line = total pending queue (right axis).
            </p>
            <div className="h-56 w-full">
              {pipelineFlow.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-600">
                  no gradings data
                </div>
              ) : (
                <ResponsiveContainer>
                  <ComposedChart data={pipelineFlow} margin={{ top: 4, right: 0, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="displayDate" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false}
                           tickFormatter={(v: number) => fmtNum(v)} />
                    <YAxis yAxisId="right" orientation="right" stroke="#a78bfa" fontSize={10} tickLine={false} axisLine={false}
                           tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`} />
                    <Tooltip
                      cursor={{ fill: "#1e293b" }}
                      contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", fontSize: 11 }}
                      itemStyle={{ fontSize: 11 }}
                      formatter={(v) => `${fmtNum(Number(v ?? 0))} lots`}
                    />
                    <Legend verticalAlign="top" height={28} iconType="circle"
                            wrapperStyle={{ fontSize: 10, color: "#cbd5e1" }} />
                    <Bar yAxisId="left" dataKey="passedPremium"    name="pass · premium"    stackId="a" fill="#10b981" />
                    <Bar yAxisId="left" dataKey="passedBorderline" name="pass · borderline" stackId="a" fill="#eab308" />
                    <Bar yAxisId="left" dataKey="failed"           name="failed"           stackId="a" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="pending" name="pending (right axis)"
                          stroke="#a78bfa" strokeWidth={2.4} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-3 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded text-[10px] text-amber-300">
              <strong>Read:</strong> growing yellow band = origins tendering lower-quality
              (class 3/4) crop even as the headline pass rate looks stable.
              Rising purple line = pipeline backing up, future supply pressure.
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline & issuance dynamics */}
      <div>
        <h3 className="text-base font-bold text-slate-100 pb-2 border-b border-slate-800 mb-4">
          Pipeline &amp; issuance dynamics
          <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-2">robusta</span>
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Today's pipeline — flow diagram */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-amber-400">→</span>
              <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-300">
                Latest day&apos;s certification pipeline
              </h4>
            </div>
            <p className="text-[11px] text-slate-500 mb-4">
              Lots moving through grading on{" "}
              <span className="font-mono">{todaysPipeline?.date ?? "—"}</span>. Watch the borderline share.
            </p>

            {!todaysPipeline ? (
              <div className="text-xs text-slate-600 italic">No gradings event loaded.</div>
            ) : (
              <>
                <div className="relative">
                  <div className="absolute top-8 left-8 right-8 h-px bg-slate-800 z-0" />
                  <div className="flex justify-between items-start relative z-10">
                    {/* Tendered */}
                    <div className="flex flex-col items-center w-20">
                      <div className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-600 flex items-center justify-center mb-1.5">
                        <span className="font-mono font-bold text-sm text-white">{fmtNum(todaysPipeline.tendered)}</span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Tendered</span>
                      <span className="text-[9px] text-amber-400 mt-0.5">{fmtNum(todaysPipeline.pendingQueue)} pending</span>
                    </div>

                    <span className="text-slate-600 text-xl mt-5">→</span>

                    {/* Graded */}
                    <div className="flex flex-col items-center w-20">
                      <div className="w-16 h-16 rounded-full bg-indigo-900/50 border-2 border-indigo-500 flex items-center justify-center mb-1.5"
                           style={{ boxShadow: "0 0 12px rgba(99,102,241,0.15)" }}>
                        <span className="font-mono font-bold text-sm text-indigo-200">{fmtNum(todaysPipeline.graded)}</span>
                      </div>
                      <span className="text-[10px] font-bold text-indigo-400 uppercase">Graded</span>
                    </div>

                    <span className="text-slate-600 text-xl mt-5">→</span>

                    {/* Outcomes */}
                    <div className="flex flex-col space-y-1.5 flex-1 ml-2">
                      <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/60 px-2 py-1 rounded">
                        <span className="text-[10px] text-emerald-300">✓ Premium pass</span>
                        <span className="font-mono font-bold text-sm text-emerald-300">{fmtNum(todaysPipeline.passedPremium)}</span>
                      </div>
                      <div className="flex items-center justify-between bg-amber-950/40 border border-amber-800/60 px-2 py-1 rounded">
                        <span className="text-[10px] text-amber-300">⚠ Borderline pass</span>
                        <span className="font-mono font-bold text-sm text-amber-300">{fmtNum(todaysPipeline.passedBorderline)}</span>
                      </div>
                      <div className="flex items-center justify-between bg-rose-950/40 border border-rose-800/60 px-2 py-1 rounded">
                        <span className="text-[10px] text-rose-300">✕ Failed</span>
                        <span className="font-mono font-bold text-sm text-rose-300">{fmtNum(todaysPipeline.failed)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 bg-slate-950 border border-slate-800 px-3 py-2 rounded flex items-center justify-between">
                  <div className="flex items-center text-[10px] text-slate-400">
                    <span className="mr-1.5 text-rose-500">🗑</span>
                    Decertified that day (aged-out / withdrawn — inferred)
                  </div>
                  <span className="font-mono font-bold text-sm text-rose-400">{fmtNum(todaysPipeline.decertified)} lots</span>
                </div>
              </>
            )}
          </div>

          {/* Net issuance vs decertification chart */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-amber-400">⇣</span>
              <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-300">
                Net issuance vs decertification
              </h4>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Building or bleeding the certified pool? Last {lifecycle.length || 30} days, lots-native.
            </p>
            <div className="h-56 w-full">
              {lifecycle.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-600">
                  not enough snapshots to compute lifecycle
                </div>
              ) : (
                <ResponsiveContainer>
                  <ComposedChart data={lifecycle} margin={{ top: 4, right: 0, left: -10, bottom: 0 }} stackOffset="sign">
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <ReferenceLine y={0} stroke="#64748b" />
                    <XAxis dataKey="displayDate" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} minTickGap={20} />
                    <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false}
                           tickFormatter={(v: number) => fmtNum(v)} />
                    <Tooltip
                      cursor={{ fill: "#1e293b" }}
                      contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", fontSize: 11 }}
                      formatter={(v) => `${fmtNum(Math.abs(Number(v ?? 0)))} lots`}
                    />
                    <Legend verticalAlign="top" height={28} iconType="circle"
                            wrapperStyle={{ fontSize: 10, color: "#cbd5e1" }} />
                    <Bar dataKey="issued"      name="issued (passed)"   fill="#10b981" stackId="x" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="decertified" name="decertified"       fill="#f43f5e" stackId="x" radius={[0, 0, 3, 3]} />
                    <Line type="monotone" dataKey="net" name="net flow" stroke="#eab308" strokeWidth={2.4} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-3 bg-indigo-500/10 border border-indigo-500/20 px-3 py-2 rounded text-[10px] text-indigo-300">
              <strong>Read:</strong> green bars above zero = today&apos;s passed lots entering
              the certified pool; rose below zero = lots leaving (aged-out or withdrawn).
              Yellow line = net change. Persistent net-negative weeks = bleeding inventory.
            </div>
          </div>
        </div>
      </div>

      {/* System flow — intake → storage → decertification */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes csFlowConveyor {
          0%   { left: 8px; opacity: 0; transform: translateY(-50%) scale(0.6); }
          15%  { opacity: 1; transform: translateY(-50%) scale(1); }
          75%  { opacity: 1; transform: translateY(-50%) scale(1); }
          90%  { left: calc(100% - 28px); opacity: 0; transform: translateY(-50%) scale(0.6); }
          100% { left: calc(100% - 28px); opacity: 0; }
        }
        .cs-flow-conveyor { animation: csFlowConveyor 2.4s linear infinite; }
      ` }} />

      <div>
        <h3 className="text-base font-bold text-slate-100 pb-2 border-b border-slate-800 mb-4">
          Certified stocks system flow
          <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-2">arabica · KC</span>
        </h3>

        {/* Stage 1 — intake pipeline */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 mb-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
            <span>↘</span>Stage 1 · grading intake (latest day)
          </div>
          {!arabicaPortFlows.intake ? (
            <div className="text-xs text-slate-600 italic">No intake data loaded.</div>
          ) : (
            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6">
              <div className="flex flex-col items-center">
                <div className="text-[10px] text-slate-400 font-bold uppercase mb-1.5">Pending</div>
                <div className="w-20 h-20 rounded-full bg-amber-950/40 border-2 border-amber-700/60 flex flex-col items-center justify-center">
                  <span className="text-base font-mono font-bold text-amber-300">{fmtNum(arabicaPortFlows.intake.pending)}</span>
                  <span className="text-[9px] text-amber-400/80">bags</span>
                </div>
              </div>
              <span className="hidden md:block w-6 h-px bg-slate-700" />
              <div className="flex flex-col items-center">
                <div className="text-[10px] text-slate-400 font-bold uppercase mb-1.5">Graded today</div>
                <div className="w-24 h-24 rounded-full bg-indigo-900/40 border-2 border-indigo-500 flex flex-col items-center justify-center"
                     style={{ boxShadow: "0 0 14px rgba(99,102,241,0.18)" }}>
                  <span className="text-lg font-mono font-bold text-indigo-200">{fmtNum(arabicaPortFlows.intake.passed + arabicaPortFlows.intake.failed)}</span>
                  <span className="text-[9px] text-indigo-400/80">bags</span>
                </div>
              </div>
              <span className="hidden md:block w-6 h-px bg-slate-700" />
              <div className="flex flex-col space-y-1.5 w-full md:w-auto md:min-w-[260px]">
                <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/60 px-2.5 py-1.5 rounded">
                  <span className="text-[11px] text-emerald-300 flex items-center gap-1.5">✓ Pass · premium</span>
                  <span className="font-mono font-bold text-emerald-300">{fmtNum(arabicaPortFlows.intake.passedPremium)}</span>
                </div>
                <div className="flex items-center justify-between bg-amber-950/40 border border-amber-800/60 px-2.5 py-1.5 rounded">
                  <span className="text-[11px] text-amber-300 flex items-center gap-1.5">⚠ Pass · borderline</span>
                  <span className="font-mono font-bold text-amber-300">{fmtNum(arabicaPortFlows.intake.passedBorderline)}</span>
                </div>
                <div className="flex items-center justify-between bg-rose-950/40 border border-rose-800/60 px-2.5 py-1.5 rounded">
                  <span className="text-[11px] text-rose-300 flex items-center gap-1.5">✕ Failed</span>
                  <span className="font-mono font-bold text-rose-300">{fmtNum(arabicaPortFlows.intake.failed)}</span>
                </div>
              </div>
            </div>
          )}
          <p className="text-[9px] text-slate-600 italic mt-2 text-center">
            Premium / borderline split apportioned by the Group 0–2 vs Group 3–4 share of standing inventory
            (no per-grading class data in arabica source).
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mb-3 text-[10px] bg-slate-950 px-3 py-2 rounded border border-slate-800">
          <span className="text-slate-500 uppercase">Origin (color):</span>
          {Object.entries(ORIGIN_COLORS).slice(0, 8).map(([origin, color]) => (
            <span key={origin} className="flex items-center text-slate-300">
              <span className="w-2 h-2 rounded mr-1" style={{ background: color }} />
              {origin.length > 12 ? origin.slice(0, 12) + "…" : origin}
            </span>
          ))}
          <span className="text-slate-700 mx-1">|</span>
          <span className="text-slate-500 uppercase">Age (fade):</span>
          {[
            { label: "fresh", op: 1 },
            { label: "mid",   op: 0.7 },
            { label: "old",   op: 0.4 },
            { label: "stale", op: 0.18 },
          ].map(({ label, op }) => (
            <span key={label} className="flex items-center text-slate-300">
              <span className="w-2 h-2 rounded mr-1 bg-white" style={{ opacity: op }} />
              {label}
            </span>
          ))}
        </div>

        {/* Stage 2 — per-port row */}
        <div className="space-y-3">
          {arabicaPortFlows.ports.length === 0 ? (
            <div className="text-xs text-slate-600 italic">No port flows loaded yet.</div>
          ) : arabicaPortFlows.ports.map((p) => {
            const grid = buildDensityGrid(p.current, p.byOrigin, p.age);
            const inflowSum = p.inflow.reduce((a, b) => a + b.bags, 0);
            const outflowSum = p.outflow.reduce((a, b) => a + b.bags, 0);
            return (
              <div key={p.code} className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 lg:p-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
                  {/* Inflow */}
                  <div className="lg:col-span-3">
                    <div className="text-[10px] text-emerald-400 font-bold uppercase mb-1.5 flex items-center justify-between">
                      <span>Intake (7d)</span>
                      <span className="font-mono">+{fmtNum(inflowSum)}</span>
                    </div>
                    <div className="relative h-10 bg-emerald-950/20 border border-emerald-900/40 rounded overflow-hidden">
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10 text-emerald-400 text-xs">🏭</div>
                      <div className="absolute top-1/2 left-7 right-3 h-px bg-slate-800" />
                      {p.inflow.slice(0, 4).map((b, i) => (
                        <div
                          key={i}
                          className="absolute top-1/2 w-2.5 h-2.5 rounded-sm cs-flow-conveyor"
                          style={{ background: b.color, animationDelay: `${i * 0.55}s` }}
                        />
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-[10px]">
                      {p.inflow.slice(0, 4).map((b) => (
                        <div key={b.origin} className="flex items-center justify-between bg-slate-900/60 border border-slate-800/60 px-1.5 py-0.5 rounded">
                          <span className="flex items-center text-slate-300">
                            <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: b.color }} />
                            {b.origin}
                          </span>
                          <span className="text-slate-200 font-mono">{fmtNum(b.bags)}</span>
                        </div>
                      ))}
                      {p.inflow.length === 0 && (
                        <div className="text-slate-600 italic text-[10px]">no intake last 7d</div>
                      )}
                    </div>
                  </div>

                  {/* Density grid */}
                  <div className="lg:col-span-6">
                    <div className="flex justify-between items-end mb-2">
                      <div>
                        <span className="text-base font-bold text-slate-100">{p.name}</span>
                        <span className="text-[10px] font-mono text-slate-500 ml-2 bg-slate-800/60 px-1 py-0.5 rounded">{p.code}</span>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          <span className="font-mono text-slate-300">{(p.current / 1000).toFixed(0)}k</span> / {(p.capacity / 1000).toFixed(0)}k bags
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xl font-bold ${p.pctFull > 80 ? "text-rose-400" : p.pctFull > 50 ? "text-amber-400" : "text-slate-400"}`}>
                          {Math.round(p.pctFull)}%
                        </div>
                        <div className="text-[9px] text-slate-600 uppercase">of peak</div>
                      </div>
                    </div>
                    <div
                      className="w-full grid gap-[1px] bg-slate-900/40 border border-slate-800 p-1 rounded"
                      style={{ gridTemplateColumns: `repeat(${DENSITY_COLS}, minmax(0, 1fr))` }}
                    >
                      {grid.squares.map((sq, i) => (
                        <div
                          key={i}
                          className="aspect-square rounded-[1px] transition-transform hover:scale-[1.8] hover:z-10 relative"
                          style={{ background: sq.color, opacity: sq.opacity }}
                          title={sq.status === "filled" ? `${BAGS_PER_SQUARE.toLocaleString()} bags` : "empty space"}
                        />
                      ))}
                    </div>
                    <div className="text-[9px] text-slate-600 italic mt-1">
                      Each square = {BAGS_PER_SQUARE.toLocaleString()} bags. Color = origin. Fade = age.
                    </div>
                  </div>

                  {/* Outflow */}
                  <div className="lg:col-span-3">
                    <div className="text-[10px] text-rose-400 font-bold uppercase mb-1.5 flex items-center justify-between">
                      <span>Outflow (7d)</span>
                      <span className="font-mono">−{fmtNum(outflowSum)}</span>
                    </div>
                    <div className="relative h-10 bg-rose-950/20 border border-rose-900/40 rounded overflow-hidden">
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-rose-400 text-xs">🚚</div>
                      <div className="absolute top-1/2 left-3 right-7 h-px bg-slate-800" />
                      {p.outflow.slice(0, 4).map((b, i) => (
                        <div
                          key={i}
                          className="absolute top-1/2 w-2.5 h-2.5 rounded-sm cs-flow-conveyor"
                          style={{ background: b.color, animationDelay: `${i * 0.55}s` }}
                        />
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-[10px]">
                      {p.outflow.slice(0, 4).map((b) => (
                        <div key={b.origin} className="flex items-center justify-between bg-slate-900/60 border border-slate-800/60 px-1.5 py-0.5 rounded">
                          <span className="flex items-center text-slate-300">
                            <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: b.color }} />
                            {b.origin}
                          </span>
                          <span className="text-slate-200 font-mono">{fmtNum(b.bags)}</span>
                        </div>
                      ))}
                      {p.outflow.length === 0 && (
                        <div className="text-slate-600 italic text-[10px]">no outflow last 7d</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
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
