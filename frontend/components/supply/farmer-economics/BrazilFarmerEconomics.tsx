"use client";
import { useState, useEffect } from "react";
import type { FarmerEconomicsData } from "./farmerEconomicsData";
import ProductionCostPanel from "./ProductionCostPanel";
import AcreageYieldPanel   from "./AcreageYieldPanel";
import WeatherRiskPanel    from "./WeatherRiskPanel";
import EnsoPanel           from "./EnsoPanel";
import FertilizerPanel     from "./FertilizerPanel";
import ManualIntelPanel    from "../ManualIntelPanel";
import BalanceSheetPanel   from "./BalanceSheetPanel";
import FarmerSellingPanel  from "./FarmerSellingPanel";

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
    <div className="space-y-5">
      {/* ── Balance Sheet (full width) ─────────────────────────── */}
      {data.balance_sheet && (
        <BalanceSheetPanel balance={data.balance_sheet} />
      )}

      {/* ── Farmer Selling Pace (full width) ──────────────────── */}
      <FarmerSellingPanel />

      {/* ── Two-column: Fundamentals + Risk Signals ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
        {/* Left */}
        <div className="space-y-4">
          {data.cost_arabica && <ProductionCostPanel cost={data.cost_arabica} coffeeType="arabica" country="Brazil" />}
          {data.cost_conilon && <ProductionCostPanel cost={data.cost_conilon} coffeeType="conilon" country="Brazil" />}
          {!data.cost_arabica && !data.cost_conilon && data.cost && (
            <ProductionCostPanel cost={data.cost} coffeeType="arabica" country="Brazil" />
          )}
          {data.acreage && data.yield && (
            <AcreageYieldPanel
              acreage={data.acreage} yield_={data.yield}
              acreage_arabica={data.acreage_arabica}
              yield_arabica={data.yield_arabica}
              acreage_conilon={data.acreage_conilon}
              yield_conilon={data.yield_conilon}
            />
          )}
          <FertilizerPanel fertilizer={data.fertilizer} />
        </div>

        {/* Right */}
        <div className="space-y-4">
          {data.weather    && <WeatherRiskPanel weather={data.weather} />}
          {data.enso       && <EnsoPanel enso={data.enso} />}
          <ManualIntelPanel />
        </div>
      </div>
    </div>
  );
}
