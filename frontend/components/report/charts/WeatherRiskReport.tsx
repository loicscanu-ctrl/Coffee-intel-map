"use client";
/**
 * Report wrapper for the Brazil frost + drought risk grid. Self-fetches
 * /data/farmer_economics.json (the Brazil farmer-economics feed) and renders the
 * Supply tab's own WeatherRiskPanel over its `weather` block — per-region frost
 * severity and drought (CSI) risk for the coming forecast window.
 */
import { useEffect, useState } from "react";
import WeatherRiskPanel from "@/components/supply/farmer-economics/WeatherRiskPanel";

type WeatherProp = Parameters<typeof WeatherRiskPanel>[0]["weather"];

export default function BrazilWeatherRiskReport() {
  const [weather, setWeather] = useState<WeatherProp | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { weather?: WeatherProp }) => (d?.weather ? setWeather(d.weather) : setError(true)))
      .catch(() => setError(true));
  }, []);
  if (error) return <div className="p-4 text-xs text-slate-500">Brazil weather-risk data unavailable.</div>;
  if (!weather) return <div className="p-4 text-xs text-slate-500">Loading Brazil frost &amp; drought risk…</div>;
  return <WeatherRiskPanel weather={weather} />;
}
