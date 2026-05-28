import NewsFeedList from "@/components/NewsFeedList";
import AgeCohortPanel from "@/components/demand/AgeCohortPanel";
import EarningsTable from "@/components/demand/EarningsTable";
import GrowthMarketsPanel from "@/components/demand/GrowthMarketsPanel";
import KaffeesteuerChart from "@/components/demand/KaffeesteuerChart";
import RoastingMixPanel from "@/components/demand/RoastingMixPanel";
import StocksPanel from "@/components/demand/StocksPanel";
import CertifiedStocksPanel from "@/components/demand/CertifiedStocksPanel";
import WorldConsumptionWidget from "@/components/demand/WorldConsumptionWidget";
import PageHeader from "@/components/PageHeader";

export default function DemandPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="Demand"
        subtitle="World consumption · growth markets · earnings · stocks · roasting mix"
        healthKeys={["ecf", "psd_coffee", "ajca", "population"]}
      />
      <div className="border-b border-slate-700 bg-slate-950">
        <WorldConsumptionWidget />
      </div>
      <div className="border-b border-slate-700 bg-slate-950">
        <StocksPanel />
      </div>
      <div className="border-b border-slate-700 bg-slate-950">
        <CertifiedStocksPanel />
      </div>
      <div className="border-b border-slate-700 bg-slate-950">
        <GrowthMarketsPanel />
      </div>
      <div className="border-b border-slate-700 bg-slate-950">
        <AgeCohortPanel />
      </div>
      <div className="border-b border-slate-700 bg-slate-950">
        <RoastingMixPanel />
      </div>
      <div className="border-b border-slate-700 bg-slate-950">
        <KaffeesteuerChart />
      </div>
      <div className="border-b border-slate-700 bg-slate-950">
        <EarningsTable />
      </div>
      <div className="flex-1 overflow-hidden">
        <NewsFeedList title="Demand News" category="demand" />
      </div>
    </div>
  );
}
