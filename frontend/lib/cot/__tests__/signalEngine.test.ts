import { describe, it, expect } from "vitest";

import {
  dir,
  dirCount,
  pct52,
  isHigh,
  isLow,
  evaluateSignals,
  evaluateHistoricalSignals,
  computeCompositeScores,
  __THRESHOLDS as THRESHOLDS,
} from "../signalEngine";
import type {
  ProcessedCotRow,
  CotMarketPositions,
  CotTradersGroup,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────────────

interface MarketSeed {
  pmpuShort?: number;
  pmpuLong?:  number;
  pmpuSpread?: number;
  swapLong?:  number;  swapShort?: number;  swapSpread?: number;
  mmLong?:    number;  mmShort?:   number;  mmSpread?:   number;
  otherLong?: number;  otherShort?: number; otherSpread?: number;
  nonRepLong?: number; nonRepShort?: number; nonRepSpread?: number;
}

interface TradersSeed {
  pmpu?: number;
  mm?:   number;
  swap?: number;
  other?: number;
  nonrep?: number;
}

interface RowSeed {
  date?:     string;
  priceNY?:  number;
  priceLDN?: number;
  ny?:       MarketSeed;
  ldn?:      MarketSeed;
  tradersNY?:        TradersSeed;
  tradersNY_short?:  TradersSeed | null;   // null = explicitly drop the property
  tradersLDN?:       TradersSeed;
  tradersLDN_short?: TradersSeed | null;
  structureNY?:  number | null;
  structureLDN?: number | null;
}

const NEUTRAL_MARKET: Required<MarketSeed> = {
  pmpuShort: 200, pmpuLong: 60, pmpuSpread: 0,
  swapLong: 50,   swapShort: 30, swapSpread: 5,
  mmLong: 80,     mmShort: 50,   mmSpread: 30,
  otherLong: 20,  otherShort: 15, otherSpread: 10,
  nonRepLong: 10, nonRepShort: 8, nonRepSpread: 2,
};

const NEUTRAL_TRADERS: Required<TradersSeed> = {
  pmpu: 15, mm: 35, swap: 12, other: 8, nonrep: 5,
};

const NEUTRAL_TRADERS_SHORT: Required<TradersSeed> = {
  pmpu: 10, mm: 25, swap: 8, other: 6, nonrep: 4,
};

function pos(seed: MarketSeed = {}): CotMarketPositions {
  return { ...NEUTRAL_MARKET, ...seed };
}

function tg(seed: TradersSeed = {}, defaults = NEUTRAL_TRADERS): CotTradersGroup {
  return { ...defaults, ...seed };
}

function makeRow(idx: number, seed: RowSeed = {}): ProcessedCotRow {
  const ny  = pos(seed.ny);
  const ldn = pos(seed.ldn);
  const date = seed.date ?? `2026-01-${String((idx % 28) + 1).padStart(2, "0")}`;
  const row: ProcessedCotRow = {
    id: idx,
    date,
    priceNY:  seed.priceNY  ?? 200,
    priceLDN: seed.priceLDN ?? 2500,
    avgPrice_USD_Ton: 4500,
    oiNY: 200_000, oiLDN: 120_000, totalOI: 320_000,
    spreadingTotal: 50_000, outrightTotal: 270_000,
    weeklyNominalFlow: 0, weeklyMarginFlow: 0,
    cumulativeNominal: 0, cumulativeMargin: 0,
    ny, ldn,
    tradersNY:  tg(seed.tradersNY,  NEUTRAL_TRADERS),
    tradersLDN: tg(seed.tradersLDN, NEUTRAL_TRADERS),
    pmpuShortMT_NY: ny.pmpuShort * 0.375,
    pmpuShortMT_LDN: ldn.pmpuShort * 0.1,
    pmpuShortMT: ny.pmpuShort * 0.375 + ldn.pmpuShort * 0.1,
    pmpuLongMT_NY: ny.pmpuLong * 0.375,
    pmpuLongMT_LDN: ldn.pmpuLong * 0.1,
    pmpuLongMT: ny.pmpuLong * 0.375 + ldn.pmpuLong * 0.1,
    efpMT: 0,
    timeframe: "historical",
    priceRank: 0.5, oiRank: 0.5, priceRankLDN: 0.5, oiRankLDN: 0.5,
  };
  if (seed.tradersNY_short !== null) {
    row.tradersNY_short = tg(seed.tradersNY_short ?? {}, NEUTRAL_TRADERS_SHORT);
  }
  if (seed.tradersLDN_short !== null) {
    row.tradersLDN_short = tg(seed.tradersLDN_short ?? {}, NEUTRAL_TRADERS_SHORT);
  }
  if (seed.structureNY !== undefined || seed.structureLDN !== undefined) {
    row.rawNy  = { structure_ny: seed.structureNY ?? null };
    row.rawLdn = { structure_ldn: seed.structureLDN ?? null };
  }
  return row;
}

/**
 * Builds a 52-week history; `tail` overrides the last N entries.
 * Head rows carry a sine-wave variance so 52-week percentile calcs are
 * non-trivial — without it, every tail value would be either the new max
 * (pct=1) or new min (pct=0) and `isHigh`/`isLow` would fire on every rule.
 */
function buildHistory(tail: RowSeed[]): ProcessedCotRow[] {
  const n = 52;
  const rows: ProcessedCotRow[] = [];
  const head = n - tail.length;
  for (let i = 0; i < head; i++) {
    const t = (Math.sin((i / 12) * Math.PI * 2) + 1) / 2; // 0..1
    const vary: MarketSeed = {
      pmpuShort: 150 + t * 100,  // 150..250
      pmpuLong:  40  + t * 40,   // 40..80
      mmLong:    50  + t * 60,   // 50..110
      mmShort:   30  + t * 40,   // 30..70
    };
    rows.push(makeRow(i, {
      ny:  vary,
      ldn: vary,
      priceNY:  180  + t * 60,
      priceLDN: 2400 + t * 200,
    }));
  }
  for (let i = 0; i < tail.length; i++) rows.push(makeRow(head + i, tail[i]));
  return rows;
}

const idsFor = (signals: { market: string; id: string }[], market: "NY" | "LDN") =>
  new Set(signals.filter((s) => s.market === market).map((s) => s.id));

// ─────────────────────────────────────────────────────────────────────────────
// 1. Helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("dir", () => {
  it("returns 'up' when curr is more than 1% above prev", () => {
    expect(dir(100, 102)).toBe("up");
    expect(dir(100, 101.01)).toBe("up");
  });

  it("returns 'down' when curr is more than 1% below prev", () => {
    expect(dir(100, 98)).toBe("down");
    expect(dir(100, 98.99)).toBe("down");
  });

  it("returns 'flat' when change is within ±1%", () => {
    expect(dir(100, 100)).toBe("flat");
    expect(dir(100, 100.5)).toBe("flat");
    expect(dir(100, 99.5)).toBe("flat");
  });

  it("uses |prev| || 1 to avoid division-by-zero", () => {
    expect(dir(0, 0.005)).toBe("flat");
    expect(dir(0, 0.02)).toBe("up");
    expect(dir(0, -0.02)).toBe("down");
  });
});

