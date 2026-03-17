// frontend/lib/pdf/dataHelpers.ts
import type { MarketMetrics, GlobalFlowMetrics } from "./types";
import type { MacroCotWeek } from "@/lib/api";

// ── Primitive helpers ────────────────────────────────────────────────────────

/** Annualised front roll. Positive = backwardation (roll income). Negative = contango. */
export function computeAnnualizedRoll(structureValue: number, price: number): number {
  if (price === 0 || structureValue === 0) return 0;
  // structure = M2 - M1. Contango (M2 > M1) means you pay on roll → negative income.
  return -(structureValue / price) * (365 / 30) * 100;
}

/** Coverage % normalised on 52-week range. Returns 50 if no range. */
export function computeCovPct(current: number, min52: number, max52: number): number {
  if (max52 === min52) return 50;
  return Math.min(100, Math.max(0, ((current - min52) / (max52 - min52)) * 100));
}

/** Funds % maxed: current / historical max × 100, capped at 100. */
export function computeFundsMaxedPct(current: number, history: number[]): number {
  const max = Math.max(...history);
  if (max === 0) return 0;
  return Math.min(100, (current / max) * 100);
}

/** OB/OS flag: both price AND OI rank must cross threshold. */
export function computeObosFlag(
  priceRank: number,
  oiRank: number
): "overbought" | "oversold" | "neutral" {
  if (priceRank > 75 && oiRank > 75) return "overbought";
  if (priceRank < 25 && oiRank < 25) return "oversold";
  return "neutral";
}

/**
 * Position mismatch: MM are net long in contracts but net short in # traders, or vice versa.
 * mmLong/mmShort = contract lots. tLong/tShort = number of traders.
 */
export function computePositionMismatch(
  mmLong: number, mmShort: number,
  tLong: number, tShort: number
): boolean {
  const lotsSign    = Math.sign(mmLong - mmShort);
  const tradersSign = Math.sign(tLong  - tShort);
  return lotsSign !== 0 && tradersSign !== 0 && lotsSign !== tradersSign;
}

/**
 * OI nearby/forward split.
 * exch_oi_ny = ICE/CBOT nearby OI (first ~2 contracts listed on exchange).
 * forward = total_oi - exch_oi.
 */
export function computeOiSplit(
  current: { oi_total: number; exch_oi_ny?: number | null },
  prev:    { oi_total: number; exch_oi_ny?: number | null }
): { total: number; nearby: number; forward: number } {
  const total   = current.oi_total - prev.oi_total;
  const nearbyC = current.exch_oi_ny ?? 0;
  const nearbyP = prev.exch_oi_ny    ?? 0;
  const nearby  = nearbyC - nearbyP;
  return { total, nearby, forward: total - nearby };
}

// Placeholder — counterparty deltas are computed inline in buildMarketMetrics
export function computeCounterpartyDeltas() { return {}; }

// ── High-level builders ──────────────────────────────────────────────────────

// MacroCotEntry.sector values: "hard" | "grains" | "meats" | "softs" | "micros"
// "hard" is split into energy vs metals using ENERGY_SYMS at display time only.
const ENERGY_SYMS = new Set(["wti","brent","natgas","heating_oil","rbob","lsgo"]);
// Display sectors used for biggestMover label
const DISPLAY_SECTORS = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;

/** Percentile rank of value in history array (0 = min, 100 = max). */
function percRank(value: number, history: number[], positiveOnly = true): number {
  const valid = positiveOnly ? history.filter(h => h > 0) : history.filter(h => h !== 0);
  if (valid.length === 0) return 50;
  const below = valid.filter(h => h < value).length;
  return (below / valid.length) * 100;
}

