"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ── Data shapes (mirror backend/scraper/sources/ice_certified_stocks/orchestrate.py) ─

interface SectionHierarchy {
  grand_total: number;
  by_port:   Record<string, number>;
  by_group:  Record<string, number>;
  by_origin: Record<string, { by_port: Record<string, number>; group: string; total: number }>;
}
interface ArabicaSnap {
  date: string;
  report_date: string | null;
  total_bags: number;
  transition_bags: number;
  pending_grading_bags: number;
  rebagging_bags: number;
  passed_today_bags: number;
  failed_today_bags: number;
  by_port: Record<string, number>;
  by_group: Record<string, number>;
  // Full hierarchy per section, populated by orchestrator. May be absent on
  // snapshots written by an older run — the table falls back to the flat
  // fields above when `sections` is undefined.
  sections?: {
    total_certified?: SectionHierarchy;
    transition?:      SectionHierarchy;
    pending_grading?: SectionHierarchy;
    rebagging?:       SectionHierarchy;
  };
  // Issuance / receipt — populated by the workbook importer (sheet 8a).
  issuers_today?:        Array<{ port: string; issuer: string;  value: number }>;
  stoppers_today?:       Array<{ port: string; stopper: string; value: number }>;
  issued_total_today?:   number;
  received_total_today?: number;
}
interface MatrixSection {
  ports: string[];
  by_port: Record<string, number>;
  by_group: Record<string, number>;
  grand_total: number;
  by_origin?: Record<string, { by_port: Record<string, number>; group: string; total: number }>;
}
interface ArabicaJson {
  generated_at: string;
  as_of: string | null;
  source_url: string | null;
  snapshots: ArabicaSnap[];
  latest_detail: {
    report_date: string | null;
    total_certified: MatrixSection | null;
    transition: MatrixSection | null;
    pending_grading: MatrixSection | null;
    rebagging: MatrixSection | null;
    grading_today: { passed_today_bags: number; failed_today_bags: number; passed_text: string | null; failed_text: string | null } | null;
  } | null;
  errors: string[];
}

interface RobustaSnap {
  date: string;
  cut_off_date: string | null;
  total_lots_certified: number;
  non_tend_lots: number;
  suspended_lots: number;
  lots_graded_today: number;
  lots_sold_today: number;
  lots_bought_today: number;
  tenders_today: number;
  by_port_lots: Record<string, number>;
}
interface RobustaStockReport {
  cut_off_date: string | null;
  ports: Array<{ port_id: string; port_name: string | null; with_val_cert: number; non_tend: number; suspended: number }>;
  grand_total: { with_val_cert: number; non_tend: number; suspended: number };
}
interface RobustaJson {
  generated_at: string;
  as_of: string | null;
  snapshots: RobustaSnap[];
  latest_detail: { stock_report: RobustaStockReport | null; stock_report_url: string | null };
  recent_activity: {
    gradings: Array<{
      date: string;
      entries?: Array<{ origin?: string; port?: string; class?: number | null; tenderable?: boolean; lots: number }>;
      summary?: { lots_graded_today: number; tenderable_today?: number; non_tenderable_today?: number };
    }>;
    grading_appeals: Array<{ date: string }>;
    iss_recv_daily: Array<{
      date: string;
      delivery_date?: string | null;
      members?: Array<{
        code: string;
        rows: Array<{ origin: string; sold: number; bought: number }>;
        total_sold: number;
        total_bought: number;
      }>;
      grand_total?: { sold: number; bought: number };
    }>;
    tenders: Array<{ date: string; totals_today?: { originals?: number } }>;
    grading_overview: Array<{ date: string; total_pending_lots: number | null }>;
    infested_warrants: Array<{ date: string; suspended?: { total_lots: number } }>;
  };
  monthly: {
    iss_recv_monthly: Array<{ month: string | null; grand_total?: { sold: number; bought: number } }>;
    age_allowance: Array<{
      month_end: string;
      valid?: {
        ports?: string[];
        buckets?: Array<{ months_since_graded: number; by_port: Record<string, number>; grand_total_mt: number }>;
        totals_by_port?: Record<string, number>;
        grand_total_mt?: number;
      } | null;
    }>;
  };
}

// ── Unit conversion (raw stored in native units: arabica=bags, robusta=lots) ──

type Unit = "bags" | "tonnes" | "lots";
const KG_PER_BAG = 60;
const TONNES_PER_LOT = 10;
const BAGS_PER_LOT = (TONNES_PER_LOT * 1000) / KG_PER_BAG;   // 166.67

function fromBags(bags: number, u: Unit): number {
  if (u === "bags")   return bags;
  if (u === "tonnes") return (bags * KG_PER_BAG) / 1000;
  return bags / BAGS_PER_LOT;
}
function fromLots(lots: number, u: Unit): number {
  if (u === "lots")   return lots;
  if (u === "tonnes") return lots * TONNES_PER_LOT;
  return lots * BAGS_PER_LOT;
}
const fmt = (n: number, u: Unit): string => {
  if (!Number.isFinite(n)) return "—";
  const rounded = u === "lots" ? Math.round(n * 10) / 10 : Math.round(n);
  return rounded.toLocaleString("en-US");
};
const unitSuffix = (u: Unit) => u === "bags" ? "bags" : u === "tonnes" ? "t" : "lots";

// ── Small reusable bits ───────────────────────────────────────────────────────

