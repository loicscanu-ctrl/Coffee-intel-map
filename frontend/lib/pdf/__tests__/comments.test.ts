// frontend/lib/pdf/__tests__/comments.test.ts
import { describe, it, expect } from "vitest";
import {
  globalFlowComment,
  marketOverviewComment,
  structuralComment,
  counterpartyComment,
  industryPulseComment,
  dryPowderComment,
  obosComment,
} from "../comments";
import type { GlobalFlowMetrics, MarketMetrics } from "../types";

const mockFlow: GlobalFlowMetrics = {
  date: "2026-03-10", totalGrossB: 142, netExpB: 18,
  wowDeltaB: 4.2, softSharePct: 14, biggestMoverSector: "softs",
  biggestMoverDeltaB: 2.1, coffeeSharePct: 6.2, coffeeDeltaB: 0.8,
  coffeeGrossB: 8.8,
  wowDeltaNetB: 1.1,
  softsGrossB: 19.9,
  commodityTable: [],
  sectorBreakdown: [
    {
      sector: "energy", grossB: 0, netB: 0, deltaB: 0, deltaPct: 0,
      shareOfTotalPct: 0, shareDeltaPp: 0, histRankGrossPct: 50,
      histRankSharePct: 50, histRankNetPct: 50, netDeltaB: 0, netDeltaPct: 0,
      grossOiEffectB: null, grossPriceEffectB: null, netOiEffectB: null, netPriceEffectB: null,
    },
    {
      sector: "metals", grossB: 0, netB: 0, deltaB: 0, deltaPct: 0,
      shareOfTotalPct: 0, shareDeltaPp: 0, histRankGrossPct: 50,
      histRankSharePct: 50, histRankNetPct: 50, netDeltaB: 0, netDeltaPct: 0,
      grossOiEffectB: null, grossPriceEffectB: null, netOiEffectB: null, netPriceEffectB: null,
    },
    {
      sector: "grains", grossB: 0, netB: 0, deltaB: 0, deltaPct: 0,
      shareOfTotalPct: 0, shareDeltaPp: 0, histRankGrossPct: 50,
      histRankSharePct: 50, histRankNetPct: 50, netDeltaB: 0, netDeltaPct: 0,
      grossOiEffectB: null, grossPriceEffectB: null, netOiEffectB: null, netPriceEffectB: null,
    },
    {
      sector: "meats", grossB: 0, netB: 0, deltaB: 0, deltaPct: 0,
      shareOfTotalPct: 0, shareDeltaPp: 0, histRankGrossPct: 50,
      histRankSharePct: 50, histRankNetPct: 50, netDeltaB: 0, netDeltaPct: 0,
      grossOiEffectB: null, grossPriceEffectB: null, netOiEffectB: null, netPriceEffectB: null,
    },
    {
      sector: "softs", grossB: 19.9, netB: 5, deltaB: 2.1, deltaPct: 11.8,
      shareOfTotalPct: 14, shareDeltaPp: 0.5, histRankGrossPct: 70,
      histRankSharePct: 65, histRankNetPct: 60, netDeltaB: 0.3, netDeltaPct: 6,
      grossOiEffectB: null, grossPriceEffectB: null, netOiEffectB: null, netPriceEffectB: null,
    },
    {
      sector: "micros", grossB: 0, netB: 0, deltaB: 0, deltaPct: 0,
      shareOfTotalPct: 0, shareDeltaPp: 0, histRankGrossPct: 50,
      histRankSharePct: 50, histRankNetPct: 50, netDeltaB: 0, netDeltaPct: 0,
      grossOiEffectB: null, grossPriceEffectB: null, netOiEffectB: null, netPriceEffectB: null,
    },
  ],
};

describe("globalFlowComment", () => {
  it("mentions total gross and biggest mover", () => {
    const c = globalFlowComment(mockFlow);
    expect(c).toContain("$142");
    expect(c).toContain("softs");
  });
  it("flags coffee contribution", () => {
    expect(globalFlowComment(mockFlow)).toContain("coffee");
  });
});

const mockNY: Partial<MarketMetrics> = {
  market: "NY Arabica", oiChangeLots: -2400, oiChangeNearby: -3000, oiChangeForward: 600,
  priceChangePct: 4.5, priceChangeAbs: 12.7, priceUnit: "¢/lb",
  structureType: "backwardation", annualizedRollPct: 9.8,
  mmLongChangeLots: 600, mmLongChangePct: 1.5,
  mmShortChangeLots: -1600, mmShortChangePct: -7.9,
  fundsMaxedLongPct: 46.3, fundsMaxedShortPct: 13.1,
  obosFlag: "neutral", priceRank: 55, oiRank: 62,
  positionMismatch: false, mmConcentrationPct: 34,
};

describe("marketOverviewComment", () => {
  it("includes OI change and price change", () => {
    const c = marketOverviewComment(mockNY as MarketMetrics);
    expect(c).toContain("2.4k");
    expect(c).toContain("4.5%");
  });
  it("mentions backwardation", () => {
    expect(marketOverviewComment(mockNY as MarketMetrics)).toContain("backwardation");
  });
});

describe("obosComment", () => {
  it("flags overbought condition", () => {
    const m = { ...mockNY, obosFlag: "overbought", priceRank: 80, oiRank: 82 } as MarketMetrics;
    expect(obosComment(m)).toContain("overbought");
  });
  it("flags position mismatch", () => {
    const m = { ...mockNY, positionMismatch: true } as MarketMetrics;
    expect(obosComment(m)).toContain("mismatch");
  });
});
