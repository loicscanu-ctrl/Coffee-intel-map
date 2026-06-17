// Builds the realised-exports overlay every per-origin Supply & Demand
// card consumes. Each origin's monthly customs/exports feed has its own
// JSON shape — bags vs k-bags vs kg, "month" vs "date", Oct-Sep vs
// Apr-Mar crop year — and rewriting the bucketing logic per origin
// reliably produces drift. Caller hands us {month, kbags} pairs and
// the crop-year start month; we hand back the overlay SupplyDemandBalance
// expects.
//
// Coverage rule (matches the Vietnam wiring):
//   • Fully realised crops (12 months present) → use the realised sum.
//   • In-progress crop (the one containing the most recent month in the
//     feed) → realised YTD + remaining-forecast split in the chart.
//   • Older crops with incomplete coverage (typical for the partial
//     crop at the start of a customs feed) → omitted from the overlay
//     so SupplyDemandBalance falls back to USDA PSD.

import type { RealizedExportsOverlay } from "@/components/supply/SupplyDemandBalance";

export interface MonthlyKbagsEntry {
  /** "YYYY-MM". */
  month: string;
  /** Thousand 60-kg bags shipped that month. */
  kbags: number;
}

export interface RealizedExportsInput {
  monthly: MonthlyKbagsEntry[];
  /** First calendar month of the crop year (1–12). Apr-Mar origins
   *  (Brazil, Indonesia) pass 4; Oct-Sep origins (Vietnam, Uganda)
   *  pass 10. */
  cropYearStartMonth: number;
  /** Display name surfaced on tooltips + the header chip, e.g.
   *  "Vietnam Customs" or "Cecafé". */
  sourceLabel: string;
}

/** Convert a "YYYY-MM" date to the crop-year key its bucket lives in,
 *  e.g. ("2025-04", 4) → "2025/26", ("2024-09", 10) → "2023/24". */
function cropYearKey(ym: string, startMonth: number): string {
  const [yStr, mStr] = ym.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

export function buildRealizedExportsOverlay(
  input: RealizedExportsInput,
): RealizedExportsOverlay | null {
  if (!input.monthly?.length) return null;

  type Bucket = { kbags: number; months: string[] };
  const byCrop: Record<string, Bucket> = {};
  let latestMonthOverall = "";
  for (const e of input.monthly) {
    if (!e.month || !Number.isFinite(e.kbags)) continue;
    const cy = cropYearKey(e.month, input.cropYearStartMonth);
    (byCrop[cy] ??= { kbags: 0, months: [] }).kbags += e.kbags;
    byCrop[cy].months.push(e.month);
    if (e.month > latestMonthOverall) latestMonthOverall = e.month;
  }
  if (!latestMonthOverall) return null;
  const currentCropYear = cropYearKey(latestMonthOverall, input.cropYearStartMonth);

  const out: RealizedExportsOverlay["byCropYear"] = {};
  for (const [cy, bucket] of Object.entries(byCrop)) {
    const isComplete = bucket.months.length === 12;
    const isCurrent  = cy === currentCropYear;
    // Older partial crops fall back to USDA PSD — sneaking the
    // 4-out-of-12 sum in would silently understate the year.
    if (!isComplete && !isCurrent) continue;
    out[cy] = {
      kbags:       bucket.kbags,
      isPartial:   !isComplete,
      latestMonth: bucket.months.reduce((a, b) => (a > b ? a : b)),
    };
  }
  return Object.keys(out).length > 0
    ? { byCropYear: out, sourceLabel: input.sourceLabel }
    : null;
}
