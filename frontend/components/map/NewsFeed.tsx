"use client";
import { useEffect, useState } from "react";
import { fetchNews } from "@/lib/api";

const CATEGORIES = ["all", "supply", "demand", "macro", "general"];

const BORDER_COLORS: Record<string, string> = {
  supply: "border-red-500",
  demand: "border-yellow-500",
  macro: "border-blue-500",
  general: "border-gray-500",
};

interface NewsFeedProps {
  initialNews?: any[];
}

export default function NewsFeed({ initialNews = [] }: NewsFeedProps) {
  const [items, setItems] = useState<any[]>(initialNews);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (initialNews.length === 0) {
      fetchNews().then(setItems).catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function itemDate(item: any): number {
    const m = item.title?.match(/[–-]\s*(\d{4}-\d{2}-\d{2})\s*$/);
    if (m) return new Date(m[1]).getTime();
    return new Date(item.pub_date ?? 0).getTime();
  }

  const filtered = (filter === "all" ? items : items.filter((i) => i.category === filter))
    .slice()
    .sort((a, b) => itemDate(b) - itemDate(a));

  return (
    <div className="h-48 border-t border-slate-700 bg-slate-900/90 flex flex-col shrink-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 shrink-0">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-xs px-2 py-1 rounded capitalize transition-colors ${
              filter === cat
                ? "bg-slate-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto flex-1 px-4 py-2 space-y-2">
        {filtered.length === 0 && (
          <div className="text-slate-500 text-xs italic text-center mt-4">No items</div>
        )}
        {filtered.map((item) => {
          const pubDate = item.pub_date
            ? new Date(item.pub_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : null;
          const hashtag = item.category === "general" && item.source
            ? "#" + item.source.toLowerCase().replace(/\s+/g, "")
            : null;
          const title = item.meta
            ? <a href={item.meta} target="_blank" rel="noopener noreferrer"
                 className="font-bold text-white hover:text-indigo-300 transition-colors">
                {item.title}
              </a>
            : <span className="font-bold text-white">{item.title}</span>;

          return (
            <div
              key={item.id}
              className={`border-l-2 pl-3 text-xs ${BORDER_COLORS[item.category] || "border-gray-500"}`}
            >
              {title}
              {pubDate && (
                <span className="text-slate-500 ml-2">{pubDate}</span>
              )}
              {hashtag && (
                <span className="text-slate-600 ml-2">{hashtag}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
