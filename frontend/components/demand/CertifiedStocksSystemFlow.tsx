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
import { useEffect, useMemo, useState } from "react";
import { fmtNum, _fmtUnit, unitWord, type FlowUnit } from "@/lib/certifiedStocks/units";
import {
  AGE_OPACITY, AGE_LABEL, AGE_BIN_ORDER, _binByMonths, _binByDays,
  type AgeBin, type AgeDist,
} from "@/lib/certifiedStocks/age";
import { ARABICA_PORT_NAMES, ROBUSTA_PORT_NAMES, _canonicalKC } from "@/lib/certifiedStocks/ports";
import { KC_ORIGIN_COLORS, RC_ORIGIN_COLORS, _originColor } from "@/lib/certifiedStocks/colors";

// ── Local data shapes (a subset of the rich panel types) ─────────────────────

interface ArabicaSectionHierarchy {
  grand_total: number;
  by_port: Record<string, number>;
  by_origin: Record<string, { by_port: Record<string, number>; group: string; total: number }>;
}
// Per-(origin, port) grading detail. Two equivalent shapes are accepted:
//   • live scraper  — passed_by_origin / failed_by_origin:
//       { origin: { by_port: { code: bags }, group?, total? } }
//   • xlsx importer — graded_today_by_port_origin (sheet 6_ny_gradings):
//       { port: { origin: { passed: bags, failed: bags } } }
// Present only on action days; older "N Bags Passed Today" days carry only
// the scalar passed_today_bags.
type ArabicaGradingByOrigin = Record<string, { by_port: Record<string, number>; group?: string; total?: number }>;
type ArabicaGradingByPortOrigin = Record<string, Record<string, { passed?: number; failed?: number }>>;
interface ArabicaSnap {
  date: string;
  total_bags: number;
  passed_today_bags?: number;
  failed_today_bags?: number;
  pending_grading_bags?: number;
  by_port?: Record<string, number>;
  sections?: { total_certified?: ArabicaSectionHierarchy; pending_grading?: ArabicaSectionHierarchy };
  passed_by_origin?: ArabicaGradingByOrigin;
  failed_by_origin?: ArabicaGradingByOrigin;
  graded_today_by_port_origin?: ArabicaGradingByPortOrigin;
}

// Normalise either snapshot shape into passed bags per (canonical port, origin).
// Returns null when the day carries no per-origin grading detail at all.
function _arabicaPassedByPortOrigin(s: ArabicaSnap): Array<[string, string, number]> | null {
  const out: Array<[string, string, number]> = [];
  if (s.passed_by_origin) {
    for (const [origin, od] of Object.entries(s.passed_by_origin))
      for (const [p, bags] of Object.entries(od.by_port ?? {}))
        if (bags) out.push([_canonicalKC(p), origin, bags]);
    return out;
  }
  if (s.graded_today_by_port_origin) {
    for (const [p, byO] of Object.entries(s.graded_today_by_port_origin))
      for (const [origin, st] of Object.entries(byO))
        if (st?.passed) out.push([_canonicalKC(p), origin, st.passed]);
    return out;
  }
  return null;
}
interface RobustaSnap { date: string; total_lots_certified: number; by_port_lots?: Record<string, number> }
interface ArabicaAgeBucketRow { age_bucket: string; bags: number }
// Monthly ageing report — the per-origin × age-band cohort snapshot. Drives
// `cohortMatched` for Arabica: in & out (transited) is only surfaced when a
// usable report's month_end falls inside the window (so cohorts can be matched).
interface ArabicaAgeingReport {
  month_end?: string | null;
  by_origin_band?: Record<string, Record<string, number>> | null;
  grand_total?: number | null;
}
export interface ArabicaJsonShape {
  snapshots: ArabicaSnap[];
  as_of?: string | null;
  latest_detail?: { age_detail?: Record<string, ArabicaAgeBucketRow[]>; age_detail_date?: string | null } | null;
  ageing_report?: ArabicaAgeingReport | null;
}

interface RobustaAgeBucket { months_since_graded: number; by_port: Record<string, number>; grand_total_mt: number }
interface RobustaAgeMonth  { month_end: string; valid?: { ports?: string[]; buckets?: RobustaAgeBucket[] } | null }
interface RobustaGradingEntry { port?: string; origin?: string; class?: number | null; tenderable?: boolean; lots: number }
interface RobustaGradingEvent { date: string; entries?: RobustaGradingEntry[] }
interface RobustaOverviewEvent { date: string; total_pending_lots?: number | null; queue_lots?: number | null; forecast_lots?: number | null }
// Output of the cohort-DNA pipeline (backend cohort_outflow.py). When
// present these drive the system flow's per-origin buckets; missing →
// we fall back to the in-browser stock simulation.
interface ImpliedOutflowMonth {
  month_end: string;
  by_port: Record<string, Record<string, number>>;
  // Subset of by_port that is "in & out": outflow from cohorts graded inside
  // this same month-end interval (arrived AND left). by_port_transit ⊆ by_port.
  by_port_transit?: Record<string, Record<string, number>>;
}
export interface RobustaJsonShape {
  snapshots: RobustaSnap[];
  as_of?: string | null;
  monthly?: {
    age_allowance?: RobustaAgeMonth[];
    implied_outflow?: ImpliedOutflowMonth[];
    current_by_origin?: Record<string, Record<string, number>>;
  };
  recent_activity?: { gradings?: RobustaGradingEvent[]; grading_overview?: RobustaOverviewEvent[] };
  port_origin_history?: Record<string, Record<string, { tenderable: number; class34: number }>>;
}

// ── Flow range selector ──────────────────────────────────────────────────────
// The period is a [start, end] window. `end` is a free calendar pick that
// defaults to the latest available data date; `start` is chosen from a small
// menu computed *relative to end*: one week back, or the 1st of end's month
// (month-to-date — the default view) and the 1st of each earlier month, back
// to the first month we hold data for. Both ends are anchored to real data
// dates (never the wall clock) so a window is never empty.

// Period-window helpers live in lib/certifiedStocks/window (shared with the
// panel). Re-exported here for existing importers.
export {
  parseFlowISO, flowDateISO, flowAnchor, flowDateBounds, flowStartOptions,
  FLOW_START_DEFAULT, type FlowStartOpt,
} from "@/lib/certifiedStocks/window";

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
  status: "filled" | "gained" | "ghost" | "transit";
  origin: string;
  color: string;
  ageBin: AgeBin;
  warrants: number;            // effective warrants this square represents
  klass: number | null;        // Robusta C-contract class (1..4) — null for KC.
}

// Robusta-class contour colours (1px inset border). Class 1 = par (no
// border, the cleanest visual), faded yellow / orange / red walk down
// the differential ladder (-30 / -60 / -90). Class P (premium, +30)
// would be green when the source feed starts emitting it.
const CLASS_BORDER_RC: Record<number, string> = {
  2: "rgba(250, 204, 21, 0.65)",  // faded yellow (-30)
  3: "rgba(249, 115, 22, 0.95)",  // orange       (-60)
  4: "rgba(239, 68, 68, 0.98)",   // red          (-90)
};
const CLASS_LABEL_RC: Record<number, string> = {
  1: "Class 1 (par)",
  2: "Class 2 (−30)",
  3: "Class 3 (−60)",
  4: "Class 4 (−90)",
};

// Per-origin gross flow over the window. gross_in = sum of all positive daily
// deltas (or grading events for Robusta). gross_out = sum of all negative
// daily deltas. We derive net / lost / transit from these:
//   • net_delta = gross_in − gross_out
//   • net_gained = max(0, net_delta)            (showed up in current stock)
//   • lost      = max(0, −net_delta)            (disappeared, shown as ghost)
//   • transit   = min(gross_in, gross_out)      (arrived AND left within window)
// gross_in / gross_out per origin over the window. `transit` is the
// cohort-matched "in & out" amount (graded AND left in-window) when the
// backend can resolve it from ageing-report cohort shrinkage — overrides the
// min(gross_in, gross_out) heuristic in buildDensityGrid when present.
interface OriginFlowPair { gross_in: number; gross_out: number; transit?: number }

// Per-card grid sizing. Hard rule (locked at user's request):
//   • Every Robusta square is exactly 13 px — matches the baseline size
//     a Houston-Arabica square previously rendered at (small warehouse,
//     used as the reference point).
//   • Every Arabica square is 17 px (= 13 × √(17 MT / 10 MT) ≈ 13 × 1.30
//     so the square area scales with the contract's warrant volume —
//     Arabica 17 MT lot vs Robusta 10 MT lot).
// cols = ceil(√squares) keeps the grid square-ish; cards grow to fit and
// the parent row wraps. This means visual area is comparable across
// warehouses and contracts — one Antwerp lot covers the same number of
// pixels regardless of how many lots Antwerp holds.
const CELL_PX_KC = 17;
const CELL_PX_RC = 13;
const _gridCols = (squares: number) => (squares <= 0 ? 4 : Math.max(4, Math.ceil(Math.sqrt(squares))));
const _rowsForCount = (n: number, cols: number) => (n <= 0 ? 0 : Math.ceil(n / cols));

