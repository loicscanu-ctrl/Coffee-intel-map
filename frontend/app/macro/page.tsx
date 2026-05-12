"use client";
import NewsFeedList from "@/components/NewsFeedList";
import PageHeader from "@/components/PageHeader";

export default function MacroPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Macro"
        subtitle="FX · freight · fertilizer · CPI cross-market news"
      />
      <div className="flex-1 overflow-hidden">
        <NewsFeedList
          filterFn={(item) =>
            item.tags?.includes("fx") ||
            item.tags?.includes("freight") ||
            item.tags?.includes("fertilizer") ||
            item.tags?.includes("cpi") ||
            item.category === "macro"
          }
        />
      </div>
    </div>
  );
}
