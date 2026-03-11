"use client";
import { useEffect, useState } from "react";
import { fetchNews } from "@/lib/api";

interface TickerItem {
  label: string;
  value: string;
}

function parseTickerItems(items: any[]): TickerItem[] {
  return items
    .filter((item) => item.tags?.includes("price") || item.tags?.includes("fx"))
    .map((item) => {
      // body format: "ICE NY Arabica price: 203.45" or "USD/BRL FX Rate price: 5.12"
      const match = item.body?.match(/:\s*([0-9.,]+)/);
      return {
        label: item.title.replace(/\s*–\s*\d{4}-\d{2}-\d{2}$/, ""), // strip date suffix
        value: match ? match[1] : "—",
      };
    });
}

export default function MarketTicker() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);

  const load = () => {
    fetchNews()
      .then((items) => setTickers(parseTickerItems(items)))
      .catch(console.error);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, []);

  if (tickers.length === 0) return null;

  const tickerText = tickers
    .map((t) => `${t.label}: ${t.value}`)
    .join("   ·   ");

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
        <span className="ticker-track text-xs text-slate-300 font-mono">
          {tickerText}
        </span>
      </div>
    </div>
  );
}
