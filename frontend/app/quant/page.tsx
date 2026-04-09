import PriceDirectionSection from "@/components/quant/PriceDirectionSection";
import RobustaForecastSection from "@/components/quant/RobustaForecastSection";
import CurrencyIndexSection from "@/components/quant/CurrencyIndexSection";
import VietnamDiffSection from "@/components/quant/VietnamDiffSection";
import SentimentSection from "@/components/quant/SentimentSection";

export default function QuantPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      {/* Page header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <h1 className="text-xl font-bold text-white">Daily Quantitative Report</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Machine-learning interpretability · Multi-factor regression · NLP sentiment
        </p>
      </div>

      <div className="flex flex-col divide-y divide-slate-800">
        <PriceDirectionSection />
        <RobustaForecastSection />
        <CurrencyIndexSection />
        <VietnamDiffSection />
        <SentimentSection />
      </div>
    </div>
  );
}
