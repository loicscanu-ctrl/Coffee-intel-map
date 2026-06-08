import { describe, it, expect } from "vitest";
import {
  parseFlowISO, flowDateISO, flowAnchor, flowDateBounds, flowStartOptions, FLOW_START_DEFAULT,
} from "../window";

const mk = (...d: string[]) => ({ snapshots: d.map((date) => ({ date })) });

describe("parseFlowISO / flowDateISO", () => {
  it("round-trips a local-midnight date without UTC drift", () => {
    const d = parseFlowISO("2026-06-06");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 6]);
    expect(flowDateISO(d)).toBe("2026-06-06");
  });
});

describe("flowAnchor", () => {
  it("returns the latest snapshot date across both markets", () => {
    const a = flowAnchor(mk("2026-05-01", "2026-06-04"), mk("2026-06-02"));
    expect(flowDateISO(a)).toBe("2026-06-04");
  });
  it("falls back to today when there are no snapshots", () => {
    expect(flowAnchor(null, null)).toBeInstanceOf(Date);
  });
});

describe("flowDateBounds", () => {
  it("spans earliest→latest across both markets", () => {
    const { min, max } = flowDateBounds(mk("2026-03-10", "2026-06-04"), mk("2026-02-01", "2026-05-30"));
    expect(flowDateISO(min)).toBe("2026-02-01");
    expect(flowDateISO(max)).toBe("2026-06-04");
  });
});

describe("flowStartOptions", () => {
  const end = parseFlowISO("2026-06-04");
  it("offers 1w then 1st-of-month back to the data floor, default month-to-date", () => {
    const opts = flowStartOptions(end, parseFlowISO("2026-03-15"));
    expect(opts[0].key).toBe("w1");
    expect(flowDateISO(opts[0].cutoff)).toBe("2026-05-28"); // end − 7d
    expect(opts.find((o) => o.key === FLOW_START_DEFAULT)?.cutoff).toEqual(parseFlowISO("2026-06-01"));
    // months stop at the data floor's month (March)
    expect(opts.some((o) => flowDateISO(o.cutoff) === "2026-03-01")).toBe(true);
    expect(opts.some((o) => flowDateISO(o.cutoff) === "2026-02-01")).toBe(false);
  });
  it("caps at 12 months when no floor is given", () => {
    const opts = flowStartOptions(end);
    expect(opts.filter((o) => o.key.startsWith("m")).length).toBe(12);
  });
});
