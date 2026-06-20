"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Treemap, Sankey, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LineChart, Line, CartesianGrid,
} from "recharts";

// ── data types ────────────────────────────────────────────────────────────
interface Origin { name: string; by_year: Record<string, number>; latest_mt: number | null; monthly?: Record<string, number> }
interface Reporter { name: string; years: number[]; origins: Origin[]; total_by_year: Record<string, number>; monthly_total?: Record<string, number> }
interface ByOrigin {
  updated: string; source: string; is_seed?: boolean;
  years: number[]; origins: Origin[]; total_by_year: Record<string, number>;
  monthly_total?: Record<string, number>;
  monthly_origins?: Record<string, Record<string, number>>;   // US: by-origin monthly
  reporters?: Record<string, Reporter>;                        // EU: bloc + members
}
interface CtAnnual { year: number; total_mt: number | null }
interface CtCountry { name: string; annual: CtAnnual[]; latest_year: number }
interface Comtrade { is_seed?: boolean; countries: Record<string, CtCountry> }

// A unified "view" — one reporter (US, EU bloc, or an EU member).
interface View {
  key: string; label: string; years: number[]; origins: Origin[];
  total_by_year: Record<string, number>; monthly_total: Record<string, number>;
  monthly_origins?: Record<string, Record<string, number>>;
}

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const PALETTE = ["#16a34a", "#f59e0b", "#0ea5e9", "#a855f7", "#ef4444", "#06b6d4", "#84cc16", "#ec4899", "#f97316", "#22d3ee", "#a3e635", "#fb7185"];
const kt = (mt?: number | null) => (mt == null ? 0 : mt / 1000);
const fmtKt = (mt?: number | null) => `${Math.round(kt(mt)).toLocaleString()} kt`;
const sumVals = (m: Record<string, number>) => Object.values(m).reduce((s, v) => s + v, 0);

function Section({ n, title, note, control, children }: {
  n: string; title: string; note: string; control?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80">Concept {n}</div>
          <h3 className="text-base font-bold text-slate-100">{title}</h3>
        </div>
        {control}
      </div>
      <p className="text-xs text-slate-400">{note}</p>
      <div className="pt-2">{children}</div>
    </div>
  );
}

// ── small controls ────────────────────────────────────────────────────────
function Picker<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-slate-400">
      {label && <span className="uppercase tracking-wide">{label}</span>}
      <select value={String(value)} onChange={e => {
        const raw = e.target.value;
        const opt = options.find(o => String(o.v) === raw);
        if (opt) onChange(opt.v);
      }} className="bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-200 px-2 py-1">
        {options.map(o => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}
      </select>
    </label>
  );
}

function yoyPct(tby: Record<string, number>): number | null {
  const ys = Object.keys(tby).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (ys.length < 2) return null;
  const cur = tby[String(ys[ys.length - 1])], prev = tby[String(ys[ys.length - 2])];
  return prev ? ((cur - prev) / prev) * 100 : null;
}
function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[9px] text-slate-600">—</span>;
  const up = pct >= 0;
  return <span className={`text-[9px] font-mono ${up ? "text-emerald-400" : "text-red-400"}`}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% YoY</span>;
}

// ── 1. KPI strip ────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, delta, tone }: { label: string; value: string; sub?: string; delta?: number | null; tone?: string }) {
  return (
    <div className="bg-slate-800/60 rounded-lg px-3 py-2 border border-slate-700">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-mono ${tone ?? "text-slate-100"}`}>{value}</div>
      <div className="flex items-center gap-2">
        {delta !== undefined && <Delta pct={delta} />}
        {sub && <span className="text-[9px] text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

function hhi(origins: Origin[]): number {
  const total = origins.reduce((s, o) => s + (o.latest_mt ?? 0), 0);
  if (!total) return 0;
  return Math.round(origins.reduce((s, o) => s + ((o.latest_mt ?? 0) / total * 100) ** 2, 0));
}
const latestVal = (tby: Record<string, number>) => {
  const ys = Object.keys(tby).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return ys.length ? tby[String(ys[ys.length - 1])] : 0;
};

// ── treemap (by selected year) ────────────────────────────────────────────────
function OriginTreemap({ origins, year }: { origins: Origin[]; year: number }) {
  const data = origins
    .map((o, i) => ({ name: o.name, size: (o.by_year[String(year)] ?? 0) / 1000, fill: PALETTE[i % PALETTE.length] }))
    .filter(d => d.size > 0).slice(0, 28);
  if (!data.length) return <div className="h-72 flex items-center justify-center text-xs text-slate-500">No data for {year}.</div>;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap data={data} dataKey="size" stroke="#0f172a" content={<TreemapCell />} >
          <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${Number(v).toFixed(0)} kt`, "Imports"]} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
