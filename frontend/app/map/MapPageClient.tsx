"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import NewsSidebar from "@/components/map/NewsSidebar";
import NewsFeed from "@/components/map/NewsFeed";
import MarketTicker from "@/components/map/MarketTicker";
import { fetchMapCountries, fetchMapFactories, fetchNews } from "@/lib/api";

const CoffeeMap = dynamic(() => import("@/components/map/CoffeeMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
      Loading map...
    </div>
  ),
});

export default function MapPageClient() {
  const [news, setNews] = useState<any[]>([]);
  const [countries, setCountries] = useState<any[]>([]);
  const [factories, setFactories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<any>(null);
  const [showFeed, setShowFeed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchNews(), fetchMapCountries(), fetchMapFactories()])
      .then((results) => {
        if (cancelled) return;
        const [newsRes, countriesRes, factoriesRes] = results;
        const failures: string[] = [];
        if (newsRes.status === "fulfilled") setNews(newsRes.value);
        else { console.error("[map] fetchNews failed", newsRes.reason); failures.push("news"); }
        if (countriesRes.status === "fulfilled") setCountries(countriesRes.value);
        else { console.error("[map] fetchMapCountries failed", countriesRes.reason); failures.push("countries"); }
        if (factoriesRes.status === "fulfilled") setFactories(factoriesRes.value);
        else { console.error("[map] fetchMapFactories failed", factoriesRes.reason); failures.push("factories"); }
        if (failures.length === results.length) {
          setError("Couldn't reach the API. Check NEXT_PUBLIC_API_URL and that the backend is online.");
        } else if (failures.length > 0) {
          setError(`Some data failed to load: ${failures.join(", ")}.`);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
      <MarketTicker />
      {error && (
        <div className="bg-red-900/40 border-b border-red-700 text-red-200 text-xs px-4 py-2">
          {error}
        </div>
      )}
      <div className="flex-1 relative min-h-0">
        {loading ? (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            Loading data…
          </div>
        ) : (
          <>
            <CoffeeMap onPinClick={setSelectedPin} countries={countries} factories={factories} news={news} />
            <NewsSidebar item={selectedPin} onClose={() => setSelectedPin(null)} />
            <button
              onClick={() => setShowFeed(f => !f)}
              className="absolute bottom-2 right-2 z-[1000] bg-slate-800/90 border border-slate-600 text-slate-300 hover:text-white text-[10px] px-2 py-1 rounded shadow"
            >
              {showFeed ? "▼ Hide table" : "▲ Show table"}
            </button>
          </>
        )}
      </div>
      {showFeed && !loading && <NewsFeed initialNews={news} />}
    </div>
  );
}
