"use client";
import { useEffect, useState } from "react";
import type { CostData } from "@/components/supply/farmer-economics/farmerEconomicsData";
import ProductionCostPanel from "@/components/supply/farmer-economics/ProductionCostPanel";
import AcreageYieldPanel   from "@/components/supply/farmer-economics/AcreageYieldPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

// `balance_sheet` is read by VietnamTab now and piped into the
// SupplyDemandBalance card on the Supply & Demand sub-tab. We don't render
// it here anymore — keeping the field on the interface for parsing tolerance.
interface VnEconomicsData {
  updated: string;
  note: string;
  cost_robusta: CostData;
  acreage: { thousand_ha: number; yoy_pct: number; source_label: string };
  yield:   { bags_per_ha:  number; yoy_pct: number; source_label: string };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function VietnamFarmerEconomics() {
  const [data, setData] = useState<VnEconomicsData | null>(null);
  const [vnFaqSpot, setVnFaqSpot] = useState<number | null>(null);

  useEffect(() => {
    fetch("/data/vn_farmer_economics.json")
      .then(r => r.json())
      .then(setData)
      .catch((err) => console.error("[VietnamFarmerEconomics] vn_farmer_economics fetch failed:", err));
    fetch("/data/vn_physical_prices.json")
      .then(r => r.json())
      .then((d: { vn_faq?: { usd_per_mt?: number } }) => {
        const price = d?.vn_faq?.usd_per_mt;
        if (price) setVnFaqSpot(price);
      })
      .catch((err) => console.error("[VietnamFarmerEconomics] vn_physical_prices fetch failed:", err));
  }, []);

  if (!data) {
    return (
      <div className="text-slate-500 text-sm py-12 text-center animate-pulse">
        Loading Vietnam economics data…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* The Supply Balance Sheet that used to live at the top of this card
          is now part of SupplyDemandBalance on the Supply & Demand sub-tab —
          the formula, multi-source range, and the chart all live there. */}
      <div className="space-y-4">
        <ProductionCostPanel
          cost={vnFaqSpot ? { ...data.cost_robusta, rc_spot: vnFaqSpot } : data.cost_robusta}
          coffeeType="robusta"
          country="Vietnam"
        />
        <AcreageYieldPanel acreage={data.acreage} yield_={data.yield} yieldUnit="mt/ha" />
      </div>
    </div>
  );
}
