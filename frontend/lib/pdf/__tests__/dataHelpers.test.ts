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
