// Shared UI constants for the per-origin FarmerEconomics panels. These were
// duplicated verbatim across the origin panels; centralised here so each panel
// only carries its origin-specific data.

// recharts tooltip chrome.
export const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

// Calendar month abbreviations (Jan–Dec).
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ENSO phase card chrome — Colombia / Honduras / Indonesia panels.
export const PHASE_STYLE = {
  "el-nino": { label: "El Niño",  border: "border-purple-500", text: "text-purple-300", bg: "bg-purple-950" },
  "la-nina": { label: "La Niña",  border: "border-blue-400",   text: "text-blue-300",   bg: "bg-blue-950"   },
  "neutral":  { label: "Neutral",  border: "border-slate-500",  text: "text-slate-400",  bg: "bg-slate-900"  },
};

// ENSO impact text colours — Colombia / Honduras / Indonesia panels.
export const IMPACT_TEXT: Record<string, string> = {
  DRY:  "text-amber-300",
  WET:  "text-cyan-300",
  WARM: "text-orange-300",
};

// Compact phase / impact text colours — Uganda / Ethiopia panels.
export const PHASE_COLOR: Record<string, string> = { "el-nino": "text-orange-400", "la-nina": "text-blue-400", "neutral": "text-slate-400" };
export const IMPACT_COLOR: Record<string, string> = { DRY: "text-orange-400", WET: "text-blue-400", WARM: "text-yellow-400", COLD: "text-cyan-400" };
