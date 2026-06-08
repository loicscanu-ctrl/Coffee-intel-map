// Certified-stocks Robusta per-port stock simulation (pure).
//
// The Robusta source only carries port-level totals, never per-origin stock.
// So we run a simulation per port to infer per-origin in/out flows:
//   1. Initialise per-origin state from port_origin_history shares ×
//      first snapshot's port total.
//   2. Walk daily. Each gradings event (date, port, origin, lots) adds to
//      state[o] and to gross_in[o]. Each day's port-level outflow (mass
//      balance: prev_total + total_in − new_total) is apportioned across the
//      current state proportionally, decrementing state[o] and accumulating
//      into gross_out[o].
//   3. End state = inferred current per-origin stock (cur[o]).
// This is what lets transited and net_gained stay self-consistent: Indonesia
// arriving at Antwerp 6mo ago and leaving 4mo ago shows up as transited (in &
// out), not as net_gained that never materialises.

import type { RobustaSnap, RobustaGradingEvent } from "./shapes";
import type { RobustaPortSim } from "./types";

export function _simulateRobustaPortStock(
  port: string,
  snaps: RobustaSnap[],
  grads: RobustaGradingEvent[],
  histShare: Record<string, number>,
): RobustaPortSim {
  const sortedSnaps = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  // Bucket gradings into daily per-origin inflow for this port only.
  const gradsByDate: Record<string, Record<string, number>> = {};
  for (const ev of grads) {
    for (const e of (ev.entries || [])) {
      if (e.tenderable === false) continue;
      if ((e.port || "") !== port) continue;
      const origin = (e.origin || "?").trim();
      gradsByDate[ev.date] = gradsByDate[ev.date] || {};
      gradsByDate[ev.date][origin] = (gradsByDate[ev.date][origin] ?? 0) + (e.lots ?? 0);
    }
  }
  const state: Record<string, number> = {};
  const firstTotal = sortedSnaps[0]?.by_port_lots?.[port] ?? 0;
  const shareSum = Object.values(histShare).reduce((a, b) => a + b, 0);
  if (firstTotal > 0 && shareSum > 0) {
    for (const [o, v] of Object.entries(histShare)) state[o] = (v / shareSum) * firstTotal;
  }
  const inflowByOriginByDate:  Record<string, Record<string, number>> = {};
  const outflowByOriginByDate: Record<string, Record<string, number>> = {};
  let prevTotal = firstTotal;
  for (let i = 1; i < sortedSnaps.length; i++) {
    const date = sortedSnaps[i].date;
    const newTotal = sortedSnaps[i].by_port_lots?.[port] ?? 0;
    const dayIn = gradsByDate[date] ?? {};
    let totalIn = 0;
    for (const [o, v] of Object.entries(dayIn)) {
      state[o] = (state[o] ?? 0) + v;
      totalIn += v;
    }
    if (Object.keys(dayIn).length > 0) inflowByOriginByDate[date] = { ...dayIn };
    const totalOut = Math.max(0, prevTotal + totalIn - newTotal);
    const stateSum = Object.values(state).reduce((a, b) => a + b, 0);
    if (totalOut > 0 && stateSum > 0) {
      const dayOut: Record<string, number> = {};
      for (const [o, v] of Object.entries(state)) {
        const out = (v / stateSum) * totalOut;
        state[o] = Math.max(0, v - out);
        if (out > 0) dayOut[o] = out;
      }
      if (Object.keys(dayOut).length > 0) outflowByOriginByDate[date] = dayOut;
    }
    prevTotal = newTotal;
  }
  return { state, inflowByOriginByDate, outflowByOriginByDate };
}
