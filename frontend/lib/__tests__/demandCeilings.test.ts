import { describe, it, expect } from "vitest";
import { K_CEILING, logisticIntensity } from "../demandCeilings";

describe("logisticIntensity", () => {
  it("starts exactly at i0 in the from-year", () => {
    const p = logisticIntensity(0.31, 0.08, 1.8, 2025, 2050);
    expect(p[2025]).toBe(0.31);
  });

  it("bends toward but never exceeds the ceiling K", () => {
    const p = logisticIntensity(0.31, 0.08, 1.8, 2025, 2050);
    for (let y = 2025; y <= 2050; y++) expect(p[y]).toBeLessThanOrEqual(1.8);
    // monotonically rising for positive g, and meaningfully above the start
    expect(p[2050]).toBeGreaterThan(p[2025]);
    expect(p[2050]).toBeGreaterThan(0.9);
  });

  it("grows at ~g while far below K (early slope matches the trend)", () => {
    const p = logisticIntensity(0.08, 0.06, 0.6, 2025, 2050);
    const firstStep = p[2026] / p[2025] - 1;
    // i0/K ≈ 0.13, so effective first-year growth ≈ g·(1−0.13)
    expect(firstStep).toBeGreaterThan(0.05);
    expect(firstStep).toBeLessThan(0.06);
  });

  it("stays near plateau when already close to K", () => {
    const p = logisticIntensity(8.21, 0.01, 9.0, 2025, 2050);
    expect(p[2050]).toBeLessThan(9.0);
    expect(p[2050] - p[2025]).toBeLessThan(0.5);
  });

  it("keeps declining markets bounded (negative g)", () => {
    const p = logisticIntensity(2.0, -0.01, 3.3, 2025, 2050);
    expect(p[2050]).toBeLessThan(p[2025]);
    expect(p[2050]).toBeGreaterThan(0);
  });

  it("falls back to plain compounding when no ceiling is defined", () => {
    const p = logisticIntensity(1.0, 0.1, 0, 2025, 2027);
    expect(p[2027]).toBeCloseTo(1.1 * 1.1, 5);
  });

  it("has a ceiling for every projection market", () => {
    for (const k of ["india", "china", "egypt", "indonesia", "turkey", "mexico",
      "russia", "ethiopia", "vietnam", "korea", "philippines", "brazil"]) {
      expect(K_CEILING[k]).toBeGreaterThan(0);
    }
  });
});
