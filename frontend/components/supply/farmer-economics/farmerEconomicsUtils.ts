import type { ForecastAccuracyPoint, FertilizerItem } from "./farmerEconomicsData";

/**
 * Root mean square error between forecast and actual temperature arrays.
 */
export function computeRmse(points: ForecastAccuracyPoint[]): number {
  if (points.length === 0) return 0;
  const sumSq = points.reduce((s, p) => s + (p.forecast_c - p.actual_c) ** 2, 0);
  return Math.round(Math.sqrt(sumSq / points.length) * 10) / 10;
}

/**
 * Number of filled dots (1–4) for ENSO impact intensity based on ONI magnitude.
 *   0.5–1.0 → 1  (mild)
 *   1.0–1.5 → 2  (moderate)
 *   1.5–2.0 → 3  (strong)
 *   > 2.0   → 4  (extreme)
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
