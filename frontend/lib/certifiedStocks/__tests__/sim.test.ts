import { describe, it, expect } from "vitest";
import { _simulateRobustaPortStock } from "../sim";
import type { RobustaSnap, RobustaGradingEvent } from "../shapes";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("_simulateRobustaPortStock", () => {
  it("seeds initial state from historical origin shares × first port total", () => {
    const snaps: RobustaSnap[] = [
      { date: "2026-01-01", total_lots_certified: 100, by_port_lots: { ANT: 100 } },
    ];
    const sim = _simulateRobustaPortStock("ANT", snaps, [], { Vietnam: 3, Indonesia: 1 });
    expect(sum(sim.state)).toBeCloseTo(100, 5);
    expect(sim.state.Vietnam).toBeCloseTo(75, 5);    // 3/4 of 100
    expect(sim.state.Indonesia).toBeCloseTo(25, 5);  // 1/4 of 100
  });

  it("adds gradings as inflow and ends with the final port total", () => {
    const snaps: RobustaSnap[] = [
      { date: "2026-01-01", total_lots_certified: 100, by_port_lots: { ANT: 100 } },
      { date: "2026-01-02", total_lots_certified: 150, by_port_lots: { ANT: 150 } },
    ];
    const grads: RobustaGradingEvent[] = [
      { date: "2026-01-02", entries: [{ port: "ANT", origin: "Vietnam", lots: 50 }] },
    ];
    const sim = _simulateRobustaPortStock("ANT", snaps, grads, { Vietnam: 1 });
    // No net outflow (100 + 50 in − 0 out = 150) → end state equals final total.
    expect(sum(sim.state)).toBeCloseTo(150, 5);
    expect(sim.inflowByOriginByDate["2026-01-02"].Vietnam).toBe(50);
  });

  it("apportions a port drawdown across current origins proportionally", () => {
    const snaps: RobustaSnap[] = [
      { date: "2026-01-01", total_lots_certified: 100, by_port_lots: { ANT: 100 } },
      { date: "2026-01-02", total_lots_certified: 60,  by_port_lots: { ANT: 60 } },
    ];
    const sim = _simulateRobustaPortStock("ANT", snaps, [], { Vietnam: 3, Indonesia: 1 });
    // 40 lots left, split 75/25 → Vietnam loses 30, Indonesia loses 10.
    expect(sum(sim.state)).toBeCloseTo(60, 5);
    expect(sim.state.Vietnam).toBeCloseTo(45, 5);
    expect(sim.state.Indonesia).toBeCloseTo(15, 5);
    expect(sum(sim.outflowByOriginByDate["2026-01-02"])).toBeCloseTo(40, 5);
  });

  it("ignores non-tenderable gradings and other ports", () => {
    const snaps: RobustaSnap[] = [
      { date: "2026-01-01", total_lots_certified: 0, by_port_lots: { ANT: 0 } },
      { date: "2026-01-02", total_lots_certified: 10, by_port_lots: { ANT: 10 } },
    ];
    const grads: RobustaGradingEvent[] = [
      { date: "2026-01-02", entries: [
        { port: "ANT", origin: "Vietnam", lots: 10 },
        { port: "ANT", origin: "Reject", tenderable: false, lots: 99 },
        { port: "LON", origin: "Brazil", lots: 99 },
      ] },
    ];
    const sim = _simulateRobustaPortStock("ANT", snaps, grads, {});
    expect(sim.state.Vietnam).toBeCloseTo(10, 5);
    expect(sim.state.Reject ?? 0).toBe(0);
    expect(sim.state.Brazil ?? 0).toBe(0);
  });
});