export function buildGlobalFlowMetrics(macroData: MacroCotWeek[]): GlobalFlowMetrics | null {
  if (macroData.length < 2) return null;
  const latest = macroData[macroData.length - 1];
  const prev   = macroData[macroData.length - 2];

  // Helper: sum gross exposure for a week
  const sumGross = (week: MacroCotWeek) =>
    week.commodities.reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);
  const totalGross = sumGross(latest);
  const prevGross  = sumGross(prev);

  // Sector breakdowns — map display sector name to actual MacroCotEntry.sector filter
  const sectorGross = (week: MacroCotWeek, displaySector: string) =>
    week.commodities
      .filter(c => {
        if (displaySector === "energy")  return c.sector === "hard" &&  ENERGY_SYMS.has(c.symbol);
        if (displaySector === "metals")  return c.sector === "hard" && !ENERGY_SYMS.has(c.symbol);
        return c.sector === displaySector; // grains | meats | softs | micros match directly
      })
      .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);

  const sectorDeltas = DISPLAY_SECTORS.map(s => ({
    sector: s,
    delta: sectorGross(latest, s) - sectorGross(prev, s),
  }));
  const biggest = sectorDeltas.reduce((a, b) => Math.abs(a.delta) > Math.abs(b.delta) ? a : b);

  const softsGross  = sectorGross(latest, "softs");
  const coffeeGross = latest.commodities
    .filter(c => c.symbol === "arabica" || c.symbol === "robusta")
    .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);
  const coffeePrev = prev.commodities
    .filter(c => c.symbol === "arabica" || c.symbol === "robusta")
    .reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0);

  const netExp = latest.commodities.reduce((s, c) => s + (c.net_exposure_usd ?? 0), 0);

  // Pre-compute total gross per historical week (for share percentile)
  const totalGrossHistory = macroData.map(w =>
    w.commodities.reduce((s, c) => s + (c.gross_exposure_usd ?? 0), 0)
  );

  // Sector filter helper (reuses existing sectorGross)
  const sectorFilter = (c: any, displaySector: string) => {
    if (displaySector === "energy") return c.sector === "hard" &&  ENERGY_SYMS.has(c.symbol);
    if (displaySector === "metals") return c.sector === "hard" && !ENERGY_SYMS.has(c.symbol);
    return c.sector === displaySector;
  };

  // ── Sector breakdown (now with net, shareDelta, histRank) ──
  const sectorBreakdown = DISPLAY_SECTORS.map(s => {
    const gross  = sectorGross(latest, s);
    const prevG  = sectorGross(prev, s);
    const delta  = gross - prevG;
    const net    = latest.commodities
      .filter(c => sectorFilter(c, s))
      .reduce((sum, c) => sum + (c.net_exposure_usd ?? 0), 0);
    const curShare  = totalGross > 0 ? (gross / totalGross) * 100 : 0;
    const prevShare = prevGross > 0  ? (prevG / prevGross) * 100  : 0;
    const grossHistory = macroData.map(w =>
      w.commodities.filter(c => sectorFilter(c, s)).reduce((sum, c) => sum + (c.gross_exposure_usd ?? 0), 0)
    );
    const shareHistory = grossHistory.map((g, i) =>
      totalGrossHistory[i] > 0 ? (g / totalGrossHistory[i]) * 100 : 0
    );
    const netHistory = macroData.map(w =>
      w.commodities.filter(c => sectorFilter(c, s)).reduce((sum, c) => sum + (c.net_exposure_usd ?? 0), 0)
    );
    const prevNet = prev.commodities
      .filter(c => sectorFilter(c, s))
      .reduce((sum, c) => sum + (c.net_exposure_usd ?? 0), 0);
    const netDelta = net - prevNet;
    return {
      sector: s,
      grossB:          gross / 1e9,
      netB:            net   / 1e9,
      deltaB:          delta / 1e9,
      deltaPct:        prevG > 0 ? (delta / prevG) * 100 : 0,
      shareOfTotalPct: curShare,
      shareDeltaPp:    curShare - prevShare,
      histRankGrossPct: percRank(gross, grossHistory),
      histRankSharePct: percRank(curShare, shareHistory),
      histRankNetPct: percRank(net, netHistory, false),
      netDeltaB:       netDelta / 1e9,
      netDeltaPct:     prevNet !== 0 ? (netDelta / Math.abs(prevNet)) * 100 : 0,
    };
  });

  // ── Per-commodity table ──
  const SECTOR_ORDER = ["energy", "metals", "grains", "meats", "softs", "micros"];
  const commodityTable: import("./types").CommodityRow[] = latest.commodities
    .filter(e => (e.gross_exposure_usd ?? 0) > 0)
    .map(entry => {
      const sym       = entry.symbol;
      const dSector   = ENERGY_SYMS.has(sym) ? "energy" : (entry.sector === "hard" ? "metals" : entry.sector);
      const prevEntry = prev.commodities.find(c => c.symbol === sym);
      const curG      = entry.gross_exposure_usd  ?? 0;
      const prevG2    = prevEntry?.gross_exposure_usd ?? 0;
      const curN      = entry.net_exposure_usd     ?? 0;
      const prevN     = prevEntry?.net_exposure_usd    ?? 0;
      const curShare  = totalGross > 0 ? (curG / totalGross) * 100  : 0;
      const prevShare2 = prevGross > 0 ? (prevG2 / prevGross) * 100 : 0;
      const grossHist  = macroData.map(w => w.commodities.find(c => c.symbol === sym)?.gross_exposure_usd ?? 0);
      const shareHist  = grossHist.map((g, i) => totalGrossHistory[i] > 0 ? (g / totalGrossHistory[i]) * 100 : 0);
      const netHist = macroData.map(w => w.commodities.find(c => c.symbol === sym)?.net_exposure_usd ?? 0);
      const netDelta = curN - prevN;
      return {
        symbol: sym,
        name:   entry.name,
        displaySector: dSector,
        isCoffee: sym === "arabica" || sym === "robusta",
        grossB:          curG / 1e9,
        netB:            curN / 1e9,
        deltaB:          (curG - prevG2) / 1e9,
        deltaPct:        prevG2 > 0 ? ((curG - prevG2) / prevG2) * 100 : 0,
        shareOfTotalPct: curShare,
        shareDeltaPp:    curShare - prevShare2,
        histRankGrossPct: percRank(curG, grossHist),
        histRankSharePct: percRank(curShare, shareHist),
        histRankNetPct: percRank(curN, netHist, false),
        netDeltaB:       netDelta / 1e9,
        netDeltaPct:     prevN !== 0 ? (netDelta / Math.abs(prevN)) * 100 : 0,
      };
    })
    .sort((a, b) => {
      const ai = SECTOR_ORDER.indexOf(a.displaySector);
      const bi = SECTOR_ORDER.indexOf(b.displaySector);
      if (ai !== bi) return ai - bi;
      return b.grossB - a.grossB;
    });

  // ── Net exposure WoW ──
  const prevNetExp = prev.commodities.reduce((s, c) => s + (c.net_exposure_usd ?? 0), 0);

  return {
    date:               latest.date,
    totalGrossB:        totalGross  / 1e9,
    netExpB:            netExp      / 1e9,
    wowDeltaB:          (totalGross - prevGross) / 1e9,
    softSharePct:       totalGross > 0 ? (softsGross / totalGross) * 100 : 0,
    biggestMoverSector: biggest.sector,
    biggestMoverDeltaB: biggest.delta / 1e9,
    coffeeSharePct:     totalGross > 0 ? (coffeeGross / totalGross) * 100 : 0,
    coffeeDeltaB:       (coffeeGross - coffeePrev) / 1e9,
    coffeeGrossB:       coffeeGross / 1e9,
    sectorBreakdown,
    wowDeltaNetB:       (netExp - prevNetExp) / 1e9,
    softsGrossB:        softsGross / 1e9,
    commodityTable,
  };
}

