// Intraweek (post-COT) positioning model — shared by the COT dashboard Overview
// and the backtest harness (scripts/backtest-intraweek.mjs). Pure, no React.
//
// Idea: COT positions are weekly (Tuesday). Between prints we infer how each
// trader category probably moved from daily per-contract OI + price:
//   #1 each day's OI×price regime sets which MM leg moves and its sign
//        price↑/OI↑ fresh longs · price↓/OI↑ fresh shorts
//        price↑/OI↓ short-cover · price↓/OI↓ long-liquidation
//   #3 accumulate day-by-day across the window (path-aware, not endpoint)
//   #4 credit MM its share of |ΔOI|, scaled by the price move vs a reference
//   #2 the opposite side of each day's flow is the counterparty (both legs)
//   #5 split that counterparty between industry (PMPU) and swaps/other-rept
//      by their COT share of the relevant side.

import type { CotMarketPositions } from "./types";

export type OiContract = { symbol: string; oi: number; last_price: number };
export type OiDay = { date: string; contracts: OiContract[] };

export interface IntraweekParams {
  deadbandPct: number;  // ignore daily moves smaller than this as directionless
  refPct: number;       // a move of this size = unit conviction (1.0 = 1%)
  scaleMin: number;     // floor on the price-magnitude scaler
  scaleMax: number;     // cap on the price-magnitude scaler
  mmShareMult: number;  // multiplier on MM's derived share of OI (tuning knob)
}

export const DEFAULT_PARAMS: IntraweekParams = {
  deadbandPct: 0.1, refPct: 1.0, scaleMin: 0.25, scaleMax: 2.0, mmShareMult: 1.0,
};

// Per-market multipliers fitted on the 5-year archive (scripts/backtest-intraweek.mjs,
// ~250 COT weeks/market). The objMAE curve is monotonic in opposite directions:
// Arabica wants a higher MM share of OI flow, Robusta a lower one. Directional
// accuracy (~66-69% on MM-net / producers / roasters) is what the model is for;
// the magnitude lever only moves MAE ~8%, so treat the lot sizes as rough.
export const NY_PARAMS:  IntraweekParams = { ...DEFAULT_PARAMS, mmShareMult: 2.0 };
export const LDN_PARAMS: IntraweekParams = { ...DEFAULT_PARAMS, mmShareMult: 0.5 };

export type IntraweekFlow = {
  mmLongDelta: number; mmShortDelta: number;
  producerLotsDelta: number; roasterLotsDelta: number; othersDelta: number;
};

export type PostCot = {
  cotDate: string; latestDate: string;
  oiChange: number; nearbyChange: number; forwardChange: number;
  priceChangeAbs: number; priceChangePct: number;
  invertedNow: number; inCarry: boolean; movingToward: "backwardation" | "carry";
} & IntraweekFlow;

const num   = (x: unknown) => (typeof x === "number" ? x : 0);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const totOI = (d: OiDay) => d.contracts.reduce((s, c) => s + num(c.oi), 0);
const maxOI = (d: OiDay) => d.contracts.reduce((a, c) => (num(c.oi) > num(a.oi) ? c : a), d.contracts[0]);
const pxOf  = (d: OiDay, sym: string) => num(d.contracts.find(c => c.symbol === sym)?.last_price) || num(d.contracts[0]?.last_price);

