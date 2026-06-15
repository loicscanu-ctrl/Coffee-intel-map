// Certified-stocks "poison" criteria (pure). Quantifies the share of standing
// stock that is effectively dead weight for the contract.
//
// Poison criteria (v2 per user spec):
//   Arabica: aged > 1 year OR Brazil origin.
//   Robusta: Brazilian Conillon OR aged > 1 year OR port ∈ London / US
//            (LON, NYK, NEW, NOR) OR graded class ∈ {3, 4}.

import type { AgeDist } from "./age";
import type { PoisonStats } from "./types";

export type { PoisonStats };

export const RC_DEAD_PORTS  = new Set(["LON", "NYK", "NEW", "NOR"]);
export const KC_BAD_ORIGINS = new Set(["Brazil"]);
export const RC_BAD_ORIGINS = new Set(["Brazilian Conillon", "Brazil"]);

export function _computePoison(
  current: number,
  market: "KC" | "RC",
  port: string,
  byOrigin: Record<string, number>,
  age: AgeDist,
  class34ShareAtPort: number,
): PoisonStats {
  if (current <= 0) {
    return { pct: 0, total: 0, aged: 0, badOrigin: 0, deadPort: 0, lowClass: 0 };
  }
  const agedShare = age.y1to2 + age.y2to3 + age.y3to4 + age.y4plus;

  let badOriginVol = 0;
  const badSet = market === "KC" ? KC_BAD_ORIGINS : RC_BAD_ORIGINS;
  for (const [origin, v] of Object.entries(byOrigin)) {
    if (badSet.has(origin)) badOriginVol += v;
  }
  const badShare = badOriginVol / current;

  // Dead-port: robusta only. If the port itself is dead, ALL stock is poison.
  const deadShare = market === "RC" && RC_DEAD_PORTS.has(port) ? 1 : 0;

  // Class 3/4 share — robusta only, inferred from gradings history at port.
  const classShare = market === "RC" ? class34ShareAtPort : 0;

  // Combined: if the port is dead, 100% poison. Otherwise assume the three
  // criteria are roughly independent → P(any) = 1 − ∏(1 − Pᵢ).
  const pct = deadShare === 1
    ? 1
    : 1 - (1 - agedShare) * (1 - badShare) * (1 - classShare);

  return {
    pct,
    total:     pct        * current,
    aged:      agedShare  * current,
    badOrigin: badShare   * current,
    deadPort:  deadShare  * current,
    lowClass:  classShare * current,
  };
}
