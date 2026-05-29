"use client";
/**
 * "Headlines" — last-7-day digest of the news.json story feed, grouped
 * by category. Capped at three items per category; the user clicks
 * "Map view" to read the full feed.
 *
 * Reuses the existing fetchNews() helper so any future feed-routing
 * changes (S3 / API / static fallback) flow through unchanged.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchNews } from "@/lib/api";

interface NewsItem {
  id: number;
  title: string;
  body?: string;
  source: string;
  category: string;
  tags?: string[];
  pub_date: string;
}

const CATEGORY_META: Record<string, { label: string; tone: string }> = {
  supply:  { label: "Supply",  tone: "text-rose-300"   },
  demand:  { label: "Demand",  tone: "text-amber-300"  },
  macro:   { label: "Macro",   tone: "text-blue-300"   },
  general: { label: "General", tone: "text-slate-300"  },
};
const CATEGORY_ORDER = ["supply", "demand", "macro", "general"] as const;
const MAX_PER_CATEGORY = 3;

function _ageStr(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function HeadlinesDigest() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    fetchNews()
      .then((list) => setItems(list as NewsItem[]))
      .catch(() => setError(true));
  }, []);

  if (!now) return null;
  if (error) {
    return <div className="text-xs text-slate-500 italic">News feed unavailable.</div>;
  }
  if (!items) {
    return <div className="text-xs text-slate-500 animate-pulse">Reading headlines…</div>;
  }

  // Filter to the last 7 days.
  const cutoff = now.getTime() - 7 * 86_400_000;
  const recent = items.filter((it) => {
    const t = Date.parse(it.pub_date);
    return Number.isFinite(t) && t >= cutoff;
  });

  if (recent.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Headlines · last 7 days</h2>
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-500 italic">
          No new stories in the last 7 days.
        </div>
      </section>
    );
  }

  // Group by category, sorted within each by pub_date desc.
  const byCat = new Map<string, NewsItem[]>();
  for (const it of recent) {
    const cat = byCat.get(it.category) ?? [];
    cat.push(it);
    byCat.set(it.category, cat);
  }
  for (const list of Array.from(byCat.values())) {
    list.sort((a: NewsItem, b: NewsItem) => b.pub_date.localeCompare(a.pub_date));
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Headlines
          <span className="ml-2 font-normal normal-case text-[10px] text-slate-500">
            · last 7 days · {recent.length} stories
          </span>
        </h2>
        <Link href="/map" className="text-[10px] text-amber-300 hover:text-amber-200">
          See all on the map →
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CATEGORY_ORDER.map((cat) => {
          const list = (byCat.get(cat) ?? []).slice(0, MAX_PER_CATEGORY);
          if (list.length === 0) return null;
          const meta = CATEGORY_META[cat] ?? CATEGORY_META.general;
          return (
            <div key={cat} className="bg-slate-900 border border-slate-700 rounded-lg p-3">
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${meta.tone}`}>
                {meta.label}
              </div>
              <ul className="space-y-2">
                {list.map((it) => (
                  <li key={it.id} className="text-xs">
                    <div className="text-slate-200 leading-snug">{it.title}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      <span>{it.source}</span>
                      <span className="mx-1">·</span>
                      <span>{_ageStr(it.pub_date, now)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
