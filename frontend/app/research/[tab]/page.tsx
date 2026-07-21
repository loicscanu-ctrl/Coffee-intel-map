import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ResearchView from "@/components/research/ResearchView";

// Top-level research categories.
const VALID_TABS = ["quant", "supply", "logistics", "exchange", "demand"] as const;
type Cat = typeof VALID_TABS[number];

// Old per-topic tab ids now redirect to the category that absorbed them, so
// existing deep links keep working. (supply / logistics / demand map to
// themselves and fall through to VALID_TABS.)
const LEGACY_REDIRECT: Record<string, Cat> = {
  cot: "quant", signals: "quant", sentiment: "quant", futures: "quant", macro: "quant",
  weather: "supply", farmer: "supply", fertilizer: "supply", agronomy: "supply",
  destination: "logistics", freight: "logistics",
  certstocks: "exchange", parity: "exchange", contracts: "exchange", delivery: "exchange",
};

export default async function ResearchTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab: rawTab } = await params;
  const tab = rawTab.toLowerCase() as Cat;
  if (!VALID_TABS.includes(tab)) {
    const dest = LEGACY_REDIRECT[rawTab.toLowerCase()];
    if (dest) redirect(`/research/${dest}`);
    notFound();
  }
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
