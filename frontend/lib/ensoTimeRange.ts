/**
 * Time-range presets shared by the ENSO command-center charts.
 * Single source of truth so the selector and the chart consumers
 * stay aligned. months=null means "no slice — render the full JSON".
 */
export type EnsoTimeRange = "3M" | "6M" | "1Y" | "2Y" | "5Y" | "10Y" | "20Y" | "ALL";

export interface EnsoRangePreset {
  key:    EnsoTimeRange;
  label:  string;
  months: number | null;     // null = unlimited / show full history
}

export const ENSO_TIME_RANGES: readonly EnsoRangePreset[] = [
  { key: "3M",  label: "3M",  months: 3   },
  { key: "6M",  label: "6M",  months: 6   },
  { key: "1Y",  label: "1Y",  months: 12  },
  { key: "2Y",  label: "2Y",  months: 24  },
  { key: "5Y",  label: "5Y",  months: 60  },
  { key: "10Y", label: "10Y", months: 120 },
  { key: "20Y", label: "20Y", months: 240 },
  { key: "ALL", label: "All", months: null },
] as const;

export const ENSO_DEFAULT_RANGE: EnsoTimeRange = "2Y";

/** Convert a preset key to its month count, or null for "all". */
export function rangeMonths(key: EnsoTimeRange): number | null {
  return ENSO_TIME_RANGES.find((r) => r.key === key)?.months ?? null;
}
