import NewsFeedList from "@/components/NewsFeedList";
import KaffeesteuerChart from "@/components/demand/KaffeesteuerChart";
import EarningsTable from "@/components/demand/EarningsTable";
import StocksPanel from "@/components/demand/StocksPanel";
import PageHeader from "@/components/PageHeader";

export default function DemandPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageHeader
        title="Demand"
        subtitle="Roaster earnings · taxes · stocks · consumption news"
        healthKeys={["ecf", "psd_coffee", "ajca"]}
      />
      <div className="border-b border-slate-700 bg-slate-950">
        <StocksPanel />
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
