"use client";
import NewsFeedList from "@/components/NewsFeedList";

export default function StocksPage() {
  return (
    <NewsFeedList
      title="Certified Stocks & Spreads"
      filterFn={(item) =>
        item.tags?.includes("cot") ||
        item.tags?.includes("stocks") ||
        item.tags?.includes("technicals")
      }
    />
  );
}