describe("dirCount", () => {
  it("uses an absolute flat band (default 2 traders)", () => {
    expect(dirCount(30, 31)).toBe("flat");
    expect(dirCount(30, 32)).toBe("up");
    expect(dirCount(30, 28)).toBe("down");
  });

  it("returns 'unknown' when either endpoint is null", () => {
    expect(dirCount(null, 30)).toBe("unknown");
    expect(dirCount(30, null)).toBe("unknown");
    expect(dirCount(null, null)).toBe("unknown");
  });

  it("accepts a custom flat threshold", () => {
    expect(dirCount(30, 33, 5)).toBe("flat");
    expect(dirCount(30, 36, 5)).toBe("up");
  });
});

describe("pct52", () => {
  it("returns 1 at the max of the window", () => {
    const series = Array.from({ length: 52 }, (_, i) => i); // monotonic
    expect(pct52(series, 51)).toBe(1);
  });

  it("returns 0 at the min of the window", () => {
    const series = [...Array(51).fill(100), 50]; // current = window min
    expect(pct52(series, 51)).toBe(0);
  });

  it("returns 0.5 fallback for a flat window", () => {
    const flat = Array(52).fill(100);
    expect(pct52(flat, 51)).toBe(0.5);
    // Single-element window (idx=0) has min == max → fallback applies
    expect(pct52([42], 0)).toBe(0.5);
  });

  it("uses a rolling 52-week window", () => {
    const series = Array.from({ length: 104 }, (_, i) => i);
    // idx 103 → window is [52..103]; current=103, min=52, max=103 → pct=1.0
    expect(pct52(series, 103)).toBe(1);
  });

  it("isHigh / isLow gate at the THRESHOLDS values", () => {
    expect(THRESHOLDS.PCT_HIGH).toBe(0.75);
    expect(THRESHOLDS.PCT_LOW).toBe(0.25);
    // Build a non-monotonic series so windowed min/max are well-defined.
    const high = [0, 100, ...Array(49).fill(50), 80]; // window: min=0 max=100 curr=80 → 0.80
    expect(isHigh(high, high.length - 1)).toBe(true);
    expect(isLow(high,  high.length - 1)).toBe(false);

    const low = [0, 100, ...Array(49).fill(50), 20]; // pct = (20-0)/(100-0) = 0.20
    expect(isLow(low,  low.length - 1)).toBe(true);
    expect(isHigh(low, low.length - 1)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. evaluateSignals — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateSignals — edge cases", () => {
  it("returns [] when fewer than 2 rows", () => {
    expect(evaluateSignals([])).toEqual([]);
    expect(evaluateSignals([makeRow(0)])).toEqual([]);
  });

  it("never emits duplicate (market, id) tuples in a single week", () => {
    const rows = buildHistory([
      { ny: { pmpuShort: 180, pmpuLong: 70, mmLong: 90, mmShort: 40 }, priceNY: 210 },
    ]);
    const signals = evaluateSignals(rows);
    const seen = new Set<string>();
    for (const s of signals) {
      const key = `${s.market}:${s.id}`;
      expect(seen.has(key), `duplicate signal ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Golden scenarios — assert rule presence and composite sign
// ─────────────────────────────────────────────────────────────────────────────

describe("classic bullish flow (NY)", () => {
  // pmpuShort falls (producers de-hedging), pmpuLong rises (roasters covering),
  // mmLong rises (funds buying), price rises.
  const rows = buildHistory([
    { ny: { pmpuShort: 200, pmpuLong: 60, mmLong: 80, mmShort: 50 }, priceNY: 200 },
    { ny: { pmpuShort: 180, pmpuLong: 66, mmLong: 88, mmShort: 50 }, priceNY: 210 },
  ]);
  const signals = evaluateSignals(rows);
  const ny = idsFor(signals, "NY");
  const { scoreNY } = computeCompositeScores(signals);

  it("fires CP3 Bullish De-hedging", () => { expect(ny.has("CP3")).toBe(true); });
  it("fires CR2 Forced Coverage",   () => { expect(ny.has("CR2")).toBe(true); });
  it("fires CI1 Commercial Convergence Bullish", () => { expect(ny.has("CI1")).toBe(true); });
  it("fires ML1 Fund Bullish Entry", () => { expect(ny.has("ML1")).toBe(true); });
  it("composite is positive", () => { expect(scoreNY).toBeGreaterThan(0); });
});

describe("classic bearish flow (NY)", () => {
  const rows = buildHistory([
    { ny: { pmpuShort: 200, pmpuLong: 60, mmLong: 80, mmShort: 50 }, priceNY: 200 },
    { ny: { pmpuShort: 220, pmpuLong: 54, mmLong: 80, mmShort: 58 }, priceNY: 190 },
  ]);
  const signals = evaluateSignals(rows);
  const ny = idsFor(signals, "NY");
  const { scoreNY } = computeCompositeScores(signals);

  it("fires CP2 Forced Liquidation",  () => { expect(ny.has("CP2")).toBe(true); });
  it("fires CR3 Coverage Reduction",  () => { expect(ny.has("CR3")).toBe(true); });
  it("fires CI2 Commercial Convergence Bearish", () => { expect(ny.has("CI2")).toBe(true); });
  it("fires MS1 Fund Bearish Entry",  () => { expect(ny.has("MS1")).toBe(true); });
  it("composite is negative",         () => { expect(scoreNY).toBeLessThan(0); });
});

describe("commercial vacuum (NY)", () => {
  // Producers and roasters both flat WoW → CI4 fires with severity 'alert', score 0.
  const rows = buildHistory([
    { ny: { pmpuShort: 200, pmpuLong: 60 }, priceNY: 200 },
    { ny: { pmpuShort: 200, pmpuLong: 60 }, priceNY: 200 },
  ]);
  const signals = evaluateSignals(rows);
  const ci4 = signals.find((s) => s.id === "CI4" && s.market === "NY");

  it("fires CI4 with severity 'alert' and score 0", () => {
    expect(ci4).toBeDefined();
    expect(ci4?.severity).toBe("alert");
    expect(ci4?.score).toBe(0);
  });
});

describe("LDN with null short-side trader counts", () => {
  // Robusta scenario: tradersLDN_short is missing on every row.
  // Set up conditions that WOULD trigger MS7 / TC1 / TC2 / CP7 on LDN if
  // short-count direction were known; assert they don't fire.
  const rows = buildHistory(
    Array.from({ length: 52 }, (_, i) => {
      const base: RowSeed = {
        ldn: { pmpuShort: 200 - i, pmpuLong: 60 + i, mmLong: 80 + i, mmShort: 60 - i },
        priceLDN: 2500 + i * 10,
        tradersLDN_short: null,
      };
      return base;
    }),
  );
  const signals = evaluateSignals(rows);
  const ldn = idsFor(signals, "LDN");

  it("does not fire CP7 (producer concentration) on LDN", () => {
    expect(ldn.has("CP7")).toBe(false);
  });
  it("does not fire MS7 (short concentration) on LDN", () => {
    expect(ldn.has("MS7")).toBe(false);
  });
  it("does not fire TC1 or TC2 (trader concentration) on LDN", () => {
    expect(ldn.has("TC1")).toBe(false);
    expect(ldn.has("TC2")).toBe(false);
  });
});

describe("NY with present short-side trader counts", () => {
  // Same directional setup as the LDN-null test, but on NY with non-null
  // short counts that fall WoW → CP7 fires.
  const rows = buildHistory([
    {
      ny: { pmpuShort: 200 },
      tradersNY_short: { pmpu: 12 },
    },
    {
      ny: { pmpuShort: 220 },
      tradersNY_short: { pmpu: 8 },  // 4-trader drop, beyond DIR_FLAT_COUNT=2
      priceNY: 195,                  // price-down so CP rules sample correctly
    },
  ]);
  const signals = evaluateSignals(rows);
  const ny = idsFor(signals, "NY");

  it("fires CP7 when producer short count falls > DIR_FLAT_COUNT", () => {
    expect(ny.has("CP7")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. evaluateHistoricalSignals — invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateHistoricalSignals", () => {
  // Build 60 rows so we have 8 weeks of history plus 52-week percentile depth.
  const rows: ProcessedCotRow[] = [];
  for (let i = 0; i < 60; i++) {
    rows.push(makeRow(i, {
      ny: { pmpuShort: 200 - (i % 7), pmpuLong: 60 + (i % 5), mmLong: 80 + (i % 3) },
      priceNY: 200 + (i % 9),
    }));
  }

  it("returns weeks+1 entries for a `weeks` request (current engine behavior)", () => {
    // KNOWN QUIRK: the loop runs `for (end = max(1, n-weeks); end <= n; end++)`,
    // which yields weeks+1 iterations when n > weeks. Locking that as-is so
    // changes to the historical-eval contract are deliberate.
    const weeks = evaluateHistoricalSignals(rows, 8);
    expect(weeks).toHaveLength(9);
  });

  it("clamps composite scores into [-10, 10]", () => {
    const weeks = evaluateHistoricalSignals(rows, 8);
    for (const w of weeks) {
      expect(w.scoreNY).toBeGreaterThanOrEqual(-10);
      expect(w.scoreNY).toBeLessThanOrEqual(10);
      expect(w.scoreLDN).toBeGreaterThanOrEqual(-10);
      expect(w.scoreLDN).toBeLessThanOrEqual(10);
    }
  });

  it("does not look-ahead — each week's signals depend only on rows up to that week", () => {
    const weeks = evaluateHistoricalSignals(rows, 8);
    // Re-evaluating the engine on rows[0..endIndex] should produce the same
    // signals as evaluateHistoricalSignals reports for that week.
    for (let w = 0; w < weeks.length; w++) {
      const endIdx = rows.length - weeks.length + w + 1;
      const sliced = rows.slice(0, endIdx);
      const directIds = new Set(evaluateSignals(sliced).map((s) => `${s.market}:${s.id}`));
      const reportedIds = new Set(weeks[w].signals.map((s) => `${s.market}:${s.id}`));
      expect(reportedIds).toEqual(directIds);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THRESHOLDS sanity (post PR-A tightening)
// ─────────────────────────────────────────────────────────────────────────────

describe("SignalLink wiring", () => {
  it("attaches links to rules with deep-link targets", () => {
    // ML3 fires on ml=up + pr=down with !isHigh — set up that exact state.
    const rows = buildHistory([
      { ny: { mmLong: 80 }, priceNY: 200 },
      { ny: { mmLong: 86 }, priceNY: 190 },  // ml↑, pr↓
    ]);
    const ml3 = evaluateSignals(rows).find((s) => s.id === "ML3" && s.market === "NY");
    expect(ml3).toBeDefined();
    expect(ml3?.links).toBeDefined();
    expect(ml3!.links!.length).toBeGreaterThan(0);
    expect(ml3!.links![0].href.startsWith("#cot-section-")).toBe(true);
  });
});

describe("THRESHOLDS", () => {
  it("OB_HIGH and OB_LOW align with PCT_HIGH and PCT_LOW (in percent units)", () => {
    expect(THRESHOLDS.OB_HIGH).toBe(THRESHOLDS.PCT_HIGH * 100);
    expect(THRESHOLDS.OB_LOW).toBe(THRESHOLDS.PCT_LOW  * 100);
  });

  it("DIR_FLAT_PCT is 1% and DIR_FLAT_COUNT is 2 traders", () => {
    expect(THRESHOLDS.DIR_FLAT_PCT).toBe(0.01);
    expect(THRESHOLDS.DIR_FLAT_COUNT).toBe(2);
  });
});
