"use client";
import NewsFeedList from "@/components/NewsFeedList";

export default function MacroPage() {
  return (
    <NewsFeedList
      title="Macro"
      filterFn={(item) =>
        item.tags?.includes("fx") ||
        item.tags?.includes("freight") ||
        item.tags?.includes("fertilizer") ||
        item.tags?.includes("cpi") ||
        item.category === "macro"
      }
    />
  );
}
