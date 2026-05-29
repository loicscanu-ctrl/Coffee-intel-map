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

// ── Filter chips (contract + geography focus) ───────────────────────────────
// Toggle chips above the headlines so a Robusta trader can hide every story
// that doesn't apply to her book. Multi-select: clicking a chip toggles, no
// active chip = "show everything". A match needs ONE of: category equality,
// a known tag, or a keyword present in title+body (case-insensitive).
interface FilterSpec {
  id: string;
  label: string;
  match: { category?: string; tags?: string[]; words?: string[] };
}
const FILTERS: FilterSpec[] = [
  { id: "kc",        label: "KC · Arabica",  match: { tags: ["arabica"],   words: ["arabica", "kc futures", "minas", "cerrado"] } },
  { id: "rc",        label: "RC · Robusta",  match: { tags: ["robusta"],   words: ["robusta", "rc futures", "london futures"] } },
  { id: "brazil",    label: "Brazil",        match: { tags: ["brazil"],    words: ["brazil", "minas", "cerrado", "espírito santo", "espirito santo", "paraná", "parana", "cecafé", "cecafe", "conab", "safra"] } },
  { id: "vietnam",   label: "Vietnam",       match: { tags: ["vietnam"],   words: ["vietnam", "dak lak", "đắk lắk", "gia lai", "lam dong", "lâm đồng", "buon ma thuot"] } },
  { id: "colombia",  label: "Colombia",      match: { tags: ["colombia"],  words: ["colombia", "huila", "caldas", "antioquia", "nariño", "narino"] } },
  { id: "honduras",  label: "Honduras",      match: { tags: ["honduras"],  words: ["honduras", "copán", "copan"] } },
  { id: "ethiopia",  label: "Ethiopia",      match: { tags: ["ethiopia"],  words: ["ethiopia", "sidama", "yirgacheffe", "limu", "jimma", "harrar"] } },
  { id: "indonesia", label: "Indonesia",     match: { tags: ["indonesia"], words: ["indonesia", "sumatra", "java", "mandheling", "lampung"] } },
  { id: "uganda",    label: "Uganda",        match: { tags: ["uganda"],    words: ["uganda", "masaka", "mt elgon", "rwenzori"] } },
  { id: "macro",     label: "Macro",         match: { category: "macro",   tags: ["macro"], words: ["fed", "ecb", "inflation", "interest rate", "currency", "fx"] } },
  { id: "demand",    label: "Demand",        match: { category: "demand",  tags: ["demand", "consumption"] } },
];

function _matches(it: NewsItem, f: FilterSpec): boolean {
  const m = f.match;
  if (m.category && it.category === m.category) return true;
  if (m.tags && it.tags && m.tags.some((t) => it.tags!.includes(t))) return true;
  if (m.words && m.words.length > 0) {
    const text = `${it.title} ${it.body ?? ""}`.toLowerCase();
    if (m.words.some((w) => text.includes(w.toLowerCase()))) return true;
  }
  return false;
}

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
  // Multi-select filter set. Empty = show every story (sensible default
  // because an empty page with chip prompts is more confusing than a
  // full digest with chip prompts).
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  useEffect(() => {
    setNow(new Date());
    fetchNews()
      .then((list) => setItems(list as NewsItem[]))
      .catch(() => setError(true));
  }, []);

  const toggleFilter = (id: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearFilters = () => setActiveFilters(new Set());

  if (!now) return null;
  if (error) {
    return <div className="text-xs text-slate-500 italic">News feed unavailable.</div>;
  }
  if (!items) {
    return <div className="text-xs text-slate-500 animate-pulse">Reading headlines…</div>;
  }

  // Filter to the last 7 days.
  const cutoff = now.getTime() - 7 * 86_400_000;
  const recentAll = items.filter((it) => {
    const t = Date.parse(it.pub_date);
    return Number.isFinite(t) && t >= cutoff;
  });

  // Apply the filter chips. When the active set is empty we just keep
  // recentAll. A story matches the active set if it matches ANY of the
  // selected filters (OR semantics) — narrowing further would hide
  // multi-tag stories that legitimately span e.g. Brazil + Macro.
  const activeFilterSpecs = FILTERS.filter((f) => activeFilters.has(f.id));
  const recent = activeFilterSpecs.length === 0
    ? recentAll
    : recentAll.filter((it) => activeFilterSpecs.some((f) => _matches(it, f)));

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

  // FilterChipRow rendered before the (possibly empty) digest so the
  // user can always toggle their way back to results.
  const filterRow = (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-2 flex flex-wrap gap-1.5 items-center">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Focus</span>
      {FILTERS.map((f) => {
        const active = activeFilters.has(f.id);
        return (
          <button
            key={f.id}
            onClick={() => toggleFilter(f.id)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono border transition-colors ${
              active
                ? "bg-amber-900/40 text-amber-200 border-amber-700"
                : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
            }`}
          >
            {f.label}
          </button>
        );
      })}
      {activeFilters.size > 0 && (
        <button
          onClick={clearFilters}
          className="ml-1 text-[10px] text-slate-500 hover:text-slate-200 underline"
        >
          clear
        </button>
      )}
    </div>
  );

  if (recentAll.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Headlines · last 7 days</h2>
        {filterRow}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-500 italic">
          No new stories in the last 7 days.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Headlines
          <span className="ml-2 font-normal normal-case text-[10px] text-slate-500">
            · last 7 days · {recent.length}/{recentAll.length} stories
            {activeFilters.size > 0 && (
              <span className="text-amber-400/80"> · filtered</span>
            )}
          </span>
        </h2>
        <Link href="/map" className="text-[10px] text-amber-300 hover:text-amber-200">
          See all on the map →
        </Link>
      </div>
      {filterRow}
      {recent.length === 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-500 italic">
          No stories match these filters. <button onClick={clearFilters} className="underline hover:text-slate-200 ml-1">Clear</button> to see all.
        </div>
      )}
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
