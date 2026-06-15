// Single source of truth for origin FOBbing costs (origin logistics + exporter
// margin), in USD/MT. Edit these numbers here and every consumer updates:
//   - Research → Origin Logistics tab (the "~$X/t" headline figures)
//   - Market ticker: lifts origin spot prices to at-port parity vs RC futures
//   - Futures → Quotation tab: the flat reference price for each origin
//
// VN FAQ ≈ $65 logistics (Cat Lai trucking + port) + ~$35 exporter margin.
// See components/research/ResearchView.tsx → Origin Logistics for the full
// cost-stack breakdown behind each number.
export const FOBBING_USD: Record<string, number> = {
  "VN FAQ":  100,
  "CON T7":  200,
  "UGA S15": 265,
};

export const VN_FAQ_FOBBING_USD = FOBBING_USD["VN FAQ"];

// Carry cost added per shipment month within a crop year, USD/MT.
export const MONTHLY_CARRY_USD = 30;
