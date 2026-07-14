import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ResearchView from "@/components/research/ResearchView";

const VALID_TABS = ["cot", "signals", "sentiment", "futures", "macro", "weather", "supply", "farmer", "fertilizer", "contracts", "agronomy", "logistics", "destination", "freight", "certstocks", "parity", "demand"] as const;
type Cat = typeof VALID_TABS[number];

export default async function ResearchTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab: rawTab } = await params;
  const tab = rawTab.toLowerCase() as Cat;
  if (!VALID_TABS.includes(tab)) notFound();
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Research"
        subtitle="Intraweek positioning model methodology & COT backtest report"
      />
      <div className="p-4 sm:p-6">
        <ResearchView initialTab={tab} />
      </div>
    </div>
  );
}
