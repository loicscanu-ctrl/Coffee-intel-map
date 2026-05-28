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

// ── Age bins ─────────────────────────────────────────────────────────────────
// Per user spec — 4 fadeness levels for stock 1y+, plus full-opacity "fresh"
// for anything under a year. Bin keys are stable so they survive cross-runs.
type AgeBin = "fresh" | "y1to2" | "y2to3" | "y3to4" | "y4plus";
interface AgeDist { fresh: number; y1to2: number; y2to3: number; y3to4: number; y4plus: number }  // shares 0..1
// Opacity floor lifted from 0.14 → 0.35 so 4y+ squares stay visibly
// colored. The earlier fade was too aggressive — rows of old stock
// were reading as "empty lines" in the grid.
const AGE_OPACITY: Record<AgeBin, number> = {
  fresh:  1.00,
  y1to2:  0.80,
  y2to3:  0.62,
  y3to4:  0.47,
  y4plus: 0.35,
};
const AGE_LABEL: Record<AgeBin, string> = {
  fresh: "< 1y", y1to2: "1-2y", y2to3: "2-3y", y3to4: "3-4y", y4plus: "4y+",
};
const AGE_BIN_ORDER: AgeBin[] = ["fresh", "y1to2", "y2to3", "y3to4", "y4plus"];

const _binByMonths = (months: number): AgeBin =>
  months < 12 ? "fresh"
  : months < 24 ? "y1to2"
  : months < 36 ? "y2to3"
  : months < 48 ? "y3to4"
  : "y4plus";
const _binByDays = (days: number): AgeBin => _binByMonths(days / 30);

// Port-name lookup for arabica port labels.
const ARABICA_PORT_NAMES: Record<string, string> = {
  ANT: "Antwerp", "HA/BR": "Hamburg/Bremen", HA: "Hamburg/Bremen", HAM: "Hamburg",
  HOU: "Houston", HO: "Houston", MIA: "Miami", MI: "Miami",
  NO: "New Orleans", NOR: "Norfolk", NY: "New York", NYK: "New York", VIR: "Virginia",
};
const ROBUSTA_PORT_NAMES: Record<string, string> = {
  AMS: "Amsterdam",
  ANT: "Antwerp",
  BAR: "Barcelona",
  BRE: "Bremen",
  FEL: "Felixstowe",
  GEN: "Genoa",
  HAM: "Hamburg",
  HUL: "Hull",
  HUM: "Humberside",
  LEH: "Le Havre",
  LIV: "Liverpool",
  LON: "London",
  NOR: "Norfolk",
  NYK: "New York",
  ROT: "Rotterdam",
  TEE: "Teesside",
  TRI: "Trieste",
};

// ── Duration window selector ────────────────────────────────────────────────
type DurationOpt = "7d" | "mtd" | "2m" | "3m" | "6m";
const DURATION_LABELS: Record<DurationOpt, string> = {
  "7d":  "Last 7 days",
  "mtd": "Month to date",
  "2m":  "Last 2 months",
  "3m":  "Last 3 months",
  "6m":  "Last 6 months",
};
function _durationCutoff(opt: DurationOpt, today: Date): Date {
  // Normalise to local midnight so date-only event timestamps (which compare
  // as 00:00:00) aren't accidentally excluded by the time-of-day component
  // on `today`. Without this, picking "Last 7 days" near the end of the
  // day cut off the boundary day's gradings event.
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (opt) {
    case "7d":  d.setDate(d.getDate() - 7); return d;
    case "mtd": return new Date(today.getFullYear(), today.getMonth(), 1);
    case "2m":  d.setMonth(d.getMonth() - 2); return d;
    case "3m":  d.setMonth(d.getMonth() - 3); return d;
    case "6m":  d.setMonth(d.getMonth() - 6); return d;
  }
}

// ── Origin colors (market-aware) ────────────────────────────────────────────
// Arabica (KC) palette is structured by ICE C-contract group, then by
// continent within Group 0:
//   • Group 0 — cold colors. Latin American → greens, Asian → blues,
//                            African → purples.
//   • Group 1 — dark green (Colombian milds).
//   • Group 2 — yellow to light orange (warm light).
//   • Group 3 — red / pink (warmer).
//   • Group 4 — dark red-brown (Brazil naturals + Vietnam KC).
//
// Robusta (RC) palette follows the user's origin spec:
//   • Vietnam     → dark blue   (primary RC origin)
//   • Indonesia   → blue
//   • Brazil      → dark red-brown
//   • African     → purple nuances (Uganda, Tanzania, Cameroon, etc.)
//   • Other Asian → cold colour nuances
//   • Other LA    → warm colour nuances
//
// Vietnam carries different roles in each market so the dicts must be
// kept separate (RC blue ≠ KC dark brown). _originColor() routes by market.

const KC_ORIGIN_COLORS: Record<string, string> = {
  // ── Group 0 — cold colours (LA green, AS blue, AF purple) ──
  "Costa Rica":        "#16a34a",   // green-600
  "El Salvador":       "#22c55e",   // green-500
  "Guatemala":         "#10b981",   // emerald-500
  "Honduras":          "#14b8a6",   // teal-500
  "Mexico":            "#84cc16",   // lime-500
  "Nicaragua":         "#15803d",   // green-700
  "Panama":            "#34d399",   // emerald-400
  "Peru":              "#4ade80",   // green-400
  "Papua New Guinea":  "#0ea5e9",   // sky-500
  "Kenya":             "#a855f7",   // purple-500
  "Tanzania":          "#9333ea",   // purple-600
  "Uganda":            "#c084fc",   // purple-400
  // ── Group 1 — dark green ──
  "Colombia":          "#14532d",   // green-900
  // ── Group 2 — yellow to light orange ──
  "Burundi":           "#facc15",   // yellow-400
  "India":             "#fb923c",   // orange-400
  "Rwanda":            "#fbbf24",   // amber-400
  "Venezuela":         "#fdba74",   // orange-300
  // ── Group 3 — red / pink ──
  "Dominican Republic": "#f43f5e",  // rose-500
  "Ecuador":           "#ec4899",   // pink-500
  // ── Group 4 — dark red-brown ──
  "Brazil":            "#7c2d12",   // red-brown-900
  "Vietnam":           "#92400e",   // amber-900-brown
};

