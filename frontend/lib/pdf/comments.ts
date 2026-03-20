// frontend/lib/pdf/comments.ts
import type { GlobalFlowMetrics, MarketMetrics } from "./types";

const RISK_FREE_RATE = 4.1; // % — update manually if needed
const fmt1 = (n: number) => Math.abs(n).toFixed(1);
const fmt0 = (n: number) => Math.abs(n).toFixed(0);
const sign = (n: number) => (n >= 0 ? "+" : "−");
const kLots = (n: number) => `${sign(n)}${fmt1(n / 1000)}k lots`;
const kLotsOrNA = (n: number | null) => n === null ? "N/A" : kLots(n);
const pct = (n: number) => `${sign(n)}${fmt1(n)}%`;

// ── Page 1: Global Money Flow ─────────────────────────────────────────────────
export function globalFlowComment(g: GlobalFlowMetrics): string {
  const dir   = g.wowDeltaB >= 0 ? "expanded" : "contracted";
  const mover = g.biggestMoverSector;
  const cofDir = g.coffeeDeltaB >= 0 ? "rose" : "fell";
  return (
    `Speculative gross exposure ${dir} by $${fmt1(Math.abs(g.wowDeltaB))}B to ` +
    `$${fmt1(g.totalGrossB)}B this week. ${mover} led the move ` +
    `(${sign(g.biggestMoverDeltaB)}$${fmt1(Math.abs(g.biggestMoverDeltaB))}B). ` +
    `coffee combined exposure ${cofDir} by $${fmt1(Math.abs(g.coffeeDeltaB))}B, ` +
    `representing ${fmt1(g.coffeeSharePct)}% of total gross speculative flow.`
  );
}

// ── Page 2: Coffee Combined Overview ─────────────────────────────────────────
export function coffeeOverviewComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const nyDir  = ny.mmLong - ny.mmShort > 0 ? "net long" : "net short";
  const ldnDir = ldn.mmLong - ldn.mmShort > 0 ? "net long" : "net short";
  const aligned = nyDir === ldnDir;
  const signal  = aligned
    ? `Both contracts are ${nyDir} — directional signals are aligned.`
    : `NY is ${nyDir} while LDN is ${ldnDir} — contracts diverge in direction.`;
  return (
    `NY Arabica MM ${nyDir} at ${fmt0(Math.abs(ny.mmLong - ny.mmShort))} lots; ` +
    `LDN Robusta MM ${ldnDir} at ${fmt0(Math.abs(ldn.mmLong - ldn.mmShort))} lots. ${signal}`
  );
}

// ── Pages 3-4: Per-market overview ───────────────────────────────────────────
export function marketOverviewComment(m: MarketMetrics): string {
  const oiDir  = m.oiChangeLots >= 0 ? "added" : "shed";
  const pDir   = m.priceChangePct >= 0 ? "rose" : "fell";
  const struct = m.structureType === null
    ? "front structure unavailable (manual data required)"
    : m.structureType === "backwardation"
      ? `backwardation at ${fmt1(Math.abs(m.annualizedRollPct!))}% annualised roll (vs ${RISK_FREE_RATE}% RFR)`
      : `front structure in carry at ${fmt1(Math.abs(m.annualizedRollPct!))}% annualised roll`;
  const nearbySplit = m.oiChangeNearby !== null
    ? `nearby: ${kLots(m.oiChangeNearby)}, forward: ${kLotsOrNA(m.oiChangeForward)}`
    : "nearby/forward split unavailable";
  return (
    `Total OI ${oiDir} ${fmt1(Math.abs(m.oiChangeLots / 1000))}k lots ` +
    `(${nearbySplit}). ` +
    `Price ${pDir} ${fmt1(Math.abs(m.priceChangePct))}% (${sign(m.priceChangeAbs)}${fmt1(Math.abs(m.priceChangeAbs))} ${m.priceUnit}) on the COT week. ` +
    `Market in ${struct}.`
  );
}

