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

export default function NewsFeed() {
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchNews().then(setItems).catch(console.error);
  }, []);

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

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
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`border-l-2 pl-3 text-xs ${BORDER_COLORS[item.category] || "border-gray-500"}`}
          >
            <span className="font-bold text-white">{item.title}</span>
            {item.body && (
              <span className="text-slate-400 ml-2">
                {item.body.slice(0, 120)}{item.body.length > 120 ? "…" : ""}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
