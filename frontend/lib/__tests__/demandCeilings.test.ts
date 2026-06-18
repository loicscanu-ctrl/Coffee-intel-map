import { describe, it, expect } from "vitest";
import {
  K_CEILING, K_BASE, logisticIntensity, ceilingK, demographicFactor,
  isDemographicallyDiscounted,
} from "../demandCeilings";

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

describe("demographicFactor", () => {
  it("is 1.0 at or below median age 30", () => {
    expect(demographicFactor(30)).toBe(1);
    expect(demographicFactor(22)).toBe(1);
  });
  it("is 0.6 at or above median age 42", () => {
    expect(demographicFactor(42)).toBe(0.6);
    expect(demographicFactor(50)).toBe(0.6);
  });
  it("interpolates linearly in between (China ~41 → ~0.63)", () => {
    expect(demographicFactor(41)).toBeCloseTo(0.633, 2);
    expect(demographicFactor(36)).toBeCloseTo(0.8, 2);
  });
});

describe("ceilingK", () => {
  it("applies the live median-age discount for analog markets", () => {
    // base 2.84 × factor(41)=0.633 ≈ 1.8 (reproduces the published K)
    expect(ceilingK("china")).toBeCloseTo(1.8, 1);
    expect(ceilingK("russia")).toBeCloseTo(3.3, 1);
  });
  it("returns base unchanged for self/plateau markets", () => {
    expect(ceilingK("brazil")).toBe(K_BASE.brazil.base);
    expect(ceilingK("korea")).toBe(K_BASE.korea.base);
  });
  it("raises an analog market's K when the population is younger", () => {
    const baseline = ceilingK("china");                 // fallback median 41
    const younger = ceilingK("china", 30);              // hypothetically young
    expect(younger).toBeGreaterThan(baseline);
    expect(younger).toBeCloseTo(K_BASE.china.base, 5);  // factor 1.0 → full base
  });
  it("ignores median age for self markets", () => {
    expect(ceilingK("brazil", 25)).toBe(K_BASE.brazil.base);
  });
  it("returns NaN for unknown markets", () => {
    expect(Number.isNaN(ceilingK("atlantis"))).toBe(true);
  });
});

describe("isDemographicallyDiscounted", () => {
  it("flags analog-anchored markets only", () => {
    expect(isDemographicallyDiscounted("china")).toBe(true);
    expect(isDemographicallyDiscounted("russia")).toBe(true);
    expect(isDemographicallyDiscounted("brazil")).toBe(false);
    expect(isDemographicallyDiscounted("korea")).toBe(false);
  });
});
