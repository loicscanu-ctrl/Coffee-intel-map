import { describe, it, expect } from "vitest";
import { _computePoison } from "../poison";
import type { AgeDist } from "../age";

const FRESH: AgeDist = { fresh: 1, y1to2: 0, y2to3: 0, y3to4: 0, y4plus: 0 };
const AGED:  AgeDist = { fresh: 0.4, y1to2: 0.3, y2to3: 0.2, y3to4: 0.05, y4plus: 0.05 };

describe("_computePoison", () => {
  it("returns all-zero for empty stock", () => {
    expect(_computePoison(0, "KC", "ANT", { Brazil: 0 }, FRESH, 0).pct).toBe(0);
  });

  it("Arabica: Brazil origin + aged stock both count", () => {
    const p = _computePoison(1000, "KC", "ANT", { Brazil: 500, Colombia: 500 }, AGED, 0);
    expect(p.badOrigin).toBe(500);               // Brazil share × current
    expect(p.aged).toBeCloseTo(600, 5);          // (0.6 aged share) × 1000
    expect(p.deadPort).toBe(0);                  // KC has no dead-port rule
    expect(p.lowClass).toBe(0);
    expect(p.pct).toBeGreaterThan(0);
    expect(p.pct).toBeLessThanOrEqual(1);
  });

  it("Robusta dead port → 100% poison", () => {
    const p = _computePoison(1000, "RC", "LON", { Vietnam: 1000 }, FRESH, 0);
    expect(p.pct).toBe(1);
    expect(p.deadPort).toBe(1000);
    expect(p.total).toBe(1000);
  });

  it("Robusta: Conillon origin + class 3/4 share contribute", () => {
    const p = _computePoison(1000, "RC", "ANT", { "Brazilian Conillon": 400, Vietnam: 600 }, FRESH, 0.25);
    expect(p.badOrigin).toBe(400);
    expect(p.lowClass).toBe(250);   // 0.25 × 1000
    expect(p.pct).toBeGreaterThan(0);
    expect(p.pct).toBeLessThan(1);
  });
});
