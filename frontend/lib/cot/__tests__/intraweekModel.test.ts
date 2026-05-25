import { describe, expect, it } from "vitest";
import { confidenceTier, estimateIntraweekFlow, NY_PARAMS, type OiDay } from "../intraweekModel";
import type { CotMarketPositions } from "../types";

// Symmetric COT positions: producers (pmpu short) and roasters (pmpu long) each
// hold half of their side's non-MM open interest, so shares are exactly 0.5.
const POS: CotMarketPositions = {
  pmpuLong: 100, pmpuShort: 100, pmpuSpread: 0,
  swapLong: 100, swapShort: 100, swapSpread: 0,
  mmLong: 200,   mmShort: 200,   mmSpread: 0,
  otherLong: 0,  otherShort: 0,  otherSpread: 0,
  nonRepLong: 0, nonRepShort: 0, nonRepSpread: 0,
};

// Two-contract days; only the front (max-OI) contract drives price/total here.
const day = (date: string, oi: number, px: number): OiDay => ({
  date,
  contracts: [{ symbol: "KCN26", oi, last_price: px }, { symbol: "KCU26", oi: 1, last_price: px - 5 }],
});

describe("estimateIntraweekFlow regimes", () => {
  it("price↑ / OI↑ → fresh MM longs, producers sell the strength", () => {
    const f = estimateIntraweekFlow([day("2026-05-19", 1000, 100), day("2026-05-20", 1100, 105)], POS);
    expect(f.mmLongDelta).toBeGreaterThan(0);
    expect(f.mmShortDelta).toBe(0);
    expect(f.producerLotsDelta).toBeGreaterThan(0); // added short coverage
    expect(f.roasterLotsDelta).toBe(0);
  });

  it("price↓ / OI↑ → fresh MM shorts, roasters buy the dip", () => {
    const f = estimateIntraweekFlow([day("2026-05-19", 1000, 100), day("2026-05-20", 1100, 95)], POS);
    expect(f.mmShortDelta).toBeGreaterThan(0);
    expect(f.mmLongDelta).toBe(0);
    expect(f.roasterLotsDelta).toBeGreaterThan(0); // added long coverage
    expect(f.producerLotsDelta).toBe(0);
  });

  it("price↑ / OI↓ → MM short-covering, roasters trim longs (both negative)", () => {
    const f = estimateIntraweekFlow([day("2026-05-19", 1100, 100), day("2026-05-20", 1000, 105)], POS);
    expect(f.mmShortDelta).toBeLessThan(0);
    expect(f.roasterLotsDelta).toBeLessThan(0);
  });

  it("sub-deadband price moves contribute nothing", () => {
    const f = estimateIntraweekFlow([day("2026-05-19", 1000, 100), day("2026-05-20", 1100, 100.05)], POS);
    expect(f.mmLongDelta).toBe(0);
    expect(f.mmShortDelta).toBe(0);
    expect(f.othersDelta).toBe(0);
  });

  it("counterparty flow splits between industry and others by COT share", () => {
    const f = estimateIntraweekFlow([day("2026-05-19", 1000, 100), day("2026-05-20", 1100, 105)], POS);
    // prodShare = 0.5 here, so producers and 'others' each take half the short side.
    expect(f.producerLotsDelta).toBeCloseTo(f.othersDelta, 6);
  });
});

describe("confidenceTier", () => {
  it("maps |signal| to backtest-calibrated tiers", () => {
    expect(confidenceTier(NY_PARAMS.confHigh + 1, NY_PARAMS)).toBe("high");
    expect(confidenceTier(NY_PARAMS.confLow - 1, NY_PARAMS)).toBe("low");
    expect(confidenceTier((NY_PARAMS.confLow + NY_PARAMS.confHigh) / 2, NY_PARAMS)).toBe("medium");
  });
});
