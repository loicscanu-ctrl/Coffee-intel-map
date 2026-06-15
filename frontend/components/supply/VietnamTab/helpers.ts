// Pure helpers for Vietnam's export panel. No React imports.
//
// Vietnam coffee year runs **Oct → Sep** (vs Brazil's Apr → Mar). All the
// crop-year grouping logic below mirrors the Brazil helpers but with that
// 10-month offset.

import { MONTH_ABBR } from "@/lib/formatters";

export const VN_CROP_MONTH_ORDER  = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const VN_CROP_MONTH_LABELS = ["Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep"];

export const VN_CROP_YEAR_COLORS = [
  "#0ea5e9",  // sky-500 — current crop, strongest
  "#06b6d4",  // cyan-500
  "#0d9488",  // teal-600
  "#475569",  // slate-600 — older years fade
  "#334155",
];

export const TT_STYLE = {
  background: "#1e293b",
  border:     "1px solid #334155",
  borderRadius: 6,
  fontSize:   11,
};

/** Vietnam crop year: Oct Y → Sep Y+1, labelled "Y/Y+1" (e.g. "2024/25") */
export function vnCropYearKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 10 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

/** thousand 60kg bags → kt (thousand metric tons) */
export function kBagsToKT(k_bags: number): number {
  return Math.round((k_bags * 60) / 1000 * 10) / 10;
}

/** thousand 60kg bags → metric tons */
export function kBagsToMT(k_bags: number): number {
  return Math.round(k_bags * 60);
}

export function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]}-${String(y).slice(2)}`;
}
