"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from "recharts";
import { cachedFetchStatic } from "@/lib/api";
import {
  buildCostStack, buildLevelSeries, buildOriginInflow, eventStudy,
  PARITY_ORIGINS, CONTAINER_MT, PARITY_ADDERS_USD, type DatedPrice, type Snapshot, type GradingDay,
} from "@/lib/research/certStocksParity";

// ── colours (fixed categorical order — never cycled) ────────────────────────
const C = { rc: "#f59e0b", farmgate: "#38bdf8", atPort: "#a78bfa", tendering: "#34d399", bar: "#38bdf8", up: "#34d399" };
const AX = "#64748b", GRID = "#1e293b";

const tip = {
  contentStyle: { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 },
  labelStyle: { color: "#94a3b8" }, itemStyle: { color: "#e2e8f0" },
};
const mmdd = (d: string) => d.slice(5);

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs text-slate-300 leading-relaxed mb-2${className ? ` ${className}` : ""}`}>{children}</p>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">{children}</code>;
}

interface Loaded {
  rc: DatedPrice[];
  farmgate: Record<string, DatedPrice[]>;
  fx: Record<string, DatedPrice[]>;
  snapshots: Snapshot[];
  deep: Snapshot[][];
  gradings: GradingDay[];
  freightUsdMt: number;
}

export default function CertifiedStocksParity() {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState(false);
  const [originKey, setOriginKey] = useState("vietnam");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fph, oph, fx, cs, d25, d20, freight] = await Promise.all([
          cachedFetchStatic<{ robusta: DatedPrice[] }>("/data/futures_price_history.json"),
          cachedFetchStatic<{ origins: Record<string, { currency: string; history: DatedPrice[] }> }>("/data/origin_prices_history.json"),
          cachedFetchStatic<{ pairs: Record<string, { history: { date: string; close: number }[] }> }>("/data/fx_history.json"),
          cachedFetchStatic<{ snapshots: Snapshot[]; recent_activity: { gradings: GradingDay[] } }>("/data/certified_stocks_robusta.json"),
          cachedFetchStatic<{ snapshots: Snapshot[] }>("/data/certified_stocks_robusta_deep_2025-2029.json").catch(() => ({ snapshots: [] })),
          cachedFetchStatic<{ snapshots: Snapshot[] }>("/data/certified_stocks_robusta_deep_2020-2024.json").catch(() => ({ snapshots: [] })),
          cachedFetchStatic<{ routes?: { id: string; rate: number }[] }>("/data/freight.json").catch(() => ({ routes: [] })),
        ]);
        const farmgate: Record<string, DatedPrice[]> = {};
        for (const o of PARITY_ORIGINS) farmgate[o.key] = (oph.origins?.[o.farmgateKey]?.history ?? []).map(d => ({ date: d.date, price: d.price }));
        const fxOut: Record<string, DatedPrice[]> = {};
        for (const o of PARITY_ORIGINS) if (o.fxTicker) fxOut[o.fxTicker] = (fx.pairs?.[o.fxTicker]?.history ?? []).map(d => ({ date: d.date, price: d.close }));
        const vnEu = (freight.routes ?? []).find(r => r.id === "vn-eu");
        if (alive) setData({
          rc: fph.robusta ?? [],
          farmgate, fx: fxOut,
          snapshots: cs.snapshots ?? [],
          deep: [d20.snapshots ?? [], d25.snapshots ?? []],
          gradings: cs.recent_activity?.gradings ?? [],
          freightUsdMt: (vnEu ? vnEu.rate : 4741) / CONTAINER_MT,
        });
      } catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, []);

  const origin = PARITY_ORIGINS.find(o => o.key === originKey) ?? PARITY_ORIGINS[0];

  const stack = useMemo(() => {
    if (!data) return [];
    return buildCostStack(data.farmgate[origin.key] ?? [], data.fx[origin.fxTicker] ?? [], data.rc, origin, data.freightUsdMt);
  }, [data, origin]);

  const level = useMemo(() => (data ? buildLevelSeries(...data.deep, data.snapshots) : []), [data]);
  const inflow = useMemo(() => (data ? buildOriginInflow(data.gradings, origin.gradingOrigin) : []), [data, origin]);
  const originRank = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, number>();
    for (const g of data.gradings) for (const e of g.entries ?? []) if (e.origin && typeof e.lots === "number") m.set(e.origin, (m.get(e.origin) ?? 0) + e.lots);
    return Array.from(m.entries()).map(([o, lots]) => ({ origin: o.replace("Brazilian ", "Brazil "), lots })).sort((a, b) => b.lots - a.lots).slice(0, 7);
  }, [data]);
  const es = useMemo(() => (level.length ? eventStudy(data!.rc, level, 6, 10) : null), [level, data]);

  // fill months with 0 so a barely-tendering origin reads honestly as ~empty
  const inflowFilled = useMemo(() => {
    if (!inflow.length) return [];
    const map = new Map(inflow.map(d => [d.month, d.lots]));
    const start = inflow[0].month, end = inflow[inflow.length - 1].month;
    const out: { month: string; lots: number }[] = [];
    let [y, mo] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    while (y < ey || (y === ey && mo <= em)) {
      const k = `${y}-${String(mo).padStart(2, "0")}`;
      out.push({ month: k, lots: map.get(k) ?? 0 });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    return out;
  }, [inflow]);

  if (err) return <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs text-red-400 max-w-4xl">Failed to load certified-stocks / price data.</div>;
  if (!data) return <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs text-slate-500 animate-pulse max-w-4xl">Loading certified-stocks &amp; parity data…</div>;

  const last = stack[stack.length - 1];
  const gapNow = last?.rc != null && last?.tendering != null ? last.rc - last.tendering : null;
  const totalOriginLots = inflow.reduce((s, d) => s + d.lots, 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-4xl">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Certified stocks · Tenderable parity</div>
      <h3 className="text-xl font-bold text-slate-100 leading-tight mb-1">When does origin coffee flow to the exchange?</h3>
      <P>
        A trader tenders coffee onto the exchange only when it pays more than selling commercial — i.e. when the all-in
        cost to place origin coffee into a certified warehouse falls <strong>below</strong> the exchange price. That
        break-even is <strong>tenderable parity</strong>. This tool stacks an origin&rsquo;s cost chain against London
        Robusta (RC) over time, shows who actually fills the exchange, and tests whether reaching parity systematically
        pulls coffee in — and with what lag.
      </P>

      {/* Origin selector */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-3 mb-1">
        <span>Origin:</span>
        {PARITY_ORIGINS.map(o => (
          <button key={o.key} onClick={() => setOriginKey(o.key)}
            className={`px-2 py-0.5 rounded border text-[11px] ${originKey === o.key ? "bg-slate-800 text-amber-400 border-slate-600" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
            {o.label}
          </button>
        ))}
        <span className="text-slate-600">· vs London RC (USD/MT)</span>
      </div>

      {/* ── Chart A: cost stack vs RC ─────────────────────────────────── */}
      <H>1 · The cost stack against the exchange</H>
      <P>
        <Code>farmgate</Code> (local price → USD/MT) → <Code>+FOBbing</Code> = at-port → <Code>+freight +{PARITY_ADDERS_USD}</Code>
        (port transport, rent, loading-out, allowances) = <strong>all-in tendering cost</strong>. When the tendering line
        sits <em>below</em> RC, tendering is profitable and certified stock should build.
      </P>
      <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={stack} margin={{ top: 6, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={mmdd} tick={{ fill: AX, fontSize: 10 }} minTickGap={28} />
            <YAxis tick={{ fill: AX, fontSize: 10 }} width={44} domain={["auto", "auto"]} tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
            <Tooltip {...tip} formatter={(v, n) => [v == null ? "—" : `$${Math.round(Number(v))}`, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="farmgate" name="Farmgate" stroke={C.farmgate} dot={false} strokeWidth={1.5} connectNulls />
            <Line dataKey="atPort" name="FOB + logistics" stroke={C.atPort} dot={false} strokeWidth={1.5} connectNulls />
            <Line dataKey="tendering" name="All-in tendering cost" stroke={C.tendering} dot={false} strokeWidth={2} connectNulls />
            <Line dataKey="rc" name="London RC" stroke={C.rc} dot={false} strokeWidth={2.5} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <P className="text-[11px] text-slate-400 mt-1">
        {last && gapNow != null ? (
          <>Latest ({last.date}): RC <strong className="text-amber-400">${Math.round(last.rc!)}</strong> vs tendering cost{" "}
            <strong className="text-emerald-400">${Math.round(last.tendering!)}</strong> →{" "}
            <strong className={gapNow >= 0 ? "text-emerald-400" : "text-red-400"}>
              {gapNow >= 0 ? `tenderable (+$${Math.round(gapNow)})` : `not tenderable (−$${Math.round(-gapNow)})`}</strong>.
            Over the {stack.length}-day window, tendering was profitable on{" "}
            {stack.filter(r => r.rc != null && r.tendering != null && r.rc >= r.tendering).length} days.</>
        ) : "No overlapping price/farmgate data for this origin."}
        {" "}Farmgate history is short (~2 months) — this is the current-mechanism view, not a back-cast.
      </P>

      {/* ── Chart B: gradings for this origin + who fills the exchange ── */}
      <H>2 · Gradings — who actually fills the exchange</H>
      <P>
        Monthly graded lots for <strong>{origin.label}</strong> (gross inflow to the certified pool). Over the ~13-month
        gradings window this origin contributed <strong>{totalOriginLots.toLocaleString()} lots</strong>.
      </P>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{origin.label} · monthly gradings (lots)</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={inflowFilled} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m) => m.slice(2)} tick={{ fill: AX, fontSize: 9 }} minTickGap={16} />
              <YAxis tick={{ fill: AX, fontSize: 10 }} width={34} />
              <Tooltip {...tip} formatter={(v) => [`${Number(v)} lots`, "graded"]} />
              <Bar dataKey="lots" fill={C.bar} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">All robusta gradings by origin (lots, ~13mo)</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={originRank} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: AX, fontSize: 9 }} />
              <YAxis type="category" dataKey="origin" tick={{ fill: AX, fontSize: 9 }} width={92} />
              <Tooltip {...tip} formatter={(v) => [`${Number(v).toLocaleString()} lots`, "graded"]} />
              <Bar dataKey="lots" radius={[0, 2, 2, 0]}>
                {originRank.map((r) => <Cell key={r.origin} fill={r.origin.startsWith(origin.gradingOrigin.replace("Brazilian ", "Brazil ")) ? C.rc : C.bar} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <P className="text-[11px] text-slate-400 mt-1">
        The tell: <strong>Indonesia and Brazil Conillon dominate</strong> the certified pool, while{" "}
        <strong>Vietnam barely tenders</strong> (~a few hundred lots, one July-2025 cluster) despite being the largest
        robusta exporter — Vietnamese coffee sells to the trade, not the exchange. Reaching parity is <em>necessary but
        not sufficient</em>: origin selling behaviour decides who fills LIFFE.
      </P>

      {/* ── Chart C + event study ─────────────────────────────────────── */}
      <H>3 · Does hitting parity systematically pull coffee in?</H>
      <P>
        The rigorous per-origin test isn&rsquo;t possible from stored data (the at-port differential is only ~2 months and
        per-origin inflow counts are tiny). The best available proxy: does the <strong>total</strong> certified pool build
        after RC is elevated (a high RC compresses every origin&rsquo;s differential toward parity)?
      </P>
      <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Total certified robusta stock (lots)</div>
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={level} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 7)} tick={{ fill: AX, fontSize: 9 }} minTickGap={44} />
            <YAxis tick={{ fill: AX, fontSize: 10 }} width={44} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip {...tip} formatter={(v) => [`${Number(v).toLocaleString()} lots`, "certified"]} />
            <Line dataKey="price" name="certified" stroke={C.rc} dot={false} strokeWidth={1.8} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {es && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">RC → forward Δstock correlation by lag (weeks)</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={es.lagCorrs} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="lag" tick={{ fill: AX, fontSize: 9 }} />
                <YAxis tick={{ fill: AX, fontSize: 10 }} width={34} domain={[0, "auto"]} />
                <Tooltip {...tip} formatter={(v) => [Number(v).toFixed(2), "corr"]} labelFormatter={(l) => `lag ${l}w`} />
                <Bar dataKey="corr" radius={[2, 2, 0, 0]}>
                  {es.lagCorrs.map((l) => <Cell key={l.lag} fill={l.lag === es.bestLag ? C.up : "#334155"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-slate-950/40 border border-slate-700/60 rounded-lg p-3 text-xs text-slate-300 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">What the {es.weeks} weeks say ({es.spanLabel})</div>
            <div>Peak response lag: <strong className="text-emerald-400">~{es.bestLag} weeks</strong> (corr {es.bestCorr.toFixed(2)} — weak).</div>
            <div>After <strong>high-RC</strong> weeks, the pool changes <strong className="text-emerald-400">{es.buildHiRc >= 0 ? "+" : ""}{Math.round(es.buildHiRc).toLocaleString()}</strong> lots over the next {es.horizonWeeks}w, vs{" "}
              <strong className="text-red-400">{es.buildLoRc >= 0 ? "+" : ""}{Math.round(es.buildLoRc).toLocaleString()}</strong> after low-RC weeks — a{" "}
              <strong>{Math.round(es.buildHiRc - es.buildLoRc).toLocaleString()}-lot</strong> relative build.</div>
            <div className="text-slate-400 text-[11px]">So the signal is real but <strong>weak and lagged (~2 months)</strong>: high RC leans stocks toward building, but the effect is swamped by the secular drawdown, EUDR transition and freight.</div>
          </div>
        </div>
      )}

      <H>Reading & caveats</H>
      <ul className="space-y-1 mb-2">
        {[
          "Parity is a floor, not a trigger: a differential at/below parity makes tendering economic, but origins that can sell commercial (Vietnam) mostly do — so parity predicts capacity to tender, not the act.",
          "The event study uses RC level as the parity driver and net all-origin stock change as the response — the per-origin differential→inflow fit needs a persisted differential series (only ~2 months exist today).",
          "Δ(certified stock) is net (gradings − decertifications), so it understates gross inflow; the gradings bars above are the gross-inflow view.",
          "Structural breaks — Red Sea freight re-routing, the EUDR transition-stock allowances, age-allowance decay — move certified stock independently of parity.",
          "Robusta / London shown; the same framework applies to NY arabica (per-origin gradings exist in bags), but arabica farmgate history is too thin to draw the cost stack.",
        ].map((t, i) => (
          <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed"><span className="text-amber-500/70">•</span><span>{t}</span></li>
        ))}
      </ul>
      <P className="text-[11px] text-slate-500">
        Data: <Code>futures_price_history</Code> (RC), <Code>origin_prices_history</Code> + <Code>fx_history</Code>
        (farmgate→USD), <Code>freight.json</Code> (ocean leg), <Code>certified_stocks_robusta</Code> (+ deep files) for
        levels and per-origin gradings. Cost constants from <Code>lib/originCosts</Code> and the Contract-rules parity
        stack. Everything recomputes live as the feeds update.
      </P>
    </div>
  );
}
