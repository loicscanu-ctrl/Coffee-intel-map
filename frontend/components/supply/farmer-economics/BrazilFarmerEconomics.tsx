"use client";
import { useState, useEffect } from "react";
import type { FarmerEconomicsData } from "./farmerEconomicsData";
import ProductionCostPanel from "./ProductionCostPanel";
import AcreageYieldPanel   from "./AcreageYieldPanel";
import WeatherRiskPanel    from "./WeatherRiskPanel";
import EnsoPanel           from "./EnsoPanel";
import FertilizerPanel     from "./FertilizerPanel";

export default function BrazilFarmerEconomics() {
  const [data, setData] = useState<FarmerEconomicsData | null>(null);

  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then((r) => r.json())
      .then(setData)
      .catch((err) => console.error("[FarmerEconomics] fetch failed:", err));
  }, []);

  if (!data) {
    return (
      <div className="text-slate-500 text-sm py-12 text-center">
        Loading farmer economics data…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
      {/* ── Left: Fundamentals ─────────────────────────────────── */}
      <div className="space-y-4">
        {data.cost    && <ProductionCostPanel cost={data.cost} />}
        {data.acreage && data.yield && (
          <AcreageYieldPanel acreage={data.acreage} yield_={data.yield} />
        )}
        <FertilizerPanel fertilizer={data.fertilizer} />
      </div>

      {/* ── Right: Risk Signals ─────────────────────────────────── */}
      <div className="space-y-4">
        {data.weather    && <WeatherRiskPanel weather={data.weather} />}
        {data.enso       && <EnsoPanel enso={data.enso} />}
      </div>
    </div>
  );
}
