// Vessel-type metadata shared by the Port Activity toggle chips and the chart.
// Kept recharts-free so importing it doesn't pull the chart bundle eagerly.
// Colors/labels mirror the IMF PortWatch legend.
export const VESSEL_TYPE_META = [
  { key: "container",     label: "Container",        color: "#ef4444" },
  { key: "dry_bulk",      label: "Dry Bulk",         color: "#f97316" },
  { key: "general_cargo", label: "General Cargo",    color: "#facc15" },
  { key: "roro",          label: "Roll-on/roll-off", color: "#7dd3fc" },
  { key: "tanker",        label: "Tanker",           color: "#15803d" },
] as const;

export type VesselTypeKey = (typeof VESSEL_TYPE_META)[number]["key"];

export const VESSEL_TYPE_KEYS = VESSEL_TYPE_META.map((t) => t.key) as VesselTypeKey[];
