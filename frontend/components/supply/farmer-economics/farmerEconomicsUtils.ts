import type { FertilizerItem } from "./farmerEconomicsData";

/**
 * Number of filled dots (1–4) for ENSO impact intensity based on ONI magnitude.
 *   < 0.5   → 1  (clamped; below threshold but non-zero)
 *   0.5–1.0 → 1  (mild)
 *   1.0–1.5 → 2  (moderate)
 *   1.5–2.0 → 3  (strong)
 *   > 2.0   → 4  (extreme)
 * Values below 0.5 (ENSO-neutral) are intentionally clamped to 1 rather than 0
 * because regional_impact rows are only shown when a phase is active.
 */
export function oniToDots(oni: number): number {
  const abs = Math.abs(oni);
  if (abs > 2.0) return 4;
  if (abs > 1.5) return 3;
  if (abs > 1.0) return 2;
  return 1;
}

/**
 * Estimated per-bag cost delta for a fertilizer item given its current MoM change.
 * delta = (mom_pct / 100) * base_usd_per_bag
 */
export function fertCostDelta(item: FertilizerItem): number {
  return Math.round((item.mom_pct / 100) * item.base_usd_per_bag * 10) / 10;
}

/**
 * Net input cost impact across all fertilizer items ($/bag).
 */
export function netFertImpact(items: FertilizerItem[]): number {
  const total = items.reduce((s, f) => s + fertCostDelta(f), 0);
  return Math.round(total * 10) / 10;
}