function StatusPill({ live }: { live: boolean }) {
  return (
    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border
      ${live ? "border-emerald-700 text-emerald-400 bg-emerald-900/30"
             : "border-amber-700  text-amber-400  bg-amber-900/20"}`}>
      {live ? "live" : "pending"}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-base font-semibold text-slate-100 font-mono">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 font-mono">{sub}</div>}
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <div className="text-[10px] text-slate-500 italic border border-dashed border-slate-700 rounded px-2 py-3">
      {label} — pending (scraper hasn’t populated yet).
    </div>
  );
}

function MiniTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-[11px] font-mono">
      <thead>
        <tr className="text-slate-500 border-b border-slate-800">
          {headers.map((h, i) => (
            <th key={h} className={`py-1 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-slate-900 last:border-0">
            {r.map((c, ci) => (
              <td key={ci} className={`py-0.5 ${ci === 0 ? "text-slate-300 text-left" : "text-slate-100 text-right"}`}>
                {typeof c === "number" ? c.toLocaleString("en-US") : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Period windows (each column = a date window, not a single date) ──────────
// Flow metrics (Graded · Poison · Decertified · Issued) sum across the window;
// inventory metrics (Stocks · Pending grading) read the end-of-window snapshot.

interface PeriodCol { label: string; start: Date; end: Date }

function _addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function _endOfMonth(today: Date, monthsAgo: number): Date {
  return new Date(today.getFullYear(), today.getMonth() - monthsAgo + 1, 0);
}
function _monthShort(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function _periodColumns(today: Date): PeriodCol[] {
  const cols: PeriodCol[] = [
    { label: "Current", start: _addDays(today, -6), end: today },
    { label: "1w ago",  start: _addDays(today, -13), end: _addDays(today, -7) },
  ];
  for (let i = 1; i <= 6; i++) {
    const eoM = _endOfMonth(today, i);
    const start = new Date(eoM.getFullYear(), eoM.getMonth(), 1);
    cols.push({ label: _monthShort(eoM), start, end: eoM });
  }
  return cols;
}

function _closestSnap<T extends { date: string }>(snaps: T[], target: Date, maxDaysOff = 7): T | null {
  if (!snaps.length) return null;
  let best: T | null = null;
  let bestDist = Infinity;
  for (const s of snaps) {
    const dist = Math.abs(new Date(s.date).getTime() - target.getTime());
    if (dist < bestDist) { best = s; bestDist = dist; }
  }
  if (bestDist > maxDaysOff * 86_400_000) return null;
  return best;
}

function _snapshotsInWindow<T extends { date: string }>(snaps: T[], w: PeriodCol): T[] {
  const s = w.start.getTime();
  const e = w.end.getTime() + 86_400_000;        // inclusive of end day
  return snaps.filter((sn) => {
    const t = new Date(sn.date).getTime();
    return t >= s && t < e;
  });
}

function _endOfWindowSnap<T extends { date: string }>(snaps: T[], w: PeriodCol, slack = 7): T | null {
  return _closestSnap(snaps, w.end, slack);
}

function _startOfWindowPrevSnap<T extends { date: string }>(snaps: T[], w: PeriodCol): T | null {
  // Most recent snapshot whose date is strictly BEFORE the window start —
  // used as the "previous stock" baseline for the Decertified formula.
  const beforeStart = snaps.filter((s) => new Date(s.date) < w.start);
  if (!beforeStart.length) return null;
  return beforeStart[beforeStart.length - 1];
}

// ── Arabica period table — rewritten with window semantics + flow/inv split ──

type ArabicaMetric =
  | "Pending grading" | "Graded" | "Passing rate"
  | "Stocks" | "Decertified" | "Issued";

const ARABICA_METRICS: ArabicaMetric[] = [
  "Pending grading", "Graded", "Passing rate",
  "Stocks", "Decertified", "Issued",
];

// Per-row drill-down support. Only rows where the source data carries the
// breakdown (or can be defensibly inferred) get a ▸. Others render flat.
type Drill = "none" | "port_origin" | "port_group_origin" | "port_age_origin"
           | "port_origin_inferred" | "port" | "port_issuer" | "member_origin"
           | "passing_breakdown" | "graded_with_poison" | "queue_forecast";
const ARABICA_DRILL: Record<ArabicaMetric, Drill> = {
  "Pending grading": "port_group_origin",   // port → ICE group → origin
  "Graded":          "port_origin_inferred", // delta of certified by_port × by_origin
  "Passing rate":    "none",                 // arabica poison TBD → no breakdown yet
  "Stocks":          "port_group_origin",   // port → ICE group → origin (same shape as Pending)
  "Decertified":     "port_group_origin",   // per-port outflow split by group → origin
  "Issued":          "port_issuer",         // workbook sheet 8a populates issuers_today
};

// ICE C-contract group ordering. Drives the Pending grading drill display.
const ARABICA_GROUP_ORDER = ["Group 0", "Group 1", "Group 2", "Group 3", "Group 4", "Unknown"];

// (Path identity is positional now — passed inline as ports/age/origin args.)

// Single value accessor — handles every drill level + the scalar metrics.
// Section value accessor — point-in-time read of a snapshot's hierarchy.
// Supports drill paths: port, port+group, port+group+origin, port+origin.
function _sectValue(
  snap: ArabicaSnap | null, sectKey: keyof NonNullable<ArabicaSnap["sections"]>,
  port?: string, group?: string, origin?: string,
): number | null {
  if (!snap) return null;
  const sec = snap.sections?.[sectKey];
  if (!sec) {
    // Fallback to flat fields for older snapshots without `sections`.
    if (!port && !group && !origin) {
      if (sectKey === "total_certified") return snap.total_bags;
      if (sectKey === "pending_grading") return snap.pending_grading_bags;
      if (sectKey === "transition")      return snap.transition_bags;
      if (sectKey === "rebagging")       return snap.rebagging_bags;
    }
    return null;
  }
  if (!port && !group && !origin) return sec.grand_total;
  if (port && !group && !origin)  return sec.by_port?.[port] ?? null;
  if (port && group && !origin) {
    // Sum bags at this port across origins assigned to this group.
    let total = 0;
    for (const od of Object.values(sec.by_origin || {})) {
      if (od.group === group) total += od.by_port?.[port] ?? 0;
    }
    return total;
  }
  if (port && origin) {
    // Group is implied by origin's group field; just look up the leaf.
    return sec.by_origin?.[origin]?.by_port?.[port] ?? null;
  }
  return null;
}

// Sum a field of `snap` across the snapshots inside the window.
function _sumWindow(snaps: ArabicaSnap[], w: PeriodCol, field: keyof ArabicaSnap): number {
  return _snapshotsInWindow(snaps, w).reduce((t, s) => t + (Number(s[field] ?? 0) || 0), 0);
}

// Inferred Graded by port × origin = positive day-over-day delta of certified
// by port × origin across the window. Conservative (negative deltas = outflow,
// ignored). Captures gross inflow into certified, which IS the grading event.
function _gradedByDelta(
  snaps: ArabicaSnap[],
  w: PeriodCol,
  port?: string,
  origin?: string,
): number | null {
  const inWin = _snapshotsInWindow(snaps, w);
  if (inWin.length < 1) return null;
  const startBase = _startOfWindowPrevSnap(snaps, w) ?? inWin[0];
  // Walk through snapshots and accumulate positive deltas.
  let total = 0;
  let prev: ArabicaSnap = startBase;
  for (const s of inWin) {
    const a = _sectValue(prev, "total_certified", port, undefined, origin) ?? 0;
    const b = _sectValue(s,    "total_certified", port, undefined, origin) ?? 0;
    const delta = b - a;
    if (delta > 0) total += delta;
    prev = s;
  }
  return total;
}

// Period rollups for the top-level cells.
interface RowVal { value: number | null; isInferred?: boolean }

function _arabicaRowValue(
  metric: ArabicaMetric, snaps: ArabicaSnap[], w: PeriodCol,
  port?: string, group?: string, origin?: string, issuer?: string,
): RowVal {
  const endSnap = _endOfWindowSnap(snaps, w);
  const startBase = _startOfWindowPrevSnap(snaps, w);

  if (metric === "Pending grading") {
    return { value: _sectValue(endSnap, "pending_grading", port, group, origin) };
  }
  if (metric === "Stocks") {
    return { value: _sectValue(endSnap, "total_certified", port, group, origin) };
  }
  if (metric === "Graded") {
    return { value: _gradedByDelta(snaps, w, port, origin), isInferred: !!(port || origin) };
  }
  if (metric === "Passing rate") {
    const g = _sumWindow(snaps, w, "passed_today_bags");
    const f = _sumWindow(snaps, w, "failed_today_bags");
    const tot = g + f;
    return { value: tot === 0 ? null : g / tot };
  }
  if (metric === "Decertified") {
    if (!endSnap || !startBase) return { value: null };
    if (port && group && origin) {
      // Per-origin: outflow = prev − current (no per-origin passed in source).
      const prev = _sectValue(startBase, "total_certified", port, group, origin) ?? 0;
      const cur  = _sectValue(endSnap,   "total_certified", port, group, origin) ?? 0;
      return { value: prev - cur, isInferred: true };
    }
    if (port && group) {
      const prev = _sectValue(startBase, "total_certified", port, group) ?? 0;
      const cur  = _sectValue(endSnap,   "total_certified", port, group) ?? 0;
      return { value: prev - cur, isInferred: true };
    }
    if (port) {
      const prevP = _sectValue(startBase, "total_certified", port) ?? 0;
      const curP  = _sectValue(endSnap,   "total_certified", port) ?? 0;
      const passedP = _gradedByDelta(snaps, w, port) ?? 0;
      return { value: prevP + passedP - curP, isInferred: true };
    }
    const passedSum = _sumWindow(snaps, w, "passed_today_bags");
    return { value: startBase.total_bags + passedSum - endSnap.total_bags };
  }
  if (metric === "Issued") {
    // Sourced from per-snapshot issuers_today (TODAY values from sheet 8a).
    const inWin = _snapshotsInWindow(snaps, w);
    if (port && issuer) {
      let total = 0;
      for (const s of inWin) {
        for (const e of (s.issuers_today || [])) {
          if (e.port === port && e.issuer === issuer) total += e.value || 0;
        }
      }
      return { value: total };
    }
    if (port) {
      let total = 0;
      for (const s of inWin) {
        for (const e of (s.issuers_today || [])) {
          if (e.port === port) total += e.value || 0;
        }
      }
      return { value: total };
    }
    let total = 0;
    for (const s of inWin) total += (s.issued_total_today || 0);
    return { value: total };
  }
  return { value: null };
}

// Master entity lists for drill rendering. We UNION across every column
// window (Current + 1w ago + last 6 month-ends), not just Current, because
// e.g. Group 4 may be absent from this week but present in last month — the
// user still needs the drill to surface it so the historical columns show.
function _portsForMetric(snaps: ArabicaSnap[], cols: PeriodCol[], metric: ArabicaMetric): string[] {
  const set = new Set<string>();
  for (const w of cols) {
    const endSnap = _endOfWindowSnap(snaps, w);
    if (metric === "Pending grading") {
      Object.entries(endSnap?.sections?.pending_grading?.by_port || {}).forEach(([p, v]) => v > 0 && set.add(p));
    } else if (metric === "Stocks") {
      Object.entries(endSnap?.sections?.total_certified?.by_port || {}).forEach(([p, v]) => v > 0 && set.add(p));
    } else if (metric === "Graded" || metric === "Decertified") {
      for (const s of _snapshotsInWindow(snaps, w)) {
        Object.keys(s.sections?.total_certified?.by_port || {}).forEach((p) => set.add(p));
      }
      const startBase = _startOfWindowPrevSnap(snaps, w);
      Object.keys(startBase?.sections?.total_certified?.by_port || {}).forEach((p) => set.add(p));
    } else if (metric === "Issued") {
      for (const s of _snapshotsInWindow(snaps, w)) {
        for (const e of (s.issuers_today || [])) set.add(e.port);
      }
    }
  }
  return Array.from(set).sort();
}

// Groups (Pending grading · Stocks · Decertified) that ever appear for this
// (port) across the column set. Avoids hiding Group 2/4 when Current happens
// to be Group-0-only.
function _groupsForCell(snaps: ArabicaSnap[], cols: PeriodCol[], metric: ArabicaMetric, port: string): string[] {
  const sectKey: keyof NonNullable<ArabicaSnap["sections"]> | null =
    metric === "Pending grading" ? "pending_grading"
    : metric === "Stocks" || metric === "Decertified" ? "total_certified"
    : null;
  if (!sectKey) return [];
  const set = new Set<string>();
  for (const w of cols) {
    const endSnap = _endOfWindowSnap(snaps, w);
    for (const d of Object.values(endSnap?.sections?.[sectKey]?.by_origin || {})) {
      if ((d.by_port?.[port] ?? 0) > 0) set.add(d.group);
    }
  }
  return ARABICA_GROUP_ORDER.filter((g) => set.has(g));
}

// Origins under (port [, group]) across the column set.
function _originsForCell(
  snaps: ArabicaSnap[], cols: PeriodCol[], metric: ArabicaMetric, port: string, group?: string,
): string[] {
  const sectKey: keyof NonNullable<ArabicaSnap["sections"]> | null =
    metric === "Pending grading" ? "pending_grading"
    : metric === "Stocks" || metric === "Decertified" || metric === "Graded" ? "total_certified"
    : null;
  if (!sectKey) return [];
  const set = new Set<string>();
  for (const w of cols) {
    const endSnap = _endOfWindowSnap(snaps, w);
    for (const [o, d] of Object.entries(endSnap?.sections?.[sectKey]?.by_origin || {})) {
      if ((d.by_port?.[port] ?? 0) > 0 && (!group || d.group === group)) set.add(o);
    }
  }
  return Array.from(set).sort();
}

// Issuers ever seen at this port across the column set.
function _issuersForPort(snaps: ArabicaSnap[], cols: PeriodCol[], port: string): string[] {
  const set = new Set<string>();
  for (const w of cols) {
    for (const s of _snapshotsInWindow(snaps, w)) {
      for (const e of (s.issuers_today || [])) {
        if (e.port === port) set.add(e.issuer);
      }
    }
  }
  return Array.from(set).sort();
}

function ArabicaPeriodTable({ snapshots, unit }: { snapshots: ArabicaSnap[]; unit: Unit }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (!snapshots.length) return <Pending label="Period view" />;

  const today = new Date();
  const cols = _periodColumns(today);

  const fmtCell = (v: RowVal): string => {
    if (v.value == null) return "—";
    const shown = fmt(fromBags(v.value, unit), unit);
    return v.isInferred ? shown + "*" : shown;
  };
  const fmtPct = (v: RowVal): string => v.value == null ? "—" : `${Math.round(v.value * 100)}%`;

  const indent = (lvl: number) => ({ paddingLeft: 8 + lvl * 14 });

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        Period view ({unitSuffix(unit)}) — flow metrics sum across each window; inventory metrics use end-of-window snapshot
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-1 pr-2 w-[170px]">Metric</th>
              {cols.map((c) => <th key={c.label} className="text-right py-1 px-1.5">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ARABICA_METRICS.map((metric) => {
              const drill = ARABICA_DRILL[metric];
              const isOpen = drill !== "none" && expanded.has(metric);
              const arrow = drill === "none" ? "  " : (isOpen ? "▾" : "▸");

              return (
                <Fragment key={metric}>
                  <tr className="border-b border-slate-900">
                    <td
                      className={`text-slate-300 text-left py-1 ${drill !== "none" ? "cursor-pointer hover:text-amber-300" : ""}`}
                      style={indent(0)}
                      onClick={() => drill !== "none" && toggle(metric)}
                    >
                      <span className="text-amber-500/80 inline-block w-3">{arrow}</span>{" "}{metric}
                    </td>
                    {cols.map((c, i) => (
                      <td key={i} className="text-slate-100 text-right py-1 px-1.5">
                        {metric === "Passing rate"
                          ? fmtPct(_arabicaRowValue(metric, snapshots, c))
                          : fmtCell(_arabicaRowValue(metric, snapshots, c))}
                      </td>
                    ))}
                  </tr>

                  {/* Port sub-rows */}
                  {isOpen && cols.length > 0 && (() => {
                    const ports = _portsForMetric(snapshots, cols, metric);
                    return ports.map((port) => {
                      const portKey = `${metric}/${port}`;
                      const portOpen = expanded.has(portKey);
                      return (
                        <Fragment key={portKey}>
                          <tr className="border-b border-slate-900 bg-slate-900/40">
                            <td
                              className="text-slate-400 text-left py-0.5 cursor-pointer hover:text-amber-300"
                              style={indent(1)}
                              onClick={() => toggle(portKey)}
                            >
                              <span className="text-amber-500/60 inline-block w-3">
                                {portOpen ? "▾" : "▸"}
                              </span>{" "}{port}
                            </td>
                            {cols.map((c, i) => (
                              <td key={i} className="text-slate-200 text-right py-0.5 px-1.5">
                                {fmtCell(_arabicaRowValue(metric, snapshots, c, port))}
                              </td>
                            ))}
                          </tr>

                          {/* Group level → origins (port → group → origin) */}
                          {portOpen && drill === "port_group_origin" && _groupsForCell(snapshots, cols, metric, port).map((group) => {
                            const grpKey = `${portKey}/${group}`;
                            const grpOpen = expanded.has(grpKey);
                            const origins = grpOpen ? _originsForCell(snapshots, cols, metric, port, group) : [];
                            return (
                              <Fragment key={grpKey}>
                                <tr className="border-b border-slate-900 bg-slate-900/20">
                                  <td
                                    className="text-slate-500 text-left py-0.5 cursor-pointer hover:text-amber-300"
                                    style={indent(2)}
                                    onClick={() => toggle(grpKey)}
                                  >
                                    <span className="text-amber-500/40 inline-block w-3">{grpOpen ? "▾" : "▸"}</span>{" "}{group}
                                  </td>
                                  {cols.map((c, i) => (
                                    <td key={i} className="text-slate-300 text-right py-0.5 px-1.5">
                                      {fmtCell(_arabicaRowValue(metric, snapshots, c, port, group))}
                                    </td>
                                  ))}
                                </tr>
                                {grpOpen && origins.map((origin) => (
                                  <tr key={`${grpKey}/${origin}`} className="border-b border-slate-900">
                                    <td className="text-slate-500 text-left py-0.5 italic" style={indent(3)}>{origin}</td>
                                    {cols.map((c, i) => (
                                      <td key={i} className="text-slate-400 text-right py-0.5 px-1.5">
                                        {fmtCell(_arabicaRowValue(metric, snapshots, c, port, group, origin))}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}

                          {/* Origin level for Graded (port → origin inferred from delta) */}
                          {portOpen && (drill === "port_origin" || drill === "port_origin_inferred") &&
                            _originsForCell(snapshots, cols, metric, port).map((origin) => (
                              <tr key={`${portKey}/${origin}`} className="border-b border-slate-900">
                                <td className="text-slate-500 text-left py-0.5 italic" style={indent(2)}>{origin}</td>
                                {cols.map((c, i) => (
                                  <td key={i} className="text-slate-400 text-right py-0.5 px-1.5">
                                    {fmtCell(_arabicaRowValue(metric, snapshots, c, port, undefined, origin))}
                                  </td>
                                ))}
                              </tr>
                            ))
                          }

                          {/* Issuer level (Issued: port → issuer) */}
                          {portOpen && drill === "port_issuer" && _issuersForPort(snapshots, cols, port).map((issuer) => (
                            <tr key={`${portKey}/${issuer}`} className="border-b border-slate-900">
                              <td className="text-slate-500 text-left py-0.5 italic" style={indent(2)}>{issuer}</td>
                              {cols.map((c, i) => (
                                <td key={i} className="text-slate-400 text-right py-0.5 px-1.5">
                                  {fmtCell(_arabicaRowValue(metric, snapshots, c, port, undefined, undefined, issuer))}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    });
                  })()}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-slate-600 italic mt-1 space-y-0.5">
        <div>
          Flow metrics (Graded · Decertified · Issued) sum across each window. Inventory metrics
          (Stocks · Pending) show the end-of-window snapshot. <strong>* = inferred</strong> from
          day-over-day delta of certified by port × origin (the xls publishes only daily totals
          for grading, not per-port breakdown). Decertified = prev_stock + Σpassed − stock.
          Issued · per-issuer breakdown from ICE iss/recv sheet (clearing-member firms).
        </div>
      </div>
    </div>
  );
}

// ── Arabica column ────────────────────────────────────────────────────────────

function ArabicaColumn({ d, unit }: { d: ArabicaJson | null; unit: Unit }) {
  const live = !!d && d.snapshots.length > 0;
  const latestSnap = d?.snapshots.at(-1) || null;
  const ld = d?.latest_detail || null;

  const totalDisplay   = latestSnap ? fmt(fromBags(latestSnap.total_bags,           unit), unit) + " " + unitSuffix(unit) : "—";
  const pendingDisplay = latestSnap ? fmt(fromBags(latestSnap.pending_grading_bags, unit), unit) + " " + unitSuffix(unit) : "—";
  const gradedDisplay  = latestSnap ? fmt(fromBags(latestSnap.passed_today_bags,    unit), unit) + " " + unitSuffix(unit) : "—";
  const failedDisplay  = latestSnap ? fmt(fromBags(latestSnap.failed_today_bags,    unit), unit) + " " + unitSuffix(unit) : "—";

  const groupRows = useMemo(() => {
    const src = latestSnap?.by_group || ld?.total_certified?.by_group || {};
    return Object.entries(src)
      .filter(([_, b]) => b > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([g, b]) => [g, fmt(fromBags(b, unit), unit)] as [string, string]);
  }, [latestSnap, ld, unit]);

  const portRows = useMemo(() => {
    const src = latestSnap?.by_port || ld?.total_certified?.by_port || {};
    return Object.entries(src)
      .filter(([_, b]) => b > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([p, b]) => [p, fmt(fromBags(b, unit), unit)] as [string, string]);
  }, [latestSnap, ld, unit]);

  const chartRows = useMemo(() => (
    (d?.snapshots || []).map(s => ({ d: s.date.slice(5), v: fromBags(s.total_bags, unit) }))
  ), [d, unit]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-amber-400">Arabica · ICE Futures US (KC)</div>
          <div className="text-[10px] text-slate-500">
            as of <span className="font-mono">{d?.as_of ?? "—"}</span>
            {d && <span className="ml-2">· {d.snapshots.length} snapshots in window</span>}
          </div>
        </div>
        <StatusPill live={live} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total certified" value={totalDisplay} />
        <Stat label="Pending grading" value={pendingDisplay} />
        <Stat label="Graded today"    value={gradedDisplay} />
        <Stat label="Failed today"    value={failedDisplay} />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By ICE group (latest)</div>
        {groupRows.length === 0
          ? <Pending label="Group rollup" />
          : <MiniTable headers={["Group", unitSuffix(unit)]} rows={groupRows} />}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By delivery port (latest)</div>
        {portRows.length === 0
          ? <Pending label="Port breakdown" />
          : <MiniTable headers={["Port", unitSuffix(unit)]} rows={portRows} />}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Total certified — last {chartRows.length} business days
        </div>
        {chartRows.length === 0 ? <Pending label="History" /> : (
          <div className="h-32 bg-slate-900 border border-slate-700 rounded-md p-2">
            <ResponsiveContainer>
              <AreaChart data={chartRows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="d" tick={{ fontSize: 9, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={42}
                       tickFormatter={(v) => fmt(v, unit)} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", fontSize: 10 }}
                         formatter={(v) => [fmt(Number(v ?? 0), unit) + " " + unitSuffix(unit), "total"]} />
                <Area type="monotone" dataKey="v" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={1.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {d?.errors && d.errors.length > 0 && (
        <div className="text-[9px] text-slate-600 italic">Missing: {d.errors.join("; ")}</div>
      )}

      <ArabicaPeriodTable snapshots={d?.snapshots || []} unit={unit} />
    </div>
  );
}

// ── Robusta period table (parallel to arabica's, lots-native) ────────────────

// ── Robusta period table (parallel to arabica, lots-native, age = months) ────

interface GradingEvent {
  date: string;
  entries?: Array<{ origin?: string; port?: string; class?: number | null; tenderable?: boolean; lots: number }>;
  summary?: {
    tenderable_today?: number;
    non_tenderable_today?: number;
    lots_graded_today?: number;
  };
}
interface OverviewEvent {
  date: string;
  total_pending_lots?: number | null;
  queue_lots?: number | null;
  forecast_lots?: number | null;
}
interface AgeAllowanceMonth {
  month_end: string;
  valid?: {
    ports?: string[];
    buckets?: Array<{ months_since_graded: number; by_port: Record<string, number>; grand_total_mt: number }>;
    totals_by_port?: Record<string, number>;
    grand_total_mt?: number;
  } | null;
}

type RobustaMetric =
  | "Pending grading" | "Graded" | "Passing rate"
  | "Stocks" | "Decertified" | "Issued";

const ROBUSTA_METRICS: RobustaMetric[] = [
  "Pending grading", "Graded", "Passing rate",
  "Stocks", "Decertified", "Issued",
];
const ROBUSTA_DRILL: Record<RobustaMetric, Drill> = {
  "Pending grading": "queue_forecast",       // 2 sub-rows: queue + forecast (source has no port)
  "Graded":          "graded_with_poison",   // sub-rows: of which Coffee / Poison, each drillable by port → origin
  "Passing rate":    "passing_breakdown",    // 2 sub-rows: of which Poison / Coffee (% terminal)
  "Stocks":          "port_age_origin",      // by_port_lots × age_allowance buckets (labels as graded month)
  "Decertified":     "port_age_origin",      // same drill shape as Stocks
  "Issued":          "member_origin",        // iss_recv_daily.members → rows[].origin
};

// ── Poison criteria (Robusta) ────────────────────────────────────────────────
// A graded lot is flagged "Poison" if ANY criterion matches. The classification
// applies *within tenderable lots only* — Poison is "passed grading but low
// quality", not "failed grading". Editable as the spec evolves.
const ROBUSTA_POISON_PORTS = new Set(["LON", "NYK"]);          // London + NY-like slot
const ROBUSTA_POISON_CLASSES = new Set([3, 4]);                // allowance −60 (class 3) / −90 (class 4)
const ROBUSTA_POISON_ORIGINS = new Set(["Brazilian Conillon"]);

interface GradingEntry {
  origin?: string; port?: string;
  class?: number | null;
  tenderable?: boolean;
  lots: number;
}

function _isRobustaPoison(e: GradingEntry): boolean {
  if (e.port && ROBUSTA_POISON_PORTS.has(e.port)) return true;
  if (e.class != null && ROBUSTA_POISON_CLASSES.has(e.class)) return true;
  if (e.origin && ROBUSTA_POISON_ORIGINS.has(e.origin)) return true;
  return false;
}

// Sum a numeric field of robusta snapshots within the window.
function _rSum(snaps: RobustaSnap[], w: PeriodCol, field: keyof RobustaSnap): number {
  return _snapshotsInWindow(snaps, w).reduce((t, s) => t + (Number(s[field] ?? 0) || 0), 0);
}

// Aggregate per (port, origin) over gradings entries matching `predicate` within
// the window. Predicate-based so callers can ask for tenderable, non-tenderable,
// poison (= tenderable ∩ low-quality criteria), or coffee (= tenderable − poison).
function _aggregateGradings(
  gradings: GradingEvent[], w: PeriodCol,
  predicate: (e: GradingEntry) => boolean,
): { byPort: Record<string, number>; byPortOrigin: Record<string, Record<string, number>>; total: number } {
  const events = _snapshotsInWindow(gradings, w);
  const byPort: Record<string, number> = {};
  const byPortOrigin: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const ev of events) {
    for (const e of (ev.entries || []) as GradingEntry[]) {
      if (!predicate(e)) continue;
      const port = e.port || "?";
      const origin = e.origin || "?";
      byPort[port]            = (byPort[port] ?? 0) + (e.lots ?? 0);
      byPortOrigin[port]      = byPortOrigin[port] ?? {};
      byPortOrigin[port][origin] = (byPortOrigin[port][origin] ?? 0) + (e.lots ?? 0);
      total += e.lots ?? 0;
    }
  }
  return { byPort, byPortOrigin, total };
}

// Convenience predicates used across the robusta computations.
const _GRAD_TENDERABLE     = (e: GradingEntry) => e.tenderable !== false;
const _GRAD_NON_TENDERABLE = (e: GradingEntry) => e.tenderable === false;
const _GRAD_POISON         = (e: GradingEntry) => e.tenderable !== false && _isRobustaPoison(e);
const _GRAD_COFFEE         = (e: GradingEntry) => e.tenderable !== false && !_isRobustaPoison(e);

// Closest age-allowance month-end snapshot to the window end (≤ 60 days).
function _ageAllowanceForWindow(months: AgeAllowanceMonth[], w: PeriodCol): AgeAllowanceMonth | null {
  if (!months.length) return null;
  const target = w.end.getTime();
  let best: AgeAllowanceMonth | null = null;
  let bestDist = Infinity;
  for (const m of months) {
    const t = new Date(m.month_end).getTime();
    const dist = Math.abs(t - target);
    if (dist < bestDist) { best = m; bestDist = dist; }
  }
  if (bestDist > 60 * 86_400_000) return null;
  return best;
}

interface RobustaRowVal { value: number | null; isInferred?: boolean }

function _robustaRowValue(
  metric: RobustaMetric,
  snaps: RobustaSnap[], gradings: GradingEvent[], overview: OverviewEvent[], ageMonths: AgeAllowanceMonth[],
  w: PeriodCol, port?: string, age?: string, origin?: string,
): RobustaRowVal {
  const endSnap = _endOfWindowSnap(snaps, w);
  const startBase = _startOfWindowPrevSnap(snaps, w);

  if (metric === "Pending grading") {
    // total_pending_lots is queue + forecast (10t units). Use the closest
    // grading_overview event to the window end.
    const ov = _closestSnap(overview, w.end, 14);
    return { value: ov?.total_pending_lots ?? null };
  }
  if (metric === "Graded") {
    // Top-level total (= passed grading, tenderable). Drill-down is rendered
    // as Coffee / Poison sub-rows in the table; the per-(port[, origin])
    // values for those sub-rows are computed there via _aggregateGradings,
    // not through this row-value function.
    const agg = _aggregateGradings(gradings, w, _GRAD_TENDERABLE);
    if (!port && !origin) return { value: agg.total };
    if (port && !origin)  return { value: agg.byPort[port] ?? 0 };
    if (port && origin)   return { value: agg.byPortOrigin[port]?.[origin] ?? 0 };
    return { value: null };
  }
  if (metric === "Passing rate") {
    const t = _aggregateGradings(gradings, w, _GRAD_TENDERABLE).total;
    const n = _aggregateGradings(gradings, w, _GRAD_NON_TENDERABLE).total;
    const tot = t + n;
    return { value: tot === 0 ? null : t / tot };
  }
  if (metric === "Stocks") {
    if (age && port) {
      // Look up that specific age bucket × port in the age-allowance snapshot.
      const m = _ageAllowanceForWindow(ageMonths, w);
      const bucket = m?.valid?.buckets?.find((b) => `${b.months_since_graded} mo` === age);
      if (!bucket) return { value: null };
      const lotsFromMt = (mt: number) => mt / TONNES_PER_LOT;
      if (origin) {
        // Origin under (port, age) is INFERRED from gradings in the month
        // that produced this age bucket. Take all gradings in that month
        // at this port and weight origins by their lots share.
        return { value: null, isInferred: true };  // v1 placeholder — see below
      }
      return { value: lotsFromMt(bucket.by_port?.[port] ?? 0) };
    }
    if (port && !age) {
      return { value: endSnap?.by_port_lots?.[port] ?? null };
    }
    return { value: endSnap?.total_lots_certified ?? null };
  }
  if (metric === "Decertified") {
    if (!endSnap || !startBase) return { value: null };
    if (port && age) {
      // Per (port, age): month-over-month change in that bucket. The
      // age-allowance .xlsx publishes the snapshot of the bucket at each
      // month-end; the decrease is "lots that aged out" — typically because
      // they were decertified. Inferred (not directly published).
      const cur  = _ageAllowanceForWindow(ageMonths, w);
      // Prev month-end relative to this window.
      const prevTarget = new Date(w.end);
      prevTarget.setMonth(prevTarget.getMonth() - 1);
      const prev = _ageAllowanceForWindow(
        ageMonths, { ...w, end: prevTarget } as PeriodCol,
      );
      const cb = cur?.valid?.buckets?.find((b) => `${b.months_since_graded} mo` === age);
      const pb = prev?.valid?.buckets?.find((b) => `${b.months_since_graded} mo` === age);
      if (!cb && !pb) return { value: null, isInferred: true };
      const prevV = (pb?.by_port?.[port] ?? 0) / TONNES_PER_LOT;
      const curV  = (cb?.by_port?.[port] ?? 0) / TONNES_PER_LOT;
      if (origin) {
        // Origin layer not directly available — inferred placeholder.
        return { value: null, isInferred: true };
      }
      const decert = prevV - curV;
      return { value: decert > 0 ? decert : 0, isInferred: true };
    }
    if (port) {
      // Per-port: prev_stock_port + Σpassed_port (from gradings) − cur_stock_port
      const prevP = startBase.by_port_lots?.[port] ?? 0;
      const curP  = endSnap.by_port_lots?.[port] ?? 0;
      const passedP = _aggregateGradings(gradings, w, _GRAD_TENDERABLE).byPort[port] ?? 0;
      return { value: prevP + passedP - curP };
    }
    const passedSum = _aggregateGradings(gradings, w, _GRAD_TENDERABLE).total;
    return { value: startBase.total_lots_certified + passedSum - endSnap.total_lots_certified };
  }
  // Issued — top-level: sum sold over window. Drill: by member, then origin
  // (port-of-issuance isn't published, so port drill is not implemented).
  if (metric === "Issued") {
    if (!port && !origin) {
      return { value: _rSum(snaps, w, "lots_sold_today") };
    }
  }
  return { value: null };
}

// Convert an age-bucket number ("3 mo since graded") + a reference snapshot
// date into a friendly graded month label ("Feb-26"). Bucket 1 = the month
// that ended ~30d before the snapshot.
function _gradedMonth(snapDate: string | undefined, monthsSince: number): string {
  if (!snapDate) return `${monthsSince} mo`;
  const d = new Date(snapDate);
  d.setMonth(d.getMonth() - monthsSince);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// ── Issued aggregation by clearing member (Robusta) ──────────────────────────
// iss_recv_daily.members carries { code, rows: [{origin, sold}], total_sold }
// per day. We aggregate sold across the window.
type IssRecvDailyEvt = NonNullable<RobustaJson["recent_activity"]>["iss_recv_daily"][number];

function _aggregateIssuance(
  events: IssRecvDailyEvt[], w: PeriodCol,
): { byMember: Record<string, number>; byMemberOrigin: Record<string, Record<string, number>>; total: number } {
  const inWin = _snapshotsInWindow(events, w);
  const byMember: Record<string, number> = {};
  const byMemberOrigin: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const ev of inWin) {
    for (const m of ev.members || []) {
      byMember[m.code] = (byMember[m.code] ?? 0) + (m.total_sold || 0);
      byMemberOrigin[m.code] = byMemberOrigin[m.code] ?? {};
      for (const r of m.rows || []) {
        byMemberOrigin[m.code][r.origin] = (byMemberOrigin[m.code][r.origin] ?? 0) + (r.sold || 0);
      }
      total += m.total_sold || 0;
    }
  }
  return { byMember, byMemberOrigin, total };
}

// Union across all column windows — same rationale as the arabica helpers.
function _rPortsForMetric(
  metric: RobustaMetric,
  snaps: RobustaSnap[], gradings: GradingEvent[], ageMonths: AgeAllowanceMonth[], cols: PeriodCol[],
): string[] {
  const set = new Set<string>();
  for (const w of cols) {
    if (metric === "Graded") {
      const agg = _aggregateGradings(gradings, w, _GRAD_TENDERABLE);
      Object.keys(agg.byPort).forEach((p) => set.add(p));
    } else if (metric === "Stocks") {
      const endSnap = _endOfWindowSnap(snaps, w);
      Object.entries(endSnap?.by_port_lots || {}).forEach(([p, v]) => v > 0 && set.add(p));
      const m = _ageAllowanceForWindow(ageMonths, w);
      (m?.valid?.ports || []).forEach((p) => set.add(p));
    } else if (metric === "Decertified") {
      const endSnap = _endOfWindowSnap(snaps, w);
      const startBase = _startOfWindowPrevSnap(snaps, w);
      Object.keys(endSnap?.by_port_lots   || {}).forEach((p) => set.add(p));
      Object.keys(startBase?.by_port_lots || {}).forEach((p) => set.add(p));
      const m = _ageAllowanceForWindow(ageMonths, w);
      (m?.valid?.ports || []).forEach((p) => set.add(p));
    }
  }
  return Array.from(set).sort();
}

// Member codes that ever issued in this column window set.
function _rMembersForCell(events: IssRecvDailyEvt[], cols: PeriodCol[]): string[] {
  const set = new Set<string>();
  for (const w of cols) {
    const a = _aggregateIssuance(events, w);
    Object.keys(a.byMember).forEach((m) => set.add(m));
  }
  return Array.from(set).sort();
}

function _rAgeBucketsForCell(ageMonths: AgeAllowanceMonth[], cols: PeriodCol[], port: string): string[] {
  const set = new Set<number>();
  for (const w of cols) {
    const m = _ageAllowanceForWindow(ageMonths, w);
    for (const b of (m?.valid?.buckets || [])) {
      if ((b.by_port?.[port] ?? 0) > 0) set.add(b.months_since_graded);
    }
  }
  return Array.from(set).sort((a, b) => a - b).map((n) => `${n} mo`);
}

// Reference date to label the "age N months" bucket as a graded calendar
// month — uses the closest age-allowance month_end across the column set.
function _rRefDateForAge(ageMonths: AgeAllowanceMonth[], cols: PeriodCol[]): string | undefined {
  for (const w of cols) {
    const m = _ageAllowanceForWindow(ageMonths, w);
    if (m?.month_end) return m.month_end;
  }
  return undefined;
}

function RobustaPeriodTable({
  snapshots, gradings, overview, ageMonths, issuance, unit,
}: {
  snapshots: RobustaSnap[];
  gradings: GradingEvent[];
  overview: OverviewEvent[];
  ageMonths: AgeAllowanceMonth[];
  issuance: IssRecvDailyEvt[];
  unit: Unit;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (!snapshots.length && !gradings.length && !overview.length) return <Pending label="Period view" />;

  const today = new Date();
  const cols = _periodColumns(today);

  const fmtCell = (v: RobustaRowVal): string => {
    if (v.value == null) return "—";
    const shown = fmt(fromLots(v.value, unit), unit);
    return v.isInferred ? shown + "*" : shown;
  };
  const fmtPct = (v: RobustaRowVal): string => v.value == null ? "—" : `${Math.round(v.value * 100)}%`;
  const indent = (lvl: number) => ({ paddingLeft: 8 + lvl * 14 });

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        Period view ({unitSuffix(unit)}) — flow metrics sum across each window; inventory metrics use end-of-window snapshot
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-1 pr-2 w-[170px]">Metric</th>
              {cols.map((c) => <th key={c.label} className="text-right py-1 px-1.5">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROBUSTA_METRICS.map((metric) => {
              const drill = ROBUSTA_DRILL[metric];
              const isOpen = drill !== "none" && expanded.has(metric);
              const arrow = drill === "none" ? "  " : (isOpen ? "▾" : "▸");

              return (
                <Fragment key={metric}>
                  <tr className="border-b border-slate-900">
                    <td
                      className={`text-slate-300 text-left py-1 ${drill !== "none" ? "cursor-pointer hover:text-emerald-300" : ""}`}
                      style={indent(0)}
                      onClick={() => drill !== "none" && toggle(metric)}
                    >
                      <span className="text-emerald-500/80 inline-block w-3">{arrow}</span>{" "}{metric}
                    </td>
                    {cols.map((c, i) => (
                      <td key={i} className="text-slate-100 text-right py-1 px-1.5">
                        {metric === "Passing rate"
                          ? fmtPct(_robustaRowValue(metric, snapshots, gradings, overview, ageMonths, c))
                          : fmtCell(_robustaRowValue(metric, snapshots, gradings, overview, ageMonths, c))}
                      </td>
                    ))}
                  </tr>

                  {/* Passing rate breakdown — 2 fixed sub-rows summing to the passing % */}
                  {isOpen && drill === "passing_breakdown" && (() => {
                    const rows = [
                      { label: "of which Poison", pred: _GRAD_POISON, tone: "text-rose-400" },
                      { label: "of which Coffee", pred: _GRAD_COFFEE, tone: "text-emerald-400" },
                    ];
                    return rows.map((r) => (
                      <tr key={r.label} className="border-b border-slate-900 bg-slate-900/30">
                        <td className={`${r.tone} text-left py-0.5 italic`} style={indent(1)}>{r.label}</td>
                        {cols.map((c, i) => {
                          const tend = _aggregateGradings(gradings, c, _GRAD_TENDERABLE).total;
                          const non  = _aggregateGradings(gradings, c, _GRAD_NON_TENDERABLE).total;
                          const tot = tend + non;
                          const part = _aggregateGradings(gradings, c, r.pred).total;
                          return (
                            <td key={i} className="text-slate-200 text-right py-0.5 px-1.5">
                              {tot === 0 ? "—" : `${Math.round((part / tot) * 100)}%`}
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })()}

                  {/* Pending grading: 2 sub-rows (queue + forecast). No port in source. */}
                  {isOpen && drill === "queue_forecast" && (() => {
                    const rows = [
                      { label: "of which Queue",    field: "queue_lots"    as const, tone: "text-amber-300"   },
                      { label: "of which Forecast", field: "forecast_lots" as const, tone: "text-sky-300"     },
                    ];
                    return rows.map((r) => (
                      <tr key={r.label} className="border-b border-slate-900 bg-slate-900/30">
                        <td className={`${r.tone} text-left py-0.5 italic`} style={indent(1)}>{r.label}</td>
                        {cols.map((c, i) => {
                          const ov = _closestSnap(overview, c.end, 14);
                          const v = ov?.[r.field];
                          return (
                            <td key={i} className="text-slate-200 text-right py-0.5 px-1.5">
                              {v == null ? "—" : fmt(fromLots(v, unit), unit)}
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })()}

                  {/* Issued: member → origin (union across all column windows) */}
                  {isOpen && drill === "member_origin" && (() => {
                    const members = _rMembersForCell(issuance, cols);
                    return members.map((code) => {
                      const memKey = `${metric}/${code}`;
                      const memOpen = expanded.has(memKey);
                      const originSet = new Set<string>();
                      for (const w2 of cols) {
                        const a2 = _aggregateIssuance(issuance, w2);
                        Object.keys(a2.byMemberOrigin[code] || {}).forEach((o) => originSet.add(o));
                      }
                      const origins = memOpen ? Array.from(originSet).sort() : [];
                      return (
                        <Fragment key={memKey}>
                          <tr className="border-b border-slate-900 bg-slate-900/40">
                            <td
                              className="text-slate-400 text-left py-0.5 cursor-pointer hover:text-emerald-300"
                              style={indent(1)}
                              onClick={() => toggle(memKey)}
                            >
                              <span className="text-emerald-500/60 inline-block w-3">{memOpen ? "▾" : "▸"}</span>{" "}{code}
                            </td>
                            {cols.map((c, i) => {
                              const a = _aggregateIssuance(issuance, c);
                              return (
                                <td key={i} className="text-slate-200 text-right py-0.5 px-1.5">
                                  {fmt(fromLots(a.byMember[code] ?? 0, unit), unit)}
                                </td>
                              );
                            })}
                          </tr>
                          {memOpen && origins.map((origin) => (
                            <tr key={`${memKey}/${origin}`} className="border-b border-slate-900">
                              <td className="text-slate-500 text-left py-0.5 italic" style={indent(2)}>{origin}</td>
                              {cols.map((c, i) => {
                                const a = _aggregateIssuance(issuance, c);
                                return (
                                  <td key={i} className="text-slate-400 text-right py-0.5 px-1.5">
                                    {fmt(fromLots(a.byMemberOrigin[code]?.[origin] ?? 0, unit), unit)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    });
                  })()}

                  {/* Stocks · Decertified: port → age (graded month) → origin */}
                  {isOpen && drill === "port_age_origin" && (() => {
                    const ports = _rPortsForMetric(metric, snapshots, gradings, ageMonths, cols);
                    const refDate = _rRefDateForAge(ageMonths, cols);
                    return ports.map((port) => {
                      const portKey = `${metric}/${port}`;
                      const portOpen = expanded.has(portKey);
                      return (
                        <Fragment key={portKey}>
                          <tr className="border-b border-slate-900 bg-slate-900/40">
                            <td
                              className="text-slate-400 text-left py-0.5 cursor-pointer hover:text-emerald-300"
                              style={indent(1)}
                              onClick={() => toggle(portKey)}
                            >
                              <span className="text-emerald-500/60 inline-block w-3">
                                {portOpen ? "▾" : "▸"}
                              </span>{" "}{port}
                            </td>
                            {cols.map((c, i) => (
                              <td key={i} className="text-slate-200 text-right py-0.5 px-1.5">
                                {fmtCell(_robustaRowValue(metric, snapshots, gradings, overview, ageMonths, c, port))}
                              </td>
                            ))}
                          </tr>

                          {portOpen && _rAgeBucketsForCell(ageMonths, cols, port).map((age) => {
                            const ageKey = `${portKey}/${age}`;
                            const ageOpen = expanded.has(ageKey);
                            const monthsSince = parseInt(age, 10);
                            const ageLabel = _gradedMonth(refDate, monthsSince);
                            const anyVal = cols.some((c) => (_robustaRowValue(metric, snapshots, gradings, overview, ageMonths, c, port, age).value ?? 0) > 0);
                            if (!anyVal) return null;
                            return (
                              <Fragment key={ageKey}>
                                <tr className="border-b border-slate-900 bg-slate-900/20">
                                  <td
                                    className="text-slate-500 text-left py-0.5 cursor-pointer hover:text-emerald-300"
                                    style={indent(2)}
                                    onClick={() => toggle(ageKey)}
                                  >
                                    <span className="text-emerald-500/40 inline-block w-3">{ageOpen ? "▾" : "▸"}</span>{" "}{ageLabel}{" "}<span className="text-slate-700 text-[9px]">({age})</span>
                                  </td>
                                  {cols.map((c, i) => (
                                    <td key={i} className="text-slate-300 text-right py-0.5 px-1.5">
                                      {fmtCell(_robustaRowValue(metric, snapshots, gradings, overview, ageMonths, c, port, age))}
                                    </td>
                                  ))}
                                </tr>
                                {ageOpen && (
                                  <tr key={`${ageKey}/origin-tbd`} className="border-b border-slate-900">
                                    <td className="text-slate-600 text-left py-0.5 italic" style={indent(3)}>
                                      origin attribution — inferred next iteration*
                                    </td>
                                    {cols.map((_c, i) => (
                                      <td key={i} className="text-slate-600 text-right py-0.5 px-1.5">—</td>
                                    ))}
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}

                        </Fragment>
                      );
                    });
                  })()}

                  {/* Graded: 2 sub-rows (Coffee / Poison), each drillable port → origin */}
                  {isOpen && drill === "graded_with_poison" && (() => {
                    const subs = [
                      { label: "of which Coffee", pred: _GRAD_COFFEE, tone: "text-emerald-300" },
                      { label: "of which Poison", pred: _GRAD_POISON, tone: "text-rose-300"   },
                    ];
                    return subs.map((sub) => {
                      const subKey = `${metric}/${sub.label}`;
                      const subOpen = expanded.has(subKey);
                      const portSet = new Set<string>();
                      for (const w2 of cols) {
                        Object.keys(_aggregateGradings(gradings, w2, sub.pred).byPort).forEach((p) => portSet.add(p));
                      }
                      const ports = subOpen ? Array.from(portSet).sort() : [];
                      return (
                        <Fragment key={subKey}>
                          <tr className="border-b border-slate-900 bg-slate-900/40">
                            <td
                              className={`${sub.tone} text-left py-0.5 italic cursor-pointer hover:text-emerald-200`}
                              style={indent(1)}
                              onClick={() => toggle(subKey)}
                            >
                              <span className="text-emerald-500/60 inline-block w-3">{subOpen ? "▾" : "▸"}</span>{" "}{sub.label}
                            </td>
                            {cols.map((c, i) => (
                              <td key={i} className="text-slate-200 text-right py-0.5 px-1.5">
                                {fmt(fromLots(_aggregateGradings(gradings, c, sub.pred).total, unit), unit)}
                              </td>
                            ))}
                          </tr>
                          {subOpen && ports.map((port) => {
                            const portKey2 = `${subKey}/${port}`;
                            const portOpen2 = expanded.has(portKey2);
                            const originSet = new Set<string>();
                            for (const w2 of cols) {
                              Object.keys(_aggregateGradings(gradings, w2, sub.pred).byPortOrigin[port] || {})
                                .forEach((o) => originSet.add(o));
                            }
                            const origins = portOpen2 ? Array.from(originSet).sort() : [];
                            return (
                              <Fragment key={portKey2}>
                                <tr className="border-b border-slate-900 bg-slate-900/20">
                                  <td
                                    className="text-slate-400 text-left py-0.5 cursor-pointer hover:text-emerald-300"
                                    style={indent(2)}
                                    onClick={() => toggle(portKey2)}
                                  >
                                    <span className="text-emerald-500/40 inline-block w-3">{portOpen2 ? "▾" : "▸"}</span>{" "}{port}
                                  </td>
                                  {cols.map((c, i) => (
                                    <td key={i} className="text-slate-300 text-right py-0.5 px-1.5">
                                      {fmt(fromLots(_aggregateGradings(gradings, c, sub.pred).byPort[port] ?? 0, unit), unit)}
                                    </td>
                                  ))}
                                </tr>
                                {portOpen2 && origins.map((origin) => (
                                  <tr key={`${portKey2}/${origin}`} className="border-b border-slate-900">
                                    <td className="text-slate-500 text-left py-0.5 italic" style={indent(3)}>{origin}</td>
                                    {cols.map((c, i) => (
                                      <td key={i} className="text-slate-400 text-right py-0.5 px-1.5">
                                        {fmt(fromLots(_aggregateGradings(gradings, c, sub.pred).byPortOrigin[port]?.[origin] ?? 0, unit), unit)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    });
                  })()}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-slate-600 italic mt-1">
        Flow metrics (Graded · Decertified · Issued) sum across each window; Graded drills into
        Coffee / Poison sub-rows. Inventory metrics (Stocks · Pending) use the end-of-window
        snapshot. <strong>* = inferred</strong>. Stocks → port → age comes from the monthly
        age-allowance .xlsx; age buckets are labelled by graded calendar month. Decertified at
        the (port, age) level = month-over-month change in that bucket (inferred). Origin under
        (port, age) is inferred from gradings flow in that month and lands next iteration.
      </div>
    </div>
  );
}
// ── Robusta column ────────────────────────────────────────────────────────────

function RobustaColumn({ d, unit }: { d: RobustaJson | null; unit: Unit }) {
  const stock = d?.latest_detail?.stock_report || null;
  const live = !!d && (!!stock || (d.snapshots?.length || 0) > 0);
  const grand = stock?.grand_total;

  const totalDisplay = grand ? fmt(fromLots(grand.with_val_cert, unit), unit) + " " + unitSuffix(unit) : "—";
  const nontDisplay  = grand ? fmt(fromLots(grand.non_tend,      unit), unit) + " " + unitSuffix(unit) : "—";
  const suspDisplay  = grand ? fmt(fromLots(grand.suspended,     unit), unit) + " " + unitSuffix(unit) : "—";

  const ra = d?.recent_activity;
  const activityCount = ra ? (
    (ra.gradings?.length || 0) +
    (ra.iss_recv_daily?.length || 0) +
    (ra.tenders?.length || 0) +
    (ra.grading_overview?.length || 0)
  ) : 0;

  const portRows = useMemo(() => {
    if (!stock) return [];
    return stock.ports
      .filter(p => p.with_val_cert > 0)
      .sort((a, b) => b.with_val_cert - a.with_val_cert)
      .map(p => [p.port_name ? `${p.port_id} · ${p.port_name}` : p.port_id,
                 fmt(fromLots(p.with_val_cert, unit), unit)] as [string, string]);
  }, [stock, unit]);

  const chartRows = useMemo(() => (
    (d?.snapshots || []).map(s => ({ d: s.date.slice(5), v: fromLots(s.total_lots_certified, unit) }))
  ), [d, unit]);

  // Combined event feed (chronological).
  const feed = useMemo(() => {
    if (!ra) return [];
    type Evt = { date: string; kind: string; detail: string };
    const out: Evt[] = [];
    for (const g of ra.gradings || []) {
      out.push({ date: g.date, kind: "grading", detail: `${g.summary?.lots_graded_today ?? "?"} lots graded` });
    }
    for (const i of ra.iss_recv_daily || []) {
      out.push({ date: i.date, kind: "issuance", detail: `${i.grand_total?.sold ?? 0} sold · ${i.grand_total?.bought ?? 0} bought` });
    }
    for (const t of ra.tenders || []) {
      out.push({ date: t.date, kind: "tender", detail: `${t.totals_today?.originals ?? 0} originals` });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  }, [ra]);

  // Anomalies = infested warrants + grading appeals
  const anomalies = useMemo(() => {
    const out: { date: string; kind: string; detail: string }[] = [];
    for (const i of d?.recent_activity?.infested_warrants || []) {
      out.push({ date: i.date, kind: "infested", detail: `${i.suspended?.total_lots ?? 0} lots suspended` });
    }
    for (const a of d?.recent_activity?.grading_appeals || []) {
      out.push({ date: a.date, kind: "appeal", detail: "grading appeal filed" });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [d]);

  const ageAllow = d?.monthly?.age_allowance || [];
  const latestAge = ageAllow[0];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-emerald-400">Robusta · ICE Futures Europe (RC)</div>
          <div className="text-[10px] text-slate-500">
            as of <span className="font-mono">{d?.as_of ?? "—"}</span>
            {d && <span className="ml-2">· {d.snapshots.length} snapshots in window</span>}
          </div>
        </div>
        <StatusPill live={live} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total certified" value={totalDisplay} />
        <Stat label="Non-tenderable"  value={nontDisplay} />
        <Stat label="Suspended"       value={suspDisplay} />
        <Stat label="Recent events"
              value={`${activityCount}`}
              sub={`gradings/iss/tenders, ${d?.snapshots.length ?? 0}d window`} />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By warehouse port (latest)</div>
        {portRows.length === 0
          ? <Pending label="Port breakdown" />
          : <MiniTable headers={["Port", unitSuffix(unit)]} rows={portRows} />}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Age allowance (most recent month)</div>
        {!latestAge ? <Pending label="Age allowance" /> : (
          <div className="text-[11px] font-mono text-slate-300">
            {latestAge.month_end?.slice(0, 7)} ·{" "}
            valid: {fmt(fromLots((latestAge.valid?.grand_total_mt ?? 0) / TONNES_PER_LOT, unit), unit)} {unitSuffix(unit)}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Recent activity</div>
        {feed.length === 0 ? <Pending label="Activity feed" /> : (
          <ul className="space-y-0.5 text-[11px] font-mono">
            {feed.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 text-slate-300">
                <span className="text-slate-500 w-16">{e.date}</span>
                <span className="w-16 text-[9px] uppercase tracking-wider text-emerald-500/70">{e.kind}</span>
                <span className="flex-1">{e.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {anomalies.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-amber-500/80 mb-1">Anomalies (infested · appeals)</div>
          <ul className="space-y-0.5 text-[11px] font-mono">
            {anomalies.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 text-amber-200/90">
                <span className="text-amber-500/70 w-16">{e.date}</span>
                <span className="w-16 text-[9px] uppercase tracking-wider">{e.kind}</span>
                <span className="flex-1">{e.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Total certified — last {chartRows.length} business days
        </div>
        {chartRows.length === 0 ? <Pending label="History" /> : (
          <div className="h-32 bg-slate-900 border border-slate-700 rounded-md p-2">
            <ResponsiveContainer>
              <AreaChart data={chartRows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="d" tick={{ fontSize: 9, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} width={42}
                       tickFormatter={(v) => fmt(v, unit)} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", fontSize: 10 }}
                         formatter={(v) => [fmt(Number(v ?? 0), unit) + " " + unitSuffix(unit), "total"]} />
                <Area type="monotone" dataKey="v" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={1.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <RobustaPeriodTable
        snapshots={d?.snapshots || []}
        gradings={(d?.recent_activity?.gradings || []) as unknown as GradingEvent[]}
        overview={(d?.recent_activity?.grading_overview || []) as unknown as OverviewEvent[]}
        ageMonths={(d?.monthly?.age_allowance || []) as unknown as AgeAllowanceMonth[]}
        issuance={(d?.recent_activity?.iss_recv_daily || []) as unknown as IssRecvDailyEvt[]}
        unit={unit}
      />
    </div>
  );
}

// ── Top-level panel ───────────────────────────────────────────────────────────

export default function CertifiedStocksPanel() {
  const [arabica, setArabica] = useState<ArabicaJson | null>(null);
  const [robusta, setRobusta] = useState<RobustaJson | null>(null);
  const [unit, setUnit] = useState<Unit>("bags");
  const [err, setErr] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/data/certified_stocks_arabica.json").then(r => r.ok ? r.json() : null),
      fetch("/data/certified_stocks_robusta.json").then(r => r.ok ? r.json() : null),
    ])
      .then(([a, b]) => { setArabica(a); setRobusta(b); })
      .catch(() => setErr(true));
  }, []);

  if (err) {
    return <div className="p-4 text-xs text-slate-500">Certified stocks data unavailable.</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Certified Stocks (exchange-deliverable)</h2>
          <p className="text-[11px] text-slate-500">
            ICE-certified arabica (US warehouses) &amp; robusta (European warehouses) — the deliverable inventory the
            futures market clears against. Daily scrape of ICE’s publicdocs reports.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {(["bags", "tonnes", "lots"] as Unit[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border ${
                unit === u
                  ? "bg-slate-800 text-amber-400 border-slate-700"
                  : "text-slate-500 hover:text-slate-300 border-transparent"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ArabicaColumn d={arabica} unit={unit} />
        <RobustaColumn d={robusta} unit={unit} />
      </div>
    </div>
  );
}
