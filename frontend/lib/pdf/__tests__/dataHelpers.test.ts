// frontend/lib/pdf/__tests__/dataHelpers.test.ts
import { describe, it, expect } from "vitest";
import {
  computeAnnualizedRoll,
  computeCovPct,
  computeFundsMaxedPct,
  computeObosFlag,
  computePositionMismatch,
  computeCounterpartyDeltas,
  computeOiSplit,
} from "../dataHelpers";

describe("computeAnnualizedRoll", () => {
  it("returns positive value for carry (M2 > M1)", () => {
    // structure = +5 ¢/lb means M2 is 5 cents above M1 → contango → negative roll
    const roll = computeAnnualizedRoll(5, 300);
    expect(roll).toBeCloseTo(-(5 / 300) * (365 / 30) * 100, 1);
  });
  it("returns positive roll for backwardation (structure < 0)", () => {
    const roll = computeAnnualizedRoll(-5, 300);
    expect(roll).toBeGreaterThan(0);
  });
  it("returns 0 for zero structure", () => {
    expect(computeAnnualizedRoll(0, 300)).toBe(0);
  });
});

describe("computeCovPct", () => {
  it("returns 100% when at historical max", () => {
    expect(computeCovPct(1000, 200, 1000)).toBe(100);
  });
  it("returns 0% when at historical min", () => {
    expect(computeCovPct(200, 200, 1000)).toBe(0);
  });
  it("returns 50% at midpoint", () => {
    expect(computeCovPct(600, 200, 1000)).toBeCloseTo(50, 1);
  });
  it("returns 50 if min === max (no range)", () => {
    expect(computeCovPct(500, 500, 500)).toBe(50);
  });
});

describe("computeFundsMaxedPct", () => {
  it("returns 80 when current is 80% of max", () => {
    expect(computeFundsMaxedPct(80, [50, 60, 70, 80, 100])).toBe(80);
  });
  it("clamps to 100 if current exceeds observed max", () => {
    expect(computeFundsMaxedPct(110, [50, 60, 70, 100])).toBe(100);
  });
});

describe("computeObosFlag", () => {
  it("returns overbought when both ranks > 75", () => {
    expect(computeObosFlag(80, 80)).toBe("overbought");
  });
  it("returns oversold when both ranks < 25", () => {
    expect(computeObosFlag(20, 20)).toBe("oversold");
  });
  it("returns neutral for mixed signals", () => {
    expect(computeObosFlag(80, 40)).toBe("neutral");
    expect(computeObosFlag(10, 80)).toBe("neutral");
  });
});

describe("computePositionMismatch", () => {
  it("detects mismatch: net long in lots but net short in traders", () => {
    expect(computePositionMismatch(100, 50, 10, 20)).toBe(true);
  });
  it("returns false when both aligned net long", () => {
    expect(computePositionMismatch(100, 50, 20, 10)).toBe(false);
  });
  it("returns false when both aligned net short", () => {
    expect(computePositionMismatch(50, 100, 10, 20)).toBe(false);
  });
});

describe("computeOiSplit", () => {
  it("computes nearby and forward delta from exch_oi and total", () => {
    const result = computeOiSplit(
      { oi_total: 170000, exch_oi_ny: 30000 },  // current
      { oi_total: 168000, exch_oi_ny: 29000 }   // previous
    );
    expect(result.total).toBe(2000);
    expect(result.nearby).toBe(1000);
    expect(result.forward).toBe(1000);
  });
});

import { buildGlobalFlowMetrics } from "../dataHelpers";
import type { MacroCotWeek } from "@/lib/api";

// Minimal MacroCotWeek factory
function makeWeek(
  date: string,
  commodities: Array<{
    symbol: string; sector: "hard" | "grains" | "meats" | "softs" | "micros";
    mm_long: number; mm_short: number; close_price: number | null;
  }>
): MacroCotWeek {
  return {
    date,
    commodities: commodities.map(c => ({
      ...c,
      name: c.symbol,
      mm_spread: 0,
      oi_total: c.mm_long + c.mm_short,
      gross_exposure_usd: c.close_price != null
        ? (c.mm_long + c.mm_short) * c.close_price * 1000
        : null,
      net_exposure_usd: c.close_price != null
        ? (c.mm_long - c.mm_short) * c.close_price * 1000
        : null,
    })),
  };
}