function TreemapCell(props: { x?: number; y?: number; width?: number; height?: number; name?: string; fill?: string }) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", fill = "#334155" } = props;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} style={{ fill, stroke: "#0f172a", strokeWidth: 2 }} />
      {width > 52 && height > 22 && (
        <text x={x + 4} y={y + 14} fill="#0f172a" fontSize={10} fontWeight={700}>{name}</text>
      )}
    </g>
  );
}

// ── bump chart (origin rank over years) ──────────────────────────────────────
function BumpChart({ years, origins, highlightYear }: { years: number[]; origins: Origin[]; highlightYear?: number }) {
  const names = origins.slice(0, 7).map(o => o.name);
  const rows = years.map(y => {
    const ranked = [...origins].sort((a, b) => (b.by_year[String(y)] ?? 0) - (a.by_year[String(y)] ?? 0));
    const row: Record<string, number | string> = { year: y };
    names.forEach(n => { const r = ranked.findIndex(o => o.name === n); if (r >= 0) row[n] = r + 1; });
    return row;
  });
  if (!names.length) return <div className="h-72 flex items-center justify-center text-xs text-slate-500">No origin history.</div>;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 64, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="year" tick={(props) => {
            const { x, y, payload } = props as { x: number; y: number; payload: { value: number } };
            const on = payload.value === highlightYear;
            return <text x={x} y={y + 10} textAnchor="middle" fontSize={9} fill={on ? "#f59e0b" : "#64748b"} fontWeight={on ? 700 : 400}>{payload.value}</text>;
          }} />
          <YAxis reversed domain={[1, names.length]} ticks={Array.from({ length: names.length }, (_, i) => i + 1)}
            tick={{ fontSize: 9, fill: "#64748b" }} width={26} />
          <Tooltip contentStyle={TT} formatter={(v: unknown, n: unknown) => [`#${v}`, String(n)]} />
          {names.map((n, i) => (
            <Line key={n} dataKey={n} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {names.map((n, i) => <span key={n} className="text-[9px]" style={{ color: PALETTE[i % PALETTE.length] }}>● {n}</span>)}
      </div>
    </div>
  );
}

// ── Sankey origins → US/EU (by selected year) ─────────────────────────────────
function buildSankey(us: View | undefined, euBloc: View | undefined, year: number) {
  const usMap = Object.fromEntries((us?.origins ?? []).map(o => [o.name, (o.by_year[String(year)] ?? 0) / 1000]));
  const euMap = Object.fromEntries((euBloc?.origins ?? []).map(o => [o.name, (o.by_year[String(year)] ?? 0) / 1000]));
  const score: Record<string, number> = {};
  for (const [n, v] of Object.entries(usMap)) score[n] = (score[n] ?? 0) + v;
  for (const [n, v] of Object.entries(euMap)) score[n] = (score[n] ?? 0) + v;
  const names = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 12).map(n => n[0]);
  const nodes = [...names.map(n => ({ name: n })), { name: "United States" }, { name: "European Union" }];
  const usIdx = names.length, euIdx = names.length + 1;
  const links: { source: number; target: number; value: number }[] = [];
  names.forEach((n, i) => {
    if (usMap[n] > 0) links.push({ source: i, target: usIdx, value: Math.round(usMap[n]) });
    if (euMap[n] > 0) links.push({ source: i, target: euIdx, value: Math.round(euMap[n]) });
  });
  return { nodes, links };
}
function SankeyNode(props: { x?: number; y?: number; width?: number; height?: number; payload?: { name: string } }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const right = x > 300;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="#f59e0b" fillOpacity={0.85} rx={1} />
      <text x={right ? x - 6 : x + width + 6} y={y + height / 2} textAnchor={right ? "end" : "start"}
        dominantBaseline="middle" fontSize={10} fill="#cbd5e1">{payload?.name}</text>
    </g>
  );
}