/** Accumulate the intraweek flow over a chronological window (anchor first … latest last). */
export function estimateIntraweekFlow(win: OiDay[], pos: CotMarketPositions, params: IntraweekParams = DEFAULT_PARAMS): IntraweekFlow {
  const flow: IntraweekFlow = { mmLongDelta: 0, mmShortDelta: 0, producerLotsDelta: 0, roasterLotsDelta: 0, othersDelta: 0 };
  if (win.length < 2) return flow;

  const oiA = totOI(win[0]) || 1;
  const mmShareOI  = clamp((pos.mmLong + pos.mmShort) / (2 * oiA), 0, 0.5) * params.mmShareMult;
  const shortNonMM = pos.pmpuShort + pos.swapShort + pos.otherShort + pos.nonRepShort;
  const longNonMM  = pos.pmpuLong  + pos.swapLong  + pos.otherLong  + pos.nonRepLong;
  const prodShare  = shortNonMM > 0 ? clamp(pos.pmpuShort / shortNonMM, 0, 1) : 0;
  const roastShare = longNonMM  > 0 ? clamp(pos.pmpuLong  / longNonMM,  0, 1) : 0;

  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1], cur = win[i];
    const d = totOI(cur) - totOI(prev);
    const fc = maxOI(cur);
    const pc = num(fc?.last_price), pp = pxOf(prev, fc?.symbol ?? "");
    if (!pp) continue;
    const pct = ((pc - pp) / pp) * 100;
    if (Math.abs(pct) < params.deadbandPct) continue;            // directionless day
    const up = pct > 0;
    const amt = mmShareOI * clamp(Math.abs(pct) / params.refPct, params.scaleMin, params.scaleMax) * d;
    if (d >= 0) {
      if (up) { flow.mmLongDelta  += amt; flow.producerLotsDelta += amt * prodShare;  flow.othersDelta += amt * (1 - prodShare); }
      else    { flow.mmShortDelta += amt; flow.roasterLotsDelta  += amt * roastShare; flow.othersDelta += amt * (1 - roastShare); }
    } else {
      if (up) { flow.mmShortDelta += amt; flow.roasterLotsDelta  += amt * roastShare; flow.othersDelta += amt * (1 - roastShare); }
      else    { flow.mmLongDelta  += amt; flow.producerLotsDelta += amt * prodShare;  flow.othersDelta += amt * (1 - prodShare); }
    }
  }
  return flow;
}

/**
 * Build the displayed post-COT snapshot. `days` is newest-first (as stored in
 * oi_history.json). Endpoint OI/nearby/price/structure are facts; the
 * positioning fields come from estimateIntraweekFlow over the COT→latest window.
 */
export function buildPostCot(days: OiDay[] | undefined, cotDate: string, pos: CotMarketPositions, params: IntraweekParams = DEFAULT_PARAMS): PostCot | null {
  if (!days?.length) return null;
  const latest = days[0];
  const anchorIdx = days.findIndex(d => d.date <= cotDate);
  if (anchorIdx < 0 || latest.date <= cotDate) return null;
  const anchor = days[anchorIdx];

  const nearby = (d: OiDay) => d.contracts.slice(0, 2).reduce((s, c) => s + num(c.oi), 0);
  const oiChange = totOI(latest) - totOI(anchor);
  const nearbyChange = nearby(latest) - nearby(anchor);
  const front = maxOI(latest);
  const pL = num(front?.last_price), pA = pxOf(anchor, front?.symbol ?? "");
  const priceChangeAbs = pL - pA;
  const struct = (d: OiDay) => num(d.contracts[1]?.last_price) - num(d.contracts[0]?.last_price);
  const fpx    = (d: OiDay) => num(d.contracts[0]?.last_price) || 1;
  const invL = (-struct(latest) / fpx(latest)) * 100, invA = (-struct(anchor) / fpx(anchor)) * 100;

  const win = days.slice(0, anchorIdx + 1).reverse(); // chronological: anchor → latest
  const flow = estimateIntraweekFlow(win, pos, params);

  return {
    cotDate: anchor.date, latestDate: latest.date,
    oiChange, nearbyChange, forwardChange: oiChange - nearbyChange,
    priceChangeAbs, priceChangePct: pA ? (priceChangeAbs / pA) * 100 : 0,
    invertedNow: Math.abs(invL), inCarry: struct(latest) > 0,
    movingToward: invL > invA ? "backwardation" : "carry",
    ...flow,
  };
}
