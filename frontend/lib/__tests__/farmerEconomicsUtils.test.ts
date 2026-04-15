import { describe, it, expect } from "vitest";
import {
  computeRmse,
  oniToDots,
  fertCostDelta,
  netFertImpact,
} from "../../components/supply/farmer-economics/farmerEconomicsUtils";
import type { FertilizerItem } from "../../components/supply/farmer-economics/farmerEconomicsData";

describe("computeRmse", () => {
  it("returns 0 for empty array", () => {
    expect(computeRmse([])).toBe(0);
  });
  it("returns 0 when forecast equals actual", () => {
    expect(computeRmse([{ date: "d", forecast_c: 5, actual_c: 5 }])).toBe(0);
  });
  it("computes correctly for a single point", () => {
    // error = 2, RMSE = 2
    expect(computeRmse([{ date: "d", forecast_c: 7, actual_c: 5 }])).toBe(2);
  });
  it("computes correctly for multiple points", () => {
    // errors: 1, 1 → RMSE = 1
    expect(computeRmse([
      { date: "d1", forecast_c: 6, actual_c: 5 },
      { date: "d2", forecast_c: 4, actual_c: 5 },
    ])).toBe(1);
  });
});

describe("oniToDots", () => {
  it("returns 1 for ONI 0.5–1.0", () => {
    expect(oniToDots(0.6)).toBe(1);
    expect(oniToDots(1.0)).toBe(1);
  });
  it("returns 2 for ONI 1.0–1.5", () => {
    expect(oniToDots(1.1)).toBe(2);
    expect(oniToDots(1.5)).toBe(2);
  });
  it("returns 3 for ONI 1.5–2.0", () => {
    expect(oniToDots(1.6)).toBe(3);
    expect(oniToDots(2.0)).toBe(3);
  });
  it("returns 4 for ONI > 2.0", () => {
    expect(oniToDots(2.1)).toBe(4);
    expect(oniToDots(3.0)).toBe(4);
  });
  it("works for negative ONI (La Niña)", () => {
    expect(oniToDots(-1.4)).toBe(2);
  });
});

describe("fertCostDelta", () => {
  const item: FertilizerItem = {
    name: "Test", price_usd_mt: 300, mom_pct: 10,
    sparkline: [], input_weight: 0.35, base_usd_per_bag: 18.9,
  };
  it("returns positive delta when price rose", () => {
    expect(fertCostDelta(item)).toBeCloseTo(1.9, 1);
  });
  it("returns negative delta when price fell", () => {
    expect(fertCostDelta({ ...item, mom_pct: -5.4, base_usd_per_bag: 13.5 })).toBeCloseTo(-0.7, 1);
  });
});

describe("netFertImpact", () => {
  it("sums deltas across items", () => {
    const items: FertilizerItem[] = [
      { name: "A", price_usd_mt: 0, mom_pct: 10, sparkline: [], input_weight: 0.35, base_usd_per_bag: 10 },
      { name: "B", price_usd_mt: 0, mom_pct: -5, sparkline: [], input_weight: 0.20, base_usd_per_bag: 10 },
    ];
    // A: +1.0, B: -0.5 → net +0.5
    expect(netFertImpact(items)).toBeCloseTo(0.5, 1);
  });
});
