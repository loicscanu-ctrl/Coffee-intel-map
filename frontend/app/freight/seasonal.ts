// Calendar helpers for the seasonal (year-over-year) view. Aligns every year on
// a 1..365 index keyed by month/day so Jan 1 → Dec 31 line up across years.
// Feb 29 is merged onto Feb 28's slot so leap and non-leap years stay aligned.
export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// Cumulative days before the start of each month (non-leap).
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
// Cumulative days at the end of each month (non-leap); Dec → 365.
const CUM_END = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

// Day-of-year index (1..365) for a given month/day, on the non-leap calendar.
export function calIdx(month: number, day: number): number {
  if (month === 2 && day === 29) return 59; // merge Feb 29 onto Feb 28
  return CUM[month - 1] + day;
}

// X-axis tick positions: the 1st of each month.
export const MONTH_TICKS = CUM.map((c) => c + 1);

// Label for a month-start tick (returns "" for non-tick positions).
export function monthTickLabel(idx: number): string {
  const i = MONTH_TICKS.indexOf(idx);
  return i >= 0 ? MONTHS[i] : "";
}

// "Mon D" label for any 1..365 index (used in tooltips).
export function idxToLabel(idx: number): string {
  let m = 0;
  while (m < 11 && idx > CUM_END[m]) m++;
  const day = idx - (m === 0 ? 0 : CUM_END[m - 1]);
  return `${MONTHS[m]} ${day}`;
}
