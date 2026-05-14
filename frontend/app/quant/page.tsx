import PriceDirectionSection from "@/components/quant/PriceDirectionSection";
import RobustaForecastSection from "@/components/quant/RobustaForecastSection";
import VietnamDiffSection from "@/components/quant/VietnamDiffSection";
import SentimentSection from "@/components/quant/SentimentSection";
import PageHeader from "@/components/PageHeader";

export default function QuantPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="Daily Quantitative Report"
        subtitle="Machine-learning interpretability · Multi-factor regression · NLP sentiment"
      />
      <div className="flex flex-col divide-y divide-slate-800">
        <PriceDirectionSection />
        <RobustaForecastSection />
        <VietnamDiffSection />
        <SentimentSection />
      </div>
    </div>
  );
}
