"use client";
import { useEffect, useState } from "react";
import { fetchNews } from "@/lib/api";

interface NewsItem {
  id: number;
  title: string;
  body: string;
  source: string;
  category: string;
  tags: string[];
  pub_date: string;
}

const BADGE_COLORS: Record<string, string> = {
  supply: "bg-red-900/60 text-red-300",
  demand: "bg-yellow-900/60 text-yellow-300",
  macro:  "bg-blue-900/60 text-blue-300",
  general:"bg-slate-700 text-slate-300",
};

const BORDER_COLORS: Record<string, string> = {
  supply: "border-red-500/40",
  demand: "border-yellow-500/40",
  macro:  "border-blue-500/40",
  general:"border-slate-600",
};

interface Props {
  category?: string;
  filterFn?: (item: NewsItem) => boolean;
  emptyMessage?: string;
  title: string;
  initialItems?: NewsItem[];
}

export default function NewsFeedList({ category, filterFn, emptyMessage, title, initialItems }: Props) {
  const [items, setItems] = useState<NewsItem[]>(() =>
    initialItems ? (filterFn ? initialItems.filter(filterFn) : initialItems) : []
  );
  const [loading, setLoading] = useState(!initialItems);

  useEffect(() => {
    if (initialItems) return; // already have server-loaded data
    fetchNews(category)
      .then((data) => setItems(filterFn ? data.filter(filterFn) : data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 h-full overflow-y-auto">
      <h1 className="text-lg font-bold text-white mb-4">{title}</h1>
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="text-slate-500 text-sm italic">{emptyMessage ?? "No data yet — check back after the next scrape run."}</p>
      )}
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`border rounded-lg p-4 bg-slate-900 ${BORDER_COLORS[item.category] ?? BORDER_COLORS.general}`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-semibold text-white text-sm leading-snug">{item.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded capitalize shrink-0 ${BADGE_COLORS[item.category] ?? BADGE_COLORS.general}`}>
                {item.category}
              </span>
            </div>
            {item.body && (
              <p className="text-slate-400 text-xs leading-relaxed mt-1">
                {item.body.slice(0, 200)}{item.body.length > 200 ? "…" : ""}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-slate-600 text-xs">
              {item.source && <span>{item.source}</span>}
              {item.pub_date && <span>{new Date(item.pub_date).toLocaleDateString()}</span>}
              {item.tags?.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {item.tags.map((tag) => (
                    <span key={tag} className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
