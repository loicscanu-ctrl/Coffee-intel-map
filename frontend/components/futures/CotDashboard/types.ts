// Shared types for the CoT dashboard decomposition.

// Step IDs are stable URL-state slugs, not display indices — the visible
// "1. / 2. / 3. ..." numbers come from each section's title prefix and
// NAV_STEPS's display order. Adding 9 for the OI 7-day tracking panel
// moved into the COT tab in 2026-05.
export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type MacroToggle = "gross" | "gross_long" | "gross_short" | "net";

export interface MacroChartRow {
  date: string;
  energy: number;
  metals: number;
  grains: number;
  meats:  number;
  softs:  number;
  micros: number;
  coffeeShare: number | null;
}
