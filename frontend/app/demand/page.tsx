"use client";
import { Suspense } from "react";

import NewsFeedList from "@/components/NewsFeedList";
import AgeCohortPanel from "@/components/demand/AgeCohortPanel";
import CertifiedStocksPanel from "@/components/demand/CertifiedStocksPanel";
import EarningsTable from "@/components/demand/EarningsTable";
import GrowthMarketsPanel from "@/components/demand/GrowthMarketsPanel";
import KaffeesteuerChart from "@/components/demand/KaffeesteuerChart";
import RoastingMixPanel from "@/components/demand/RoastingMixPanel";
import StocksPanel from "@/components/demand/StocksPanel";
import WorldConsumptionWidget from "@/components/demand/WorldConsumptionWidget";
import PageHeader from "@/components/PageHeader";
import { useUrlState } from "@/lib/useUrlState";

type SubTab = "destination" | "certified" | "demand" | "listed";

const TABS: { id: SubTab; label: string }[] = [
  { id: "destination", label: "Destination stocks" },
  { id: "certified",   label: "Certified stocks" },
  { id: "demand",      label: "Demand" },
  { id: "listed",      label: "Listed stocks" },
];
const SUB_TABS = TABS.map((t) => t.id) as SubTab[];

function Section({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-slate-700 bg-slate-950">{children}</div>;
}

export default function DemandPage() {
  // useUrlState reads `useSearchParams`, which Next 14 requires to live
  // under a Suspense boundary during static prerender (see /futures).
  return (
    <Suspense fallback={<div className="h-full bg-slate-950" />}>
      <DemandPageInner />
    </Suspense>
  );
}

function DemandPageInner() {
  // Deep-linkable sub-tab via `?tab=certified` — bookmarks, share-links,
  // and the browser back button all behave correctly.
  const [tab, setTab] = useUrlState<SubTab>("tab", "destination", (raw) =>
    (SUB_TABS as string[]).includes(raw) ? (raw as SubTab) : "destination",
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="Demand"
        subtitle="Destination stocks · Certified stocks · Demand drivers · Listed companies"
        healthKeys={["ecf", "psd_coffee", "ajca", "population"]}
      />

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 flex-wrap px-4 py-2 border-b border-slate-700 bg-slate-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              tab === t.id
                ? "bg-slate-800 text-amber-400 border border-slate-700"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Per-sub-tab content. Existing panels move under their tab, no panel
          renders on more than one tab. NewsFeedList stays as a persistent
          footer across all sub-tabs (demand-relevant news is general). */}
      {tab === "destination" && (
        <Section>
          <StocksPanel />
        </Section>
      )}

      {tab === "certified" && (
        <Section>
          <CertifiedStocksPanel />
        </Section>
      )}

      {tab === "demand" && (
        <>
          <Section><WorldConsumptionWidget /></Section>
          <Section><GrowthMarketsPanel /></Section>
          <Section><AgeCohortPanel /></Section>
          <Section><RoastingMixPanel /></Section>
          <Section><KaffeesteuerChart /></Section>
        </>
      )}

      {tab === "listed" && (
        <Section>
          <EarningsTable />
        </Section>
      )}

      <div className="flex-1 overflow-hidden">
        <NewsFeedList title="Demand News" category="demand" />
      </div>
    </div>
  );
}
