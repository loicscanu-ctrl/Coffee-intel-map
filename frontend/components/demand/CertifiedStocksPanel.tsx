"use client";
import { useEffect, useState } from "react";

// ── Shape (mirrors frontend/public/data/certified_stocks.json) ────────────────

interface PortRow   { port: string; bags?: number; lots?: number; tonnes?: number }
interface OriginRow { origin: string; bags?: number; lots?: number; tonnes?: number; pct?: number }
interface ActivityRow { date: string; detail: string; amount?: number; unit?: string }
interface HistoryPoint { date: string; value: number }
interface AgeBucket { age_bucket: string; lots?: number; tonnes?: number; pct?: number }

interface Arabica {
  as_of: string;
  source: string;
  unit: "bags";
  total: number | null;
  delta_day: number | null;
  pending_grading: number | null;
  graded_today: number | null;
  issued_today: number | null;
  by_port: PortRow[];
  by_origin: OriginRow[];
  recent_issuance: ActivityRow[];
  history: HistoryPoint[];
}

interface Robusta {
  as_of: string;
  source: string;
  unit: "lots";
  lot_size_tonnes: number;
  total_lots: number | null;
  total_tonnes: number | null;
  delta_day_lots: number | null;
  by_origin: OriginRow[];
  by_warehouse: PortRow[];
  age_allowance: { month: string | null; buckets: AgeBucket[] };
  recent_gradings: ActivityRow[];
  recent_issuance_daily: ActivityRow[];
  monthly_issuance: ActivityRow[];
  recent_tenders: ActivityRow[];
  infested_warrants: ActivityRow[];
  grading_appeals: ActivityRow[];
  history: HistoryPoint[];
}

