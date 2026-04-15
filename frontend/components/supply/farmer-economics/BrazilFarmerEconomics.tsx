"use client";
import { BRAZIL_FARMER_DATA } from "./farmerEconomicsData";
import ProductionCostPanel from "./ProductionCostPanel";
import AcreageYieldPanel   from "./AcreageYieldPanel";
import WeatherRiskPanel    from "./WeatherRiskPanel";
import EnsoPanel           from "./EnsoPanel";
import FertilizerPanel     from "./FertilizerPanel";

export default function BrazilFarmerEconomics() {
  const d = BRAZIL_FARMER_DATA;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
      {/* ── Left: Fundamentals ─────────────────────────────────── */}
      <div className="space-y-4">
        <ProductionCostPanel cost={d.cost} />
        <AcreageYieldPanel   acreage={d.acreage} yield_={d.yield} />
      </div>

      {/* ── Right: Risk Signals ─────────────────────────────────── */}
      <div className="space-y-4">
        <WeatherRiskPanel weather={d.weather} />
        <EnsoPanel        enso={d.enso} />
        <FertilizerPanel  fertilizer={d.fertilizer} />
      </div>
    </div>
  );
}
