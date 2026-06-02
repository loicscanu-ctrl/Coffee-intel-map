"use client";
import { useEffect, useState } from "react";
import type { CostData } from "@/components/supply/farmer-economics/farmerEconomicsData";
import ProductionCostPanel from "@/components/supply/farmer-economics/ProductionCostPanel";
import AcreageYieldPanel   from "@/components/supply/farmer-economics/AcreageYieldPanel";
import VnBalanceSheetPanel from "@/components/supply/farmer-economics/VnBalanceSheetPanel";
import type { VnBalanceSheet } from "@/components/supply/farmer-economics/VnBalanceSheetPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VnEconomicsData {
  updated: string;
  note: string;
  cost_robusta: CostData;
  acreage: { thousand_ha: number; yoy_pct: number; source_label: string };
  yield:   { bags_per_ha:  number; yoy_pct: number; source_label: string };
  balance_sheet: VnBalanceSheet;
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
      {/* Balance sheet — full width */}
      <VnBalanceSheetPanel balance={data.balance_sheet} />

      {/* Production cost + acreage/yield */}
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
