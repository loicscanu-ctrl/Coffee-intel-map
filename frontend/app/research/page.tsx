"use client";
import PageHeader from "@/components/PageHeader";
import ResearchView from "@/components/research/ResearchView";

export default function ResearchPage() {
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Research"
        subtitle="Intraweek positioning model methodology & COT backtest report"
      />
      <div className="p-4 sm:p-6">
        <ResearchView />
      </div>
    </div>
  );
}
