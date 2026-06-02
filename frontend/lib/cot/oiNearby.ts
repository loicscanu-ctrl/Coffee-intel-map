/**
 * nearbyOiDelta — re-derive the COT Overview's "nearby OI change" bullet
 * from per-contract OI history, replacing the buggy `exch_oi_ny|ldn`
 * single-field lookup in dataHelpers.ts that produced "+0.0 k lots" for
 * Robusta on the 2026-05-26 release despite the real N+U sum changing
 * by ~+0.7 k lots.
 *
 * Source: frontend/public/data/oi_history.json (already fetched by
 * Overview.tsx for the "letters" rendering — no extra fetch needed).
 *
 * Algorithm:
 *   1. Identify the two front contracts by their chronological order on
 *      the COT date (oi_history.json contracts[] is front-to-back).
 *      Skip any contract with OI <= 0 (price-only or expired).
 *   2. Sum those same symbols' OI on both the COT date and the prior
 *      COT date.
 *   3. Return the delta (cur - prv).
 *
 * Tracking the same symbols week-over-week (rather than each week's own
 * front-two) correctly attributes the change even across an FND roll.
 */
import type { OiDay } from "./intraweekModel";

const num = (x: unknown): number => (typeof x === "number" ? x : 0);


/** Sum OI for the given contract symbols on a single OI day. Missing
 * symbols contribute 0. */
function _sumSymbols(day: OiDay | undefined, symbols: string[]): number {
  if (!day) return 0;
  let total = 0;
  for (const sym of symbols) {
    const c = day.contracts.find((x) => x.symbol === sym);
    total += num(c?.oi);
  }
  return total;
}


/** Front-two contract symbols on the given day, by chronological order
 * (the order oi_history.json ships them in). Filters out OI<=0. */
export function frontTwoSymbols(day: OiDay | undefined): string[] {
  if (!day?.contracts?.length) return [];
  return day.contracts.filter((c) => num(c.oi) > 0).slice(0, 2).map((c) => c.symbol);
}


/** Week-over-week OI change in the front-two contracts (in lots).
 * Returns null when either date is absent from history, or when the
 * COT date carries no front contracts. */
export function nearbyOiDelta(
  days: OiDay[] | undefined,
  cotDate: string,
  priorCotDate: string,
): number | null {
  if (!days || days.length === 0 || !cotDate || !priorCotDate) return null;
  const cur = days.find((d) => d.date === cotDate);
  const prv = days.find((d) => d.date === priorCotDate);
  if (!cur || !prv) return null;

  const symbols = frontTwoSymbols(cur);
  if (symbols.length === 0) return null;

  return _sumSymbols(cur, symbols) - _sumSymbols(prv, symbols);
}
