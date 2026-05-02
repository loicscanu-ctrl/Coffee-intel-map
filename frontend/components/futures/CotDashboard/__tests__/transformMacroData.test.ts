import { describe, expect, it } from "vitest";
import type { MacroCotWeek } from "@/lib/api";
import { transformMacroData } from "../transformMacroData";


function mkWeek(commodities: Partial<MacroCotWeek["commodities"][number]>[], date = "2026-04-28"): MacroCotWeek {
  return {
    date,
    commodities: commodities.map(c => ({
      symbol: c.symbol ?? "x",
      sector: c.sector ?? "softs",
      name:   c.name   ?? "X",
      mm_long:  c.mm_long  ?? 0,
      mm_short: c.mm_short ?? 0,
      mm_spread: c.mm_spread ?? 0,
      oi_total:  c.oi_total  ?? 0,
      close_price:        c.close_price        ?? null,
      gross_exposure_usd: c.gross_exposure_usd ?? null,
      net_exposure_usd:   c.net_exposure_usd   ?? null,
    } as MacroCotWeek["commodities"][number])),
  };
}


describe("transformMacroData", () => {
  it("returns an empty array when given no weeks", () => {
    expect(transformMacroData([], "gross")).toEqual([]);
  });

  it("filters out weeks where every sector is zero", () => {
    const out = transformMacroData([mkWeek([])], "gross");
    expect(out).toEqual([]);
  });

  it("aggregates by sector and converts to billions", () => {
    const week = mkWeek([
      { symbol: "arabica", sector: "softs", gross_exposure_usd: 5e9, net_exposure_usd: 1e9 },
      { symbol: "corn",    sector: "grains", gross_exposure_usd: 8e9, net_exposure_usd: 2e9 },
      { symbol: "live_cattle", sector: "meats", gross_exposure_usd: 3e9, net_exposure_usd: 1e9 },
    ]);
    const out = transformMacroData([week], "gross");
    expect(out).toHaveLength(1);
    expect(out[0].softs).toBe(5);
    expect(out[0].grains).toBe(8);
    expect(out[0].meats).toBe(3);
  });

  it("splits the 'hard' sector into energy vs metals via ENERGY_SYMBOLS", () => {
    const week = mkWeek([
      { symbol: "wti",    sector: "hard", gross_exposure_usd: 10e9, net_exposure_usd: 1e9 },
      { symbol: "gold",   sector: "hard", gross_exposure_usd:  4e9, net_exposure_usd: 1e9 },
      { symbol: "natgas", sector: "hard", gross_exposure_usd:  6e9, net_exposure_usd: 1e9 },
    ]);
    const out = transformMacroData([week], "gross");
    expect(out[0].energy).toBe(10 + 6); // wti + natgas
    expect(out[0].metals).toBe(4);      // gold
  });

  it("uses net values in net mode", () => {
    const week = mkWeek([
      { symbol: "arabica", sector: "softs", gross_exposure_usd: 5e9, net_exposure_usd: -2e9 },
    ]);
    expect(transformMacroData([week], "net")[0].softs).toBe(-2);
  });

  it("computes (g+n)/2 for gross_long and (g-n)/2 for gross_short", () => {
    const week = mkWeek([
      { symbol: "arabica", sector: "softs", gross_exposure_usd: 10e9, net_exposure_usd: 4e9 },
    ]);
    const longOut  = transformMacroData([week], "gross_long");
    const shortOut = transformMacroData([week], "gross_short");
    expect(longOut[0].softs).toBe(7);   // (10 + 4) / 2
    expect(shortOut[0].softs).toBe(3);  // (10 - 4) / 2
  });

  it("skips a commodity when the chosen value is null", () => {
    const week = mkWeek([
      { symbol: "arabica", sector: "softs", gross_exposure_usd: null, net_exposure_usd: null },
      { symbol: "corn",    sector: "grains", gross_exposure_usd: 8e9, net_exposure_usd: 1e9 },
    ]);
    const out = transformMacroData([week], "gross");
    expect(out[0].softs).toBe(0);
    expect(out[0].grains).toBe(8);
  });

  it("computes coffee's share of total gross exposure", () => {
    const week = mkWeek([
      { symbol: "arabica", sector: "softs", gross_exposure_usd: 5e9, net_exposure_usd: 1e9 },
      { symbol: "robusta", sector: "softs", gross_exposure_usd: 3e9, net_exposure_usd: 1e9 },
      { symbol: "corn",    sector: "grains", gross_exposure_usd: 16e9, net_exposure_usd: 2e9 },
    ]);
    const out = transformMacroData([week], "gross");
    // (5 + 3) / (5 + 3 + 16) * 100 = 33.33...
    expect(out[0].coffeeShare).toBeCloseTo(33.33, 1);
  });

  it("computes coffeeShare from whichever coffee variant has data", () => {
    // NOTE locks current behavior: the early `continue` when val==null
    // means a null arabica is skipped entirely (not flagged as missing),
    // so the share is calculated from robusta alone. Possibly a bug worth
    // revisiting, but locking it here keeps refactors safe.
    const week = mkWeek([
      { symbol: "arabica", sector: "softs", gross_exposure_usd: null, net_exposure_usd: null },
      { symbol: "robusta", sector: "softs", gross_exposure_usd: 3e9,  net_exposure_usd: 1e9 },
    ]);
    expect(transformMacroData([week], "gross")[0].coffeeShare).toBe(100);
  });

  it("returns null coffeeShare when total gross is zero", () => {
    const week = mkWeek([
      { symbol: "corn", sector: "grains", gross_exposure_usd: 0, net_exposure_usd: 0 },
    ]);
    // Empty after filter, so the row is dropped entirely
    expect(transformMacroData([week], "gross")).toEqual([]);
  });

  it("preserves the date key", () => {
    const week = mkWeek([
      { symbol: "arabica", sector: "softs", gross_exposure_usd: 5e9, net_exposure_usd: 1e9 },
    ], "2026-04-21");
    expect(transformMacroData([week], "gross")[0].date).toBe("2026-04-21");
  });
});