// ── YoY heatmap (annual) ──────────────────────────────────────────────────────
function heatCell(pct: number | null) {
  if (pct == null) return "#1e293b";
  const c = Math.max(-40, Math.min(40, pct)) / 40;
  return c >= 0 ? `rgba(22,163,74,${0.2 + 0.7 * c})` : `rgba(239,68,68,${0.2 + 0.7 * -c})`;
}
function YoyHeatmap({ years, origins }: { years: number[]; origins: Origin[] }) {
  const names = origins.slice(0, 12);
  if (!names.length || years.length < 2) return <div className="text-xs text-slate-500">Not enough history.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
        <thead><tr><th></th>{years.slice(1).map(y => <th key={y} className="text-slate-500 font-normal px-1">{`'${String(y).slice(2)}`}</th>)}</tr></thead>
        <tbody>
          {names.map(o => (
            <tr key={o.name}>
              <td className="text-slate-300 pr-2 whitespace-nowrap text-right">{o.name}</td>
              {years.slice(1).map((y, i) => {
                const prev = o.by_year[String(years[i])], cur = o.by_year[String(y)];
                const pct = prev && cur ? ((cur - prev) / prev) * 100 : null;
                return <td key={y} title={pct == null ? "—" : `${pct.toFixed(0)}%`}
                  style={{ background: heatCell(pct), width: 30, height: 18 }}
                  className="text-center text-[8px] text-slate-100/70 rounded">{pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}`}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[9px] text-slate-500 mt-1">Year-over-year % change in import volume · green = rising, red = falling</div>
    </div>
  );
}

// ── Month-over-month heatmap (monthly granularity) ────────────────────────────
function monthlyOf(view: View, name: string): Record<string, number> | undefined {
  const o = view.origins.find(x => x.name === name);
  return o?.monthly ?? view.monthly_origins?.[name];
}
function MonthlyHeatmap({ view }: { view: View }) {
  const rows = view.origins
    .map(o => ({ name: o.name, m: monthlyOf(view, o.name) ?? {} }))
    .filter(r => Object.keys(r.m).length > 0)
    .sort((a, b) => sumVals(b.m) - sumVals(a.m)).slice(0, 12);
  const months = Array.from(new Set(rows.flatMap(r => Object.keys(r.m)))).sort();
  if (!rows.length || months.length < 2) {
    return <div className="text-xs text-slate-500">No monthly-by-origin data for {view.label} yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
        <thead><tr><th></th>{months.slice(1).map(m => <th key={m} className="text-slate-500 font-normal px-1">{m.slice(2)}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name}>
              <td className="text-slate-300 pr-2 whitespace-nowrap text-right">{r.name}</td>
              {months.slice(1).map((m, i) => {
                const prev = r.m[months[i]], cur = r.m[m];
                const pct = prev && cur ? ((cur - prev) / prev) * 100 : null;
                return <td key={m} title={pct == null ? "—" : `${pct.toFixed(0)}%`}
                  style={{ background: heatCell(pct), width: 28, height: 18 }}
                  className="text-center text-[8px] text-slate-100/70 rounded">{pct == null ? "" : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}`}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[9px] text-slate-500 mt-1">Month-over-month % change · recent months · green = rising, red = falling</div>
    </div>
  );
}

// ── lab container ─────────────────────────────────────────────────────────────
export default function ImportsVisualsLab() {
  const [us, setUs] = useState<ByOrigin | null>(null);
  const [eu, setEu] = useState<ByOrigin | null>(null);
  const [ct, setCt] = useState<Comtrade | null>(null);

  useEffect(() => {
    fetch("/data/us_coffee_imports.json").then(r => r.json()).then(setUs).catch(() => {});
    fetch("/data/eu_coffee_imports.json").then(r => r.json()).then(setEu).catch(() => {});
    fetch("/data/coffee_imports.json").then(r => r.json()).then(setCt).catch(() => {});
  }, []);

  // Unified reporter views: US, EU bloc, then EU members.
  const views = useMemo<View[]>(() => {
    const list: View[] = [];
    if (us) list.push({ key: "US", label: "United States", years: us.years, origins: us.origins, total_by_year: us.total_by_year, monthly_total: us.monthly_total ?? {}, monthly_origins: us.monthly_origins });
    if (eu?.reporters) {
      for (const [code, r] of Object.entries(eu.reporters)) {
        list.push({ key: code, label: r.name, years: r.years, origins: r.origins, total_by_year: r.total_by_year, monthly_total: r.monthly_total ?? {} });
      }
    } else if (eu) {
      list.push({ key: "EU27_2020", label: "European Union", years: eu.years, origins: eu.origins, total_by_year: eu.total_by_year, monthly_total: eu.monthly_total ?? {} });
    }
    return list;
  }, [us, eu]);

  const [comboKey, setComboKey] = useState("US");
  const [comboYear, setComboYear] = useState<number | null>(null);
  const [heatKey, setHeatKey] = useState("US");
  const [heatGran, setHeatGran] = useState<"annual" | "monthly">("annual");
  const [sankeyYear, setSankeyYear] = useState<number | null>(null);

  const viewByKey = (k: string) => views.find(v => v.key === k) ?? views[0];
  const combo = viewByKey(comboKey);
  const heat = viewByKey(heatKey);
  const usView = views.find(v => v.key === "US");
  const euBloc = views.find(v => v.key === "EU27_2020");

  // default year selections once data is in
  const cYear = comboYear ?? (combo?.years.length ? combo.years[combo.years.length - 1] : 0);
  const sankeyYears = usView?.years ?? [];
  const sYear = sankeyYear ?? (sankeyYears.length ? sankeyYears[sankeyYears.length - 1] : 0);

  if (!us || !eu || !ct) return <div className="p-6 text-xs text-slate-500 animate-pulse">Loading import datasets…</div>;
  if (!views.length) return <div className="p-6 text-xs text-slate-500">No import data available.</div>;

  // World (Comtrade) total + YoY
  const worldByYear: Record<string, number> = {};
  for (const c of Object.values(ct.countries)) for (const a of c.annual) if (a.total_mt != null) worldByYear[String(a.year)] = (worldByYear[String(a.year)] ?? 0) + a.total_mt;

  const viewOptions = views.map(v => ({ v: v.key, label: v.label }));
  const comboYearOptions = (combo?.years ?? []).map(y => ({ v: y, label: String(y) }));
  const sankeyYearOptions = sankeyYears.map(y => ({ v: y, label: String(y) }));

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-white">Imports — Visual Lab ✦</h2>
        <p className="text-xs text-slate-400">
          Candidate visuals for the Imports tab. Data: UN Comtrade (global), USITC (US by origin),
          Eurostat (EU bloc + member states, by origin). {eu.is_seed && <span className="text-amber-400/80">EU is still seed data.</span>}
        </p>
      </div>

      {/* Concept 1 — KPI strip with YoY */}
      <Section n="1" title="KPI stat-strip" note="Totals with year-over-year change, leaders, and sourcing concentration (HHI).">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="World (Comtrade)" value={fmtKt(latestVal(worldByYear))} delta={yoyPct(worldByYear)} sub={`${Object.keys(ct.countries).length} mkts`} tone="text-amber-300" />
          <Kpi label="US imports" value={fmtKt(latestVal(us.total_by_year))} delta={yoyPct(us.total_by_year)} sub={`top: ${us.origins[0]?.name ?? "—"}`} />
          <Kpi label="EU imports" value={fmtKt(latestVal(eu.total_by_year))} delta={yoyPct(eu.total_by_year)} sub={`top: ${eu.origins[0]?.name ?? "—"}`} />
          <Kpi label="US origins" value={`${us.origins.length}`} sub={`HHI ${hhi(us.origins)}`} />
          <Kpi label="EU origins" value={`${eu.origins.length}`} sub={`HHI ${hhi(eu.origins)}`} />
          <Kpi label="US top-3 share" value={`${Math.round(us.origins.slice(0, 3).reduce((s, o) => s + (o.latest_mt ?? 0), 0) / (us.origins.reduce((s, o) => s + (o.latest_mt ?? 0), 0) || 1) * 100)}%`} sub="of US imports" />
        </div>
      </Section>

      {/* Concept 6 + 3 — rank bump + treemap, shared destination & year */}
      <Section n="6 + 3" title="Origin rank & concentration"
        note="Left: how each top origin's rank shifts year to year. Right: origin shares as a treemap for the selected year. Both follow the destination & year picker — including individual EU member states."
        control={
          <div className="flex items-center gap-2">
            <Picker label="Dest" value={comboKey} options={viewOptions} onChange={(v) => { setComboKey(v); setComboYear(null); }} />
            <Picker label="Year" value={cYear} options={comboYearOptions} onChange={setComboYear} />
          </div>
        }>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Rank over time — {combo.label}</div>
            <BumpChart years={combo.years} origins={combo.origins} highlightYear={cYear} />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 mb-1">Origin shares — {combo.label} · {cYear}</div>
            <OriginTreemap origins={combo.origins} year={cYear} />
          </div>
        </div>
      </Section>

      {/* Concept 4 — Sankey with year selector */}
      <Section n="4" title="Origins → blocs Sankey"
        note="Top origins flowing into the US and EU for the selected year (kt)."
        control={<Picker label="Year" value={sYear} options={sankeyYearOptions} onChange={setSankeyYear} />}>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey data={buildSankey(usView, euBloc, sYear)} node={<SankeyNode />} nodePadding={14}
              margin={{ top: 10, right: 120, bottom: 10, left: 10 }} link={{ stroke: "#475569", strokeOpacity: 0.35 }}>
              <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${Number(v).toLocaleString()} kt`, "flow"]} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* Concept 7 — YoY / MoM heatmap with destination + granularity */}
      <Section n="7" title="Change heatmap"
        note="Per-origin change — spot surges and collapses instantly. Switch destination (US, EU bloc, or a member state) and granularity (annual YoY or monthly month-over-month)."
        control={
          <div className="flex items-center gap-2">
            <Picker label="Dest" value={heatKey} options={viewOptions} onChange={setHeatKey} />
            <Picker label="Gran" value={heatGran} options={[{ v: "annual", label: "Annual (YoY)" }, { v: "monthly", label: "Monthly (MoM)" }]} onChange={setHeatGran} />
          </div>
        }>
        {heatGran === "annual"
          ? <YoyHeatmap years={heat.years} origins={heat.origins} />
          : <MonthlyHeatmap view={heat} />}
      </Section>
    </div>
  );
}