// ── Density-grid formulas ────────────────────────────────────────────────────
//
// Per port, over a chosen window:
//
//   • Per origin we know two gross flows:
//       gross_in[o]  = lots arriving in the window
//       gross_out[o] = lots leaving in the window
//
//   • Per-origin invariant (mass balance):
//       base[o] + gross_in[o] − gross_out[o]  =  cur[o]
//     so:
//       net_delta[o] = gross_in[o] − gross_out[o]
//
//   • Buckets rendered on the card:
//       net_gained[o] = max(0,  net_delta[o])      arrived and still here
//       lost[o]       = max(0, −net_delta[o])      were here, gone now
//       transited[o]  = min(gross_in[o], gross_out[o])   arrived AND left
//
//   • Existing portion (the colored grid above the dashed boxes):
//       existing[o]   = max(0, cur[o] − net_gained[o])
//     i.e. what's still on hand from before the window started.
//
//   • Port-level invariant:
//       current = existing_total + net_gained_total
//       gross_in_total  = net_gained_total + transited_total
//       gross_out_total = lost_total        + transited_total
//
// How gross_in / gross_out are sourced:
//
//   Arabica (KC) — we walk every snapshot in the window and read
//   `total_certified.by_origin[o].by_port[p]` directly. Positive daily
//   deltas at (p, o) accumulate into gross_in[o], negative into gross_out[o].
//
//   Robusta (RC) — the source only carries port-level totals, never
//   per-origin stock. So we run a simulation per port:
//       1. Initialise per-origin state from port_origin_history shares ×
//          first snapshot's port total.
//       2. Walk daily. Each gradings event (date, port, origin, lots) adds
//          to state[o] and to gross_in[o]. Each day's port-level outflow
//          (mass balance: prev_total + total_in − new_total) is apportioned
//          across the current state proportionally, decrementing state[o]
//          and accumulating into gross_out[o].
//       3. End state = inferred current per-origin stock (cur[o]).
//   This is what lets transited and net_gained stay self-consistent:
//   Indonesia arriving at Antwerp 6mo ago and leaving 4mo ago shows up
//   as transited (in & out), not as net_gained that never materialises.
//   ─────────────────────────────────────────────────────────────────────────

interface RobustaPortSim {
  state: Record<string, number>;
  inflowByOriginByDate:  Record<string, Record<string, number>>;
  outflowByOriginByDate: Record<string, Record<string, number>>;
}

function _simulateRobustaPortStock(
  port: string,
  snaps: RobustaSnap[],
  grads: RobustaGradingEvent[],
  histShare: Record<string, number>,
): RobustaPortSim {
  const sortedSnaps = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  // Bucket gradings into daily per-origin inflow for this port only.
  const gradsByDate: Record<string, Record<string, number>> = {};
  for (const ev of grads) {
    for (const e of (ev.entries || [])) {
      if (e.tenderable === false) continue;
      if ((e.port || "") !== port) continue;
      const origin = (e.origin || "?").trim();
      gradsByDate[ev.date] = gradsByDate[ev.date] || {};
      gradsByDate[ev.date][origin] = (gradsByDate[ev.date][origin] ?? 0) + (e.lots ?? 0);
    }
  }
  const state: Record<string, number> = {};
  const firstTotal = sortedSnaps[0]?.by_port_lots?.[port] ?? 0;
  const shareSum = Object.values(histShare).reduce((a, b) => a + b, 0);
  if (firstTotal > 0 && shareSum > 0) {
    for (const [o, v] of Object.entries(histShare)) state[o] = (v / shareSum) * firstTotal;
  }
  const inflowByOriginByDate:  Record<string, Record<string, number>> = {};
  const outflowByOriginByDate: Record<string, Record<string, number>> = {};
  let prevTotal = firstTotal;
  for (let i = 1; i < sortedSnaps.length; i++) {
    const date = sortedSnaps[i].date;
    const newTotal = sortedSnaps[i].by_port_lots?.[port] ?? 0;
    const dayIn = gradsByDate[date] ?? {};
    let totalIn = 0;
    for (const [o, v] of Object.entries(dayIn)) {
      state[o] = (state[o] ?? 0) + v;
      totalIn += v;
    }
    if (Object.keys(dayIn).length > 0) inflowByOriginByDate[date] = { ...dayIn };
    const totalOut = Math.max(0, prevTotal + totalIn - newTotal);
    const stateSum = Object.values(state).reduce((a, b) => a + b, 0);
    if (totalOut > 0 && stateSum > 0) {
      const dayOut: Record<string, number> = {};
      for (const [o, v] of Object.entries(state)) {
        const out = (v / stateSum) * totalOut;
        state[o] = Math.max(0, v - out);
        if (out > 0) dayOut[o] = out;
      }
      if (Object.keys(dayOut).length > 0) outflowByOriginByDate[date] = dayOut;
    }
    prevTotal = newTotal;
  }
  return { state, inflowByOriginByDate, outflowByOriginByDate };
}

