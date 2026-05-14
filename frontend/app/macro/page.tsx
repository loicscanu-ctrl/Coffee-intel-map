"use client";
import NewsFeedList from "@/components/NewsFeedList";
import PageHeader from "@/components/PageHeader";
import CurrencyIndexSection from "@/components/macro/CurrencyIndexSection";
import FxTimeSeriesPanel from "@/components/macro/FxTimeSeriesPanel";
import CrossCommodityPanel from "@/components/macro/CrossCommodityPanel";
import FreightContextPanel from "@/components/macro/FreightContextPanel";
import RetailCpiPanel from "@/components/macro/RetailCpiPanel";

export default function MacroPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="Macro"
        subtitle="FX · inflation · cross-commodity positioning · freight · macro flow"
        healthKeys={["macro_cot", "freight", "quant_currency_index", "retail_cpi", "fx_history"]}
      />
      <div className="flex flex-col divide-y divide-slate-800">
        <CurrencyIndexSection />
        <FxTimeSeriesPanel />
        <CrossCommodityPanel />
        <FreightContextPanel />
        <RetailCpiPanel />
      </div>
      <div className="flex-1 min-h-[400px] border-t border-slate-700">
        <NewsFeedList
          title="Macro News"
          filterFn={(item) =>
            item.tags?.includes("fx") ||
            item.tags?.includes("freight") ||
            item.tags?.includes("fertilizer") ||
            item.tags?.includes("cpi") ||
            item.category === "macro"
          }
        />
      </div>
    </div>
  );
}