export function industryCoverageComment(m: MarketMetrics): string {
  const pDir = m.producerMTWoW >= 0 ? "increased" : "decreased";
  const rDir = m.roasterMTWoW  >= 0 ? "increased" : "decreased";
  return (
    `Producers' coverage at ${fmt1(m.producerCovPct)}% of 52-week range ` +
    `(${fmt0(m.producerMT / 1000)}k MT, ${pDir} ${fmt0(Math.abs(m.producerMTWoW / 1000))}k MT WoW). ` +
    `Roasters at ${fmt1(m.roasterCovPct)}% of range ` +
    `(${fmt0(m.roasterMT / 1000)}k MT, ${rDir} ${fmt0(Math.abs(m.roasterMTWoW / 1000))}k MT WoW).`
  );
}

export function mmPositioningComment(m: MarketMetrics): string {
  const lDir = m.mmLongChangeLots  >= 0 ? "increasing longs"  : "liquidating longs";
  const sDir = m.mmShortChangeLots >= 0 ? "increasing shorts" : "liquidating shorts";
  const rollSignal = m.annualizedRollPct === null
    ? ""
    : m.annualizedRollPct > RISK_FREE_RATE
      ? `Roll above RFR — further long building likely.`
      : `Roll below RFR — less incentive to add longs.`;
  return (
    `MM ${lDir} (${kLots(m.mmLongChangeLots)} / ${pct(m.mmLongChangePct)} of position) ` +
    `and ${sDir} (${kLots(m.mmShortChangeLots)} / ${pct(m.mmShortChangePct)} of position). ` +
    `Funds ${fmt1(m.fundsMaxedLongPct)}% maxed on longs, ${fmt1(m.fundsMaxedShortPct)}% on shorts. ${rollSignal}`
  );
}

export function obosComment(m: MarketMetrics): string {
  const flagStr =
    m.obosFlag === "overbought" ? `⚠ overbought — price rank ${fmt1(m.priceRank)}th, OI rank ${fmt1(m.oiRank)}th percentile.` :
    m.obosFlag === "oversold"   ? `⚠ oversold — price rank ${fmt1(m.priceRank)}th, OI rank ${fmt1(m.oiRank)}th percentile.` :
    `No extreme signal — price rank ${fmt1(m.priceRank)}th, OI rank ${fmt1(m.oiRank)}th percentile.`;
  const mismatch = m.positionMismatch
    ? ` ⚠ Position mismatch detected (MM net direction differs between lots and trader count).`
    : "";
  const conc = m.mmConcentrationPct > 40
    ? ` ⚠ MM concentration at ${fmt1(m.mmConcentrationPct)}% of OI — elevated.`
    : ` MM concentration ${fmt1(m.mmConcentrationPct)}% of OI.`;
  return flagStr + mismatch + conc;
}

// ── Chart micro-comments ──────────────────────────────────────────────────────

export function structuralComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const nyConc = ny.mmConcentrationPct > 40 ? "elevated" : "normal";
  return `MM share of total OI: NY ${fmt1(ny.mmConcentrationPct)}% (${nyConc}), LDN ${fmt1(ldn.mmConcentrationPct)}%. No structural concentration risk flagged.`;
}

export function counterpartyComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const absMax = (obj: Record<string, number>) =>
    Object.entries(obj).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const nyBigLong  = absMax(ny.cp.longs  as any);
  const nyBigShort = absMax(ny.cp.shorts as any);
  return (
    `NY: largest long move from ${nyBigLong[0].toUpperCase()} (${kLots(nyBigLong[1])}), ` +
    `largest short move from ${nyBigShort[0].toUpperCase()} (${kLots(nyBigShort[1])}). ` +
    `Handshake balance reflects normal market-making activity.`
  );
}

export function industryPulseComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const dir = (ny.producerMTWoW + ldn.producerMTWoW) >= 0 ? "increasing" : "reducing";
  return (
    `Producers are ${dir} gross long hedges across NY and LDN. ` +
    `Combined PMPU coverage at ${fmt1((ny.producerCovPct + ldn.producerCovPct) / 2)}% of 52-week range.`
  );
}

export function dryPowderComment(ny: MarketMetrics, ldn: MarketMetrics): string {
  const nyFull = ny.fundsMaxedLongPct > 80 ? "limited" : "available";
  const ldnFull = ldn.fundsMaxedLongPct > 80 ? "limited" : "available";
  return (
    `NY dry powder ${nyFull} — funds ${fmt1(ny.fundsMaxedLongPct)}% maxed on longs. ` +
    `LDN dry powder ${ldnFull} — funds ${fmt1(ldn.fundsMaxedLongPct)}% maxed on longs.`
  );
}
