"use client";
import NewsFeedList from "@/components/NewsFeedList";

export default function FuturesPage() {
  return (
    <NewsFeedList
      title="Futures Exchange"
      filterFn={(item) => item.tags?.includes("futures")}
    />
  );
}
