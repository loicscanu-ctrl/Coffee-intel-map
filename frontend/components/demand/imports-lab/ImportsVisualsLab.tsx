"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Treemap, Sankey, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip,
  ResponsiveContainer, LineChart, Line, CartesianGrid, Cell,
} from "recharts";
import SourcingFlowMap from "./SourcingFlowMap";

// ── data types ────────────────────────────────────────────────────────────
interface Origin { name: string; by_year: Record<string, number>; latest_mt: number | null }
interface ByOrigin { updated: string; source: string; is_seed?: boolean; years: number[]; origins: Origin[]; total_by_year: Record<string, number> }
interface CtAnnual { year: number; total_mt: number | null; green_mt: number | null; roasted_mt: number | null }
interface CtCountry { name: string; annual: CtAnnual[]; latest_year: number }
interface Comtrade { is_seed?: boolean; countries: Record<string, CtCountry> }

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const PALETTE = ["#16a34a", "#f59e0b", "#0ea5e9", "#a855f7", "#ef4444", "#06b6d4", "#84cc16", "#ec4899", "#f97316", "#22d3ee", "#a3e635", "#fb7185"];
const kt = (mt?: number | null) => (mt == null ? 0 : mt / 1000);
const fmtKt = (mt?: number | null) => `${Math.round(kt(mt)).toLocaleString()} kt`;

function Section({ n, title, note, children }: { n: number; title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80">Concept {n}</div>
      <h3 className="text-base font-bold text-slate-100">{title}</h3>
      <p className="text-xs text-slate-400">{note}</p>
      <div className="pt-2">{children}</div>
    </div>
  );
}

// ── 1. KPI strip ────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-slate-800/60 rounded-lg px-3 py-2 border border-slate-700">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-mono ${tone ?? "text-slate-100"}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500">{sub}</div>}
    </div>
  );
}

function topOrigin(d?: ByOrigin) {
  return d?.origins?.[0];
}

// HHI sourcing concentration (0–10000) on latest-year shares.
function hhi(d?: ByOrigin): number {
  if (!d?.origins?.length) return 0;
  const total = d.origins.reduce((s, o) => s + (o.latest_mt ?? 0), 0);
  if (!total) return 0;
  return Math.round(d.origins.reduce((s, o) => s + ((o.latest_mt ?? 0) / total * 100) ** 2, 0));
}

