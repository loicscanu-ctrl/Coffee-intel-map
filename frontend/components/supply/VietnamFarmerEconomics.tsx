"use client";
import { useEffect, useState } from "react";
import type { CostData } from "@/components/supply/farmer-economics/farmerEconomicsData";
import ProductionCostPanel from "@/components/supply/farmer-economics/ProductionCostPanel";
import AcreageYieldPanel   from "@/components/supply/farmer-economics/AcreageYieldPanel";
import VnBalanceSheetPanel from "@/components/supply/farmer-economics/VnBalanceSheetPanel";
import type { VnBalanceSheet } from "@/components/supply/farmer-economics/VnBalanceSheetPanel";
import VnWaterLevels       from "@/components/supply/VnWaterLevels";
import VnWeatherCharts     from "@/components/supply/VnWeatherCharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VnEconomicsData {
  updated: string;
  note: string;
  cost_robusta: CostData;
  acreage: { thousand_ha: number; yoy_pct: number; source_label: string };
  yield:   { bags_per_ha:  number; yoy_pct: number; source_label: string };
  balance_sheet: VnBalanceSheet;
}

// ── ENSO impact note (Vietnam-specific) ───────────────────────────────────────

function VnEnsoNote() {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        ENSO Impact · Vietnam
      </div>
      <div className="space-y-2 text-[9px]">
        <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <span className="font-bold text-blue-400 flex-shrink-0">La Niña</span>
          <span className="text-slate-400">
            Wetter dry season in Central Highlands. Reduced irrigation cost.
            Historically <span className="text-green-400 font-semibold">+5–10%</span> yield uplift.
          </span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <span className="font-bold text-orange-400 flex-shrink-0">El Niño</span>
          <span className="text-slate-400">
            Prolonged dry season (Jan–Apr critical). Srepok / Dak Bla basins most exposed.
            2023/24 drought cut production ~<span className="text-red-400 font-semibold">−10%</span>.
          </span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-700/50 border border-slate-600/30">
          <span className="font-bold text-slate-400 flex-shrink-0">Neutral</span>
          <span className="text-slate-500">Normal seasonal rainfall. Trend yield around 27–29 bags/ha.</span>
        </div>
      </div>
      <div className="text-[7px] text-slate-700 italic border-t border-slate-700 pt-2">
        Source: WASI / WMO historical analysis. ~90% of Vietnam coffee is Robusta (Dak Lak, Gia Lai, Dak Nong, Lam Dong).
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function VietnamFarmerEconomics() {
  const [data, setData] = useState<VnEconomicsData | null>(null);
  const [vnFaqSpot, setVnFaqSpot] = useState<number | null>(null);

  useEffect(() => {
    fetch("/data/vn_farmer_economics.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
    fetch("/data/vn_physical_prices.json")
      .then(r => r.json())
      .then((d: any) => {
        const price = d?.vn_faq?.usd_per_mt;
        if (price) setVnFaqSpot(price);
      })
      .catch(() => {});
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

      {/* Two-column: production + river/ENSO */}
      <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
        {/* Left: production cost + acreage/yield */}
        <div className="space-y-4">
          <ProductionCostPanel
            cost={vnFaqSpot ? { ...data.cost_robusta, rc_spot: vnFaqSpot } : data.cost_robusta}
            coffeeType="robusta"
            country="Vietnam"
          />
          <AcreageYieldPanel acreage={data.acreage} yield_={data.yield} yieldUnit="mt/ha" />
        </div>

        {/* Right: river flow + ENSO */}
        <div className="space-y-4">
          <VnWaterLevels />
          <VnEnsoNote />
        </div>
      </div>

      {/* Weather charts — full width */}
      <VnWeatherCharts />
    </div>
  );
}
