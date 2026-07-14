"use client";
import { useEffect, useMemo, useState } from "react";
import ImportsPanel from "@/components/demand/ImportsPanel";
import MonthlyTrendCombined from "@/components/demand/MonthlyTrendCombined";
import SourceReconciliation from "@/components/demand/SourceReconciliation";
import OriginExplorer, { ImportKpiStrip, useImportData } from "@/components/demand/imports-lab/OriginExplorer";

// The live Imports tab — "funnel" storyline: world state → who buys → what's
// changing → from where → fine print (collapsed). Chapter headers carry the
// one-line question each section answers, and each chapter opens with an
// insight sentence COMPUTED LIVE from the same data the charts plot — the tab
// reads like a briefing, the charts are the evidence. Sentences degrade
// gracefully (null → hidden) when a series is missing.
function Chapter({ n, title, question, insight, children }: {
  n: number; title: string; question: string; insight?: string | null; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="border-b border-slate-800 pb-2 space-y-1.5">
        <div className="flex items-baseline gap-3">
          <span className="text-[22px] font-black text-amber-500/70 leading-none">{n}</span>
          <div>
            <h3 className="text-base font-bold text-slate-100 leading-tight">{title}</h3>
            <p className="text-[11px] text-slate-500">{question}</p>
          </div>
        </div>
        {insight && (
          <p className="text-[12px] text-slate-300 bg-slate-900/70 border-l-2 border-amber-500/50 rounded-r px-3 py-1.5">
            💬 {insight}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

// ── live insight computation ──────────────────────────────────────────────────
const p1 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const ktOf = (mt: number) => `${Math.round(mt / 1000).toLocaleString()} kt`;

function yoyOf(tby: Record<string, number>): { yr: string; val: number; yoy: number | null } | null {
  const ys = Object.keys(tby).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ys.length) return null;
  const yr = ys[ys.length - 1], prev = tby[String(yr - 1)];
  return { yr: String(yr), val: tby[String(yr)], yoy: prev ? ((tby[String(yr)] / prev) - 1) * 100 : null };
}

// Trailing-12-consecutive-month totals of a {"YYYY-MM": mt} map.
function matOf(m: Record<string, number> | undefined): Record<string, number> {
  const keys = Object.keys(m ?? {}).filter(k => (m as Record<string, number>)[k] > 0).sort();
  const out: Record<string, number> = {};
  for (let i = 11; i < keys.length; i++) {
    const w = keys.slice(i - 11, i + 1);
    const [y0, m0] = w[0].split("-").map(Number);
    const [y1, m1] = w[11].split("-").map(Number);
    if (y1 * 12 + m1 - (y0 * 12 + m0) !== 11) continue;
    out[keys[i]] = w.reduce((s, k) => s + (m as Record<string, number>)[k], 0);
  }
  return out;
}
function matYoy(m: Record<string, number> | undefined): { end: string; val: number; yoy: number } | null {
  const mat = matOf(m);
  const ks = Object.keys(mat).sort();
  for (let i = ks.length - 1; i >= 0; i--) {
    const [y, mo] = ks[i].split("-").map(Number);
    const prevK = `${y - 1}-${String(mo).padStart(2, "0")}`;
    if (mat[prevK]) return { end: ks[i], val: mat[ks[i]], yoy: (mat[ks[i]] / mat[prevK] - 1) * 100 };
  }
  return null;
}

function useImportInsights() {
  const { us, eu, ct } = useImportData();
  // EU net-import context: extra-EU exports (re-exports out of the bloc) and
  // USDA-PSD EU consumption for the imports-vs-consumption comparison.
  const [euAux, setEuAux] = useState<{ exports?: Record<string, number>; soluble?: Record<string, number>;
    solubleImports?: Record<string, number>; consumptionMt?: number } | null>(null);
  useEffect(() => {
    Promise.all([
      fetch("/data/eu_coffee_imports.json").then(r => r.json()).catch(() => null),
      fetch("/data/demand_stocks.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([e, ds]) => {
      const annual = ds?.eu?.annual as { year: string; consumption_mt?: number }[] | undefined;
      const lastCons = annual?.filter(a => a.consumption_mt).at(-1)?.consumption_mt;
      setEuAux({ exports: e?.monthly_exports ?? undefined,
                 soluble: e?.monthly_exports_soluble ?? undefined,
                 solubleImports: e?.monthly_imports_soluble ?? undefined, consumptionMt: lastCons });
    });
  }, []);
  return useMemo(() => {
    if (!us || !eu || !ct) return { world: null, who: null, changing: null, origins: null, trust: null };

    // 1 — world state
    const worldByYear: Record<string, number> = {};
    for (const c of Object.values(ct.countries)) for (const a of c.annual)
      if (a.total_mt != null) worldByYear[String(a.year)] = (worldByYear[String(a.year)] ?? 0) + a.total_mt;
    const w = yoyOf(worldByYear), usA = yoyOf(us.total_by_year), euA = yoyOf(eu.total_by_year);
    let world = w ? `Tracked world imports reached ${ktOf(w.val)} in ${w.yr}` +
      (w.yoy != null ? ` (${p1(w.yoy)} YoY)` : "") +
      (usA?.yoy != null && euA?.yoy != null ? ` — US ${p1(usA.yoy)}, EU ${p1(euA.yoy)}.` : ".") : null;
    // Net-of-re-exports view: EU gross MAT − extra-EU export MAT, vs PSD consumption.
    const impMat = matYoy(eu.monthly_total), exMat = matYoy(euAux?.exports);
    const solMat = matYoy(euAux?.soluble), solImpMat = matYoy(euAux?.solubleImports);
    if (world && impMat && exMat) {
      const solGbe = solMat ? solMat.val * 2.6 : 0;          // ICO ×2.6 GBE, export side
      const solImpGbe = solImpMat ? solImpMat.val * 2.6 : 0; // …and the symmetric import side
      const net = impMat.val + solImpGbe - exMat.val - solGbe;
      let tail = ` EU exports run ~${ktOf(exMat.val + solGbe)}/yr` +
        (solGbe ? ` (incl. soluble ~${ktOf(solGbe)} GBE)` : "") +
        ` → NET imports ~${ktOf(net)}/yr (GBE, soluble both ways)`;
      const cons = euAux?.consumptionMt;
      if (cons) {
        const gap = net - cons;
        tail += ` vs PSD consumption ~${ktOf(cons)}/yr (${gap >= 0 ? "pipeline building" : "pipeline drawing"} ~${ktOf(Math.abs(gap))}/yr).`;
      } else tail += ".";
      world += tail;
    }

    // 2 — who buys: largest single markets vs the EU bloc
    const latestOf = (c: { annual: { year: number; total_mt: number | null }[]; latest_year: number }) =>
      c.annual.find(a => a.year === c.latest_year)?.total_mt ?? 0;
    const markets: [string, number][] = Object.values(ct.countries).map(c => [c.name, latestOf(c) ?? 0]);
    for (const [code, r] of Object.entries(eu.reporters ?? {})) {
      if (code === "EU27_2020") continue;
      const ly = yoyOf(r.total_by_year);
      if (ly && !markets.some(([n]) => n === r.name)) markets.push([r.name, ly.val]);
    }
    markets.sort((a, b) => b[1] - a[1]);
    const who = markets.length >= 2 && euA
      ? `${markets[0][0]} is the largest single market at ${ktOf(markets[0][1])}, ahead of ${markets[1][0]} ` +
        `(${ktOf(markets[1][1])}) — while the EU bloc together takes ${ktOf(euA.val)}/yr.`
      : null;

    // 3 — momentum: US/EU MAT + biggest rest-of-world mover
    const usM = matYoy(us.monthly_total), euM = matYoy(eu.monthly_total);
    let mover: { name: string; yoy: number } | null = null;
    for (const c of Object.values(ct.countries)) {
      const m = matYoy((c as { monthly_total?: Record<string, number> }).monthly_total);
      if (m && (!mover || Math.abs(m.yoy) > Math.abs(mover.yoy))) mover = { name: c.name, yoy: m.yoy };
    }
    const changing = usM && euM
      ? `On a 12-month basis the US is running ${ktOf(usM.val)}/yr (${p1(usM.yoy)} YoY) and the EU ` +
        `${ktOf(euM.val)}/yr (${p1(euM.yoy)}).` + (mover ? ` Biggest rest-of-world mover: ${mover.name} ${p1(mover.yoy)} MAT.` : "")
      : null;

    // 4 — origins: top supplier share of each bloc
    const share = (origins: { name: string; latest_mt: number | null }[]) => {
      const tot = origins.reduce((s, o) => s + (o.latest_mt ?? 0), 0);
      return tot && origins[0] ? { name: origins[0].name, pct: (origins[0].latest_mt ?? 0) / tot * 100 } : null;
    };
    const su = share(us.origins), se = share(eu.origins);
    const origins = su && se
      ? (su.name === se.name
        ? `${su.name} supplies ${su.pct.toFixed(0)}% of US and ${se.pct.toFixed(0)}% of EU imports.`
        : `${su.name} supplies ${su.pct.toFixed(0)}% of US imports; the EU's top origin is ${se.name} (${se.pct.toFixed(0)}%).`)
      : null;

    // 5 — trust: US mean Comtrade↔USITC gap over overlapping years
    const usaCt: Record<string, number> = {};
    for (const a of ct.countries.usa?.annual ?? []) if (a.total_mt) usaCt[String(a.year)] = a.total_mt;
    const gaps = Object.keys(us.total_by_year).filter(y => usaCt[y] > 0)
      .map(y => Math.abs((usaCt[y] - us.total_by_year[y]) / us.total_by_year[y]) * 100);
    const trust = gaps.length
      ? `USITC and UN Comtrade agree to within ${(gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(1)}% on the US; ` +
        `the EU has no usable Comtrade series — treat Eurostat as authoritative.`
      : `For the US, USITC is primary; for the EU, Eurostat is authoritative (no usable Comtrade EU-bloc series).`;

    return { world, who, changing, origins, trust };
  }, [us, eu, ct, euAux]);
}

export default function ImportsStory() {
  const ins = useImportInsights();
  return (
    <div className="p-4 space-y-8">
      <Chapter n={1} title="World import demand" question="How much coffee is the world buying, and is it growing?"
        insight={ins.world}>
        <ImportKpiStrip />
      </Chapter>

      <Chapter n={2} title="Who buys" question="Which countries drive import demand? (Comtrade + Eurostat ᴱ for EU members)"
        insight={ins.who}>
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <ImportsPanel />
        </div>
      </Chapter>

      <Chapter n={3} title="What's changing" question="Where is import momentum building or fading right now?"
        insight={ins.changing}>
        <MonthlyTrendCombined />
        <OriginExplorer sections={["heat"]} />
      </Chapter>

      <Chapter n={4} title="From where" question="Which origins supply each market, and how are supplier ranks shifting?"
        insight={ins.origins}>
        <OriginExplorer sections={["combo", "sankey"]} />
        <p className="text-[10px] text-slate-500 italic">
          Geographic view: the Map tab&rsquo;s <span className="text-slate-300">Import flows</span> toggle
          draws these flows as arcs (Off / US / EU).
        </p>
      </Chapter>

      <Chapter n={5} title="Fine print" question="Can these numbers be trusted, and where do they come from?"
        insight={ins.trust}>
        <details className="group">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none">
            ▸ Source reconciliation &amp; data notes (click to expand)
          </summary>
          <div className="pt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SourceReconciliation primarySrc="/data/us_coffee_imports.json"
              primaryLabel="USITC" comtradeKey="usa"
              heading="US — USITC vs UN Comtrade" />
            <SourceReconciliation primarySrc="/data/eu_coffee_imports.json"
              primaryLabel="Eurostat" comtradeSrc="/data/eu_coffee_imports.json"
              comtradeField="comtrade_total_by_year"
              heading="EU — Eurostat vs UN Comtrade (extra-EU)"
              emptyNote="UN Comtrade has no usable EU-bloc series — the EU isn't a sovereign Comtrade reporter (member states report individually, and the public endpoint's EU member data is stale/incomplete). For the US the two agree to ~0.1%; for the EU, treat Eurostat as authoritative." />
          </div>
          <p className="text-[10px] text-slate-500 mt-3 max-w-3xl">
            Sources: UN Comtrade (rest-of-world, keyless preview endpoint), USITC DataWeb (US by origin),
            Eurostat Comext (EU bloc + member states, marked ᴱ). Monthly series are archived — history grows
            each run even where the source only serves a rolling window.
          </p>
        </details>
      </Chapter>
    </div>
  );
}
