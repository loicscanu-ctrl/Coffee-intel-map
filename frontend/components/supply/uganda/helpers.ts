// Shared types + helpers for the Uganda chart suite. Sourced from
// frontend/public/data/uganda_monthly.json (written by the UCDA scraper).
// Mirrors the role Brazil's helpers.ts + types.ts play for the Cecafé tab.

export interface UgandaMonthlyRow {
  month:           string;                                      // "YYYY-MM"
  robusta_bags?:   number | null;
  arabica_bags?:   number | null;
  total_bags?:     number | null;
  value_usd?:      number | null;
  by_grade?:       { grade: string; bags: number }[];
  by_destination?: { country: string; bags: number;
                     robusta_bags?: number; arabica_bags?: number }[];
  parser_version?: string;
  source_pdf?:     string;
  parse_warnings?: string[];
}

export interface UgandaMonthlyFile {
  source?:   string;
  updated?:  string;
  series:    UgandaMonthlyRow[];
  parser_summary?: Record<string, number>;
}

// Uganda crop year runs Oct → Sep, same as Vietnam, and matches USDA Coffee
// MY for Uganda. Labelled "Y/Y+1" (e.g. "2025/26").
export const UG_CROP_MONTH_ORDER  = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const UG_CROP_MONTH_LABELS = ["Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep"];

export const UG_CROP_YEAR_COLORS = [
  "#f59e0b",  // amber-500 — current crop, strongest (matches existing Uganda palette)
  "#fb923c",  // orange-400
  "#fbbf24",  // amber-400
  "#475569",  // slate-600 — older years fade
  "#334155",
];

export const TT_STYLE = {
  background: "#1e293b",
  border:     "1px solid #334155",
  borderRadius: 6,
  fontSize:   11,
};

export function ugCropYearKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 10 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

/** Bags → kt (thousand metric tons). UCDA reports in 60-kg bags. */
export function bagsToKT(bags: number): number {
  return Math.round((bags * 60) / 1_000_000 * 10) / 10;
}

/** Group robusta vs arabica by month — drives the type-share chart. */
export interface TypeRow {
  month: string;
  robusta_bags: number;
  arabica_bags: number;
  total_bags: number;
}