// Helper — distribute `count` squares across origins proportionally and
// stamp each with an age bin sampled from the age distribution. For
// Robusta squares an optional `originClassShares` lets us also stamp
// each square's C-contract class (1..4) proportionally to that
// origin's class mix recorded in gradings at the port.
function _allocSquares(
  count: number,
  byOrigin: Record<string, number>,
  age: AgeDist,
  status: DensitySquare["status"],
  perSquareWarrants: number,
  market: "KC" | "RC",
  originClassShares?: Record<string, Record<number, number>>,
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

  // Per-square class assignment (Robusta only). Group indices by origin,
  // then partition each origin's slot of the pool proportionally to its
  // gradings-derived class mix; the leftover fills with class 1 (par).
  const klassByIdx: (number | null)[] = new Array(count).fill(null);
  if (market === "RC" && originClassShares) {
    const indicesByOrigin: Record<string, number[]> = {};
    originPool.forEach((o, i) => {
      indicesByOrigin[o] = indicesByOrigin[o] || [];
      indicesByOrigin[o].push(i);
    });
    for (const [origin, indices] of Object.entries(indicesByOrigin)) {
      const shares = originClassShares[origin] ?? {};
      const classes = Object.entries(shares)
        .map(([k, v]) => [Number(k), v] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      let assigned = 0;
      for (const [cls, share] of classes) {
        const n = Math.round(indices.length * share);
        for (let j = 0; j < n && assigned < indices.length; j++) {
          klassByIdx[indices[assigned]] = cls;
          assigned++;
        }
      }
      while (assigned < indices.length) {
        klassByIdx[indices[assigned]] = 1;
        assigned++;
      }
    }
  }

  return originPool.map((origin, i) => ({
    status,
    origin,
    color: _originColor(origin, market),
    ageBin: agePool[i] ?? "fresh",
    warrants: perSquareWarrants,
    klass: klassByIdx[i],
  }));
}

// Build the four sub-grids for one port from per-origin gross flows:
//   • `existing`   — what's still here from before the window started
//                    (current − net-gained). Inherits the port's age mix.
//   • `netGained`  — net new warrants added over the window (sum of per-
//                    origin max(0, in−out)). Green dashed border, fresh.
//   • `ghosts`     — net warrants that disappeared (sum of per-origin
//                    max(0, out−in)). Red dashed border.
//   • `transited`  — coffee that arrived AND left within the window
//                    (sum of per-origin min(in, out)). Amber dashed,
//                    fresh — these never show up in current stock.
//
// Invariant: current = existing + netGained, so the visible current stock
// is exactly `existing` + `netGained`. `ghosts` and `transited` sit
// alongside as window-only ghost groups.
function buildDensityGrid(
  current: number,
  byOrigin: Record<string, number>,
  age: AgeDist,
  flowByOrigin: Record<string, OriginFlowPair>,
  unit: number,
  market: "KC" | "RC",
  originClassShares?: Record<string, Record<number, number>>,
  // When true an ageing report inside the window lets us match cohorts, so we
  // can separate stock that arrived AND left (transited / "in & out"). When
  // false every inflow is "in" and every outflow is "out" — no in & out, the
  // model's pre-ageing-report state.
  cohortMatched: boolean = true,
): {
  existing:  DensitySquare[];
  netGained: DensitySquare[];
  ghosts:    DensitySquare[];
  transited: DensitySquare[];
  // Volume breakdown per origin for each bucket. Drives the small
  // top-origin chip strip beneath each sub-grid header.
  byOriginExisting:  Record<string, number>;
  byOriginNetGained: Record<string, number>;
  byOriginGhost:     Record<string, number>;
  byOriginTransit:   Record<string, number>;
  // Raw volume per bucket (bags for KC, lots for RC). Square counts are
  // ceil'd to whole warrants for visual integrity, so the headline label
  // must use these to avoid a rounding inflation (e.g. 500 lost bags
  // → 2 warrants → 567 bags via the warrant count).
  netGainedVol: number;
  lostVol:      number;
  transitVol:   number;
  effectivePerSquare: number;
  totalWarrants: number;
} {
  // 1. Decompose per-origin gross flows into net / lost / transit volumes.
  let netGainedVol = 0, lostVol = 0, transitVol = 0;
  const netGainedByOrigin: Record<string, number> = {};
  const ghostByOrigin:     Record<string, number> = {};
  const transitByOrigin:   Record<string, number> = {};
  for (const [origin, f] of Object.entries(flowByOrigin)) {
    const tIn  = Math.max(0, f.gross_in);
    const tOut = Math.max(0, f.gross_out);
    if (cohortMatched) {
      // Ageing report matched → split the overlap (arrived AND left) out as
      // transited. Prefer the backend's cohort-resolved transit (outflow from
      // cohorts graded in-window); fall back to min(in, out) when it's absent.
      // Clamp to [0, min(in, out)] so net-gained / lost stay non-negative.
      const tr = Math.max(0, Math.min(
        origin in flowByOrigin && flowByOrigin[origin].transit != null
          ? (flowByOrigin[origin].transit as number)
          : Math.min(tIn, tOut),
        tIn, tOut,
      ));
      const ng = tIn - tr;   // pure in (graded and stayed)
      const lo = tOut - tr;  // pure out (legacy decertifications)
      if (ng > 0) { netGainedByOrigin[origin] = ng; netGainedVol += ng; }
      if (lo > 0) { ghostByOrigin[origin]     = lo; lostVol      += lo; }
      if (tr > 0) { transitByOrigin[origin]   = tr; transitVol   += tr; }
    } else {
      // No ageing report yet → we cannot tell which inflow also left, so all
      // inflow is "in" and all outflow is "out" (no in & out). This is what
      // keeps freshly-graded lots visible instead of netting them against
      // same-window decertifications.
      if (tIn  > 0) { netGainedByOrigin[origin] = tIn;  netGainedVol += tIn;  }
      if (tOut > 0) { ghostByOrigin[origin]     = tOut; lostVol      += tOut; }
    }
  }

  const totalWarrants    = Math.max(0, Math.ceil(current / unit));
  const netGainedWarrants = Math.max(0, Math.ceil(netGainedVol / unit));
  const lostWarrants      = Math.max(0, Math.ceil(lostVol      / unit));
  const transitWarrants   = Math.max(0, Math.ceil(transitVol   / unit));
  const existingWarrants  = Math.max(0, totalWarrants - netGainedWarrants);

  // 2. Uniform scale-down if the grand total of squares would overflow.
  const grand = existingWarrants + netGainedWarrants + lostWarrants + transitWarrants;
  void market;
  const scale = grand > DENSITY_MAX_SQUARES ? DENSITY_MAX_SQUARES / grand : 1;
  const existingShown  = Math.round(existingWarrants  * scale);
  const netGainedShown = Math.round(netGainedWarrants * scale);
  const lostShown      = Math.round(lostWarrants      * scale);
  const transitShown   = Math.round(transitWarrants   * scale);
  const effectivePerSquare = scale === 1 ? 1 : 1 / scale;

  // 3. Existing origin shares = byOrigin minus per-origin net-gained.
  const existingByOrigin: Record<string, number> = {};
  for (const [origin, v] of Object.entries(byOrigin)) {
    const ng = netGainedByOrigin[origin] ?? 0;
    existingByOrigin[origin] = Math.max(0, v - ng);
  }

  // 4. Stamp squares. Existing inherits the port's age mix; net-gained and
  // transit are fresh by definition; ghosts have no surviving age info.
  const FRESH_ONLY: AgeDist = { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
  const existing  = _allocSquares(existingShown,  existingByOrigin,  age,        "filled",  effectivePerSquare, market, originClassShares);
  const netGained = _allocSquares(netGainedShown, netGainedByOrigin, FRESH_ONLY, "gained",  effectivePerSquare, market, originClassShares);
  const ghosts    = _allocSquares(lostShown,      ghostByOrigin,     FRESH_ONLY, "ghost",   effectivePerSquare, market, originClassShares);
  const transited = _allocSquares(transitShown,   transitByOrigin,   FRESH_ONLY, "transit", effectivePerSquare, market, originClassShares);

  return {
    existing, netGained, ghosts, transited,
    byOriginExisting:  existingByOrigin,
    byOriginNetGained: netGainedByOrigin,
    byOriginGhost:     ghostByOrigin,
    byOriginTransit:   transitByOrigin,
    netGainedVol, lostVol, transitVol,
    effectivePerSquare, totalWarrants,
  };
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
  // Per-origin gross flows over the window — drives the four-bucket density
  // grid (existing / net-gained / lost / transited). Replaces the older
  // signed-delta-only model so we can surface intra-window churn.
  flowByOrigin: Record<string, OriginFlowPair>;
  // Per-origin C-contract class mix (Robusta only). Tagged on each square
  // so a hover reveals "Class 2 (−30)" etc. and the border colour reflects
  // the class differential.
  classShares?: Record<string, Record<number, number>>;
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

// Tiny lucide-style truck SVG, parked at the right end of each ↓out
// conveyor strip so the visual reads as "stock flowing out to a buyer".
const IconTruck = (p: { className?: string }) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);

interface Props {
  arabica: ArabicaJsonShape | null;
  robusta: RobustaJsonShape | null;
  // Flow range + display unit are owned by the parent panel (rendered up by
  // the metric toggle) and passed down so both stay in sync. `start`/`end`
  // are the window bounds (local-midnight Dates).
  start: Date;
  end: Date;
  unit: FlowUnit;
}

export default function CertifiedStocksSystemFlow({ arabica, robusta, start, end, unit }: Props) {
  const fmtU = (v: number, native: "bags" | "lots") => _fmtUnit(v, native, unit);
  // Hover-only inspector — no click state. The tooltip pops out of the
  // square the mouse is over and renders origin / age / (Robusta) class.
  const [hoveredSquare, setHoveredSquare] = useState<{
    market: "KC" | "RC"; portName: string;
    origin: string; ageBin: AgeBin; klass: number | null;
    status: DensitySquare["status"];
    anchorLeft: number; anchorTop: number;     // viewport pixels
  } | null>(null);

  // Inject the flowing-dash keyframes once, the same way the map's
  // logistics routes get their animation. Lives in document.head so it
  // survives re-renders and doesn't compound when this component re-mounts.
  useEffect(() => {
    if (document.getElementById("cs-flow-anim")) return;
    const s = document.createElement("style");
    s.id = "cs-flow-anim";
    s.textContent = `
      @keyframes csFlowDash { to { stroke-dashoffset: -10; } }
      .cs-flow      { stroke-dasharray: 2.4 1.4; animation: csFlowDash 1.6s linear infinite; }
      .cs-flow-slow { stroke-dasharray: 3.2 1.8; animation: csFlowDash 2.2s linear infinite; }
      /* Mini conveyor — animates per-card "out" boxes from left edge to
         right edge of the outflow indicator strip. Same look-and-feel as
         the cohort-explainer conveyor on the test tab, scaled down. */
      @keyframes csConveyorMini {
        0%   { left: 0%;                opacity: 0; }
        15%  {                           opacity: 1; }
        85%  {                           opacity: 1; }
        100% { left: calc(100% - 5px);  opacity: 0; }
      }
      .cs-conveyor-mini { animation: csConveyorMini 1.8s linear infinite; }
    `;
    document.head.appendChild(s);
  }, []);

  //   • flowByOrigin (gross_in / gross_out) per origin over the window,
  //     used to derive the existing / net-gained / lost / transited squares
  //   • inflow / outflow lists for the side indicators
  interface SystemFlowMarket {
    market: "KC" | "RC";
    label: string;
    unit: "bags" | "lots";
    squareUnit: number;
    ports: PortFlow[];
    // Whether we can surface in & out for this market/window. Drives the
    // density-grid split (transit-aware when true).
    cohortMatched: boolean;
    // How in & out is derived — drives the per-market caption:
    //   "fifo"   = Arabica daily per-(origin,port) ledger (oldest-leaves-first)
    //   "ageing" = Robusta cohort-DNA matched against an ageing report in-window
    //   "none"   = no in & out yet (Robusta intra-month, before the next report)
    inOutBasis: "fifo" | "ageing" | "none";
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
    const cutoff = start;
    // Inclusive end-of-day so the chosen end date's own snapshot is in range.
    const endT = end.getTime() + 86_400_000 - 1;

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

    // Last snapshot at or before the window end — the "as-of" frame for the
    // period (current stock / by-origin). Falls back to the newest snapshot.
    const snapAtOrBefore = <T extends { date: string }>(snaps: T[]): T | null => {
      let best: T | null = null, bestT = -Infinity;
      for (const s of snaps) {
        const t = new Date(s.date).getTime();
        if (t <= endT && t > bestT) { best = s; bestT = t; }
      }
      return best ?? (snaps.length ? snaps[snaps.length - 1] : null);
    };

    // ── Arabica market ─────────────────────────────────────────────────
    const buildArabica = (): SystemFlowMarket => {
      const empty: SystemFlowMarket = {
        market: "KC", label: "Arabica · ICE Futures US (KC)",
        unit: "bags", squareUnit: BAGS_PER_WARRANT_KC, ports: [], cohortMatched: false, inOutBasis: "none", intake: null,
      };
      const snaps = arabica?.snapshots ?? [];
      if (snaps.length === 0) return empty;
      const latest = snapAtOrBefore(snaps) ?? snaps[snaps.length - 1];
      const base = findSnapAt(snaps, cutoff) ?? snaps[0];
      const latestSec = latest.sections?.total_certified;
      if (!latestSec) return empty;

      // 365-day per-port max, keyed by canonical port code so the snapshot
      // history's short codes (NOR/MIA/NYK/HAM) merge into the long forms.
      const maxByPort = new Map<string, number>();
      for (const s of snaps) {
        for (const [p, v] of Object.entries(s.by_port || {})) {
          const k = _canonicalKC(p);
          if (v > (maxByPort.get(k) ?? 0)) maxByPort.set(k, v);
        }
      }

      // Age distribution per port from latest_detail.age_detail. Canonicalise
      // here too so the latest's "NOLA" key picks up workbook rows still
      // written as "NOR" (older imports of sheet 12).
      const ageByPort: Record<string, AgeDist> = {};
      const ageDetail = arabica?.latest_detail?.age_detail ?? {};
      for (const [port, rows] of Object.entries(ageDetail)) {
        const canon = _canonicalKC(port);
        const dist: AgeDist = ageByPort[canon] ?? { fresh: 0, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
        for (const r of rows) {
          const m = r.age_bucket?.match(/^(\d+)/);
          const days = m ? parseInt(m[1], 10) : 0;
          dist[_binByDays(days)] += r.bags || 0;
        }
        ageByPort[canon] = dist;
      }
      // Renormalise to shares per canonical port.
      for (const port of Object.keys(ageByPort)) {
        const a = ageByPort[port];
        const sum = a.fresh + a.y1to2 + a.y2to3 + a.y3to4 + a.y4plus;
        if (sum > 0) {
          a.fresh /= sum; a.y1to2 /= sum; a.y2to3 /= sum; a.y3to4 /= sum; a.y4plus /= sum;
        }
      }

      // Roll up latest + base port volumes per canonical code so periods
      // with mismatched short/long codes compare cleanly.
      const collapseSec = (sec: typeof latestSec | undefined) => {
        const byPort: Record<string, number> = {};
        const byOriginPort: Record<string, Record<string, number>> = {};
        const originMeta: Record<string, { group: string }> = {};
        for (const [p, v] of Object.entries(sec?.by_port ?? {})) {
          byPort[_canonicalKC(p)] = (byPort[_canonicalKC(p)] ?? 0) + v;
        }
        for (const [origin, od] of Object.entries(sec?.by_origin ?? {})) {
          byOriginPort[origin] = byOriginPort[origin] ?? {};
          originMeta[origin] = { group: od.group };
          for (const [p, v] of Object.entries(od.by_port ?? {})) {
            const k = _canonicalKC(p);
            byOriginPort[origin][k] = (byOriginPort[origin][k] ?? 0) + v;
          }
        }
        return { byPort, byOriginPort, originMeta };
      };
      const latestC = collapseSec(latestSec);

      // Walk every snapshot in the window in chronological order and
      // accumulate per-(port, origin) gross inflows / outflows from daily
      // deltas. Including `base` at the start captures the first transition
      // into the window. This is what lets us surface stock that arrived
      // AND departed inside the period (the "transited" bucket).
      const cutT = cutoff.getTime();
      const winSnaps = snaps
        .filter((s) => { const t = new Date(s.date).getTime(); return t >= cutT && t <= endT; })
        .sort((a, b) => a.date.localeCompare(b.date));
      const walk = winSnaps[0] === base ? winSnaps : [base, ...winSnaps];
      const flowByPort: Record<string, Record<string, OriginFlowPair>> = {};
      for (let i = 0; i < walk.length - 1; i++) {
        const a = collapseSec(walk[i].sections?.total_certified);
        const b = collapseSec(walk[i + 1].sections?.total_certified);
        const keys = new Set<string>();
        for (const [origin, perPort] of Object.entries(a.byOriginPort)) for (const p of Object.keys(perPort)) keys.add(`${p}|${origin}`);
        for (const [origin, perPort] of Object.entries(b.byOriginPort)) for (const p of Object.keys(perPort)) keys.add(`${p}|${origin}`);
        for (const key of Array.from(keys)) {
          const sep = key.indexOf("|");
          const port = key.slice(0, sep);
          const origin = key.slice(sep + 1);
          const av = (a.byOriginPort[origin] || {})[port] ?? 0;
          const bv = (b.byOriginPort[origin] || {})[port] ?? 0;
          const d = bv - av;
          if (d === 0) continue;
          flowByPort[port] = flowByPort[port] || {};
          flowByPort[port][origin] = flowByPort[port][origin] || { gross_in: 0, gross_out: 0 };
          if (d > 0) flowByPort[port][origin].gross_in  += d;
          else       flowByPort[port][origin].gross_out += -d;
        }
      }

      // ── Exact per-(origin, port) ledger via daily FIFO ──────────────────
      // Arabica publishes exact daily per-(origin,port) stock AND per-origin
      // gradings, so we don't infer — we account exactly:
      //   in  = passed gradings in the window           (exact)
      //   out = base + in − current per (origin,port)   (exact mass balance)
      //   in & out (transit) = of the window's gradings, how much also LEFT in
      //     the window, by a per-(origin,port) FIFO ledger seeded with the
      //     start-of-window stock as the oldest cohort (oldest warrants leave
      //     first — age allowances make that the realistic tender order).
      // The monthly ageing report is age×port with no origin, so it can't drive
      // an origin cohort match; it powers the age fade and validates this ledger.
      // `walk` is the chronological [base, …window snapshots] built above.
      {
        type LedgerCell = { in: number; out: number; transit: number };
        const ledger: Record<string, Record<string, LedgerCell>> = {};
        const cell = (p: string, o: string): LedgerCell => {
          ledger[p] = ledger[p] || {};
          return (ledger[p][o] = ledger[p][o] || { in: 0, out: 0, transit: 0 });
        };
        // FIFO queues per (port, origin): [cohortDate | "LEGACY", qty].
        const queues = new Map<string, Array<[string, number]>>();
        const qOf = (p: string, o: string) => {
          const k = `${p}|${o}`;
          let q = queues.get(k);
          if (!q) { q = []; queues.set(k, q); }
          return q;
        };
        // Seed legacy = start-of-window stock (oldest cohort).
        let prev = collapseSec(walk[0]?.sections?.total_certified).byOriginPort;
        for (const [o, perPort] of Object.entries(prev))
          for (const [p, v] of Object.entries(perPort)) if (v > 0) qOf(p, o).push(["LEGACY", v]);
        // Per-day grading inflow for a snapshot, canonical-port keyed. Uses the
        // exact per-origin matrix; if a day only has the scalar (pre-matrix),
        // spreads it across origins by that day's positive stock movement.
        const gradOf = (snap: ArabicaSnap, prevBO: Record<string, Record<string, number>>,
                        curBO: Record<string, Record<string, number>>): Record<string, Record<string, number>> => {
          const rows = _arabicaPassedByPortOrigin(snap);
          const out: Record<string, Record<string, number>> = {};
          if (rows && rows.length) {
            for (const [p, o, b] of rows) { out[p] = out[p] || {}; out[p][o] = (out[p][o] ?? 0) + b; }
            return out;
          }
          const scalar = snap.passed_today_bags ?? 0;
          if (scalar <= 0) return out;
          const ups: Array<[string, string, number]> = [];
          let upSum = 0;
          const keys = new Set<string>();
          for (const o of Object.keys({ ...prevBO, ...curBO })) for (const p of Object.keys({ ...(prevBO[o] || {}), ...(curBO[o] || {}) })) keys.add(`${p}|${o}`);
          for (const key of Array.from(keys)) {
            const sep = key.indexOf("|"); const p = key.slice(0, sep), o = key.slice(sep + 1);
            const d = (curBO[o]?.[p] ?? 0) - (prevBO[o]?.[p] ?? 0);
            if (d > 0) { ups.push([p, o, d]); upSum += d; }
          }
          for (const [p, o, d] of ups) { out[p] = out[p] || {}; out[p][o] = scalar * (d / (upSum || 1)); }
          return out;
        };
        for (let i = 1; i < walk.length; i++) {
          const cur = collapseSec(walk[i]?.sections?.total_certified).byOriginPort;
          const grad = gradOf(walk[i], prev, cur);
          const keys = new Set<string>();
          for (const o of Object.keys(prev)) for (const p of Object.keys(prev[o])) keys.add(`${p}|${o}`);
          for (const o of Object.keys(cur)) for (const p of Object.keys(cur[o])) keys.add(`${p}|${o}`);
          for (const p of Object.keys(grad)) for (const o of Object.keys(grad[p])) keys.add(`${p}|${o}`);
          for (const key of Array.from(keys)) {
            const sep = key.indexOf("|"); const p = key.slice(0, sep), o = key.slice(sep + 1);
            const gin = grad[p]?.[o] ?? 0;
            const c = cell(p, o);
            if (gin > 0) { c.in += gin; qOf(p, o).push([walk[i].date, gin]); }
            const outToday = Math.max(0, (prev[o]?.[p] ?? 0) + gin - (cur[o]?.[p] ?? 0));
            if (outToday > 0) {
              c.out += outToday;
              let rem = outToday;
              const q = qOf(p, o);
              while (rem > 1e-9 && q.length) {
                const head = q[0];
                const take = Math.min(rem, head[1]);
                if (head[0] !== "LEGACY") c.transit += take;   // graded in-window AND left
                head[1] -= take; rem -= take;
                if (head[1] <= 1e-9) q.shift();
              }
            }
          }
          prev = cur;
        }
        // Replace the signed-delta flows with the exact ledger (carrying transit).
        for (const k of Object.keys(flowByPort)) delete flowByPort[k];
        for (const [p, byO] of Object.entries(ledger))
          for (const [o, f] of Object.entries(byO))
            if (f.in > 0 || f.out > 0) {
              flowByPort[p] = flowByPort[p] || {};
              flowByPort[p][o] = { gross_in: f.in, gross_out: f.out, transit: f.transit };
            }
      }
      // Arabica always has the daily ledger as its in & out basis.
      const cohortMatched = true;
      const inOutBasis: "fifo" | "ageing" | "none" = "fifo";

      const ports: PortFlow[] = [];
      for (const [code, current] of Object.entries(latestC.byPort)) {
        if (current <= 0) continue;
        const byOrigin: Record<string, number> = {};
        for (const [origin, perPort] of Object.entries(latestC.byOriginPort)) {
          const v = perPort[code] ?? 0;
          if (v > 0) byOrigin[origin] = v;
        }
        const flowByOrigin = flowByPort[code] ?? {};
        const inflow: OriginFlow[] = [];
        const outflow: OriginFlow[] = [];
        for (const [origin, f] of Object.entries(flowByOrigin)) {
          if (f.gross_in  > 0) inflow.push({  origin, volume: f.gross_in,  color: _originColor(origin, "KC") });
          if (f.gross_out > 0) outflow.push({ origin, volume: f.gross_out, color: _originColor(origin, "KC") });
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
          flowByOrigin, inflow, outflow, span: 1, poison,
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
        const t = new Date(s.date).getTime();
        if (t < cutTime || t > endT) continue;
        passed += s.passed_today_bags ?? 0;
        failed += s.failed_today_bags ?? 0;
      }
      let premiumShare = 0, borderlineShare = 0;
      for (const [origin, perPort] of Object.entries(latestC.byOriginPort)) {
        const tot = Object.values(perPort).reduce((a, b) => a + b, 0);
        const group = latestC.originMeta[origin]?.group ?? "";
        if (group === "Group 3" || group === "Group 4") borderlineShare += tot;
        else premiumShare += tot;
      }
      const sum = premiumShare + borderlineShare || 1;
      const passedPremium    = Math.round(passed * (premiumShare    / sum));
      const passedBorderline = Math.round(passed * (borderlineShare / sum));
      return {
        market: "KC", label: "Arabica · ICE Futures US (KC)",
        unit: "bags", squareUnit: BAGS_PER_WARRANT_KC, ports, cohortMatched, inOutBasis,
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
        unit: "lots", squareUnit: LOTS_PER_WARRANT_RC, ports: [], cohortMatched: false, inOutBasis: "none", intake: null,
      };
      const snaps = robusta?.snapshots ?? [];
      const grads = robusta?.recent_activity?.gradings ?? [];
      const overv = robusta?.recent_activity?.grading_overview ?? [];
      if (snaps.length === 0) return empty;
      const latest = snapAtOrBefore(snaps) ?? snaps[snaps.length - 1];

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

      // Per-(port, origin, class) tenderable lots from gradings events —
      // drives the per-square Robusta class assignment + border colour.
      // Normalised to shares per (port, origin) so each square is stamped
      // with a class sampled from that origin's quality mix at the port.
      const portOriginClassMix: Record<string, Record<string, Record<number, number>>> = {};
      for (const ev of grads) {
        for (const e of (ev.entries || [])) {
          if (e.tenderable === false) continue;
          const klass = e.class;
          if (klass == null) continue;
          const port = e.port || "?";
          const origin = e.origin?.trim() || "?";
          portOriginClassMix[port] = portOriginClassMix[port] || {};
          portOriginClassMix[port][origin] = portOriginClassMix[port][origin] || {};
          portOriginClassMix[port][origin][klass] = (portOriginClassMix[port][origin][klass] ?? 0) + (e.lots ?? 0);
        }
      }
      const portOriginClassShares: Record<string, Record<string, Record<number, number>>> = {};
      for (const [port, byOrigin] of Object.entries(portOriginClassMix)) {
        const out: Record<string, Record<number, number>> = {};
        for (const [origin, byClass] of Object.entries(byOrigin)) {
          const total = Object.values(byClass).reduce((a, b) => a + b, 0);
          if (total <= 0) continue;
          const shares: Record<number, number> = {};
          for (const [k, v] of Object.entries(byClass)) shares[Number(k)] = v / total;
          out[origin] = shares;
        }
        if (Object.keys(out).length > 0) portOriginClassShares[port] = out;
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

      // Preferred path: read backend's cohort-DNA outputs (cohort_outflow.py).
      // `current_by_origin` gives the per-origin breakdown of the latest
      // ageing report; `implied_outflow` gives per-origin outflow per
      // calendar month, apportioned by each cohort's own DNA. Falls back
      // to the in-browser per-port stock simulation when either field is
      // missing (older JSON or fresh builds before the importer re-runs).
      const cohortCurrent = robusta?.monthly?.current_by_origin;
      const cohortOutflow = robusta?.monthly?.implied_outflow;
      const useCohort = !!cohortCurrent && !!cohortOutflow;
      // in & out is only meaningful once an ageing report inside the window
      // lets us cohort-match the outflow. Intra-month (no new month_end yet)
      // we show all gradings as "in" and the decline as "out", no in & out —
      // exactly the "assume nothing until end of month" state in the model.
      // NB: use cutoff.getTime() here, not the `cutT` const below — this runs
      // immediately inside .some(), before cutT is declared (TDZ otherwise).
      const cutStartT = cutoff.getTime();
      const cohortMatched = useCohort && (cohortOutflow ?? []).some((e) => {
        const t = new Date(e.month_end).getTime();
        return t >= cutStartT && t <= endT;
      });
      // Whether the data carries the cohort-resolved in & out subset
      // (by_port_transit). New importer output has it; older JSON does not, in
      // which case buildDensityGrid falls back to the min(in, out) heuristic.
      const transitFieldPresent = (cohortOutflow ?? []).some((e) => e.by_port_transit != null);

      // Always compute the in-browser per-port stock simulation. In the
      // fallback path it is the sole source of flows; in the cohort path it
      // supplements the monthly implied_outflow with recent DAILY outflow
      // (decertifications) that lands after the last month-end ageing report
      // — otherwise a fresh drop like "22 lots decertified on Jun 2" never
      // shows in the system flow because implied_outflow only updates monthly.
      const sims: Record<string, RobustaPortSim> = {};
      {
        const allPortCodes = new Set<string>();
        for (const s of snaps) for (const p of Object.keys(s.by_port_lots || {})) allPortCodes.add(p);
        for (const p of Array.from(allPortCodes)) {
          sims[p] = _simulateRobustaPortStock(p, snaps, grads, portOriginLots[p] ?? {});
        }
      }
      // Newest month_end covered by the cohort implied_outflow. Daily-sim
      // outflow strictly AFTER this date is additive (no double counting),
      // because implied_outflow has not yet absorbed it.
      const lastCohortMonthEndT = (cohortOutflow && cohortOutflow.length)
        ? Math.max(...cohortOutflow.map((e) => new Date(e.month_end).getTime()))
        : -Infinity;

      // Real per-(port, origin) gradings inflow per calendar month —
      // needed when cohort-DNA outflow is the trusted source for gross_out;
      // gross_in still comes straight from gradings events (the source
      // of truth for inflows).
      const cutT = cutoff.getTime();
      const cohortInflowByPortOrigin: Record<string, Record<string, number>> = {};
      if (useCohort) {
        for (const ev of grads) {
          const t = new Date(ev.date).getTime();
          if (t < cutT || t > endT) continue;
          for (const e of (ev.entries || [])) {
            if (e.tenderable === false) continue;
            const port = e.port || "?";
            const origin = (e.origin || "?").trim();
            cohortInflowByPortOrigin[port] = cohortInflowByPortOrigin[port] || {};
            cohortInflowByPortOrigin[port][origin] = (cohortInflowByPortOrigin[port][origin] ?? 0) + (e.lots ?? 0);
          }
        }
      }

      const ports: PortFlow[] = [];
      for (const [code, current] of Object.entries(latest.by_port_lots || {})) {
        if (current <= 0) continue;
        const byOrigin: Record<string, number> = {};
        const flowByOrigin: Record<string, OriginFlowPair> = {};

        if (useCohort) {
          // PREFERRED: cohort-DNA pipeline outputs.
          // byOrigin from current_by_origin, normalised to the live port
          // total so it always sums to `current` (which comes from the
          // most recent daily snapshot, not the month-end ageing report).
          const cur = cohortCurrent?.[code] ?? {};
          const curSum = Object.values(cur).reduce((a, b) => a + b, 0);
          if (curSum > 0) {
            for (const [o, v] of Object.entries(cur)) if (v > 0) byOrigin[o] = (v / curSum) * current;
          } else {
            byOrigin["Unknown"] = current;
          }
          // gross_out from implied_outflow summed over months in window;
          // gross_in from real gradings events. `transitByOrigin` is the
          // cohort-resolved "in & out" subset (by_port_transit) — outflow from
          // cohorts graded inside the same interval, i.e. graded AND left.
          const inflowByOrigin = cohortInflowByPortOrigin[code] ?? {};
          const outflowByOrigin: Record<string, number> = {};
          const transitByOrigin: Record<string, number> = {};
          for (const entry of cohortOutflow ?? []) {
            const t = new Date(entry.month_end).getTime();
            if (t < cutT || t > endT) continue;
            const byO = entry.by_port?.[code];
            if (byO) {
              for (const [o, v] of Object.entries(byO)) outflowByOrigin[o] = (outflowByOrigin[o] ?? 0) + v;
            }
            const byT = entry.by_port_transit?.[code];
            if (byT) {
              for (const [o, v] of Object.entries(byT)) transitByOrigin[o] = (transitByOrigin[o] ?? 0) + v;
            }
          }
          // Supplement with recent DAILY outflow from the per-port sim for
          // dates after the last month-end the cohort outflow covers. This
          // surfaces same-month decertifications (e.g. the Jun 2 drop) that
          // implied_outflow won't reflect until the next monthly ageing run.
          const simRecent = sims[code];
          if (simRecent) {
            for (const [date, byO] of Object.entries(simRecent.outflowByOriginByDate)) {
              const t = new Date(date).getTime();
              if (t < cutT || t > endT || t <= lastCohortMonthEndT) continue;
              for (const [o, v] of Object.entries(byO)) {
                outflowByOrigin[o] = (outflowByOrigin[o] ?? 0) + v;
              }
            }
          }
          // Attach the cohort-resolved transit when the window brackets an
          // ageing report AND the data carries by_port_transit. Every origin
          // then gets an explicit transit (0 = "no in & out for this origin"),
          // which overrides the min(in, out) heuristic. Older JSON without the
          // field leaves transit undefined → heuristic fallback downstream.
          const haveTransit = cohortMatched && transitFieldPresent;
          for (const o of Array.from(new Set([...Object.keys(inflowByOrigin), ...Object.keys(outflowByOrigin)]))) {
            const gi = inflowByOrigin[o] ?? 0;
            const go = outflowByOrigin[o] ?? 0;
            if (gi > 0 || go > 0) {
              flowByOrigin[o] = { gross_in: gi, gross_out: go };
              if (haveTransit) flowByOrigin[o].transit = transitByOrigin[o] ?? 0;
            }
          }
        } else {
          // FALLBACK: in-browser per-port stock simulation.
          const sim = sims[code];
          const stateSum = sim ? Object.values(sim.state).reduce((a, b) => a + b, 0) : 0;
          if (sim && stateSum > 0) {
            for (const [o, v] of Object.entries(sim.state)) if (v > 0) byOrigin[o] = (v / stateSum) * current;
          } else {
            byOrigin["Unknown"] = current;
          }
          if (sim) {
            for (const [date, byO] of Object.entries(sim.inflowByOriginByDate)) {
              const t = new Date(date).getTime();
              if (t < cutT || t > endT) continue;
              for (const [o, v] of Object.entries(byO)) {
                flowByOrigin[o] = flowByOrigin[o] || { gross_in: 0, gross_out: 0 };
                flowByOrigin[o].gross_in += v;
              }
            }
            for (const [date, byO] of Object.entries(sim.outflowByOriginByDate)) {
              const t = new Date(date).getTime();
              if (t < cutT || t > endT) continue;
              for (const [o, v] of Object.entries(byO)) {
                flowByOrigin[o] = flowByOrigin[o] || { gross_in: 0, gross_out: 0 };
                flowByOrigin[o].gross_out += v;
              }
            }
          }
        }
        const inflow:  OriginFlow[] = [];
        const outflow: OriginFlow[] = [];
        for (const [origin, f] of Object.entries(flowByOrigin)) {
          if (f.gross_in  > 0) inflow.push({  origin, volume: f.gross_in,  color: _originColor(origin, "RC") });
          if (f.gross_out > 0) outflow.push({ origin, volume: f.gross_out, color: _originColor(origin, "RC") });
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
          flowByOrigin, classShares: portOriginClassShares[code],
          inflow, outflow, span: 1, poison,
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
        const t = new Date(g.date).getTime();
        if (t < cutTimeR || t > endT) continue;
        for (const e of (g.entries || [])) {
          const lots = e.lots || 0;
          if (e.tenderable === false) { fail += lots; continue; }
          if (e.class === 3 || e.class === 4) pBord += lots;
          else pPrem += lots;
        }
      }
      // Pending from the most recent grading_overview report at or before the
      // window end (point-in-time queue + forecast — not a flow).
      const overvInWin = overv.filter((o) => new Date(o.date).getTime() <= endT);
      const lastOverv = overvInWin.length ? overvInWin[overvInWin.length - 1]
        : (overv.length ? overv[overv.length - 1] : null);
      const pendingTotal = lastOverv?.total_pending_lots ?? 0;
      // Date label = latest event in window so the user knows the period end.
      const inWinGrad = grads.filter((g) => { const t = new Date(g.date).getTime(); return t >= cutTimeR && t <= endT; });
      const dateLabel = inWinGrad.length ? inWinGrad[inWinGrad.length - 1].date : (grads[grads.length - 1]?.date ?? null);
      return {
        market: "RC", label: "Robusta · ICE Futures Europe (RC)",
        unit: "lots", squareUnit: LOTS_PER_WARRANT_RC, ports, cohortMatched,
        inOutBasis: cohortMatched ? "ageing" : "none",
        intake: { pending: pendingTotal, passed: pPrem + pBord, failed: fail,
                  passedPremium: pPrem, passedBorderline: pBord, date: dateLabel },
      };
    };

    return { kc: buildArabica(), rc: buildRobusta() };
  }, [arabica, robusta, start, end]);


  return (
    <div>
      <div className="pb-2 border-b border-slate-800 mb-4">
        <h3 className="text-base font-bold text-slate-100">
          Certified stocks system flow
          <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-2">arabica + robusta</span>
        </h3>
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
          net gained
        </span>
        <span className="flex items-center text-slate-300">
          <span className="w-3 h-3 rounded mr-1 border border-dashed border-rose-400 bg-rose-950/50" />
          lost
        </span>
        <span className="flex items-center text-slate-300" title="stock that arrived AND left within the window — never showed up in current stock">
          <span className="w-3 h-3 rounded mr-1 border border-dashed border-amber-400 bg-amber-950/50" />
          in & out (transited)
        </span>
        <span className="text-slate-700 mx-1">|</span>
        <span className="text-slate-500 uppercase">1 ◻ =</span>
        <span className="flex items-center text-slate-300">KC: 1 warrant = 37,500 lb (17.009 MT ≈ 283 bags) · RC: 1 lot (10 MT)</span>
        <span className="text-slate-700 mx-1">|</span>
        <span className="text-slate-500 uppercase" title="Robusta C-contract class — apportioned to each square from each origin's class mix at the port">RC class:</span>
        <span className="flex items-center text-slate-300" title="par (0 differential)">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" /> 1 (par)
        </span>
        <span className="flex items-center text-slate-300" title="−30 differential">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" style={{ boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[2]}` }} /> 2 (−30)
        </span>
        <span className="flex items-center text-slate-300" title="−60 differential">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" style={{ boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[3]}` }} /> 3 (−60)
        </span>
        <span className="flex items-center text-slate-300" title="−90 differential">
          <span className="w-2.5 h-2.5 rounded mr-1 bg-slate-700" style={{ boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[4]}` }} /> 4 (−90)
        </span>
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
            {/* How in & out is derived for this market. */}
            <span
              className={`ml-2 text-[10px] normal-case font-normal ${mkt.inOutBasis === "none" ? "text-slate-500" : "text-amber-400/80"}`}
              title={
                mkt.inOutBasis === "fifo"
                  ? "in & out from the exact daily per-(origin, port) ledger: in = gradings, out = mass balance, in & out = FIFO (oldest warrants leave first). The monthly ageing report has no origin column, so it powers the age fade and validates this ledger."
                  : mkt.inOutBasis === "ageing"
                  ? "An ageing report inside this window lets us cohort-match outflow — stock graded AND decertified in-window is split out as in & out."
                  : "No ageing report inside this window yet — every passed lot counts as in and the decline as out; in & out is matched once the next ageing report lands."
              }
            >
              · {mkt.inOutBasis === "fifo"
                  ? "in & out · daily per-origin ledger (FIFO)"
                  : mkt.inOutBasis === "ageing"
                  ? "in & out matched (ageing report)"
                  : "in & out pending next ageing report"}
            </span>
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
                    <span className="text-sm font-mono font-bold text-amber-300">{fmtU(mkt.intake.pending, mkt.unit)}</span>
                  </div>
                </div>
                <span className="hidden md:block w-6 h-px bg-slate-700" />
                <div className="flex flex-col items-center">
                  <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Graded</div>
                  <div className="w-20 h-20 rounded-full bg-indigo-900/40 border-2 border-indigo-500 flex items-center justify-center"
                       style={{ boxShadow: "0 0 12px rgba(99,102,241,0.18)" }}>
                    <span className="text-base font-mono font-bold text-indigo-200">{fmtU(mkt.intake.passed + mkt.intake.failed, mkt.unit)}</span>
                  </div>
                </div>
                <span className="hidden md:block w-6 h-px bg-slate-700" />
                <div className="flex flex-col gap-1 w-full md:w-auto md:min-w-[220px]">
                  <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/60 px-2 py-1 rounded">
                    <span className="text-[10px] text-emerald-300">✓ Premium</span>
                    <span className="font-mono font-bold text-sm text-emerald-300">{fmtU(mkt.intake.passedPremium, mkt.unit)}</span>
                  </div>
                  <div className="flex items-center justify-between bg-amber-950/40 border border-amber-800/60 px-2 py-1 rounded">
                    <span className="text-[10px] text-amber-300">⚠ Borderline</span>
                    <span className="font-mono font-bold text-sm text-amber-300">{fmtU(mkt.intake.passedBorderline, mkt.unit)}</span>
                  </div>
                  <div className="flex items-center justify-between bg-rose-950/40 border border-rose-800/60 px-2 py-1 rounded">
                    <span className="text-[10px] text-rose-300">✕ Failed</span>
                    <span className="font-mono font-bold text-sm text-rose-300">{fmtU(mkt.intake.failed, mkt.unit)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Grading-intake → warehouses conveyor. Replaces the previous
              SVG manifold tree with a single horizontal conveyor that mirrors
              the per-port ↓in / ↓out strips — boxes flow left-to-right from
              the intake stage to the warehouse row, coloured by the dominant
              origins arriving in the window. Hidden when no passed graded
              coffee landed in this window. */}
          {mkt.ports.length > 0 && (() => {
            const visible = mkt.ports.slice(0, 8);
            if (visible.length === 0) return null;
            // Aggregate inflow across visible ports and pick the dominant
            // origins for the box-colour cycle.
            const totals: Record<string, { volume: number; color: string }> = {};
            for (const p of visible) {
              for (const o of p.inflow) {
                totals[o.origin] = totals[o.origin] || { volume: 0, color: o.color };
                totals[o.origin].volume += o.volume;
              }
            }
            const totalInflow = Object.values(totals).reduce((a, b) => a + b.volume, 0);
            // Nothing passed grading in this window → no conveyor.
            if (totalInflow <= 0) return null;
            const topOrigins = Object.entries(totals)
              .sort(([, a], [, b]) => b.volume - a.volume)
              .slice(0, 4)
              .map(([, v]) => v);
            const colors = topOrigins.length > 0 ? topOrigins : [{ volume: 0, color: "#10b981" }];
            return (
              <div className="my-2 flex items-stretch gap-2">
                {/* Source badge */}
                <div className="flex flex-col items-center justify-center px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[9px] text-slate-400 uppercase tracking-wider whitespace-nowrap">
                  Grading intake
                </div>
                {/* Conveyor — flex-grow so it stretches with the row */}
                <div className="relative flex-1 h-10 bg-slate-900/40 border border-slate-800 rounded overflow-hidden">
                  {/* Belt rails */}
                  <div className="absolute inset-x-2 top-1/2 h-px bg-emerald-900/50 -translate-y-1/2" />
                  <div className="absolute inset-x-2 top-1/2 mt-[2px] h-px bg-emerald-900/30" />
                  {/* 8 boxes flowing right, slower cadence — duration bumped
                      to 3.5s and delays restaggered so the belt feels calm
                      rather than racing. */}
                  <div className="absolute inset-x-2 inset-y-0">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <span key={i}
                        className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-sm cs-conveyor-mini"
                        style={{
                          background: colors[i % colors.length].color,
                          animationDelay: `${i * 0.44}s`,
                          animationDuration: "3.5s",
                          boxShadow: "0 0 5px rgba(16,185,129,0.4)",
                        }}
                      />
                    ))}
                  </div>
                  {/* Direction label + magnitude, centred above the belt */}
                  <div className="absolute top-0.5 left-1/2 -translate-x-1/2 text-[8.5px] font-mono text-emerald-400/80 px-1.5 bg-slate-950/60 rounded">
                    → net in +{fmtU(totalInflow, mkt.unit)}
                  </div>
                </div>
                {/* Destination badge */}
                <div className="flex flex-col items-center justify-center px-2 py-1 bg-emerald-950/40 border border-emerald-900/60 rounded text-[9px] text-emerald-300 uppercase tracking-wider whitespace-nowrap">
                  Warehouses
                </div>
              </div>
            );
          })()}

          {/* Per-port warehouse grid — compact vertical cards, up to 6 per row */}
          {mkt.ports.length === 0 ? (
            <div className="text-xs text-slate-600 italic">No port data loaded.</div>
          ) : (
            <div className="flex flex-wrap items-start gap-1.5 w-full">
              {mkt.ports.slice(0, 8).map((p) => {
                const {
                  existing, netGained, ghosts, transited,
                  byOriginExisting, byOriginNetGained, byOriginGhost, byOriginTransit,
                  netGainedVol, lostVol, transitVol,
                  effectivePerSquare, totalWarrants,
                } = buildDensityGrid(p.current, p.byOrigin, p.age, p.flowByOrigin, p.squareUnit, p.market, p.classShares, mkt.cohortMatched);
                const inflowSum  = p.inflow.reduce((a, b) => a + b.volume, 0);
                const outflowSum = p.outflow.reduce((a, b) => a + b.volume, 0);
                const topInflow  = p.inflow.slice(0, 2);
                const topOutflow = p.outflow.slice(0, 2);
                // Top-2 origins per bucket — drives the small chip strip
                // beneath each sub-grid header so the user sees the
                // origin mix at a glance.
                const top2 = (m: Record<string, number>) =>
                  Object.entries(m)
                    .filter(([, v]) => v > 0)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 2)
                    .map(([origin, volume]) => ({ origin, volume, color: _originColor(origin, p.market) }));
                const topExisting  = top2(byOriginExisting);
                const topNetGained = top2(byOriginNetGained);
                const topGhost     = top2(byOriginGhost);
                const topTransit   = top2(byOriginTransit);
                // Label that explains the per-square scale. If
                // effectivePerSquare > 1 the port exceeded the cap and
                // each square is now ≈N warrants instead of 1 exactly.
                const sqLabel = effectivePerSquare === 1
                  ? "1 ◻ = 1 warrant"
                  : `1 ◻ ≈ ${effectivePerSquare.toFixed(1)} warrants`;
                // Per-card grid: cols ≈ √(existing + net-gained) so the
                // grid is square-ish and the card sizes to its content.
                // Cells are fixed-pixel (17 px Arabica, 13 px Robusta) so
                // one warrant always covers the same area across cards
                // and contracts — the user can eyeball "this is twice as
                // much coffee" because the squares ARE the same size.
                const cellPx = p.market === "KC" ? CELL_PX_KC : CELL_PX_RC;
                const cols = _gridCols(existing.length + netGained.length);
                const colsTemplate = `repeat(${cols}, ${cellPx}px)`;
                const dimLabel = (n: number) => {
                  const r = _rowsForCount(n, cols);
                  return r === 0 ? "" : `${cols}×${r}`;
                };
                // Hover-tooltip helpers — read the square's viewport rect
                // from the event target and set state. Same handler shape
                // for every sub-grid; the status field distinguishes
                // existing / gained / lost / transit.
                const onSquareEnter = (e: React.MouseEvent<HTMLButtonElement>, sq: DensitySquare) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setHoveredSquare({
                    market: p.market, portName: p.name,
                    origin: sq.origin, ageBin: sq.ageBin, klass: sq.klass,
                    status: sq.status,
                    anchorLeft: r.left + r.width / 2,
                    anchorTop: r.top,
                  });
                };
                const onSquareLeave = () => setHoveredSquare(null);
                // Per-class border for Robusta squares — inset 1px so the
                // contour doesn't disturb the grid alignment.
                const classBorder = (sq: DensitySquare) =>
                  p.market === "RC" && sq.klass != null && CLASS_BORDER_RC[sq.klass]
                    ? { boxShadow: `inset 0 0 0 1px ${CLASS_BORDER_RC[sq.klass]}` }
                    : {};
                return (
                  <div key={`${p.market}-${p.code}`}
                       className="bg-slate-950/60 border border-slate-800 rounded-md p-1.5 flex flex-col"
                       style={{ minWidth: 0 }}>
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
                      <span className="text-slate-300">{fmtU(p.current, p.unit)}</span>/{fmtU(p.capacity, p.unit)} {unitWord(unit)}
                    </div>

                    {/* Poison breakdown — % + per-criterion contribution. */}
                    {p.poison.pct > 0 && (
                      <div className="bg-purple-950/30 border border-purple-900/50 rounded px-1 py-0.5 mb-1 text-[9px]">
                        <div className="flex items-center justify-between text-purple-300 font-bold">
                          <span>☣ poison</span>
                          <span className="font-mono">
                            {Math.round(p.poison.pct * 100)}% · {fmtU(p.poison.total, p.unit)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-1.5 gap-y-0 text-purple-300/80 text-[8.5px]">
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

                    {/* Inflow indicator (compact) — header / animated
                        conveyor strip / top-origin chip line. Mirrors the
                        ↓out belt but emerald, and only renders when this
                        port saw positive inflow over the window. */}
                    <div className="bg-emerald-950/20 border border-emerald-900/50 rounded px-1 py-0.5 mb-1 text-[9px]">
                      <div className="flex items-center justify-between text-emerald-400 font-bold">
                        <span>↓ in</span>
                        <span className="font-mono">+{fmtU(inflowSum, p.unit)}</span>
                      </div>
                      {inflowSum > 0 && topInflow.length > 0 && (
                        <div className="relative h-2.5 mt-0.5 overflow-hidden">
                          {/* Track */}
                          <div className="absolute inset-x-0 top-1/2 h-px bg-emerald-900/40 -translate-y-1/2" />
                          {/* 4 boxes flowing right, cycling the top inflow
                              origin colours. Staggered delays give a steady
                              stream rather than a wave. */}
                          {Array.from({ length: 4 }).map((_, i) => (
                            <span key={i}
                              className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-sm cs-conveyor-mini"
                              style={{
                                background: topInflow[i % topInflow.length].color,
                                animationDelay: `${i * 0.45}s`,
                                animationDuration: "2.4s",
                                boxShadow: "0 0 4px rgba(16,185,129,0.45)",
                              }}
                            />
                          ))}
                        </div>
                      )}
                      {topInflow.length > 0 && (
                        <div className="flex flex-wrap gap-x-1.5">
                          {topInflow.map((b) => (
                            <span key={b.origin} className="flex items-center text-slate-300 text-[8.5px]">
                              <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                              {b.origin}: {fmtU(b.volume, p.unit)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Density grid — existing portion (= current − net-gained). */}
                    {topExisting.length > 0 && (
                      <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                        <span className="text-slate-500 uppercase tracking-wider">Existing top:</span>
                        {topExisting.map((b) => (
                          <span key={b.origin} className="flex items-center text-slate-300">
                            <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                            {b.origin}: {fmtU(b.volume, p.unit)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <div
                        className="grid gap-[1px] bg-slate-900/50 border border-slate-800 p-1 rounded"
                        style={{ gridTemplateColumns: colsTemplate }}
                      >
                        {existing.map((sq, i) => (
                          <button
                            key={i}
                            type="button"
                            onMouseEnter={(e) => onSquareEnter(e, sq)}
                            onMouseLeave={onSquareLeave}
                            className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                            style={{ background: sq.color, opacity: AGE_OPACITY[sq.ageBin], ...classBorder(sq) }}
                            aria-label={`${p.name} square ${i}`}
                          />
                        ))}
                      </div>
                      {existing.length > 0 && (
                        <span className="absolute -top-2 right-1 text-[8px] font-mono text-slate-500 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(existing.length)} = ${existing.length} warrants`}>
                          {dimLabel(existing.length)}
                        </span>
                      )}
                    </div>

                    {/* Net gained — origins whose net delta is positive over the window. */}
                    {netGained.length > 0 && (
                      <div className="mt-1 border border-dashed border-emerald-400/70 rounded p-1 bg-emerald-950/10 relative">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-[8px] uppercase tracking-wider text-emerald-400 font-bold">Net gained</span>
                          <span className="text-[8px] font-mono text-emerald-400">+{fmtU(netGainedVol, p.unit)}</span>
                        </div>
                        {topNetGained.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                            {topNetGained.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin}: {fmtU(b.volume, p.unit)}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-[1px]" style={{ gridTemplateColumns: colsTemplate }}>
                          {netGained.map((sq, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseEnter={(e) => onSquareEnter(e, sq)}
                              onMouseLeave={onSquareLeave}
                              className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                              style={{ background: sq.color, opacity: AGE_OPACITY[sq.ageBin], ...classBorder(sq) }}
                              aria-label={`${p.name} net-gained ${i}`}
                            />
                          ))}
                        </div>
                        <span className="absolute -bottom-2 right-1 text-[8px] font-mono text-emerald-400 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(netGained.length)} = ${netGained.length} warrants`}>
                          {dimLabel(netGained.length)}
                        </span>
                      </div>
                    )}

                    {/* Lost group — net warrants that disappeared over the window. */}
                    {ghosts.length > 0 && (
                      <div className="mt-1 border border-dashed border-rose-400/70 rounded p-1 bg-rose-950/10 relative">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-[8px] uppercase tracking-wider text-rose-400 font-bold">Lost</span>
                          <span className="text-[8px] font-mono text-rose-400">−{fmtU(lostVol, p.unit)}</span>
                        </div>
                        {topGhost.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                            {topGhost.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin}: {fmtU(b.volume, p.unit)}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-[1px]" style={{ gridTemplateColumns: colsTemplate }}>
                          {ghosts.map((sq, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseEnter={(e) => onSquareEnter(e, sq)}
                              onMouseLeave={onSquareLeave}
                              className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                              style={{ background: sq.color, opacity: 0.4, ...classBorder(sq) }}
                              aria-label={`${p.name} lost ${i}`}
                            />
                          ))}
                        </div>
                        <span className="absolute -bottom-2 right-1 text-[8px] font-mono text-rose-400 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(ghosts.length)} = ${ghosts.length} warrants`}>
                          {dimLabel(ghosts.length)}
                        </span>
                      </div>
                    )}

                    {/* Transited — stock that arrived AND departed inside the
                        window. Per-origin min(gross_in, gross_out), summed. */}
                    {transited.length > 0 && (
                      <div className="mt-1 border border-dashed border-amber-400/70 rounded p-1 bg-amber-950/10 relative">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-[8px] uppercase tracking-wider text-amber-400 font-bold">In & out</span>
                          <span className="text-[8px] font-mono text-amber-400">↻{fmtU(transitVol, p.unit)}</span>
                        </div>
                        {topTransit.length > 0 && (
                          <div className="flex flex-wrap gap-x-1.5 mb-0.5 text-[8.5px]">
                            {topTransit.map((b) => (
                              <span key={b.origin} className="flex items-center text-slate-300">
                                <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                                {b.origin}: {fmtU(b.volume, p.unit)}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-[1px]" style={{ gridTemplateColumns: colsTemplate }}>
                          {transited.map((sq, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseEnter={(e) => onSquareEnter(e, sq)}
                              onMouseLeave={onSquareLeave}
                              className="aspect-square rounded-[1px] cursor-pointer transition-transform hover:scale-150 hover:z-10"
                              style={{ background: sq.color, opacity: 0.55, ...classBorder(sq) }}
                              aria-label={`${p.name} transited ${i}`}
                            />
                          ))}
                        </div>
                        <span className="absolute -bottom-2 right-1 text-[8px] font-mono text-amber-400 bg-slate-950 px-1 rounded"
                              title={`${dimLabel(transited.length)} = ${transited.length} warrants`}>
                          {dimLabel(transited.length)}
                        </span>
                      </div>
                    )}

                    <div className="text-[8.5px] text-slate-600 mt-1 flex justify-between">
                      <span>{sqLabel}</span>
                      <span>{fmtNum(totalWarrants)} warrants</span>
                    </div>

                    {/* Outflow indicator (compact) — header / animated
                        conveyor strip / top-origin chip line. */}
                    <div className="bg-rose-950/20 border border-rose-900/50 rounded px-1 py-0.5 mt-1 text-[9px]">
                      <div className="flex items-center justify-between text-rose-400 font-bold">
                        <span>↓ out</span>
                        <span className="font-mono">−{fmtU(outflowSum, p.unit)}</span>
                      </div>
                      {outflowSum > 0 && topOutflow.length > 0 && (
                        <div className="relative h-3 mt-0.5 overflow-hidden">
                          {/* Conveyor track — narrower than the container so
                              the boxes fade out just before reaching the
                              truck parked at the right edge. */}
                          <div className="absolute left-0 right-3.5 top-1/2 h-px bg-rose-900/40 -translate-y-1/2" />
                          <div className="absolute left-0 right-3.5 top-0 bottom-0">
                            {/* 4 boxes flowing right, cycling the top outflow
                                origin colours. Staggered delays give a steady
                                stream rather than a wave. */}
                            {Array.from({ length: 4 }).map((_, i) => (
                              <span key={i}
                                className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-sm cs-conveyor-mini"
                                style={{
                                  background: topOutflow[i % topOutflow.length].color,
                                  animationDelay: `${i * 0.45}s`,
                                  boxShadow: "0 0 4px rgba(239,68,68,0.45)",
                                }}
                              />
                            ))}
                          </div>
                          {/* Truck destination — the stock leaves the system here. */}
                          <IconTruck className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 text-rose-400" />
                        </div>
                      )}
                      {topOutflow.length > 0 && (
                        <div className="flex flex-wrap gap-x-1.5">
                          {topOutflow.map((b) => (
                            <span key={b.origin} className="flex items-center text-slate-300 text-[8.5px]">
                              <span className="w-1 h-1 rounded-full mr-0.5" style={{ background: b.color }} />
                              {b.origin}: {fmtU(b.volume, p.unit)}
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

      {/* Hover tooltip — anchored to the square the cursor is over.
          Renders origin, age band, and (Robusta only) C-contract class.
          pointer-events:none so it never eats hover from neighbouring
          squares. Transform pulls the tooltip above and centred on the
          anchor point. */}
      {hoveredSquare && (
        <div
          role="tooltip"
          className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-700 rounded shadow-2xl px-2 py-1.5 text-[10px] font-mono whitespace-nowrap"
          style={{
            left: hoveredSquare.anchorLeft,
            top:  hoveredSquare.anchorTop - 6,
            transform: "translate(-50%, -100%)",
            boxShadow: "0 8px 20px rgba(0,0,0,0.6)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-2 h-2 rounded" style={{ background: _originColor(hoveredSquare.origin, hoveredSquare.market) }} />
            <span className="text-slate-100">{hoveredSquare.origin}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">{hoveredSquare.portName}</span>
          </div>
          <div className="text-slate-400">
            <span className="text-slate-500">age</span> {AGE_LABEL[hoveredSquare.ageBin]}
          </div>
          {hoveredSquare.market === "RC" && hoveredSquare.klass != null && (
            <div className="text-slate-400">
              <span className="text-slate-500">quality</span>{" "}
              <span style={{ color: CLASS_BORDER_RC[hoveredSquare.klass] ?? "#94a3b8" }}>
                {CLASS_LABEL_RC[hoveredSquare.klass] ?? `Class ${hoveredSquare.klass}`}
              </span>
            </div>
          )}
          {hoveredSquare.status !== "filled" && (
            <div className="text-[9px] text-slate-600 italic mt-0.5">
              {hoveredSquare.status === "gained" ? "net gained over window"
                : hoveredSquare.status === "ghost" ? "lost over window"
                : "in & out over window"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
