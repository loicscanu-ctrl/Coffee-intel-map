/**
 * Regression test for the Robusta "+0.0 k" bug (issue #132 Body-7).
 *
 * The user verified manually from raw OI numbers that the front-two
 * contract sum changed by +731 lots between the 2026-05-19 prior COT
 * and the 2026-05-26 COT release, but the dashboard rendered "+0.0 k
 * lots". Root cause was dataHelpers.ts pulling a single deprecated
 * `exch_oi_ldn` field; this module re-derives the delta from
 * per-contract OI history correctly.
 */
import { describe, expect, it } from "vitest";

import type { OiDay } from "../intraweekModel";
import { frontTwoSymbols, nearbyOiDelta } from "../oiNearby";


// ── Fixture matching the issue's verified Robusta numbers ────────────────────
// Week prior: N = 77,013 + U = 50,815 → 127,828
// COT week  : N = 73,995 + U = 54,564 → 128,559
// True nearby delta = +731 lots.
const ROBUSTA_HISTORY: OiDay[] = [
  {
    date: "2026-05-26",
    contracts: [
      { symbol: "RMN26", oi: 73_995, last_price: 3519 },
      { symbol: "RMU26", oi: 54_564, last_price: 3377 },
      { symbol: "RMX26", oi: 11_880, last_price: 3294 },
      { symbol: "RMF27", oi:  5_976, last_price: 3222 },
      { symbol: "RMH27", oi:  2_293, last_price: 3180 },
      // Note: RMX27 has 0 OI — must be filtered by frontTwoSymbols.
      { symbol: "RMX27", oi:      0, last_price:    0 },
    ],
  },
  {
    date: "2026-05-19",
    contracts: [
      { symbol: "RMN26", oi: 77_013, last_price: 3345 },
      { symbol: "RMU26", oi: 50_815, last_price: 3208 },
      { symbol: "RMX26", oi: 11_366, last_price: 3136 },
      { symbol: "RMF27", oi:  6_031, last_price: 3074 },
      { symbol: "RMH27", oi:  2_175, last_price: 3043 },
    ],
  },
];


describe("frontTwoSymbols", () => {
  it("returns the two earliest contracts with non-zero OI", () => {
    expect(frontTwoSymbols(ROBUSTA_HISTORY[0])).toEqual(["RMN26", "RMU26"]);
  });

  it("skips zero-OI placeholder rows", () => {
    const day: OiDay = {
      date: "2026-01-01",
      contracts: [
        { symbol: "RMN26", oi: 0, last_price: 3000 },         // expired/empty
        { symbol: "RMU26", oi: 10_000, last_price: 3000 },
        { symbol: "RMX26", oi: 5_000, last_price: 3000 },
      ],
    };
    expect(frontTwoSymbols(day)).toEqual(["RMU26", "RMX26"]);
  });

  it("handles a day with only one populated contract", () => {
    const day: OiDay = {
      date: "2026-01-01",
      contracts: [{ symbol: "RMN26", oi: 100, last_price: 0 }],
    };
    expect(frontTwoSymbols(day)).toEqual(["RMN26"]);
  });

  it("returns [] when the day is empty or undefined", () => {
    expect(frontTwoSymbols(undefined)).toEqual([]);
    expect(frontTwoSymbols({ date: "2026-01-01", contracts: [] })).toEqual([]);
  });
});


describe("nearbyOiDelta — regression on issue #132 Body-7 numbers", () => {
  it("computes +731 lots for the 2026-05-26 Robusta COT release", () => {
    const delta = nearbyOiDelta(ROBUSTA_HISTORY, "2026-05-26", "2026-05-19");
    expect(delta).toBe(731);
  });

  it("uses the front-two symbols from the CURRENT week, looked up on both weeks", () => {
    // Even if next week brings a different front pair, we should still
    // sum the SAME symbols across both dates so the delta attributes
    // change to the specific contracts moving.
    const days: OiDay[] = [
      { date: "2026-06-02", contracts: [
        { symbol: "RMU26", oi: 60_000, last_price: 3000 },   // U is now front
        { symbol: "RMX26", oi: 30_000, last_price: 3000 },   // X is second
      ]},
      { date: "2026-05-26", contracts: [
        { symbol: "RMN26", oi: 73_995, last_price: 3000 },   // N still on the board
        { symbol: "RMU26", oi: 54_564, last_price: 3000 },
        { symbol: "RMX26", oi: 11_880, last_price: 3000 },
      ]},
    ];
    // Front-two on 2026-06-02 = [RMU26, RMX26]. Their sum on 2026-05-26:
    // 54_564 + 11_880 = 66_444. On 2026-06-02: 60_000 + 30_000 = 90_000.
    // Delta = +23_556.
    expect(nearbyOiDelta(days, "2026-06-02", "2026-05-26")).toBe(23_556);
  });

  it("returns null when either date is missing from history", () => {
    expect(nearbyOiDelta(ROBUSTA_HISTORY, "2026-05-26", "2025-01-01")).toBeNull();
    expect(nearbyOiDelta(ROBUSTA_HISTORY, "2025-01-01", "2026-05-19")).toBeNull();
  });

  it("returns null on empty / undefined input", () => {
    expect(nearbyOiDelta(undefined, "2026-05-26", "2026-05-19")).toBeNull();
    expect(nearbyOiDelta([], "2026-05-26", "2026-05-19")).toBeNull();
    expect(nearbyOiDelta(ROBUSTA_HISTORY, "", "2026-05-19")).toBeNull();
  });

  it("returns null when the COT date has zero populated front contracts", () => {
    const days: OiDay[] = [
      { date: "2026-05-26", contracts: [{ symbol: "RMN26", oi: 0, last_price: 3000 }] },
      { date: "2026-05-19", contracts: [{ symbol: "RMN26", oi: 100, last_price: 3000 }] },
    ];
    expect(nearbyOiDelta(days, "2026-05-26", "2026-05-19")).toBeNull();
  });

  it("treats missing symbols on the prior week as zero (new contract on board)", () => {
    const days: OiDay[] = [
      { date: "2026-05-26", contracts: [
        { symbol: "RMU26", oi: 50_000, last_price: 0 },
        { symbol: "RMX26", oi: 20_000, last_price: 0 },   // new addition this week
      ]},
      { date: "2026-05-19", contracts: [
        { symbol: "RMU26", oi: 45_000, last_price: 0 },
        // RMX26 absent — newly added contract
      ]},
    ];
    // Sum on cur: 70_000.  Sum on prv: 45_000 (RMX26 missing → 0).
    // Delta = +25_000.
    expect(nearbyOiDelta(days, "2026-05-26", "2026-05-19")).toBe(25_000);
  });
});
