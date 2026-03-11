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

export default function MapPage() {
  const [selectedPin, setSelectedPin] = useState<any>(null);
  return (
    <div className="w-full h-full flex flex-col">
      <MarketTicker />
      <div className="flex-1 relative min-h-0">
        <CoffeeMap onPinClick={setSelectedPin} />
        <NewsSidebar item={selectedPin} onClose={() => setSelectedPin(null)} />
      </div>
      <NewsFeed />
    </div>
  );
}
