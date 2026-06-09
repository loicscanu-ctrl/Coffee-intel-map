import { describe, it, expect } from "vitest";
import { _fmtUnit, unitWord } from "../units";

describe("_fmtUnit — contract-correct lot sizes", () => {
  it("Arabica (native bags): 1 lot = 17.009 MT = 283.49 bags", () => {
    // 283.49 bags should read as ~1 lot and ~17 tonnes, not 1.7 lots.
    expect(_fmtUnit(283.49, "bags", "lots")).toBe("1");
    expect(_fmtUnit(283.49, "bags", "tonnes")).toBe("17");
    // A round 1,000 bags = 60 MT = ~3.5 KC lots (1000 / 283.49).
    expect(_fmtUnit(1000, "bags", "lots")).toBe("3.5");
    expect(_fmtUnit(1000, "bags", "bags")).toBe("1,000");
  });

  it("Robusta (native lots): 1 lot = 10 MT = 166.67 bags", () => {
    expect(_fmtUnit(1, "lots", "tonnes")).toBe("10");
    expect(_fmtUnit(1, "lots", "bags")).toBe("167");
    expect(_fmtUnit(100, "lots", "lots")).toBe("100");
  });

  it("unitWord labels", () => {
    expect([unitWord("bags"), unitWord("tonnes"), unitWord("lots")]).toEqual(["bags", "t", "lots"]);
  });
});
