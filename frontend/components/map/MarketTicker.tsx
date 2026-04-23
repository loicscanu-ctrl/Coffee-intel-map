"use client";
import { useEffect, useState } from "react";

type TickerCategory = "futures" | "physical" | "fx";

interface TickerItem {
  label: string;
  value: string;
  category: TickerCategory;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarketTicker() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);

  useEffect(() => {
    const load = () =>
      fetch("/data/latest_prices.json")
        .then(r => r.json())
        .then((d: any) => setTickers(d?.tickers ?? []))
        .catch(() => {});
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (tickers.length === 0) return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 flex items-center shrink-0 px-3">
      <span className="text-indigo-400 text-xs font-bold border-r border-slate-700 pr-3 mr-3">MARKETS</span>
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
      <span className="text-indigo-400 text-xs font-bold px-3 shrink-0 border-r border-slate-700 mr-2">
        MARKETS
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
