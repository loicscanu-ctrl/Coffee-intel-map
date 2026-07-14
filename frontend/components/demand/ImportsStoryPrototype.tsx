"use client";
import ImportsPanel from "@/components/demand/ImportsPanel";
import MonthlyTrendCombined from "@/components/demand/MonthlyTrendCombined";
import SourceReconciliation from "@/components/demand/SourceReconciliation";
import OriginExplorer, { ImportKpiStrip } from "@/components/demand/imports-lab/OriginExplorer";

// Imports tab redesign — Option A "funnel" storyline, prototyped in the Test
// tab before replacing the live layout. Same components, re-ordered into a
// narrative: world state → who buys → what's changing → from where → fine
// print (collapsed). Chapter headers carry the one-line question each section
// answers, so the reader always knows why they're looking at a chart.
function Chapter({ n, title, question, children }: {
  n: number; title: string; question: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 border-b border-slate-800 pb-2">
        <span className="text-[22px] font-black text-amber-500/70 leading-none">{n}</span>
        <div>
          <h3 className="text-base font-bold text-slate-100 leading-tight">{title}</h3>
          <p className="text-[11px] text-slate-500">{question}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function ImportsStoryPrototype() {
  return (
    <div className="p-4 space-y-8">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-white">Imports — redesigned layout (prototype) ✦</h2>
        <p className="text-xs text-slate-400 max-w-3xl">
          Funnel storyline: world state → who buys → what&rsquo;s changing → from where → fine print.
          Same data and charts as the live Imports tab, reorganized. The standalone US/EU origin cards are
          retired here — their content lives in the origin explorer (chapter 4). Approve and this replaces
          the live tab layout.
        </p>
      </div>

      <Chapter n={1} title="World import demand" question="How much coffee is the world buying, and is it growing?">
        <ImportKpiStrip />
      </Chapter>

      <Chapter n={2} title="Who buys" question="Which countries drive import demand? (Comtrade + Eurostat ᴱ for EU members)">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <ImportsPanel />
        </div>
      </Chapter>

      <Chapter n={3} title="What's changing" question="Where is import momentum building or fading right now?">
        <MonthlyTrendCombined />
        <OriginExplorer sections={["heat"]} />
      </Chapter>

      <Chapter n={4} title="From where" question="Which origins supply each market, and how are supplier ranks shifting?">
        <OriginExplorer sections={["combo", "sankey"]} />
        <p className="text-[10px] text-slate-500 italic">
          Geographic view: the Map tab&rsquo;s <span className="text-slate-300">Import flows</span> toggle
          draws these flows as arcs (Off / US / EU).
        </p>
      </Chapter>

      <Chapter n={5} title="Fine print" question="Can these numbers be trusted, and where do they come from?">
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
