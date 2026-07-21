import { describe, expect, it } from "vitest";
import type { MacroCotEntry, MacroCotWeek } from "@/lib/api";
import { buildGlobalFlowMetrics } from "../dataHelpers";

function entry(partial: Partial<MacroCotEntry> & { symbol: string }): MacroCotEntry {
  const mm_long = partial.mm_long ?? 100_000;
  const mm_short = partial.mm_short ?? 50_000;
  const price = partial.close_price === undefined ? 70 : partial.close_price;
  // Gross/net derived the same way the exporter does (price × contract unit
  // omitted — tests only need internally consistent magnitudes, so unit = 1).
  return {
    sector: "hard",
    name: partial.symbol,
    mm_spread: 0,
    oi_total: 1_000_000,
    initial_margin_usd: null,
    gross_exposure_usd: price == null ? null : (mm_long + mm_short) * price,
    net_exposure_usd: price == null ? null : (mm_long - mm_short) * price,
    ...partial,
    mm_long,
    mm_short,
    close_price: price,
  };
}

function week(date: string, entries: MacroCotEntry[]): MacroCotWeek {
  return { date, commodities: entries };
}

// 4 weeks of WTI with a steadily rising price and OI.
const WEEKS: MacroCotWeek[] = [
  week("2026-06-23", [entry({ symbol: "wti", close_price: 60, oi_total: 900_000 })]),
  week("2026-06-30", [entry({ symbol: "wti", close_price: 64, oi_total: 950_000 })]),
  week("2026-07-07", [entry({ symbol: "wti", close_price: 68, oi_total: 980_000 })]),
  week("2026-07-14", [entry({ symbol: "wti", close_price: 72, oi_total: 1_000_000 })]),
];

describe("buildGlobalFlowMetrics — comparison window", () => {
  it("defaults to week-over-week (1W)", () => {
    const gfm = buildGlobalFlowMetrics(WEEKS)!;
    expect(gfm.windowWeeks).toBe(1);
    expect(gfm.prevDate).toBe("2026-07-07");
    const wti = gfm.commodityTable[0];
    expect(wti.priceDeltaPct).toBeCloseTo(((72 - 68) / 68) * 100, 5);
    expect(wti.oiDeltaPct).toBeCloseTo(((1_000_000 - 980_000) / 980_000) * 100, 5);
  });

  it("compares against N weeks back when windowWeeks is set", () => {
    const gfm = buildGlobalFlowMetrics(WEEKS, 3)!;
    expect(gfm.windowWeeks).toBe(3);
    expect(gfm.prevDate).toBe("2026-06-23");
    const wti = gfm.commodityTable[0];
    expect(wti.priceDeltaPct).toBeCloseTo(((72 - 60) / 60) * 100, 5);
    // Gross delta spans the full window too: 150k lots × (72 − 60) = $1.8M → $B
    expect(wti.deltaB).toBeCloseTo((150_000 * 72 - 150_000 * 60) / 1e9, 9);
  });

  it("clamps a window longer than the history to the oldest week", () => {
    const gfm = buildGlobalFlowMetrics(WEEKS, 52)!;
    expect(gfm.prevDate).toBe("2026-06-23");
  });
});

describe("buildGlobalFlowMetrics — price outlier flag", () => {
  it("flags a >±50% one-week price jump (the 2026-07-14 corruption signature)", () => {
    const weeks = [
      week("2026-07-07", [entry({ symbol: "gold", close_price: 4116 })]),
      week("2026-07-14", [entry({ symbol: "gold", close_price: 4.01 })]),
    ];
    const gfm = buildGlobalFlowMetrics(weeks)!;
    expect(gfm.commodityTable[0].priceOutlier).toBe(true);
  });

  it("does not flag normal weekly moves", () => {
    const gfm = buildGlobalFlowMetrics(WEEKS)!;
    expect(gfm.commodityTable[0].priceOutlier).toBe(false);
  });

  it("stays a WEEKLY check even when a long window shows a large legit move", () => {
    // +100% over 3 weeks via ~26%/wk steps — big over the window, normal weekly.
    const weeks = [
      week("2026-06-23", [entry({ symbol: "wti", close_price: 40 })]),
      week("2026-06-30", [entry({ symbol: "wti", close_price: 50 })]),
      week("2026-07-07", [entry({ symbol: "wti", close_price: 64 })]),
      week("2026-07-14", [entry({ symbol: "wti", close_price: 80 })]),
    ];
    const gfm = buildGlobalFlowMetrics(weeks, 3)!;
    expect(gfm.commodityTable[0].priceDeltaPct).toBeCloseTo(100, 5);
    expect(gfm.commodityTable[0].priceOutlier).toBe(false);
  });

  it("handles missing prices without flagging", () => {
    const weeks = [
      week("2026-07-07", [entry({ symbol: "lumber", close_price: null })]),
      week("2026-07-14", [entry({ symbol: "lumber", close_price: null })]),
    ];
    const gfm = buildGlobalFlowMetrics(weeks)!;
    const row = gfm.commodityTable[0];
    expect(row.priceOutlier).toBe(false);
    expect(row.priceDeltaPct).toBeNull();
    expect(row.closePrice).toBeNull();
  });
});
