// Saturation ceilings (K) for the emerging-demand projection, per the
// "Demand modelling" research methodology (Research → Demand modelling tab).
//
// K is the per-drinking-age-adult intensity ceiling (kg/adult/yr) toward which
// each market's consumption bends — derived from an analog plateau, discounted
// for stomach-share / demographics / substitution, and converted to per-adult.
// Single source of truth: imported by both the research article (MarketCeilings)
// and the live projection (GrowthMarketsPanel).
//
// Keyed by growth_markets `short` name. Values are review anchors — tune here.
export const K_CEILING: Record<string, number> = {
  india: 0.6,
  china: 1.8,
  egypt: 1.8,
  turkey: 2.5,
  indonesia: 3.0,
  mexico: 3.0,
  russia: 3.3,
  ethiopia: 4.5,
  vietnam: 5.0,
  korea: 5.0,
  philippines: 6.0,
  brazil: 9.0,
};

// Discrete logistic (Verhulst) projection of per-adult intensity toward the
// ceiling K, seeded with the observed initial growth rate g:
//   i_{y+1} = i_y · (1 + g·(1 − i_y/K))
// Early on (i ≪ K) it grows at ~g, matching the recent trend; as i → K the
// effective growth decays to zero, so the curve flattens instead of exploding.
// Returns intensity by year for [fromYear, toYear] inclusive (fromYear = i0).
export function logisticIntensity(
  i0: number, g: number, K: number, fromYear: number, toYear: number,
): Record<number, number> {
  const out: Record<number, number> = { [fromYear]: i0 };
  let i = i0;
  for (let y = fromYear + 1; y <= toYear; y++) {
    if (K > 0) {
      i = i * (1 + g * (1 - i / K));
      if (i > K) i = K;          // clamp against overshoot from large g
      if (i < 0) i = 0;
    } else {
      i = i * (1 + g);           // no ceiling defined → fall back to plain trend
    }
    out[y] = i;
  }
  return out;
}

// The three model failure modes the UI surfaces (study Phase 4). `markets` lists
// the projection markets each caveat bites hardest, for optional emphasis.
export const MODEL_LIMITS: { title: string; detail: string; markets: string[] }[] = [
  {
    title: "Substitution (Boba effect)",
    detail: "Massively-funded bubble/fruit/cheese tea competes for the same stomach share — absent in the Japan/Korea analogs — so K may be overstated.",
    markets: ["china"],
  },
  {
    title: "Tech leapfrog (O2O delivery)",
    detail: "App-led kiosks accelerate the early curve but skip at-home brewing (~70% of global volume), weakening the long-run base level.",
    markets: ["china", "india"],
  },
  {
    title: "Demographic mismatch",
    detail: "Using young analogs (Korea ~27) for ageing targets overstates late-curve adoption; India's youth keeps its analog sound.",
    markets: ["china", "russia"],
  },
];
