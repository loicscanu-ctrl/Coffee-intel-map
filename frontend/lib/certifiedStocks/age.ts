// Age bins for certified stock — 4 fade levels for stock 1y+, plus full-opacity
// "fresh" under a year. Bin keys are stable so they survive cross-runs.

export type AgeBin = "fresh" | "y1to2" | "y2to3" | "y3to4" | "y4plus";
export interface AgeDist { fresh: number; y1to2: number; y2to3: number; y3to4: number; y4plus: number }  // shares 0..1

export const AGE_OPACITY: Record<AgeBin, number> = {
  fresh:  1.00,
  y1to2:  0.80,
  y2to3:  0.62,
  y3to4:  0.47,
  y4plus: 0.35,
};
export const AGE_LABEL: Record<AgeBin, string> = {
  fresh: "< 1y", y1to2: "1-2y", y2to3: "2-3y", y3to4: "3-4y", y4plus: "4y+",
};
export const AGE_BIN_ORDER: AgeBin[] = ["fresh", "y1to2", "y2to3", "y3to4", "y4plus"];

export const _binByMonths = (months: number): AgeBin =>
  months < 12 ? "fresh"
  : months < 24 ? "y1to2"
  : months < 36 ? "y2to3"
  : months < 48 ? "y3to4"
  : "y4plus";
export const _binByDays = (days: number): AgeBin => _binByMonths(days / 30);