interface CertifiedStocksData {
  generated_at: string;
  status?: "seed" | "live";
  _note?: string;
  arabica: Arabica;
  robusta: Robusta;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");

const fmtDelta = (n: number | null | undefined) => {
  if (n == null) return null;
  const sign = n > 0 ? "+" : n < 0 ? "" : "±";
  return `${sign}${n.toLocaleString("en-US")}`;
};

// ── Small reusable bits ───────────────────────────────────────────────────────

function StatusPill({ status }: { status?: "seed" | "live" }) {
  const live = status === "live";
  return (
    <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border
      ${live ? "border-emerald-700 text-emerald-400 bg-emerald-900/30"
             : "border-amber-700  text-amber-400  bg-amber-900/20"}`}>
      {live ? "live" : "seed · live data pending"}
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

function PendingBlock({ label }: { label: string }) {
  return (
    <div className="text-[10px] text-slate-500 italic border border-dashed border-slate-700 rounded px-2 py-3">
      {label} — pending live scrape from ICE daily report.
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

// ── Per-market column ─────────────────────────────────────────────────────────

function ArabicaColumn({ d, status }: { d: Arabica; status?: "seed" | "live" }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-amber-400">Arabica · ICE Futures US (KC)</div>
          <div className="text-[10px] text-slate-500">as of <span className="font-mono">{d.as_of}</span></div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Certified total"
          value={fmtInt(d.total) + (d.total != null ? " bags" : "")}
          sub={fmtDelta(d.delta_day) ? `${fmtDelta(d.delta_day)} day` : null}
        />
        <Stat
          label="Pending grading"
          value={d.pending_grading != null ? `${fmtInt(d.pending_grading)} bags` : "—"}
        />
        <Stat label="Graded today"  value={d.graded_today  != null ? `${fmtInt(d.graded_today)} bags`  : "—"} />
        <Stat label="Issued today"  value={d.issued_today  != null ? `${fmtInt(d.issued_today)} bags`  : "—"} />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By delivery port</div>
        {d.by_port.length === 0
          ? <PendingBlock label="Port breakdown" />
          : <MiniTable
              headers={["Port", "Bags"]}
              rows={d.by_port.map((p) => [p.port, p.bags ?? 0])}
            />}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By origin</div>
        {d.by_origin.length === 0
          ? <PendingBlock label="Origin breakdown" />
          : <MiniTable
              headers={["Origin", "Bags"]}
              rows={d.by_origin.map((o) => [o.origin, o.bags ?? 0])}
            />}
      </div>

      <div className="text-[9px] text-slate-600 italic">Source: {d.source}</div>
    </div>
  );
}

function RobustaColumn({ d, status }: { d: Robusta; status?: "seed" | "live" }) {
  const lotsToBagsEquiv = d.total_lots != null ? Math.round(d.total_lots * (d.lot_size_tonnes * 1000) / 60) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-emerald-400">Robusta · ICE Futures Europe (RC)</div>
          <div className="text-[10px] text-slate-500">as of <span className="font-mono">{d.as_of}</span></div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Certified total"
          value={d.total_lots != null ? `${fmtInt(d.total_lots)} lots` : "—"}
          sub={
            d.total_tonnes != null
              ? `${fmtInt(d.total_tonnes)} t · ≈ ${fmtInt(lotsToBagsEquiv)} 60kg bags`
              : null
          }
        />
        <Stat
          label="Δ day"
          value={fmtDelta(d.delta_day_lots) ?? "—"}
          sub={d.delta_day_lots != null ? "lots" : null}
        />
        <Stat
          label="Age allowance"
          value={d.age_allowance.month ?? "—"}
          sub={d.age_allowance.buckets.length > 0 ? `${d.age_allowance.buckets.length} buckets` : "pending"}
        />
        <Stat
          label="Recent activity"
          value={d.recent_gradings.length + d.recent_issuance_daily.length + d.recent_tenders.length + " events"}
          sub="last 30d"
        />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By origin</div>
        {d.by_origin.length === 0
          ? <PendingBlock label="Origin breakdown" />
          : <MiniTable
              headers={["Origin", "Lots"]}
              rows={d.by_origin.map((o) => [o.origin, o.lots ?? 0])}
            />}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">By warehouse / port</div>
        {d.by_warehouse.length === 0
          ? <PendingBlock label="Warehouse breakdown" />
          : <MiniTable
              headers={["Warehouse", "Lots"]}
              rows={d.by_warehouse.map((p) => [p.port, p.lots ?? 0])}
            />}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Recent activity · gradings · issuance · tenders
        </div>
        {(d.recent_gradings.length + d.recent_issuance_daily.length + d.recent_tenders.length) === 0
          ? <PendingBlock label="Recent activity feed" />
          : (
            <ul className="space-y-0.5 text-[11px] font-mono">
              {[...d.recent_gradings, ...d.recent_issuance_daily, ...d.recent_tenders]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 8)
                .map((row, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-slate-300">
                    <span className="text-slate-500 w-16">{row.date}</span>
                    <span className="flex-1">{row.detail}</span>
                    {row.amount != null && <span className="text-slate-100">{fmtInt(row.amount)} {row.unit ?? ""}</span>}
                  </li>
                ))}
            </ul>
          )
        }
      </div>

      <div className="text-[9px] text-slate-600 italic">Source: {d.source}</div>
    </div>
  );
}

// ── Top-level panel ───────────────────────────────────────────────────────────

export default function CertifiedStocksPanel() {
  const [data, setData]   = useState<CertifiedStocksData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/certified_stocks.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error || !data) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Certified stocks data unavailable.
      </div>
    );
  }

  const status = data.status;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Certified Stocks (exchange-deliverable)</h2>
          <p className="text-[11px] text-slate-500">
            ICE-certified arabica (US warehouses) &amp; robusta (European warehouses) — the deliverable inventory the
            futures market clears against. Distinct from the physical port stocks above (ECF / Japan / USA).
          </p>
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          generated {data.generated_at?.slice(0, 16).replace("T", " ")}Z
        </div>
      </div>

      {status === "seed" && data._note && (
        <div className="text-[10px] text-amber-400/80 bg-amber-900/10 border border-amber-900/40 rounded px-2 py-1.5">
          {data._note}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ArabicaColumn d={data.arabica} status={status} />
        <RobustaColumn d={data.robusta} status={status} />
      </div>
    </div>
  );
}