const RC_ORIGIN_COLORS: Record<string, string> = {
  "Vietnam":                       "#1e3a8a",  // dark blue (blue-900)
  "Indonesia":                     "#3b82f6",  // blue-500
  // Brazil — dark red-brown
  "Brazil":                        "#7c2d12",
  "Brazilian Conillon":            "#7c2d12",
  // African origins — purple nuances
  "Uganda":                        "#a855f7",  // purple-500
  "Tanzania":                      "#9333ea",  // purple-600
  "Ethiopia":                      "#c084fc",  // purple-400
  "Cameroon":                      "#7e22ce",  // purple-700
  "Angola":                        "#6b21a8",  // purple-800
  "Cote dIvoire":                  "#9d4edd",
  "Cote d'Ivoire":                 "#9d4edd",
  "Ghana":                         "#a78bfa",  // violet-400
  "Guinea":                        "#8b5cf6",  // violet-500
  "Madagascar":                    "#7c3aed",  // violet-600
  "Republic of Madagascar":        "#7c3aed",
  "Sierra Leone":                  "#d8b4fe",  // purple-300
  "Togo":                          "#a855f7",
  "Nigeria":                       "#9d4edd",
  "DRC":                           "#7e22ce",
  "Congo":                         "#7e22ce",
  "Democratic Republic of Congo":  "#7e22ce",
  // Other Asian — cold (blue / cyan)
  "India":                         "#0ea5e9",  // sky-500
  "Laos":                          "#06b6d4",  // cyan-500
};
const ORIGIN_DEFAULT = "#64748b";  // slate-500 (unknown / catch-all)

function _originColor(origin: string, market: "KC" | "RC"): string {
  const dict = market === "KC" ? KC_ORIGIN_COLORS : RC_ORIGIN_COLORS;
  return dict[origin] ?? ORIGIN_DEFAULT;
}

// ── Density grid (vertical orientation, one square ≈ one warrant) ──────────
// Each square targets one ICE warrant. Tunable cap so giant ports (ANT at
// 1k+ arabica warrants, LON at 1.7k robusta lots) don't blow up the DOM —
// when a port exceeds the cap we scale uniformly across {existing, gained,
// ghost} groups and surface the effective per-square volume in the click
// popover so the visual stays honest.
// DENSITY_COLS is now per-card: `p.span * 3` (span ∈ 1-4 → cols ∈ 3-12).
const DENSITY_MAX_SQUARES = 400;
// Warrant sizing:
//   • Robusta — 1 lot = 10 MT = 1 warrant. Snapshot data is already in lots,
//     so squareUnit = 1.
//   • Arabica — 1 warrant = 37,500 lb = 17,009 kg ≈ 283.49 bags (at 60 kg/bag).
//     Snapshot data is in bags, so squareUnit = 283.49.
const BAGS_PER_WARRANT_KC = (37_500 * 0.45359237) / 60;   // ≈ 283.49
const LOTS_PER_WARRANT_RC = 1;

interface DensitySquare {
  status: "filled" | "gained" | "ghost";
  origin: string;
  color: string;
  ageBin: AgeBin;
  warrants: number;            // effective warrants this square represents
}

// Helper — distribute `count` squares across origins proportionally and
// stamp each with an age bin sampled from the age distribution.
function _allocSquares(
  count: number,
  byOrigin: Record<string, number>,
  age: AgeDist,
  status: DensitySquare["status"],
  perSquareWarrants: number,
  market: "KC" | "RC",
): DensitySquare[] {
  if (count <= 0) return [];
  const origins = Object.entries(byOrigin).filter(([, v]) => v > 0);
  const total = origins.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return [];

  const originPool: string[] = [];
  for (const [origin, v] of origins) {
    const n = Math.round(count * (v / total));
    for (let i = 0; i < n; i++) originPool.push(origin);
  }
  while (originPool.length < count) originPool.push(origins[0][0]);
  while (originPool.length > count) originPool.pop();

  const agePool: AgeBin[] = [];
  for (const bin of AGE_BIN_ORDER) {
    const n = Math.round(count * age[bin]);
    for (let i = 0; i < n; i++) agePool.push(bin);
  }
  while (agePool.length < count) agePool.push("fresh");
  while (agePool.length > count) agePool.pop();

  return originPool.map((origin, i) => ({
    status,
    origin,
    color: _originColor(origin, market),
    ageBin: agePool[i] ?? "fresh",
    warrants: perSquareWarrants,
  }));
}

