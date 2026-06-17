// Saturation ceilings (K) for the emerging-demand projection, per the
// "Demand modelling" research methodology (Research → Demand modelling tab).
//
// K is the per-drinking-age-adult intensity ceiling (kg/adult/yr) toward which
// each market's consumption bends. It is built from a demographically-neutral
// base ceiling (analog plateau × stomach-share × dairy/infra) and — for markets
// anchored on a YOUNG historical analog — a live demographic discount driven by
// the market's median age. Mature/"self"-anchored markets already embed their
// own demographics in the observed plateau, so they take no further discount.
//
// Single source of truth: imported by the live projection (GrowthMarketsPanel)
// and the research article (MarketCeilings). Values are review anchors — tune
// `base` / `medianAge` here and both update together.

type Anchor = "analog" | "self";
interface Ceiling {
  /** Demographically-neutral ceiling, kg/adult (before the age discount). */
  base: number;
  /** "analog" → discount by median age; "self" → plateau already lived-in. */
  anchor: Anchor;
  /** Fallback whole-population median age (UN WPP 2025) when the live cohort
   *  series carries none yet. */
  medianAge: number;
}

// base values for analog markets are chosen so ceilingK() at the fallback median
// age reproduces the originally-published K (china 1.8, turkey 2.5, russia 3.3…).
export const K_BASE: Record<string, Ceiling> = {
  india:       { base: 0.60, anchor: "analog", medianAge: 28 },
  china:       { base: 2.84, anchor: "analog", medianAge: 41 },
  egypt:       { base: 1.80, anchor: "analog", medianAge: 24 },
  turkey:      { base: 2.88, anchor: "analog", medianAge: 34 },
  mexico:      { base: 3.00, anchor: "analog", medianAge: 30 },
  russia:      { base: 4.95, anchor: "analog", medianAge: 40 },
  indonesia:   { base: 3.00, anchor: "self",   medianAge: 30 },
  ethiopia:    { base: 4.50, anchor: "self",   medianAge: 19 },
  vietnam:     { base: 5.00, anchor: "self",   medianAge: 33 },
  korea:       { base: 5.00, anchor: "self",   medianAge: 46 },
  philippines: { base: 6.00, anchor: "self",   medianAge: 26 },
  brazil:      { base: 9.00, anchor: "self",   medianAge: 36 },
};

// Demographic dampener (study Phase 2.3): caffeine adoption needs a young, active
// population. ~1.0 at median age ≤30, declining linearly to 0.6 at ≥42.
export function demographicFactor(medianAge: number): number {
  if (medianAge <= 30) return 1;
  if (medianAge >= 42) return 0.6;
  return 1 - (medianAge - 30) * (0.4 / 12);
}

// Effective ceiling K (kg/adult). For analog-anchored markets the demographic
// discount is applied live from `medianAge` (self-updating as WPP refreshes);
// self/plateau markets return base unchanged. Returns NaN for unknown markets.
export function ceilingK(short: string, medianAge?: number): number {
  const c = K_BASE[short];
  if (!c) return NaN;
  if (c.anchor === "self") return c.base;
  return c.base * demographicFactor(medianAge ?? c.medianAge);
}

// True when the market takes a live demographic discount (analog-anchored).
export function isDemographicallyDiscounted(short: string): boolean {
  return K_BASE[short]?.anchor === "analog";
}

// Convenience static map at the fallback median ages — for documentation and
// any context without a live median-age series.
export const K_CEILING: Record<string, number> = Object.fromEntries(
  Object.keys(K_BASE).map(k => [k, ceilingK(k)]),
);

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
