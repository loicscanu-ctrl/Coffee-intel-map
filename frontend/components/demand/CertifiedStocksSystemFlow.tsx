"use client";
/**
 * Certified Stocks System Flow — production component
 *
 * Renders two end-to-end workflows (Arabica + Robusta):
 *   Grading intake → branched arrows → per-warehouse density grids
 *   → gained/ghost change boxes → outflow indicators.
 *
 * Originally prototyped in CertifiedStocksTestPanel; promoted here once the
 * layout, poison-rule logic, and full-history origin inference were
 * verified. Consumes the same JSON shape the panel already loads — pass
 * arabica + robusta JSON in as props.
 */
import { useMemo, useState } from "react";

// ── Local data shapes (a subset of the rich panel types) ─────────────────────

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
export interface ArabicaJsonShape {
  snapshots: ArabicaSnap[];
  as_of?: string | null;
  latest_detail?: { age_detail?: Record<string, ArabicaAgeBucketRow[]>; age_detail_date?: string | null } | null;
}

interface RobustaAgeBucket { months_since_graded: number; by_port: Record<string, number>; grand_total_mt: number }
interface RobustaAgeMonth  { month_end: string; valid?: { ports?: string[]; buckets?: RobustaAgeBucket[] } | null }
interface RobustaGradingEntry { port?: string; origin?: string; class?: number | null; tenderable?: boolean; lots: number }
interface RobustaGradingEvent { date: string; entries?: RobustaGradingEntry[] }
interface RobustaOverviewEvent { date: string; total_pending_lots?: number | null; queue_lots?: number | null; forecast_lots?: number | null }
export interface RobustaJsonShape {
  snapshots: RobustaSnap[];
  as_of?: string | null;
  monthly?: { age_allowance?: RobustaAgeMonth[] };
  recent_activity?: { gradings?: RobustaGradingEvent[]; grading_overview?: RobustaOverviewEvent[] };
  port_origin_history?: Record<string, Record<string, { tenderable: number; class34: number }>>;
}

// ── Format helpers ───────────────────────────────────────────────────────────

const fmtNum = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";

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
// HARD RULE — never compromise: 1 square = exactly 1 ICE warrant.
//   • Robusta: 1 warrant = 1 lot = 10 MT.
//   • Arabica: 1 warrant = 37,500 lb = 17.009 MT ≈ 283.49 bags @ 60 kg.
// The cap that used to scale down giant ports has been raised to a value
// large enough that we never hit it in practice (max historical robusta
// peak ≈ 12k lots). Cards grow as tall as the data demands — the user
// chose accuracy over compactness.
const DENSITY_MAX_SQUARES = 20000;
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
  // Safety scale only triggers if a port somehow exceeds the (deliberately
  // huge) cap — in practice scale stays at 1 so each square is exactly
  // 1 warrant. Avoids referencing the now-unused `market` arg directly.
  void market;
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


// ── systemFlows memo body (lifted from test panel) ──


// ── Component body ─────────────────────────────────────────────────────────

interface Props {
  arabica: ArabicaJsonShape | null;
  robusta: RobustaJsonShape | null;
}

export default function CertifiedStocksSystemFlow({ arabica, robusta }: Props) {
  const [flowDuration, setFlowDuration] = useState<DurationOpt>("7d");
  const [pickedSquare, setPickedSquare] = useState<{
    market: "KC" | "RC"; port: string; portName: string; squareIdx: number;
    origin: string; ageBin: AgeBin; bagsOrLots: number; unit: "bags" | "lots";
    isNew: boolean; isGhost: boolean;
  } | null>(null);

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

      // Origin proportion per port — prefer the full-history rollup the
      // importer attached (covers stock graded outside the daily window,
      // e.g. Felixstowe's 34 lots that pre-date our gradings events).
      // Fall back to the rolling window's gradings entries when the
      // workbook field isn't present.
      const portOriginLots: Record<string, Record<string, number>> = {};
      const portClass34Lots: Record<string, number> = {};
      const portTotalLotsHist: Record<string, number> = {};
      const fullHist = robusta?.port_origin_history;
      if (fullHist) {
        for (const [port, byOrigin] of Object.entries(fullHist)) {
          portOriginLots[port] = {};
          let class34 = 0, total = 0;
          for (const [origin, d] of Object.entries(byOrigin) as Array<[string, { tenderable: number; class34: number }]>) {
            portOriginLots[port][origin] = (portOriginLots[port][origin] ?? 0) + d.tenderable;
            class34 += d.class34;
            total   += d.tenderable;
          }
          portClass34Lots[port] = class34;
          portTotalLotsHist[port] = total;
        }
      } else {
        for (const ev of grads) {
          for (const e of (ev.entries || [])) {
            if (e.tenderable === false) continue;
            const port = e.port || "?";
            const origin = e.origin?.trim() || "?";
            portOriginLots[port] = portOriginLots[port] ?? {};
            portOriginLots[port][origin] = (portOriginLots[port][origin] ?? 0) + (e.lots ?? 0);
            portTotalLotsHist[port] = (portTotalLotsHist[port] ?? 0) + (e.lots ?? 0);
            if (e.class === 3 || e.class === 4) {
              portClass34Lots[port] = (portClass34Lots[port] ?? 0) + (e.lots ?? 0);
            }
          }
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
        // Class 3/4 share — taken from the precomputed full-history rollup
        // when present, falls back to per-window inference above.
        const totalHist = portTotalLotsHist[code] ?? 0;
        const class34Share = totalHist > 0 ? (portClass34Lots[code] ?? 0) / totalHist : 0;
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
        <span className="flex items-center text-slate-300">KC: 1 warrant = 37,500 lb (17.009 MT ≈ 283 bags) · RC: 1 lot (10 MT)</span>
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
              Card positions are computed from the actual flex layout
              (each card's flex grow = its span, total = sum of spans). */}
          {mkt.ports.length > 0 && (() => {
            const visible = mkt.ports.slice(0, 8);
            const totalSpan = visible.reduce((sum, p) => sum + p.span, 0);
            if (totalSpan === 0) return null;
            let cursor = 0;
            const centres = visible.map((p) => {
              const c = (cursor + p.span / 2) * (100 / totalSpan);
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
  );
}
