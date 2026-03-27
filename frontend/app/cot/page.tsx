import dynamic from "next/dynamic";

const CotDashboard = dynamic(() => import("@/components/futures/CotDashboard"), { ssr: false });

export default function CotPage() {
  return <CotDashboard />;
}
