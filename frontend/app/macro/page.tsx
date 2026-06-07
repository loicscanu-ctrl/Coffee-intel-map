"use client";
import PageHeader from "@/components/PageHeader";
import CurrencyIndexSection from "@/components/macro/CurrencyIndexSection";
import FxTimeSeriesPanel from "@/components/macro/FxTimeSeriesPanel";
import CrossCommodityPanel from "@/components/macro/CrossCommodityPanel";
import OriginPricesPanel from "@/components/macro/OriginPricesPanel";
import FertilizerInputsPanel from "@/components/macro/FertilizerInputsPanel";
import FreightContextPanel from "@/components/macro/FreightContextPanel";
import InflationSection from "@/components/macro/InflationSection";

export default function MacroPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="Macro"
        subtitle="FX · inflation · cross-commodity positioning · origin prices · freight"
        healthKeys={["macro_cot", "freight", "quant_currency_index", "us_cpi", "retail_cpi", "fx_history", "origin_prices"]}
      />
      <div className="flex flex-col divide-y divide-slate-800">
        <CurrencyIndexSection />
        <FxTimeSeriesPanel />
        <CrossCommodityPanel />
        <InflationSection />
        <OriginPricesPanel />
        <FertilizerInputsPanel />
        <FreightContextPanel />
      </div>
    </div>
  );
}
