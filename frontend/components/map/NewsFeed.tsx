"use client";
import { useEffect, useState } from "react";
import { fetchNews, type NewsItem } from "@/lib/api";

const CATEGORIES = ["all", "supply", "demand", "macro", "general"];

const BORDER_COLORS: Record<string, string> = {
  supply: "border-red-500",
  demand: "border-yellow-500",
  macro: "border-blue-500",
  general: "border-gray-500",
};

/**
 * Extract the most informative data label from a news item's body.
 * Tries (in order):
 *   - "R$ 1.234,50 / saca" → "1.234,50 BRL / saca"
 *   - "USD 250 / lb"       → "250 USD / lb"
 *   - "$1.50"              → "1.50 USD"
 *   - Numeric magnitudes with units ("123.4 kt", "5.2 mln bags")
 * Returns null if no recognisable label can be extracted — the caller then
 * falls back to title-only rendering.
 */
function extractDataLabel(body: string | null | undefined): string | null {
  if (!body) return null;

  // Brazilian real with optional "/unit" — "R$ 900/saca" or "R$ 1.234,50 / sack"
  const brl = body.match(/R\$\s*([\d.,]+)\s*(?:\/\s*([A-Za-zçãáéõ]+))?/);
  if (brl) {
    const unit = brl[2] ? ` / ${brl[2]}` : "";
    return `${brl[1]} BRL${unit}`;
  }

  // USD prefix — "USD 250.5/lb"
  const usd = body.match(/USD\s*([\d.,]+)\s*(?:\/\s*([A-Za-z]+))?/);
  if (usd) {
    const unit = usd[2] ? ` / ${usd[2]}` : "";
    return `${usd[1]} USD${unit}`;
  }

  // Bare dollar sign — "$1.50"
  const usdSign = body.match(/\$\s*([\d.,]+)\s*(?:\/\s*([A-Za-z]+))?/);
  if (usdSign) {
    const unit = usdSign[2] ? ` / ${usdSign[2]}` : "";
    return `${usdSign[1]} USD${unit}`;
  }

  // Volume-style magnitudes — "123.4 kt", "5.2 mln bags", "4.5 million tonnes"
  const vol = body.match(/(\d[\d.,]*)\s*(kt|mln|million|thousand|bags|tonnes|t|k_bags)/i);
  if (vol) {
    return `${vol[1]} ${vol[2]}`;
  }

  return null;
}

interface NewsFeedProps {
  initialNews?: NewsItem[];
}

export default function NewsFeed({ initialNews = [] }: NewsFeedProps) {
  const [items, setItems] = useState<NewsItem[]>(initialNews);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (initialNews.length === 0) {
      fetchNews().then(setItems).catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function itemDate(item: NewsItem): number {
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
          const dataLabel = extractDataLabel(item.body);

          return (
            <div
              key={item.id}
              className={`border-l-2 pl-3 text-xs ${BORDER_COLORS[item.category] || "border-gray-500"}`}
            >
              <span className="font-bold text-white">{item.title}</span>
              {dataLabel && (
                <span className="text-amber-400 ml-1.5 font-mono">: {dataLabel}</span>
              )}
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