// Build the three sub-grids for one port:
//   • `existing`  — what was already at the port at the window's T0
//                   (current minus the net-gained portion this window)
//   • `gained`    — newly arrived warrants over the window (any origin with
//                   positive net delta). Rendered in a green dashed box.
//   • `ghosts`    — warrants that left the port over the window (any
//                   origin with negative net delta). Red dashed box.
//
// `unit` is the per-market warrant size (bags or lots) — see
// BAGS_PER_WARRANT_KC / LOTS_PER_WARRANT_RC. We aim for one square ≈ one
// warrant. If the port's total warrants exceeds DENSITY_MAX_SQUARES we
// scale uniformly across the three groups and surface the effective
// per-square count via `effectivePerSquare` so the click popover stays
// honest.
function buildDensityGrid(
  current: number,
  byOrigin: Record<string, number>,
  age: AgeDist,
  deltaByOrigin: Record<string, number>,
  unit: number,
  market: "KC" | "RC",
): {
  existing: DensitySquare[];
  gained:   DensitySquare[];
  ghosts:   DensitySquare[];
  effectivePerSquare: number;
  totalWarrants: number;
} {
  // 1. Raw warrant counts (current state, gained, lost).
  const totalWarrants = Math.max(0, Math.ceil(current / unit));

  let gainedTotalVol = 0, lostTotalVol = 0;
  for (const d of Object.values(deltaByOrigin)) {
    if (d > 0) gainedTotalVol += d;
    if (d < 0) lostTotalVol += -d;
  }
  const gainedWarrants = Math.max(0, Math.ceil(gainedTotalVol / unit));
  const lostWarrants   = Math.max(0, Math.ceil(lostTotalVol   / unit));
  const existingWarrants = Math.max(0, totalWarrants - gainedWarrants);

  // 2. Uniform scale-down if the grand total of squares would overflow.
  const grand = existingWarrants + gainedWarrants + lostWarrants;
  const scale = grand > DENSITY_MAX_SQUARES ? DENSITY_MAX_SQUARES / grand : 1;
  const existingShown = Math.round(existingWarrants * scale);
  const gainedShown   = Math.round(gainedWarrants   * scale);
  const lostShown     = Math.round(lostWarrants     * scale);
  const effectivePerSquare = scale === 1 ? 1 : 1 / scale;

  // 3. Origin distributions for each group.
  const existingByOrigin: Record<string, number> = {};
  for (const [origin, v] of Object.entries(byOrigin)) {
    const delta = deltaByOrigin[origin] ?? 0;
    existingByOrigin[origin] = Math.max(0, v - Math.max(0, delta));
  }
  const gainedByOrigin: Record<string, number> = {};
  const ghostByOrigin: Record<string, number>  = {};
  for (const [origin, d] of Object.entries(deltaByOrigin)) {
    if (d > 0) gainedByOrigin[origin] = d;
    if (d < 0) ghostByOrigin[origin]  = -d;
  }

  // 4. Stamp squares. Existing inherits the port's actual age mix; gained
  // are by definition fresh (<1y); ghosts have no surviving age info.
  const FRESH_ONLY: AgeDist = { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
  const existing = _allocSquares(existingShown, existingByOrigin, age,        "filled", effectivePerSquare, market);
  const gained   = _allocSquares(gainedShown,   gainedByOrigin,   FRESH_ONLY, "gained", effectivePerSquare, market);
  const ghosts   = _allocSquares(lostShown,     ghostByOrigin,    FRESH_ONLY, "ghost",  effectivePerSquare, market);

  return { existing, gained, ghosts, effectivePerSquare, totalWarrants };
}

interface OriginFlow { origin: string; volume: number; color: string }
// Card-width spans (1–4 of a 12-col container). Sqrt scaling so a port at
// 5% of max capacity still gets span 1 (visible) rather than collapsing.
// Top-8 sum ≤ 12 typically; if it overflows the container grid wraps.
function _assignSpans(ports: PortFlow[]): void {
  if (ports.length === 0) return;
  const maxCap = Math.max(...ports.map((p) => p.capacity));
  for (const p of ports) {
    const r = maxCap > 0 ? Math.sqrt(p.capacity / maxCap) : 0;
    const raw = Math.round(4 * r);
    p.span = Math.max(1, Math.min(4, raw)) as 1 | 2 | 3 | 4;
  }
}

// ── Poison criteria (v2 per user spec) ─────────────────────────────────────
// Arabica: aged > 1 year OR Brazil origin.
// Robusta: Brazilian Conillon OR aged > 1 year OR port ∈ London / US
//          (LON, NYK, NEW, NOR) OR graded class ∈ {3, 4}.
const RC_DEAD_PORTS  = new Set(["LON", "NYK", "NEW", "NOR"]);
const KC_BAD_ORIGINS = new Set(["Brazil"]);
const RC_BAD_ORIGINS = new Set(["Brazilian Conillon", "Brazil"]);

interface PoisonStats {
  pct:        number;   // 0..1 — share of standing stock flagged poison
  total:      number;   // volume (bags or lots) flagged poison
  aged:       number;   // contribution of the aged>1y criterion
  badOrigin:  number;   // contribution of bad-origin (Brazil / Conillon)
  deadPort:   number;   // contribution of dead-port (RC only)
  lowClass:   number;   // contribution of class 3/4 (RC only, inferred)
}

function _computePoison(
  current: number,
  market: "KC" | "RC",
  port: string,
  byOrigin: Record<string, number>,
  age: AgeDist,
  class34ShareAtPort: number,
): PoisonStats {
  if (current <= 0) {
    return { pct: 0, total: 0, aged: 0, badOrigin: 0, deadPort: 0, lowClass: 0 };
  }
  const agedShare = age.y1to2 + age.y2to3 + age.y3to4 + age.y4plus;

  let badOriginVol = 0;
  const badSet = market === "KC" ? KC_BAD_ORIGINS : RC_BAD_ORIGINS;
  for (const [origin, v] of Object.entries(byOrigin)) {
    if (badSet.has(origin)) badOriginVol += v;
  }
  const badShare = badOriginVol / current;

  // Dead-port: robusta only. If the port itself is dead, ALL stock is poison.
  const deadShare = market === "RC" && RC_DEAD_PORTS.has(port) ? 1 : 0;

  // Class 3/4 share — robusta only, inferred from gradings history at port.
  const classShare = market === "RC" ? class34ShareAtPort : 0;

  // Combined: if the port is dead, 100% poison. Otherwise assume the three
  // criteria are roughly independent → P(any) = 1 − ∏(1 − Pᵢ).
  const pct = deadShare === 1
    ? 1
    : 1 - (1 - agedShare) * (1 - badShare) * (1 - classShare);

  return {
    pct,
    total:     pct        * current,
    aged:      agedShare  * current,
    badOrigin: badShare   * current,
    deadPort:  deadShare  * current,
    lowClass:  classShare * current,
  };
}

interface PortFlow {
  market: "KC" | "RC";
  code: string;
  name: string;
  current: number;
  capacity: number;
  pctFull: number;
  unit: "bags" | "lots";
  squareUnit: number;            // bags-per-square or lots-per-square
  byOrigin: Record<string, number>;
  age: AgeDist;
  deltaByOrigin: Record<string, number>;   // signed change over window per origin
  inflow: OriginFlow[];
  outflow: OriginFlow[];
  // Display sizing — assigned after all ports are computed. Card spans
  // 1–4 columns of a 12-col container grid based on capacity-rank (sqrt-
  // scaled so small ports don't collapse to invisible). Density grid
  // inside each card uses span × 3 columns.
  span: 1 | 2 | 3 | 4;
  // Poison stats — share + per-criterion breakdown for the card header.
  poison: PoisonStats;
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
  // System-flow controls.
  const [flowDuration, setFlowDuration] = useState<DurationOpt>("7d");
  const [pickedSquare, setPickedSquare] = useState<{
    market: "KC" | "RC"; port: string; portName: string; squareIdx: number;
    origin: string; ageBin: AgeBin; bagsOrLots: number; unit: "bags" | "lots";
    isNew: boolean; isGhost: boolean;
  } | null>(null);

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

  // ── System flow — per-port state, flows, change deltas (both markets) ────
  // Window: `flowDuration` (last 7d / MTD / 2m / 3m / 6m) drives the "base"
  // snapshot reference. Per port we compute:
  //   • current byOrigin and ageDist (KC: exact from sections; RC: inferred)
  //   • deltaByOrigin (current − T0) per origin, used for new/ghost squares
  //   • inflow / outflow lists for the side indicators
  interface SystemFlowMarket {
    market: "KC" | "RC";
    label: string;
    unit: "bags" | "lots";
    squareUnit: number;
    ports: PortFlow[];
    intake: {
      pending: number;
      passed: number;
      failed: number;
      passedPremium: number;
      passedBorderline: number;
      date: string | null;
    } | null;
  }

  const systemFlows = useMemo<{ kc: SystemFlowMarket; rc: SystemFlowMarket }>(() => {
    const today = new Date();
    const cutoff = _durationCutoff(flowDuration, today);

    // Find the snapshot closest to (but not after) `target` for the T0 baseline.
    const findSnapAt = <T extends { date: string }>(snaps: T[], target: Date): T | null => {
      if (!snaps.length) return null;
      let best: T | null = null;
      let bestDist = Infinity;
      for (const s of snaps) {
        const t = new Date(s.date).getTime();
        if (t > target.getTime()) continue;
        const dist = target.getTime() - t;
        if (dist < bestDist) { best = s; bestDist = dist; }
      }
      return best ?? snaps[0];
    };

    // ── Arabica market ─────────────────────────────────────────────────
    const buildArabica = (): SystemFlowMarket => {
      const empty: SystemFlowMarket = {
        market: "KC", label: "Arabica · ICE Futures US (KC)",
        unit: "bags", squareUnit: BAGS_PER_WARRANT_KC, ports: [], intake: null,
      };
      const snaps = arabica?.snapshots ?? [];
      if (snaps.length === 0) return empty;
      const latest = snaps[snaps.length - 1];
      const base = findSnapAt(snaps, cutoff) ?? snaps[0];
      const latestSec = latest.sections?.total_certified;
      const baseSec = base.sections?.total_certified;
      if (!latestSec) return empty;

      const maxByPort = new Map<string, number>();
      for (const s of snaps) {
        for (const [p, v] of Object.entries(s.by_port || {})) {
          if (v > (maxByPort.get(p) ?? 0)) maxByPort.set(p, v);
        }
      }

      // Age distribution per port from latest_detail.age_detail.
      const ageByPort: Record<string, AgeDist> = {};
      const ageDetail = arabica?.latest_detail?.age_detail ?? {};
      for (const [port, rows] of Object.entries(ageDetail)) {
        const dist: AgeDist = { fresh: 0, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
        for (const r of rows) {
          const m = r.age_bucket?.match(/^(\d+)/);
          const days = m ? parseInt(m[1], 10) : 0;
          dist[_binByDays(days)] += r.bags || 0;
        }
        const sum = dist.fresh + dist.y1to2 + dist.y2to3 + dist.y3to4 + dist.y4plus;
        if (sum > 0) {
          ageByPort[port] = {
            fresh:  dist.fresh  / sum, y1to2: dist.y1to2 / sum, y2to3: dist.y2to3 / sum,
            y3to4:  dist.y3to4  / sum, y4plus: dist.y4plus / sum,
          };
        }
      }

      const ports: PortFlow[] = [];
      for (const [code, current] of Object.entries(latestSec.by_port)) {
        if (current <= 0) continue;
        const byOrigin: Record<string, number> = {};
        for (const [origin, od] of Object.entries(latestSec.by_origin)) {
          const v = od.by_port?.[code] ?? 0;
          if (v > 0) byOrigin[origin] = v;
        }
        const baseByOrigin: Record<string, number> = {};
        for (const [origin, od] of Object.entries(baseSec?.by_origin ?? {})) {
          const v = od.by_port?.[code] ?? 0;
          if (v > 0) baseByOrigin[origin] = v;
        }
        const allOrigins = new Set([...Object.keys(byOrigin), ...Object.keys(baseByOrigin)]);
        const deltaByOrigin: Record<string, number> = {};
        const inflow: OriginFlow[] = [];
        const outflow: OriginFlow[] = [];
        for (const origin of Array.from(allOrigins)) {
          const d = (byOrigin[origin] ?? 0) - (baseByOrigin[origin] ?? 0);
          deltaByOrigin[origin] = d;
          if (d > 0) inflow.push({ origin, volume: d, color: _originColor(origin, "KC") });
          else if (d < 0) outflow.push({ origin, volume: -d, color: _originColor(origin, "KC") });
        }
        inflow.sort((a, b) => b.volume - a.volume);
        outflow.sort((a, b) => b.volume - a.volume);
        const cap = Math.max(maxByPort.get(code) ?? current, current);
        const ageFinal = ageByPort[code] ?? { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
        const poison = _computePoison(current, "KC", code, byOrigin, ageFinal, 0);
        ports.push({
          market: "KC", code, name: ARABICA_PORT_NAMES[code] ?? code,
          current, capacity: cap, pctFull: cap > 0 ? (current / cap) * 100 : 0,
          unit: "bags", squareUnit: BAGS_PER_WARRANT_KC,
          byOrigin, age: ageFinal,
          deltaByOrigin, inflow, outflow, span: 1, poison,
        });
      }
      ports.sort((a, b) => b.current - a.current);
      _assignSpans(ports);

      // Intake summary — SUM over the window (so it aligns with the
      // per-warehouse inflow numbers below). Pending stays point-in-time
      // (it's a standing queue, not a flow).
      const cutTime = cutoff.getTime();
      let passed = 0, failed = 0;
      for (const s of snaps) {
        if (new Date(s.date).getTime() < cutTime) continue;
        passed += s.passed_today_bags ?? 0;
        failed += s.failed_today_bags ?? 0;
      }
      let premiumShare = 0, borderlineShare = 0;
      for (const od of Object.values(latestSec.by_origin)) {
        if (od.group === "Group 3" || od.group === "Group 4") borderlineShare += od.total;
        else premiumShare += od.total;
      }
      const sum = premiumShare + borderlineShare || 1;
      const passedPremium    = Math.round(passed * (premiumShare    / sum));
      const passedBorderline = Math.round(passed * (borderlineShare / sum));
      return {
        market: "KC", label: "Arabica · ICE Futures US (KC)",
        unit: "bags", squareUnit: BAGS_PER_WARRANT_KC, ports,
        intake: { pending: latest.pending_grading_bags ?? 0, passed, failed, passedPremium, passedBorderline, date: latest.date },
      };
    };

    // ── Robusta market ──────────────────────────────────────────────────
    // No standing by_origin per port in the source — inferred from gradings
    // flow proportions (per port, full history). Mark every robusta panel
    // with the inferred caveat.
    const buildRobusta = (): SystemFlowMarket => {
      const empty: SystemFlowMarket = {
        market: "RC", label: "Robusta · ICE Futures Europe (RC)",
        unit: "lots", squareUnit: LOTS_PER_WARRANT_RC, ports: [], intake: null,
      };
      const snaps = robusta?.snapshots ?? [];
      const grads = robusta?.recent_activity?.gradings ?? [];
      const overv = robusta?.recent_activity?.grading_overview ?? [];
      if (snaps.length === 0) return empty;
      const latest = snaps[snaps.length - 1];
      const base = findSnapAt(snaps, cutoff) ?? snaps[0];

      // Origin proportion per port — from ALL gradings, tenderable only.
      const portOriginLots: Record<string, Record<string, number>> = {};
      for (const ev of grads) {
        for (const e of (ev.entries || [])) {
          if (e.tenderable === false) continue;
          const port = e.port || "?";
          const origin = e.origin?.trim() || "?";
          portOriginLots[port] = portOriginLots[port] ?? {};
          portOriginLots[port][origin] = (portOriginLots[port][origin] ?? 0) + (e.lots ?? 0);
        }
      }

      // Per-port inflow over the window (real gradings events in window).
      const portInflowOrigin: Record<string, Record<string, number>> = {};
      const cutTime = cutoff.getTime();
      for (const ev of grads) {
        if (new Date(ev.date).getTime() < cutTime) continue;
        for (const e of (ev.entries || [])) {
          if (e.tenderable === false) continue;
          const port = e.port || "?";
          const origin = e.origin?.trim() || "?";
          portInflowOrigin[port] = portInflowOrigin[port] ?? {};
          portInflowOrigin[port][origin] = (portInflowOrigin[port][origin] ?? 0) + (e.lots ?? 0);
        }
      }

      // Age distribution per port from the latest age_allowance month.
      const ageByPort: Record<string, AgeDist> = {};
      const ageMonths = robusta?.monthly?.age_allowance ?? [];
      const latestAge = ageMonths.reduce<RobustaAgeMonth | null>((acc, m) =>
        !acc || new Date(m.month_end) > new Date(acc.month_end) ? m : acc, null);
      const buckets = latestAge?.valid?.buckets ?? [];
      for (const b of buckets) {
        const bin = _binByMonths(b.months_since_graded);
        for (const [port, mt] of Object.entries(b.by_port || {})) {
          ageByPort[port] = ageByPort[port] ?? { fresh: 0, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
          ageByPort[port][bin] += Number(mt) || 0;
        }
      }
      for (const port of Object.keys(ageByPort)) {
        const a = ageByPort[port];
        const sum = a.fresh + a.y1to2 + a.y2to3 + a.y3to4 + a.y4plus;
        if (sum > 0) {
          a.fresh /= sum; a.y1to2 /= sum; a.y2to3 /= sum; a.y3to4 /= sum; a.y4plus /= sum;
        }
      }

      const maxByPort = new Map<string, number>();
      for (const s of snaps) {
        for (const [p, v] of Object.entries(s.by_port_lots || {})) {
          if (v > (maxByPort.get(p) ?? 0)) maxByPort.set(p, v);
        }
      }

      const ports: PortFlow[] = [];
      for (const [code, current] of Object.entries(latest.by_port_lots || {})) {
        if (current <= 0) continue;
        // byOrigin = current × normalised origin share for this port (inferred).
        const oTotals = portOriginLots[code] ?? {};
        const oSum = Object.values(oTotals).reduce((a, b) => a + b, 0);
        const byOrigin: Record<string, number> = {};
        if (oSum > 0) {
          for (const [origin, v] of Object.entries(oTotals)) {
            byOrigin[origin] = (v / oSum) * current;
          }
        } else {
          byOrigin["Unknown"] = current;
        }
        // Inflow per origin (real lots from gradings in window).
        const inflowByOrigin = portInflowOrigin[code] ?? {};
        // Outflow per origin: apportion the port's net stock-out by current
        // origin mix. (No per-origin outflow source for robusta.)
        const basePort = base.by_port_lots?.[code] ?? 0;
        const netDelta = current - basePort;
        const inflowSum = Object.values(inflowByOrigin).reduce((a, b) => a + b, 0);
        const totalOutflow = Math.max(0, inflowSum - netDelta);
        const outflowByOrigin: Record<string, number> = {};
        if (totalOutflow > 0 && oSum > 0) {
          for (const [origin, v] of Object.entries(oTotals)) {
            outflowByOrigin[origin] = (v / oSum) * totalOutflow;
          }
        }
        const allOrigins = new Set([...Object.keys(inflowByOrigin), ...Object.keys(outflowByOrigin)]);
        const deltaByOrigin: Record<string, number> = {};
        const inflow: OriginFlow[] = [];
        const outflow: OriginFlow[] = [];
        for (const origin of Array.from(allOrigins)) {
          const i = inflowByOrigin[origin] ?? 0;
          const o = outflowByOrigin[origin] ?? 0;
          deltaByOrigin[origin] = i - o;
          if (i > 0)  inflow.push({ origin, volume: i, color: _originColor(origin, "RC") });
          if (o > 0)  outflow.push({ origin, volume: o, color: _originColor(origin, "RC") });
        }
        inflow.sort((a, b) => b.volume - a.volume);
        outflow.sort((a, b) => b.volume - a.volume);
        // Class 3/4 share at this port from the FULL gradings history
        // (standing stock has no class field; this is the best inference).
        let portTotalLots = 0, portClass34Lots = 0;
        for (const ev of grads) {
          for (const e of (ev.entries || [])) {
            if (e.tenderable === false) continue;
            if (e.port !== code) continue;
            const lots = e.lots || 0;
            portTotalLots += lots;
            if (e.class === 3 || e.class === 4) portClass34Lots += lots;
          }
        }
        const class34Share = portTotalLots > 0 ? portClass34Lots / portTotalLots : 0;
        const cap = Math.max(maxByPort.get(code) ?? current, current);
        const ageFinal = ageByPort[code] ?? { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
        const poison = _computePoison(current, "RC", code, byOrigin, ageFinal, class34Share);
        ports.push({
          market: "RC", code, name: ROBUSTA_PORT_NAMES[code] ?? code,
          current, capacity: cap, pctFull: cap > 0 ? (current / cap) * 100 : 0,
          unit: "lots", squareUnit: LOTS_PER_WARRANT_RC,
          byOrigin, age: ageFinal,
          deltaByOrigin, inflow, outflow, span: 1, poison,
        });
      }
      ports.sort((a, b) => b.current - a.current);
      _assignSpans(ports);

      // Intake summary — SUM all gradings entries in the window. Aligns
      // with the per-warehouse inflow numbers below (which also sum lots
      // from the same gradings events). Pending stays point-in-time from
      // the most recent grading_overview report.
      const cutTimeR = cutoff.getTime();
      let pPrem = 0, pBord = 0, fail = 0;
      for (const g of grads) {
        if (new Date(g.date).getTime() < cutTimeR) continue;
        for (const e of (g.entries || [])) {
          const lots = e.lots || 0;
          if (e.tenderable === false) { fail += lots; continue; }
          if (e.class === 3 || e.class === 4) pBord += lots;
          else pPrem += lots;
        }
      }
      // Pending from the most recent grading_overview report (point-in-time
      // queue + forecast — not a flow).
      const lastOverv = overv.length ? overv[overv.length - 1] : null;
      const pendingTotal = lastOverv?.total_pending_lots ?? 0;
      // Date label = latest event in window so the user knows the period end.
      const inWinGrad = grads.filter((g) => new Date(g.date).getTime() >= cutTimeR);
      const dateLabel = inWinGrad.length ? inWinGrad[inWinGrad.length - 1].date : (grads[grads.length - 1]?.date ?? null);
      return {
        market: "RC", label: "Robusta · ICE Futures Europe (RC)",
        unit: "lots", squareUnit: LOTS_PER_WARRANT_RC, ports,
        intake: { pending: pendingTotal, passed: pPrem + pBord, failed: fail,
                  passedPremium: pPrem, passedBorderline: pBord, date: dateLabel },
      };
    };

    return { kc: buildArabica(), rc: buildRobusta() };
  }, [arabica, robusta, flowDuration]);

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

      {/* Net issuance vs decertification — 30-day lifecycle */}
      <div>
        <h3 className="text-base font-bold text-slate-100 pb-2 border-b border-slate-800 mb-4">
          Lifecycle · net issuance vs decertification
          <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-2">robusta</span>
        </h3>
        <div>


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

      {/* ───────────────────────────────────────────────────────────────────
          Certified stocks system flow — intake → storage → outflow
          Vertical workflow per market (arabica + robusta), with origin-coded
          density grids, click-to-inspect squares, duration selector and
          gained / lost change markers.
         ─────────────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-baseline justify-between pb-2 border-b border-slate-800 mb-4 gap-2 flex-wrap">
          <h3 className="text-base font-bold text-slate-100">
            Certified stocks system flow
            <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-2">arabica + robusta</span>
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Flow window</span>
            <select
              value={flowDuration}
              onChange={(e) => setFlowDuration(e.target.value as DurationOpt)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs px-2 py-1 rounded font-mono focus:outline-none focus:border-amber-500"
            >
              {(Object.entries(DURATION_LABELS) as [DurationOpt, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Shared legend — colour scheme summary + age + change groups */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 text-[10px] bg-slate-950 px-3 py-2 rounded border border-slate-800">
          <details className="cursor-pointer">
            <summary className="text-slate-500 uppercase tracking-wider hover:text-slate-300">
              Origin scheme · click to expand
            </summary>
            <div className="mt-2 space-y-2 max-w-3xl">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-amber-400 font-bold mb-1">Arabica (KC) — by C-contract group</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {[
                    { label: "G0 · LA",  example: "Honduras",        color: KC_ORIGIN_COLORS["Honduras"] },
                    { label: "G0 · AS",  example: "Papua New Guinea",color: KC_ORIGIN_COLORS["Papua New Guinea"] },
                    { label: "G0 · AF",  example: "Kenya",           color: KC_ORIGIN_COLORS["Kenya"] },
                    { label: "G1",       example: "Colombia",        color: KC_ORIGIN_COLORS["Colombia"] },
                    { label: "G2",       example: "Burundi",         color: KC_ORIGIN_COLORS["Burundi"] },
                    { label: "G3",       example: "Ecuador",         color: KC_ORIGIN_COLORS["Ecuador"] },
                    { label: "G4",       example: "Brazil",          color: KC_ORIGIN_COLORS["Brazil"] },
                  ].map((g) => (
                    <span key={g.label} className="flex items-center text-slate-300">
                      <span className="w-2.5 h-2.5 rounded mr-1" style={{ background: g.color }} />
                      <span className="font-mono text-slate-400 mr-1">{g.label}</span>{g.example}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold mb-1">Robusta (RC) — by region</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {[
                    { label: "Vietnam",   color: RC_ORIGIN_COLORS["Vietnam"] },
                    { label: "Indonesia", color: RC_ORIGIN_COLORS["Indonesia"] },
                    { label: "Brazil",    color: RC_ORIGIN_COLORS["Brazil"] },
                    { label: "African",   color: RC_ORIGIN_COLORS["Uganda"] },
                    { label: "Other AS",  color: RC_ORIGIN_COLORS["India"] },
                  ].map((g) => (
                    <span key={g.label} className="flex items-center text-slate-300">
                      <span className="w-2.5 h-2.5 rounded mr-1" style={{ background: g.color }} />
                      {g.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </details>
          <span className="text-slate-700 mx-1">|</span>
          <span className="text-slate-500 uppercase">Age (fade):</span>
          {AGE_BIN_ORDER.map((bin) => (
            <span key={bin} className="flex items-center text-slate-300">
              <span className="w-2 h-2 rounded mr-1 bg-white" style={{ opacity: AGE_OPACITY[bin] }} />
              {AGE_LABEL[bin]}
            </span>
          ))}
          <span className="text-slate-700 mx-1">|</span>
          <span className="text-slate-500 uppercase">Change:</span>
          <span className="flex items-center text-slate-300">
            <span className="w-3 h-3 rounded mr-1 border border-dashed border-emerald-400 bg-emerald-950/50" />
            gained box
          </span>
          <span className="flex items-center text-slate-300">
            <span className="w-3 h-3 rounded mr-1 border border-dashed border-rose-400 bg-rose-950/50" />
            lost box
          </span>
          <span className="text-slate-700 mx-1">|</span>
          <span className="text-slate-500 uppercase">1 ◻ =</span>
          <span className="flex items-center text-slate-300">1 warrant (KC: 37,500 lb · RC: 10 MT)</span>
        </div>

        {([systemFlows.kc, systemFlows.rc] as SystemFlowMarket[]).map((mkt) => (
          <div key={mkt.market} className="mb-8">
            <div className={`text-xs uppercase tracking-wider font-bold mb-3 ${mkt.market === "KC" ? "text-amber-400" : "text-emerald-400"}`}>
              {mkt.label}
              {mkt.market === "RC" && (
                <span className="ml-2 text-[10px] text-slate-500 normal-case font-normal">
                  origin per port inferred from gradings flow*
                </span>
              )}
            </div>

            {/* Stage 1 — intake row */}
            {!mkt.intake ? (
              <div className="text-xs text-slate-600 italic mb-3">No intake data loaded.</div>
            ) : (
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 mb-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                  <span>⊕</span>Stage 1 · grading intake
                  {mkt.intake.date && <span className="font-mono normal-case text-slate-600 ml-1">{mkt.intake.date}</span>}
                </div>
                <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-5">
                  <div className="flex flex-col items-center">
                    <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Pending</div>
                    <div className="w-16 h-16 rounded-full bg-amber-950/40 border-2 border-amber-700/60 flex items-center justify-center">
                      <span className="text-sm font-mono font-bold text-amber-300">{fmtNum(mkt.intake.pending)}</span>
                    </div>
                  </div>
                  <span className="hidden md:block w-6 h-px bg-slate-700" />
                  <div className="flex flex-col items-center">
                    <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Graded</div>
                    <div className="w-20 h-20 rounded-full bg-indigo-900/40 border-2 border-indigo-500 flex items-center justify-center"
                         style={{ boxShadow: "0 0 12px rgba(99,102,241,0.18)" }}>
                      <span className="text-base font-mono font-bold text-indigo-200">{fmtNum(mkt.intake.passed + mkt.intake.failed)}</span>
                    </div>
                  </div>
                  <span className="hidden md:block w-6 h-px bg-slate-700" />
                  <div className="flex flex-col gap-1 w-full md:w-auto md:min-w-[220px]">
                    <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/60 px-2 py-1 rounded">
                      <span className="text-[10px] text-emerald-300">✓ Premium</span>
                      <span className="font-mono font-bold text-sm text-emerald-300">{fmtNum(mkt.intake.passedPremium)}</span>
                    </div>
                    <div className="flex items-center justify-between bg-amber-950/40 border border-amber-800/60 px-2 py-1 rounded">
                      <span className="text-[10px] text-amber-300">⚠ Borderline</span>
                      <span className="font-mono font-bold text-sm text-amber-300">{fmtNum(mkt.intake.passedBorderline)}</span>
                    </div>
                    <div className="flex items-center justify-between bg-rose-950/40 border border-rose-800/60 px-2 py-1 rounded">
                      <span className="text-[10px] text-rose-300">✕ Failed</span>
                      <span className="font-mono font-bold text-sm text-rose-300">{fmtNum(mkt.intake.failed)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Branch connector — arrows only where the window saw inflow.
                Trunk anchors to the centroid of the active warehouses so
                packed-left layouts (Robusta) don't leave the trunk floating
                disconnected at x=50. */}
            {mkt.ports.length > 0 && (() => {
              const visible = mkt.ports.slice(0, 8);
              // Each card's centre x (% of viewBox width) in a 12-col grid.
              const totalCols = 12;
              let cursor = 0;
              const centres = visible.map((p) => {
                const c = (cursor + p.span / 2) * (100 / totalCols);
                cursor += p.span;
                return c;
              });
              const arrowXs = visible
                .map((p, i) => ({ p, x: centres[i] }))
                .filter(({ p }) => p.inflow.reduce((s, b) => s + b.volume, 0) > 0)
                .map(({ x }) => x);
              if (arrowXs.length === 0) return null;
              // Manifold extends to include the intake trunk (x=50) so the
              // vertical drop always reaches the horizontal connector.
              const leftX  = Math.min(...arrowXs, 50);
              const rightX = Math.max(...arrowXs, 50);
              return (
                <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="w-full h-10 my-1" aria-hidden>
                  <line x1="50" y1="0" x2="50" y2="5" stroke="#10b981" strokeWidth="0.4" strokeOpacity="0.7" />
                  {leftX !== rightX && (
                    <line x1={leftX} y1="5" x2={rightX} y2="5"
                          stroke="#10b981" strokeWidth="0.4" strokeOpacity="0.7" />
                  )}
                  {arrowXs.map((x, i) => (
                    <g key={i}>
                      <line x1={x} y1="5" x2={x} y2="14" stroke="#10b981" strokeWidth="0.4" strokeOpacity="0.7" />
                      <polygon points={`${x - 0.9},14 ${x + 0.9},14 ${x},15.5`} fill="#10b981" fillOpacity="0.85" />
                    </g>
                  ))}
                </svg>
              );
            })()}

            {/* Per-port warehouse grid — compact vertical cards, up to 6 per row */}
            {mkt.ports.length === 0 ? (
              <div className="text-xs text-slate-600 italic">No port data loaded.</div>
            ) : (
              <div className="flex items-start gap-1.5 w-full">
                {mkt.ports.slice(0, 8).map((p) => {
                  const { existing, gained, ghosts, effectivePerSquare, totalWarrants } =
                    buildDensityGrid(p.current, p.byOrigin, p.age, p.deltaByOrigin, p.squareUnit, p.market);
                  const inflowSum  = p.inflow.reduce((a, b) => a + b.volume, 0);
                  const outflowSum = p.outflow.reduce((a, b) => a + b.volume, 0);
                  const topInflow  = p.inflow.slice(0, 2);
                  const topOutflow = p.outflow.slice(0, 2);
                  // Label that explains the per-square scale. If
                  // effectivePerSquare > 1 the port exceeded the cap and
                  // each square is now ≈N warrants instead of 1 exactly.
                  const sqLabel = effectivePerSquare === 1
                    ? "1 ◻ = 1 warrant"
                    : `1 ◻ ≈ ${effectivePerSquare.toFixed(1)} warrants`;
                  const buildPick = (sq: DensitySquare, idx: number, isNew: boolean, isGhost: boolean) => ({
                    market: p.market, port: p.code, portName: p.name, squareIdx: idx,
                    origin: sq.origin, ageBin: sq.ageBin,
                    bagsOrLots: sq.warrants * p.squareUnit,
                    unit: p.unit, isNew, isGhost,
                  });
                  return (
                    <div key={`${p.market}-${p.code}`}
                         className="bg-slate-950/60 border border-slate-800 rounded-md p-1.5 flex flex-col"
                         style={{ flex: `${p.span} 1 0`, minWidth: 0 }}>
                      {/* Header */}
                      <div className="flex justify-between items-baseline mb-1">
                        <div>
                          <div className="text-[11px] font-bold text-slate-100 leading-tight">{p.name}</div>
                          <div className="text-[9px] font-mono text-slate-500">{p.code}</div>
                        </div>
                        <div className={`text-xs font-bold ${p.pctFull > 80 ? "text-rose-400" : p.pctFull > 50 ? "text-amber-400" : "text-slate-400"}`}>
                          {Math.round(p.pctFull)}%
                        </div>
                      </div>
                      <div className="text-[9px] text-slate-500 mb-1 font-mono leading-tight">
                        <span className="text-slate-300">{fmtNum(p.current)}</span>/{fmtNum(p.capacity)} {p.unit}
                      </div>

                      {/* Poison breakdown — % + per-criterion contribution. */}
                      {p.poison.pct > 0 && (
                        <div className="bg-rose-950/30 border border-rose-900/50 rounded px-1 py-0.5 mb-1 text-[9px]">
                          <div className="flex items-center justify-between text-rose-300 font-bold">
                            <span>☣ poison</span>
                            <span className="font-mono">
                              {Math.round(p.poison.pct * 100)}% · {fmtNum(p.poison.total)}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-1.5 gap-y-0 text-rose-300/80 text-[8.5px]">
                            {p.poison.deadPort > 0 && (
                              <span title="London / US warehouse">
                                dead-port {Math.round((p.poison.deadPort / p.current) * 100)}%
                              </span>
                            )}
                            {p.poison.badOrigin > 0 && (
                              <span title={p.market === "KC" ? "Brazil" : "Brazilian Conillon"}>
                                {p.market === "KC" ? "Brazil" : "Conillon"}{" "}
                                {Math.round((p.poison.badOrigin / p.current) * 100)}%
                              </span>
                            )}
                            {p.poison.aged > 0 && (
                              <span title="stock graded over 1 year ago">
                                aged {Math.round((p.poison.aged / p.current) * 100)}%
                              </span>
                            )}
                            {p.poison.lowClass > 0 && (
                              <span title="inferred from gradings history at this port">
                                class3/4 {Math.round((p.poison.lowClass / p.current) * 100)}%*
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Inflow indicator (compact) */}
                      <div className="bg-emerald-950/20 border border-emerald-900/50 rounded px-1 py-0.5 mb-1 text-[9px]">
                        <div className="flex items-center justify-between text-emerald-400 font-bold">
                          <span>↓ in</span>
                          <span className="font-mono">+{fmtNum(inflowSum)}</span>
                        </div>
                        {topInflow.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5">
                            {topInflow.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300 text-[8.5px]">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin.slice(0, 6)}:{fmtNum(b.volume)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Density grid — existing portion (T0 state still on hand) */}
                      <div
                        className="grid gap-[1px] bg-slate-900/50 border border-slate-800 p-1 rounded"
                        style={{ gridTemplateColumns: "repeat(auto-fill, 13px)" }}
                      >
                        {existing.map((sq, i) => {
                          const isPicked = pickedSquare?.market === p.market
                                        && pickedSquare?.port === p.code
                                        && pickedSquare?.squareIdx === i;
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setPickedSquare(isPicked ? null : buildPick(sq, i, false, false))}
                              className={`aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10 ${isPicked ? "scale-150 z-20 ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-950" : ""}`}
                              style={{ background: sq.color, opacity: AGE_OPACITY[sq.ageBin] }}
                              aria-label={`${p.name} square ${i}`}
                            />
                          );
                        })}
                      </div>

                      {/* Gained group — new warrants this window, ONE green dashed border around the lot */}
                      {gained.length > 0 && (
                        <div className="mt-1 border border-dashed border-emerald-400/70 rounded p-1 bg-emerald-950/10">
                          <div className="flex justify-between items-baseline mb-0.5">
                            <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-bold">Gained</span>
                            <span className="text-[8px] font-mono text-emerald-400">+{fmtNum(Math.round(gained.length * effectivePerSquare * p.squareUnit))}</span>
                          </div>
                          <div
                            className="grid gap-[1px]"
                            style={{ gridTemplateColumns: "repeat(auto-fill, 13px)" }}
                          >
                            {gained.map((sq, i) => {
                              const idx = existing.length + i;
                              const isPicked = pickedSquare?.market === p.market
                                            && pickedSquare?.port === p.code
                                            && pickedSquare?.squareIdx === idx;
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setPickedSquare(isPicked ? null : buildPick(sq, idx, true, false))}
                                  className={`aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10 ${isPicked ? "scale-150 z-20 ring-2 ring-amber-400" : ""}`}
                                  style={{ background: sq.color, opacity: AGE_OPACITY[sq.ageBin] }}
                                  aria-label={`${p.name} gained ${i}`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Ghost group — lost over window, ONE red dashed border around the lot */}
                      {ghosts.length > 0 && (
                        <div className="mt-1 border border-dashed border-rose-400/70 rounded p-1 bg-rose-950/10">
                          <div className="flex justify-between items-baseline mb-0.5">
                            <span className="text-[8px] uppercase tracking-wider text-rose-400 font-bold">Lost</span>
                            <span className="text-[8px] font-mono text-rose-400">−{fmtNum(Math.round(ghosts.length * effectivePerSquare * p.squareUnit))}</span>
                          </div>
                          <div
                            className="grid gap-[1px]"
                            style={{ gridTemplateColumns: "repeat(auto-fill, 13px)" }}
                          >
                            {ghosts.map((sq, i) => {
                              const idx = existing.length + gained.length + i;
                              const isPicked = pickedSquare?.market === p.market
                                            && pickedSquare?.port === p.code
                                            && pickedSquare?.squareIdx === idx;
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setPickedSquare(isPicked ? null : buildPick(sq, idx, false, true))}
                                  className={`aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10 ${isPicked ? "scale-150 z-20 ring-2 ring-amber-400" : ""}`}
                                  style={{ background: sq.color, opacity: 0.4 }}
                                  aria-label={`${p.name} lost ${i}`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="text-[8.5px] text-slate-600 mt-1 flex justify-between">
                        <span>{sqLabel}</span>
                        <span>{fmtNum(totalWarrants)} warrants</span>
                      </div>

                      {/* Outflow indicator (compact) */}
                      <div className="bg-rose-950/20 border border-rose-900/50 rounded px-1 py-0.5 mt-1 text-[9px]">
                        <div className="flex items-center justify-between text-rose-400 font-bold">
                          <span>↓ out</span>
                          <span className="font-mono">−{fmtNum(outflowSum)}</span>
                        </div>
                        {topOutflow.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5">
                            {topOutflow.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300 text-[8.5px]">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin.slice(0, 6)}:{fmtNum(b.volume)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {/* Click-popover for inspected square */}
        {pickedSquare && (
          <div
            role="dialog"
            aria-label="square details"
            className="fixed bottom-6 right-6 z-50 max-w-xs bg-slate-900 border border-amber-500/60 rounded-lg shadow-2xl px-4 py-3 text-xs"
            style={{ boxShadow: "0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.2)" }}
          >
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">Square detail</span>
              <button
                type="button"
                onClick={() => setPickedSquare(null)}
                className="text-slate-500 hover:text-slate-200 text-lg leading-none"
                aria-label="close"
              >×</button>
            </div>
            <div className="space-y-1.5 font-mono">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Port</span>
                <span className="text-slate-200">{pickedSquare.portName} ({pickedSquare.port})</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Origin</span>
                <span className="flex items-center text-slate-200">
                  <span className="w-2 h-2 rounded mr-1.5" style={{ background: _originColor(pickedSquare.origin, pickedSquare.market) }} />
                  {pickedSquare.origin}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Age band</span>
                <span className="flex items-center text-slate-200">
                  <span className="w-2 h-2 rounded mr-1.5 bg-white" style={{ opacity: AGE_OPACITY[pickedSquare.ageBin] }} />
                  {AGE_LABEL[pickedSquare.ageBin]}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Represents</span>
                <span className="text-slate-200">
                  {pickedSquare.market === "RC"
                    ? `${fmtNum(pickedSquare.bagsOrLots)} lot${pickedSquare.bagsOrLots !== 1 ? "s" : ""} (${fmtNum(pickedSquare.bagsOrLots * 10)} MT)`
                    : `${fmtNum(pickedSquare.bagsOrLots)} bags (${(pickedSquare.bagsOrLots / BAGS_PER_WARRANT_KC).toFixed(2)} warrants)`}
                </span>
              </div>
              {(pickedSquare.isNew || pickedSquare.isGhost) && (
                <div className="flex justify-between gap-3 pt-1 border-t border-slate-800 mt-1">
                  <span className="text-slate-500">Change</span>
                  <span className={pickedSquare.isGhost ? "text-rose-400" : "text-emerald-400"}>
                    {pickedSquare.isGhost ? "lost over window" : "gained over window"}
                  </span>
                </div>
              )}
              <div className="text-[10px] text-slate-600 italic mt-2 pt-1 border-t border-slate-800">
                Origin × age combined visually from per-port distributions
                (not per-bag tracked).
              </div>
            </div>
          </div>
        )}
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
