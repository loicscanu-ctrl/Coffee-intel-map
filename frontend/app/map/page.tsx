import dynamic from "next/dynamic";

const CoffeeMap = dynamic(() => import("@/components/map/CoffeeMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
      Loading map...
    </div>
  ),
});

export default function MapPage() {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <CoffeeMap />
    </div>
  );
}
