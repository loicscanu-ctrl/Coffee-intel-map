"use client";
import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ── Data shapes (mirror backend/scraper/sources/ice_certified_stocks/orchestrate.py) ─

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
    gradings: Array<{ date: string; summary?: { lots_graded_today: number } }>;
    grading_appeals: Array<{ date: string }>;
    iss_recv_daily: Array<{ date: string; grand_total?: { sold: number; bought: number } }>;
    tenders: Array<{ date: string; totals_today?: { originals?: number } }>;
    grading_overview: Array<{ date: string; total_pending_lots: number | null }>;
    infested_warrants: Array<{ date: string; suspended?: { total_lots: number } }>;
  };
  monthly: {
    iss_recv_monthly: Array<{ month: string | null; grand_total?: { sold: number; bought: number } }>;
    age_allowance: Array<{ month_end: string; valid?: { grand_total_mt: number } | null }>;
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

// ── Arabica period table (multi-period view requested in spec) ───────────────

interface PeriodCol { label: string; date: Date }

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
  return [
    { label: "Current",  date: today },
    { label: "1 wk ago", date: _addDays(today, -7) },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      label: _monthShort(_endOfMonth(today, i)),
      date: _endOfMonth(today, i),
    })),
  ];
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

function ArabicaPeriodTable({ snapshots, unit }: { snapshots: ArabicaSnap[]; unit: Unit }) {
  if (!snapshots.length) return <Pending label="Period view" />;

  const today = new Date();
  const cols = _periodColumns(today);

  const data = cols.map((col) => {
    const snap = _closestSnap(snapshots, col.date);
    if (!snap) return { col, snap: null as ArabicaSnap | null, prev: null as ArabicaSnap | null };
    const idx = snapshots.findIndex((s) => s.date === snap.date);
    const prev = idx > 0 ? snapshots[idx - 1] : null;
    return { col, snap, prev };
  });

  const fmtBagsCell = (n: number | null | undefined) =>
    n == null ? "—" : fmt(fromBags(n, unit), unit);

  const rows: { label: string; values: string[] }[] = [
    { label: "Pending grading", values: data.map((d) => fmtBagsCell(d.snap?.pending_grading_bags)) },
    { label: "Passed today",    values: data.map((d) => fmtBagsCell(d.snap?.passed_today_bags)) },
    { label: "Failed today",    values: data.map((d) => fmtBagsCell(d.snap?.failed_today_bags)) },
    {
      label: "Passing rate",
      values: data.map((d) => {
        if (!d.snap) return "—";
        const tot = (d.snap.passed_today_bags ?? 0) + (d.snap.failed_today_bags ?? 0);
        return tot === 0 ? "—" : `${Math.round((d.snap.passed_today_bags / tot) * 100)}%`;
      }),
    },
    { label: "Stocks", values: data.map((d) => fmtBagsCell(d.snap?.total_bags)) },
    {
      label: "Decert / issued",
      values: data.map((d) => {
        if (!d.snap || !d.prev) return "—";
        // Spec formula: prev_stock + passed_today − today_stock. Lumps any
        // issuance + decertification together (arabica xls doesn't separate
        // them; we'd need a deeper data source to split).
        const v = d.prev.total_bags + d.snap.passed_today_bags - d.snap.total_bags;
        return fmtBagsCell(v);
      }),
    },
  ];

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        Period view ({unitSuffix(unit)})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-1 pr-2 w-[110px]">Metric</th>
              {cols.map((c) => (
                <th key={c.label} className="text-right py-1 px-1.5">{c.label}</th>
              ))}
            </tr>
            <tr className="text-slate-700 text-[9px] border-b border-slate-900">
              <th className="text-left pb-1 pr-2" />
              {data.map((d, i) => (
                <th key={i} className="text-right pb-1 px-1.5">
                  {d.snap ? d.snap.date.slice(5) : "—"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-900 last:border-0">
                <td className="text-slate-300 text-left py-1 pr-2">{r.label}</td>
                {r.values.map((v, i) => (
                  <td key={i} className="text-slate-100 text-right py-1 px-1.5">{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-slate-600 italic mt-1">
        Closest snapshot per period (±7 days). Decert/issued = prev_stock + passed − stock.
        Click-to-drill (port → group → origin) coming next — needs the full 180-day backfill first.
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

interface GradingEvent {
  date: string;
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

function RobustaPeriodTable({
  snapshots, gradings, overview, unit,
}: {
  snapshots: RobustaSnap[];
  gradings: GradingEvent[];
  overview: OverviewEvent[];
  unit: Unit;
}) {
  if (!snapshots.length && !gradings.length && !overview.length) return <Pending label="Period view" />;

  const today = new Date();
  const cols = _periodColumns(today);

  const data = cols.map((col) => {
    const snap = _closestSnap(snapshots, col.date);
    const grading = _closestSnap(gradings, col.date);
    const ov = _closestSnap(overview, col.date);
    const idx = snap ? snapshots.findIndex((s) => s.date === snap.date) : -1;
    const prev = idx > 0 ? snapshots[idx - 1] : null;
    return { col, snap, prev, grading, overview: ov };
  });

  const fmtLotsCell = (n: number | null | undefined) =>
    n == null ? "—" : fmt(fromLots(n, unit), unit);

  const rows: { label: string; values: string[] }[] = [
    {
      label: "Pending grading",
      // grading_overview publishes total = queue + forecast (10-tonne lots).
      values: data.map((d) => fmtLotsCell(d.overview?.total_pending_lots ?? null)),
    },
    {
      label: "Tenderable today",
      values: data.map((d) => fmtLotsCell(d.grading?.summary?.tenderable_today)),
    },
    {
      label: "Non-tenderable",
      values: data.map((d) => fmtLotsCell(d.grading?.summary?.non_tenderable_today)),
    },
    {
      label: "Passing rate",
      values: data.map((d) => {
        const t = d.grading?.summary?.tenderable_today ?? 0;
        const n = d.grading?.summary?.non_tenderable_today ?? 0;
        const tot = t + n;
        if (!d.grading || tot === 0) return "—";
        return `${Math.round((t / tot) * 100)}%`;
      }),
    },
    {
      label: "Stocks",
      values: data.map((d) => fmtLotsCell(d.snap?.total_lots_certified)),
    },
    {
      label: "Issuance (sold)",
      values: data.map((d) => fmtLotsCell(d.snap?.lots_sold_today)),
    },
    {
      label: "Decert / issued",
      values: data.map((d) => {
        if (!d.snap || !d.prev) return "—";
        // Same formula as arabica: prev_stock + passed − stock. For robusta
        // we use lots_graded_today (the tenderable portion drives the stock
        // *into* certified). Includes the issuance/tender outflow.
        const passed = d.grading?.summary?.tenderable_today ?? d.snap.lots_graded_today ?? 0;
        const v = d.prev.total_lots_certified + passed - d.snap.total_lots_certified;
        return fmtLotsCell(v);
      }),
    },
  ];

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        Period view ({unitSuffix(unit)})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left py-1 pr-2 w-[110px]">Metric</th>
              {cols.map((c) => (
                <th key={c.label} className="text-right py-1 px-1.5">{c.label}</th>
              ))}
            </tr>
            <tr className="text-slate-700 text-[9px] border-b border-slate-900">
              <th className="text-left pb-1 pr-2" />
              {data.map((d, i) => (
                <th key={i} className="text-right pb-1 px-1.5">
                  {d.snap ? d.snap.date.slice(5) : (d.grading ? d.grading.date.slice(5) : "—")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-900 last:border-0">
                <td className="text-slate-300 text-left py-1 pr-2">{r.label}</td>
                {r.values.map((v, i) => (
                  <td key={i} className="text-slate-100 text-right py-1 px-1.5">{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-slate-600 italic mt-1">
        Closest snapshot per period (±7 days). Decert/issued = prev_stock + tenderable − stock.
        Click-to-drill (port → ageing → origin, the origin layer inferred from gradings flow) coming next.
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
