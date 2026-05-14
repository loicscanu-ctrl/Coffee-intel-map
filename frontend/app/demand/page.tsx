import NewsFeedList from "@/components/NewsFeedList";
import AgeCohortPanel from "@/components/demand/AgeCohortPanel";
import EarningsTable from "@/components/demand/EarningsTable";
import GrowthMarketsPanel from "@/components/demand/GrowthMarketsPanel";
import KaffeesteuerChart from "@/components/demand/KaffeesteuerChart";
import RoastingMixPanel from "@/components/demand/RoastingMixPanel";
import StocksPanel from "@/components/demand/StocksPanel";
import PageHeader from "@/components/PageHeader";

export default function DemandPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="Demand"
        subtitle="Growth markets · earnings · taxes · stocks · roasting mix · consumption news"
        healthKeys={["ecf", "psd_coffee", "ajca", "population"]}
      />
      <div className="border-b border-slate-700 bg-slate-950">
        <StocksPanel />
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
