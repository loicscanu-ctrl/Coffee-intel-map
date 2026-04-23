"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import NewsSidebar from "@/components/map/NewsSidebar";
import NewsFeed from "@/components/map/NewsFeed";
import MarketTicker from "@/components/map/MarketTicker";

const CoffeeMap = dynamic(() => import("@/components/map/CoffeeMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
      Loading map...
    </div>
  ),
});

interface MapPageClientProps {
  news: any[];
  countries: any[];
  factories: any[];
}

export default function MapPageClient({ news, countries, factories }: MapPageClientProps) {
  const [selectedPin, setSelectedPin] = useState<any>(null);
  const [showFeed, setShowFeed] = useState(false);
  return (
    <div className="w-full h-full flex flex-col">
      <MarketTicker />
      <div className="flex-1 relative min-h-0">
        <CoffeeMap onPinClick={setSelectedPin} countries={countries} factories={factories} news={news} />
        <NewsSidebar item={selectedPin} onClose={() => setSelectedPin(null)} />
        {/* Toggle button — bottom-right corner of map */}
        <button
          onClick={() => setShowFeed(f => !f)}
          className="absolute bottom-2 right-2 z-[1000] bg-slate-800/90 border border-slate-600 text-slate-300 hover:text-white text-[10px] px-2 py-1 rounded shadow"
        >
          {showFeed ? "▼ Hide table" : "▲ Show table"}
        </button>
      </div>
      {showFeed && <NewsFeed initialNews={news} />}
    </div>
  );
}