describe("buildGlobalFlowMetrics — attribution", () => {
  const prev = makeWeek("2026-03-03", [
    { symbol: "wti", sector: "hard", mm_long: 100, mm_short: 50, close_price: 80 },
  ]);
  const latest = makeWeek("2026-03-10", [
    { symbol: "wti", sector: "hard", mm_long: 120, mm_short: 60, close_price: 90 },
  ]);

  it("grossOiEffectB: Δgross_oi × old_price × contract_unit / 1e9", () => {
    // Δgross_oi = (120+60)-(100+50) = 30; old_price = 80; contract_unit(wti) = 1000
    // = 30 × 80 × 1000 / 1e9 = 2_400_000 / 1e9 = 0.0024
    const result = buildGlobalFlowMetrics([prev, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(wti?.grossOiEffectB).toBeCloseTo(0.0024, 6);
  });

  it("grossPriceEffectB: gross_oi_new × Δprice × contract_unit / 1e9", () => {
    // gross_oi_new = 180; Δprice = 10; contract_unit = 1000
    // = 180 × 10 × 1000 / 1e9 = 0.0018
    const result = buildGlobalFlowMetrics([prev, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(wti?.grossPriceEffectB).toBeCloseTo(0.0018, 6);
  });

  it("invariant: grossOiEffect + grossPriceEffect === gross WoW change", () => {
    const result = buildGlobalFlowMetrics([prev, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    const totalChange = wti!.deltaB; // gross WoW $B
    expect((wti!.grossOiEffectB ?? 0) + (wti!.grossPriceEffectB ?? 0)).toBeCloseTo(totalChange, 6);
  });

  it("netOiEffectB: Δnet_oi × old_price × contract_unit / 1e9", () => {
    // Δnet_oi = (120-60)-(100-50) = 60-50 = 10; old_price = 80; cu = 1000
    // = 10 × 80 × 1000 / 1e9 = 0.0008
    const result = buildGlobalFlowMetrics([prev, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(wti?.netOiEffectB).toBeCloseTo(0.0008, 6);
  });

  it("netPriceEffectB: net_oi_new × Δprice × contract_unit / 1e9", () => {
    // net_oi_new = 120-60 = 60; Δprice = 10; cu = 1000
    // = 60 × 10 × 1000 / 1e9 = 0.0006
    const result = buildGlobalFlowMetrics([prev, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(wti?.netPriceEffectB).toBeCloseTo(0.0006, 6);
  });

  it("invariant: netOiEffect + netPriceEffect === net WoW change", () => {
    const result = buildGlobalFlowMetrics([prev, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect((wti!.netOiEffectB ?? 0) + (wti!.netPriceEffectB ?? 0)).toBeCloseTo(wti!.netDeltaB, 6);
  });

  it("returns null for all effects when close_price is null in current week", () => {
    const latestNullPrice = makeWeek("2026-03-10", [
      { symbol: "wti", sector: "hard", mm_long: 120, mm_short: 60, close_price: null },
    ]);
    const result = buildGlobalFlowMetrics([prev, latestNullPrice]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(wti?.grossOiEffectB).toBeNull();
    expect(wti?.grossPriceEffectB).toBeNull();
  });

  it("returns null for all effects when close_price is null in prev week", () => {
    const prevNullPrice = makeWeek("2026-03-03", [
      { symbol: "wti", sector: "hard", mm_long: 100, mm_short: 50, close_price: null },
    ]);
    const result = buildGlobalFlowMetrics([prevNullPrice, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(wti?.grossOiEffectB).toBeNull();
  });

  it("returns null for all effects when symbol is missing from previous week", () => {
    const prevEmpty = makeWeek("2026-03-03", []);
    const result = buildGlobalFlowMetrics([prevEmpty, latest]);
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(wti?.grossOiEffectB).toBeNull();
  });

  it("sector grossOiEffectB subtotal sums non-null commodity values", () => {
    const result = buildGlobalFlowMetrics([prev, latest]);
    const energySector = result?.sectorBreakdown.find(s => s.sector === "energy");
    // WTI is the only energy commodity in this test — subtotal should equal wti's value
    const wti = result?.commodityTable.find(c => c.symbol === "wti");
    expect(energySector?.grossOiEffectB).toBeCloseTo(wti!.grossOiEffectB!, 6);
  });

  it("sector grossOiEffectB is null when all commodities in sector have null attribution", () => {
    const prevNull = makeWeek("2026-03-03", [
      { symbol: "wti", sector: "hard", mm_long: 100, mm_short: 50, close_price: null },
    ]);
    const latestNull = makeWeek("2026-03-10", [
      { symbol: "wti", sector: "hard", mm_long: 120, mm_short: 60, close_price: null },
    ]);
    const result = buildGlobalFlowMetrics([prevNull, latestNull]);
    const energySector = result?.sectorBreakdown.find(s => s.sector === "energy");
    expect(energySector?.grossOiEffectB).toBeNull();
  });
});