/**
 * Build MarketMetrics for one market (ny or ldn) from the processed recent52 array
 * and the raw data[] array.
 *
 * @param recent52  — processed rows from CotDashboard (has priceRank, oiRank, tradersNY/LDN, etc.)
 * @param rawData   — raw rows from /api/cot (has structure_ny, exch_oi_ny, efp_ny, etc.)
 * @param market    — "ny" | "ldn"
 */
export function buildMarketMetrics(
  recent52: any[],
  rawData:  any[],
  market:   "ny" | "ldn"
): MarketMetrics | null {
  if (recent52.length < 2 || rawData.length < 2) return null;

  const cur  = recent52[recent52.length - 1];
  const prev = recent52[recent52.length - 2];
  const rawCur  = rawData[rawData.length - 1];
  const rawPrev = rawData[rawData.length - 2];

  const isNY = market === "ny";
  const mk   = isNY ? "ny" : "ldn";        // key in raw data and in cur/prev

  const price      = isNY ? cur.priceNY  : cur.priceLDN;
  const prevPrice  = isNY ? prev.priceNY : prev.priceLDN;
  const priceUnit  = isNY ? "¢/lb" : "$/MT" as "¢/lb" | "$/MT";

  const curNY  = cur[mk];   // the ny/ldn sub-object from processed data
  const prevNY = prev[mk];

  // OI split
  const rawMk = rawCur?.[mk];
  const rawPMk = rawPrev?.[mk];
  const oiSplit = rawMk && rawPMk
    ? computeOiSplit(
        { oi_total: rawMk.oi_total ?? 0,  exch_oi_ny: isNY ? rawMk.exch_oi_ny  : rawMk.exch_oi_ldn  },
        { oi_total: rawPMk.oi_total ?? 0, exch_oi_ny: isNY ? rawPMk.exch_oi_ny : rawPMk.exch_oi_ldn }
      )
    : { total: 0, nearby: 0, forward: 0 };

  // Structure / roll
  const structureValue     = isNY ? (rawMk?.structure_ny ?? 0) : (rawMk?.structure_ldn ?? 0);
  const structurePrevValue = isNY ? (rawPMk?.structure_ny ?? 0) : (rawPMk?.structure_ldn ?? 0);
  const annualizedRollPct  = computeAnnualizedRoll(structureValue, price);

  // PMPU MT (industry coverage) — normalize over 52w
  const pmpuLongMTs  = recent52.map(d => (isNY ? d.pmpuLongMT_NY  : d.pmpuLongMT_LDN)  ?? 0);
  const pmpuShortMTs = recent52.map(d => (isNY ? d.pmpuShortMT_NY : d.pmpuShortMT_LDN) ?? 0);
  const prodMT    = isNY ? cur.pmpuLongMT_NY  : cur.pmpuLongMT_LDN;
  const roastMT   = isNY ? cur.pmpuShortMT_NY : cur.pmpuShortMT_LDN;
  const prodMTPrev  = isNY ? prev.pmpuLongMT_NY  : prev.pmpuLongMT_LDN;
  const roastMTPrev = isNY ? prev.pmpuShortMT_NY : prev.pmpuShortMT_LDN;

  // Funds maxed
  const mmLongs  = recent52.map(d => d[mk].mmLong  ?? 0);
  const mmShorts = recent52.map(d => d[mk].mmShort ?? 0);

  // Counterparty deltas (lots WoW)
  const cpDelta = (field: string, side: "long" | "short") => {
    const k = field + (side === "long" ? "Long" : "Short");
    return (cur[mk][k] ?? 0) - (prev[mk][k] ?? 0);
  };

  // Trader counts
  // tradersNY/LDN currently stores t_mm_long under key "mm" (long-side count only).
  // t_mm_short is available in the raw COT row as row.ny.t_mm_short.
  // Use rawCur for the short trader count to correctly detect position mismatch.
  const traders  = isNY ? cur.tradersNY  : cur.tradersLDN;
  const tMmLong  = traders?.mm ?? 0;
  // Both NY and LDN raw rows store the MM short trader count under "t_mm_short".
  const tMmShort = rawMk?.t_mm_short ?? 0;

  return {
    market:   isNY ? "NY Arabica" : "LDN Robusta",
    date:     cur.date,

    oiChangeLots:    oiSplit.total,
    oiChangeNearby:  oiSplit.nearby,
    oiChangeForward: oiSplit.forward,

    price,
    priceUnit,
    priceChangePct:  prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0,
    priceChangeAbs:  price - prevPrice,

    structureValue,
    structurePrevValue,
    structureType:    structureValue <= 0 ? "backwardation" : "carry",
    annualizedRollPct,

    // Coverage %: PMPU position normalised on 52-week min/max range (0% = 52w low, 100% = 52w high)
    producerCovPct:  computeCovPct(prodMT,  Math.min(...pmpuLongMTs),  Math.max(...pmpuLongMTs)),
    producerMT:      prodMT,
    producerMTWoW:   prodMT - prodMTPrev,
    roasterCovPct:   computeCovPct(roastMT, Math.min(...pmpuShortMTs), Math.max(...pmpuShortMTs)),
    roasterMT:       roastMT,
    roasterMTWoW:    roastMT - roastMTPrev,

    mmLong:             curNY.mmLong,
    mmShort:            curNY.mmShort,
    mmLongChangeLots:   cpDelta("mm", "long"),
    mmShortChangeLots:  cpDelta("mm", "short"),
    mmLongChangePct:    prevNY.mmLong > 0 ? (cpDelta("mm","long")  / prevNY.mmLong)  * 100 : 0,
    mmShortChangePct:   prevNY.mmShort> 0 ? (cpDelta("mm","short") / prevNY.mmShort) * 100 : 0,
    fundsMaxedLongPct:  computeFundsMaxedPct(curNY.mmLong,  mmLongs),
    fundsMaxedShortPct: computeFundsMaxedPct(curNY.mmShort, mmShorts),

    obosFlag: computeObosFlag(
      isNY ? cur.priceRank : cur.priceRankLDN,
      isNY ? cur.oiRank    : cur.oiRankLDN
    ),
    priceRank:          isNY ? cur.priceRank    : cur.priceRankLDN,
    oiRank:             isNY ? cur.oiRank       : cur.oiRankLDN,
    // tMmLong = long-side trader count; tMmShort = short-side from raw row
    positionMismatch:   computePositionMismatch(curNY.mmLong, curNY.mmShort, tMmLong, tMmShort),
    mmConcentrationPct: (curNY.oi_total ?? 0) > 0
      ? ((curNY.mmLong + curNY.mmShort) / (curNY.oi_total ?? 1)) * 100
      : 0,

    cp: {
      longs:  { pmpu: cpDelta("pmpu","long"),  sd: cpDelta("swap","long"),  mm: cpDelta("mm","long"),  or: cpDelta("other","long"),  nr: cpDelta("nonRep","long")  },
      shorts: { pmpu: cpDelta("pmpu","short"), sd: cpDelta("swap","short"), mm: cpDelta("mm","short"), or: cpDelta("other","short"), nr: cpDelta("nonRep","short") },
    },
  };
}
