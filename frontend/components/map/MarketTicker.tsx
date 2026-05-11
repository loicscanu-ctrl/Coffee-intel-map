"use client";
import { useEffect, useState } from "react";

type TickerCategory = "futures" | "physical" | "fx";

interface TickerItem {
  label: string;
  value: string;
  category: TickerCategory;
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function stalenessColor(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 6) return "text-emerald-500";
  if (hours < 24) return "text-yellow-500";
  return "text-red-500";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarketTicker() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () =>
      fetch("/data/latest_prices.json")
        .then(r => r.json())
        .then((d: { tickers?: TickerItem[]; generated_at?: string }) => {
          setTickers(d?.tickers ?? []);
          setGeneratedAt(d?.generated_at ?? null);
        })
        .catch((err) => console.error("[MarketTicker] fetch failed:", err));
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    // Re-render every minute so "X ago" stays accurate
    const tick = setInterval(() => setTick(n => n + 1), 60_000);
    return () => { clearInterval(interval); clearInterval(tick); };
  }, []);

  if (tickers.length === 0) return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 flex items-center shrink-0 px-3">
      <span className="text-indigo-400 text-xs font-bold border-r border-slate-700 pr-3 mr-3 shrink-0">MARKETS</span>
      <span className="text-slate-600 text-xs italic">No market data — waiting for scraper</span>
    </div>
  );

  const COLOR: Record<TickerCategory, string> = {
    futures:  "text-yellow-400",
    physical: "text-yellow-600",
    fx:       "text-sky-400",
  };

  const ORDER: TickerCategory[] = ["futures", "physical", "fx"];
  const groups = ORDER
    .map(cat => tickers.filter(t => t.category === cat))
    .filter(g => g.length > 0);

  const tickerContent = groups.flatMap((group, gi) => {
    const items = group.map((t, i) => (
      <span key={`${t.label}-${i}`} className={`${COLOR[t.category]} font-mono`}>
        {t.label}: {t.value}
        {i < group.length - 1 && <span className="text-slate-500">{"   ·   "}</span>}
      </span>
    ));
    if (gi < groups.length - 1) {
      items.push(<span key={`sep-${gi}`} className="text-slate-500 mx-3">|</span>);
    }
    return items;
  });

  return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 overflow-hidden flex items-center shrink-0">
      <span className="flex flex-col justify-center px-3 shrink-0 border-r border-slate-700 mr-2 leading-none gap-0.5"
        title={generatedAt ? `Generated: ${generatedAt}` : undefined}>
        <span className="text-indigo-400 text-xs font-bold">MARKETS</span>
        {generatedAt && (
          <span className={`text-[9px] font-mono ${stalenessColor(generatedAt)}`}>
            {timeAgo(generatedAt)}
          </span>
        )}
      </span>
      <div
        className="overflow-hidden flex-1 relative"
        style={{ cursor: "default" }}
        onMouseEnter={(e) => {
          const track = e.currentTarget.querySelector<HTMLElement>(".ticker-track");
          if (track) track.style.animationPlayState = "paused";
        }}
        onMouseLeave={(e) => {
          const track = e.currentTarget.querySelector<HTMLElement>(".ticker-track");
          if (track) track.style.animationPlayState = "running";
        }}
      >
        <span className="ticker-track text-xs whitespace-nowrap">
          {tickerContent}
        </span>
      </div>
    </div>
  );
}
