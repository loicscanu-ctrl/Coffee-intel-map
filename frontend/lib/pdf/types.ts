// frontend/lib/pdf/types.ts

export interface MarketMetrics {
  // Identification
  market: "NY Arabica" | "LDN Robusta";
  date: string;             // COT report date e.g. "2026-03-10"

  // OI change
  oiChangeLots: number;     // total WoW delta in lots
  oiChangeNearby: number;   // lots change in first 2 contracts (exch_oi delta)
  oiChangeForward: number;  // lots change in forward contracts (total - nearby delta)

  // Price
  price: number;            // current price (cents/lb for NY, USD/MT for LDN)
  priceUnit: "¢/lb" | "$/MT";
  priceChangePct: number;   // % change WoW
  priceChangeAbs: number;   // absolute change in price units

  // Front structure
  structureValue: number;   // M2 - M1 spread (same unit as price)
  structurePrevValue: number;
  structureType: "carry" | "backwardation"; // positive spread = carry; negative = backwardation
  annualizedRollPct: number; // (structureValue / price) * (365/30) * 100, sign-flipped for carry convention

  // Industry coverage (min/max normalised over 52w history)
  producerCovPct: number;   // ((current - min52w) / (max52w - min52w)) * 100 — position within 52w range
  producerMT: number;       // current PMPU long MT equivalent
  producerMTWoW: number;    // WoW change in MT
  roasterCovPct: number;    // ((current - min52w) / (max52w - min52w)) * 100 — same normalization as producerCovPct
  roasterMT: number;
  roasterMTWoW: number;

  // Managed Money
  mmLong: number;           // current lots
  mmShort: number;
  mmLongChangeLots: number; // WoW delta
  mmShortChangeLots: number;
  mmLongChangePct: number;  // delta / prior * 100
  mmShortChangePct: number;
  fundsMaxedLongPct: number; // mmLong / max(mmLong last 52w) * 100
  fundsMaxedShortPct: number;

  // Risk flags
  obosFlag: "overbought" | "oversold" | "neutral"; // price >75 AND oi >75 = OB; both <25 = OS
  priceRank: number;        // 0-100
  oiRank: number;           // 0-100
  positionMismatch: boolean; // sign(mmLong-mmShort) != sign(t_mm_long - t_mm_short)
  mmConcentrationPct: number; // (mmLong + mmShort) / oi_total * 100

  // Counterparty WoW deltas (lots)
  cp: {
    longs:  { pmpu: number; sd: number; mm: number; or: number; nr: number };
    shorts: { pmpu: number; sd: number; mm: number; or: number; nr: number };
  };
}

export interface GlobalFlowMetrics {
  date: string;
  totalGrossB: number;      // USD billions
  netExpB: number;
  wowDeltaB: number;        // total gross WoW change
  softSharePct: number;     // softs % of total gross
  biggestMoverSector: string;
  biggestMoverDeltaB: number;
  coffeeSharePct: number;   // arabica+robusta combined % of total gross
  coffeeDeltaB: number;     // WoW change in coffee gross exposure
}

export interface ReportData {
  weekNumber: number;       // ISO week number
  year: number;
  cotDate: string;          // "March 10, 2026"
  generatedAt: string;      // ISO timestamp
  globalFlow: GlobalFlowMetrics;
  coffeeOverview: {
    combinedNetLots: number;    // NY mmNet + LDN mmNet
    combinedNetMT: number;
    alignedDirection: boolean;  // NY and LDN net pointing same direction
    nyCombinedOiRank: number;
    ldnCombinedOiRank: number;
  };
  ny: MarketMetrics;
  ldn: MarketMetrics;
  // PNG data URLs for chart images (set during capture phase)
  charts: {
    globalFlow:    string | null;
    structural:    string | null;
    counterparty:  string | null;
    industryPulse: string | null;
    dryPowder:     string | null;
    obosMatrix:    string | null;
  };
}
