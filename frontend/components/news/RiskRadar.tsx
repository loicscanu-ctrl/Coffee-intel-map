"use client";
/**
 * Risk Radar — keyword-velocity tracker over the news feed.
 *
 * For each watched term ("Frost", "Drought", "Strike", …) we count
 * matches in the last 7 days vs the prior 23 days (case-insensitive,
 * word-boundary) and render a pill: keyword · last-7d count · ↑↑/↑/→/↓.
 *
 * Sorted by descending recent count so the loudest signal sits leftmost.
 * Keywords with zero mentions in the whole 30-day window are hidden
 * (avoids a wall of dead pills on quiet weeks). Component hides itself
 * entirely when the news feed is empty or unavailable.
 */
import { useEffect, useState } from "react";
import { fetchNews } from "@/lib/api";

interface NewsItem {
  id: number;
  title: string;
  body?: string;
  pub_date: string;
}

// Risk terms a trading desk would flag. Phrases use \s+ for whitespace
// tolerance ("port strike" matches "port  strike" too).
const KEYWORDS = [
  "Frost", "Drought", "Strike", "Port", "Bumper crop", "Rust",
  "Broca", "Heatwave", "Rain", "Harvest", "Tariff", "Export ban",
  "Shortage", "Deforestation", "Hedge fund",
];

function _matchCount(items: NewsItem[], keyword: string): number {
  const re = new RegExp(`\\b${keyword.replace(/\s+/g, "\\s+")}\\b`, "i");
  let n = 0;
  for (const it of items) {
    if (re.test(it.title) || re.test(it.body ?? "")) n++;
  }
  return n;
}

interface Trend { glyph: string; tone: string; label: string }

function _trend(last7: number, prior23: number): Trend {
  if (last7 === 0) {
    return { glyph: "—", tone: "text-slate-600", label: "quiet" };
  }
  // Normalise prior-23 to a 7-day equivalent for an apples-to-apples ratio.
  const priorRate = prior23 / (23 / 7);
  if (priorRate < 0.5) {
    return { glyph: "↑↑", tone: "text-rose-300", label: "fresh spike" };
  }
  const ratio = last7 / priorRate;
  if (ratio >= 2.0)  return { glyph: "↑↑", tone: "text-rose-300",    label: "loud" };
  if (ratio >= 1.3)  return { glyph: "↑",  tone: "text-amber-300",   label: "rising" };
  if (ratio <= 0.5)  return { glyph: "↓",  tone: "text-emerald-300", label: "fading" };
  return                    { glyph: "→",  tone: "text-slate-400",   label: "steady" };
}

export default function RiskRadar() {
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
  if (error || !items) return null;   // hide entirely on failure

  const day = 86_400_000;
  const cutoffRecent = now.getTime() - 7 * day;
  const cutoffWindow = now.getTime() - 30 * day;
  const recent: NewsItem[] = [];
  const prior:  NewsItem[] = [];
  for (const it of items) {
    const t = Date.parse(it.pub_date);
    if (!Number.isFinite(t)) continue;
    if (t >= cutoffRecent) recent.push(it);
    else if (t >= cutoffWindow) prior.push(it);
  }

  const stats = KEYWORDS
    .map((kw) => {
      const last7 = _matchCount(recent, kw);
      const p23   = _matchCount(prior,  kw);
      return { kw, last7, p23, ...(_trend(last7, p23)) };
    })
    .filter((s) => s.last7 + s.p23 > 0)
    .sort((a, b) => b.last7 - a.last7 || b.p23 - a.p23);

  if (stats.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
        Risk radar
        <span className="ml-2 font-normal normal-case text-[10px] text-slate-500">
          · keyword velocity · last 7d vs prior 23d
        </span>
      </h2>
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
        <div className="flex flex-wrap gap-2">
          {stats.map((s) => (
            <span
              key={s.kw}
              title={`${s.kw}: ${s.last7} mentions in the last 7 days; ${s.p23} in the prior 23 days (${s.label}).`}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-700 bg-slate-800/60 text-xs font-mono ${s.tone}`}
            >
              <span className="text-slate-300">{s.kw}</span>
              <span className="text-slate-400">{s.last7}</span>
              <span>{s.glyph}</span>
            </span>
          ))}
        </div>
        <div className="text-[8.5px] text-slate-600 italic mt-2">
          Counts use word-boundary matches across each story&apos;s title and body.
          ↑↑ = spike (≥ 2× the prior weekly rate or fresh-only); ↑ rising; → steady; ↓ fading.
        </div>
      </div>
    </section>
  );
}
