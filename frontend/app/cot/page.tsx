import dynamic from "next/dynamic";
import PageHeader from "@/components/PageHeader";

const CotDashboard = dynamic(() => import("@/components/futures/CotDashboard"), { ssr: false });

export default function CotPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="COT"
        subtitle="Commitments of Traders — positioning & flow analysis"
        healthKeys={["cot", "macro_cot"]}
      />
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3">
        <CotDashboard />
      </div>
    </div>
  );
}
