import PriceDirectionSection from "@/components/signals/PriceDirectionSection";
import RobustaForecastSection from "@/components/signals/RobustaForecastSection";
import VietnamDiffSection from "@/components/signals/VietnamDiffSection";
import SentimentSection from "@/components/signals/SentimentSection";
import PageHeader from "@/components/PageHeader";

export default function SignalsPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="Signals"
        subtitle="Derived signals · ML price-direction · Multi-factor regression · NLP sentiment · Local-vs-futures arbitrage"
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
