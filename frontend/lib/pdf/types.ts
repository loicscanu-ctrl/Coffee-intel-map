// frontend/lib/pdf/types.ts

export interface MarketMetrics {
  // Identification
  market: "NY Arabica" | "LDN Robusta";
  date: string;             // COT report date e.g. "2026-03-10"

  // OI change
  oiChangeLots: number;             // total WoW delta in lots
  oiChangeNearby: number | null;    // lots change in first 2 contracts (exch_oi delta); null = not populated by scraper
  oiChangeForward: number | null;   // lots change in forward contracts (total - nearby delta); null = not populated by scraper

  // Price
  price: number;            // current price (cents/lb for NY, USD/MT for LDN)
  priceUnit: "¢/lb" | "$/MT";
  priceChangePct: number;   // % change WoW
  priceChangeAbs: number;   // absolute change in price units

  // Front structure
  structureValue: number | null;       // M2 - M1 spread (same unit as price); null = not populated by scraper
  structurePrevValue: number | null;
  structureType: "carry" | "backwardation" | null; // null = data unavailable
  annualizedRollPct: number | null;    // null = data unavailable

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

  // Full category breakdown (absolute current + WoW deltas)
  cats: {
    pmpu:  { long: number; short: number; dLong: number; dShort: number };
    swap:  { long: number; short: number; spread: number; dLong: number; dShort: number; dSpread: number };
    mm:    { long: number; short: number; spread: number; dLong: number; dShort: number; dSpread: number };
    other: { long: number; short: number; spread: number; dLong: number; dShort: number; dSpread: number };
    nr:    { long: number; short: number; dLong: number; dShort: number };
    oi:    number;
  };
}

export interface CommodityRow {
  symbol: string;
  name: string;
  displaySector: string;        // "energy" | "metals" | "grains" | "meats" | "softs" | "micros"
  isCoffee: boolean;            // true for arabica / robusta
  grossB: number;               // current gross $B
  netB: number;                 // current net $B
  deltaB: number;               // WoW gross delta $B
  deltaPct: number;             // WoW gross delta %
  shareOfTotalPct: number;      // % of total gross
  shareDeltaPp: number;         // WoW share change (percentage points)
  histRankGrossPct: number;     // 0–100: position in full available history (0 = all-time low, 100 = all-time high)
  histRankSharePct: number;     // same for share %
  histRankNetPct: number;
  netDeltaB: number;            // WoW net exposure delta $B
  netDeltaPct: number;          // WoW net exposure delta %
  // Attribution: WoW notional change split by cause ($B)
  // null when price data is unavailable for either week, or no previous-week entry
  grossOiEffectB:    number | null;
  grossPriceEffectB: number | null;
  netOiEffectB:      number | null;
  netPriceEffectB:   number | null;
  // Raw price / OI verification columns (per selected comparison window)
  closePrice: number | null;    // latest close, USD per base unit (scraper-normalized)
  priceDeltaPct: number | null; // % price change vs comparison week
  oiTotal: number;              // total open interest, lots (all participants)
  oiDeltaPct: number | null;    // % OI change vs comparison week
  // Data-quality flag: latest price moved >±50% vs the IMMEDIATELY previous
  // week (independent of the display window) — the signature of a corrupt
  // feed batch (e.g. the 2026-07-14 yfinance misalignment), not a real move.
  priceOutlier: boolean;
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
  coffeeGrossB: number;     // current coffee gross USD billions
  sectorBreakdown: Array<{
    sector: string;
    grossB: number;
    netB: number;
    deltaB: number;
    deltaPct: number;         // WoW % change
    shareOfTotalPct: number;  // % of total gross
    shareDeltaPp: number;
    histRankGrossPct: number;
    histRankSharePct: number;
    histRankNetPct: number;
    netDeltaB: number;
    netDeltaPct: number;
    // Attribution: WoW notional change split by cause ($B)
    // null when price data is unavailable for either week, or no previous-week entry
    grossOiEffectB:    number | null;
    grossPriceEffectB: number | null;
    netOiEffectB:      number | null;
    netPriceEffectB:   number | null;
  }>;
  wowDeltaNetB: number;         // WoW net exposure change $B
  softsGrossB: number;          // current softs sector gross $B
  commodityTable: CommodityRow[]; // all commodities sorted sector-then-gross-desc
  // Comparison window all Δ fields were computed over: 1 = week-over-week
  // (default), N = latest vs N weeks back. prevDate is the comparison week.
  windowWeeks: number;
  prevDate: string;
}