// ── treemap ──────────────────────────────────────────────────────────────────
function OriginTreemap({ d }: { d: ByOrigin }) {
  const data = d.origins.slice(0, 28).map((o, i) => ({ name: o.name, size: kt(o.latest_mt), fill: PALETTE[i % PALETTE.length] }));
  return (
    <div className="h-80">
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

// ── sankey ───────────────────────────────────────────────────────────────────
function buildSankey(us?: ByOrigin, eu?: ByOrigin) {
  const score: Record<string, number> = {};
  for (const o of us?.origins ?? []) score[o.name] = (score[o.name] ?? 0) + kt(o.latest_mt);
  for (const o of eu?.origins ?? []) score[o.name] = (score[o.name] ?? 0) + kt(o.latest_mt);
  const names = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 12).map(n => n[0]);
  const nodes = [...names.map(n => ({ name: n })), { name: "United States" }, { name: "European Union" }];
  const usIdx = names.length, euIdx = names.length + 1;
  const usMap = Object.fromEntries((us?.origins ?? []).map(o => [o.name, kt(o.latest_mt)]));
  const euMap = Object.fromEntries((eu?.origins ?? []).map(o => [o.name, kt(o.latest_mt)]));
  const links: { source: number; target: number; value: number }[] = [];
  names.forEach((n, i) => {
    if (usMap[n] > 0) links.push({ source: i, target: usIdx, value: Math.round(usMap[n]) });
    if (euMap[n] > 0) links.push({ source: i, target: euIdx, value: Math.round(euMap[n]) });
  });
  return { nodes, links };
}
function SankeyNode(props: { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: { name: string } }) {
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

// ── roasted-share scatter (Comtrade) ─────────────────────────────────────────
function RoastedScatter({ ct }: { ct: Comtrade }) {
  const pts = Object.values(ct.countries).map(c => {
    const ly = c.annual.find(a => a.year === c.latest_year) ?? c.annual[c.annual.length - 1];
    const tot = kt(ly?.total_mt), roasted = ly?.total_mt && ly?.roasted_mt ? (ly.roasted_mt / ly.total_mt) * 100 : null;
    return { name: c.name, x: tot, y: roasted, z: tot };
  }).filter(p => p.x > 0 && p.y != null);
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis type="number" dataKey="x" name="Total imports" tick={{ fontSize: 9, fill: "#64748b" }}
            tickFormatter={v => `${v}kt`} label={{ value: "Total imports (kt)", position: "insideBottom", offset: -8, fontSize: 9, fill: "#64748b" }} />
          <YAxis type="number" dataKey="y" name="Roasted share" tick={{ fontSize: 9, fill: "#64748b" }}
            tickFormatter={v => `${v}%`} label={{ value: "Roasted %", angle: -90, position: "insideLeft", fontSize: 9, fill: "#64748b" }} />
          <ZAxis type="number" dataKey="z" range={[30, 500]} />
          <Tooltip contentStyle={TT} cursor={{ strokeDasharray: "3 3" }}
            formatter={(v: unknown, n: unknown) => [n === "Roasted share" ? `${Number(v).toFixed(0)}%` : `${Number(v).toFixed(0)} kt`, String(n)]}
            labelFormatter={() => ""} content={({ payload }) => {
              const p = payload?.[0]?.payload as { name: string; x: number; y: number } | undefined;
              if (!p) return null;
              return <div style={TT as React.CSSProperties} className="px-2 py-1 text-slate-200">
                <div className="font-bold">{p.name}</div>
                <div>{Math.round(p.x)} kt · {Math.round(p.y)}% roasted</div>
              </div>;
            }} />
          <Scatter data={pts}>
            {pts.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.7} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── bump chart (origin rank over years) ──────────────────────────────────────
function BumpChart({ d }: { d: ByOrigin }) {
  const names = d.origins.slice(0, 7).map(o => o.name);
  const rows = d.years.map(y => {
    const ranked = [...d.origins].sort((a, b) => (b.by_year[String(y)] ?? 0) - (a.by_year[String(y)] ?? 0));
    const row: Record<string, number | string> = { year: y };
    names.forEach(n => { const r = ranked.findIndex(o => o.name === n); if (r >= 0) row[n] = r + 1; });
    return row;
  });
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 70, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} />
          <YAxis reversed domain={[1, names.length]} ticks={Array.from({ length: names.length }, (_, i) => i + 1)}
            tick={{ fontSize: 9, fill: "#64748b" }} width={28} label={{ value: "rank", angle: -90, position: "insideLeft", fontSize: 9, fill: "#64748b" }} />
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

// ── YoY heatmap ───────────────────────────────────────────────────────────────
function YoyHeatmap({ d }: { d: ByOrigin }) {
  const names = d.origins.slice(0, 12);
  const years = d.years;
  const cell = (pct: number | null) => {
    if (pct == null) return "#1e293b";
    const c = Math.max(-40, Math.min(40, pct)) / 40;            // clamp ±40%
    return c >= 0 ? `rgba(22,163,74,${0.2 + 0.7 * c})` : `rgba(239,68,68,${0.2 + 0.7 * -c})`;
  };
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
                  style={{ background: cell(pct), width: 30, height: 18 }}
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

// ── sparkline table ───────────────────────────────────────────────────────────
function Spark({ vals, color }: { vals: number[]; color: string }) {
  if (vals.length < 2) return <span className="text-slate-600">—</span>;
  const min = Math.min(...vals), max = Math.max(...vals), w = 80, h = 20;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} /></svg>;
}
function SparkTable({ d }: { d: ByOrigin }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {d.origins.slice(0, 12).map((o, i) => (
          <tr key={o.name} className="border-b border-slate-800">
            <td className="py-1 text-slate-200">{o.name}</td>
            <td className="py-1"><Spark vals={d.years.map(y => o.by_year[String(y)] ?? 0)} color={PALETTE[i % PALETTE.length]} /></td>
            <td className="py-1 text-right font-mono text-amber-300">{fmtKt(o.latest_mt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── lab container ─────────────────────────────────────────────────────────────
export default function ImportsVisualsLab() {
  const [us, setUs] = useState<ByOrigin | null>(null);
  const [eu, setEu] = useState<ByOrigin | null>(null);
  const [ct, setCt] = useState<Comtrade | null>(null);
  const [dest, setDest] = useState<"US" | "EU">("US");
  const [tmDest, setTmDest] = useState<"US" | "EU">("US");

  useEffect(() => {
    fetch("/data/us_coffee_imports.json").then(r => r.json()).then(setUs).catch(() => {});
    fetch("/data/eu_coffee_imports.json").then(r => r.json()).then(setEu).catch(() => {});
    fetch("/data/coffee_imports.json").then(r => r.json()).then(setCt).catch(() => {});
  }, []);

  const sankey = useMemo(() => buildSankey(us ?? undefined, eu ?? undefined), [us, eu]);
  const flowData = dest === "US" ? us : eu;
  const tmData = tmDest === "US" ? us : eu;

  if (!us || !eu || !ct) return <div className="p-6 text-xs text-slate-500 animate-pulse">Loading import datasets…</div>;

  const ctTotal = Object.values(ct.countries).reduce((s, c) => {
    const ly = c.annual.find(a => a.year === c.latest_year) ?? c.annual[c.annual.length - 1];
    return s + kt(ly?.total_mt);
  }, 0);

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-white">Imports — Visual Lab ✦</h2>
        <p className="text-xs text-slate-400">
          Preview gallery of candidate visuals for the Imports tab. Data: UN Comtrade (global), USITC (US by origin),
          Eurostat (EU by origin). {eu.is_seed && <span className="text-amber-400/80">EU is still seed data.</span>}
        </p>
      </div>

      {/* Concept 1 — KPI strip */}
      <Section n={1} title="KPI stat-strip" note="Instant context above the charts — totals, leaders, and sourcing concentration (HHI).">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="World tracked (Comtrade)" value={fmtKt(ctTotal * 1000)} sub={`${Object.keys(ct.countries).length} markets`} tone="text-amber-300" />
          <Kpi label="US imports" value={fmtKt(us.total_by_year[String(us.years[us.years.length - 1])] * 1000)} sub={`top: ${topOrigin(us)?.name ?? "—"}`} />
          <Kpi label="US origins" value={`${us.origins.length}`} sub={`HHI ${hhi(us)}`} />
          <Kpi label="EU imports" value={fmtKt(eu.total_by_year[String(eu.years[eu.years.length - 1])] * 1000)} sub={`top: ${topOrigin(eu)?.name ?? "—"}`} />
          <Kpi label="EU origins" value={`${eu.origins.length}`} sub={`HHI ${hhi(eu)}`} />
          <Kpi label="US top-3 share" value={`${Math.round(us.origins.slice(0, 3).reduce((s, o) => s + (o.latest_mt ?? 0), 0) / us.origins.reduce((s, o) => s + (o.latest_mt ?? 0), 0) * 100)}%`} sub="of US imports" />
        </div>
      </Section>

      {/* Concept 2 — flow map */}
      <Section n={2} title="Sourcing flow map (leaflet)" note="Arcs from origin countries to the destination bloc; arc width = import volume. The hero geographic view.">
        <div className="flex gap-1 mb-2">
          {(["US", "EU"] as const).map(x => (
            <button key={x} onClick={() => setDest(x)}
              className={`px-2 py-0.5 rounded text-[10px] border ${dest === x ? "bg-amber-500 text-slate-900 border-transparent font-medium" : "border-slate-700 text-slate-400"}`}>{x}</button>
          ))}
        </div>
        {flowData && <SourcingFlowMap origins={flowData.origins} dest={dest} color={dest === "US" ? "#0ea5e9" : "#f59e0b"} />}
      </Section>

      {/* Concept 3 — treemap */}
      <Section n={3} title="Origin treemap" note="Area = import volume. Turns the long origin list into an at-a-glance concentration map.">
        <div className="flex gap-1 mb-2">
          {(["US", "EU"] as const).map(x => (
            <button key={x} onClick={() => setTmDest(x)}
              className={`px-2 py-0.5 rounded text-[10px] border ${tmDest === x ? "bg-amber-500 text-slate-900 border-transparent font-medium" : "border-slate-700 text-slate-400"}`}>{x}</button>
          ))}
        </div>
        {tmData && <OriginTreemap d={tmData} />}
      </Section>

      {/* Concept 4 — sankey */}
      <Section n={4} title="Origins → blocs Sankey" note="Top origins flowing into the US and EU in one diagram (latest year, kt).">
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey data={sankey} node={<SankeyNode />} nodePadding={14} margin={{ top: 10, right: 120, bottom: 10, left: 10 }}
              link={{ stroke: "#475569", strokeOpacity: 0.35 }}>
              <Tooltip contentStyle={TT} formatter={(v: unknown) => [`${Number(v).toLocaleString()} kt`, "flow"]} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* Concept 5 — scatter */}
      <Section n={5} title="Green-vs-roasted segmentation" note="Each market: total imports (x) vs roasted share (y), bubble = size. Separates green-bean roasters from roasted re-export hubs.">
        <RoastedScatter ct={ct} />
      </Section>

      {/* Concept 6 — bump */}
      <Section n={6} title="Origin rank bump chart (US)" note="How each top origin's rank as a US supplier shifts year to year.">
        <BumpChart d={us} />
      </Section>

      {/* Concept 7 — heatmap */}
      <Section n={7} title="YoY change heatmap (US origins)" note="Year-over-year volume change per origin — spot surges and collapses instantly.">
        <YoyHeatmap d={us} />
      </Section>

      {/* Concept 8 — sparklines */}
      <Section n={8} title="Sparkline table (US origins)" note="Per-origin mini-trend inline with the latest value — compact drill view.">
        <SparkTable d={us} />
      </Section>
    </div>
  );
}
