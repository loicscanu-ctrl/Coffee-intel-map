/**
 * Shared balance-sheet projection helper used by every per-origin AnnualTrend
 * chart (Brazil, Vietnam, Uganda). Implements the user's spec:
 *
 *   expected_total = prior_year_ending_stocks + production − consumption
 *   projected_gap  = max(0, expected_total − already_exported)
 *
 * Per-origin AnnualTrendChart components fetch demand_stocks.json themselves
 * (each owns its own loading state), then call computeBalanceSheet() with
 * the resolved row(s) + the current-crop-year already-shipped total.
 *
 * Two rows feed the math:
 *   • forecastRow — the USDA GAIN row for the in-progress USDA marketing
 *                   year, if demand_stocks carries one (added by the
 *                   usda_gain_pdf scraper or the seed-fallback).
 *   • latestRow   — the most recent realized row, used as a PROXY when no
 *                   forecast row exists for the in-progress MY.
 *
 * Stock accounting:
 *   • With forecastRow: opening = forecastRow.begin_stocks_mt
 *                       prod    = forecastRow.production_mt
 *                       cons    = forecastRow.consumption_mt
 *   • Without forecastRow (proxy): opening = latestRow.stocks_mt
 *                                   prod    = latestRow.production_mt
 *                                   cons    = latestRow.consumption_mt
 *
 * The `mode` field on the result lets callers surface the source choice in
 * their UI ("forecast" / "proxy") so users can tell which is active.
 */

export interface PsdRow {
  year?: string;
  begin_stocks_mt?: number;
  stocks_mt?: number;
  production_mt?: number;
  consumption_mt?: number;
  exports_mt?: number;
}

export interface BalanceSheetProjection {
  /** Opening stocks in thousand metric tons (kt). */
  opening_kt: number;
  /** This year's production (kt). */
  production_kt: number;
  /** This year's consumption (kt). */
  consumption_kt: number;
  /** Expected full-year exports = opening + prod − cons (kt). */
  expected_total_kt: number;
  /** Already shipped this crop year, fed in by the caller (kt). */
  already_exported_kt: number;
  /** Projected remaining = max(0, expected − already) (kt). */
  projected_gap_kt: number;
  /** USDA year label of the row used (for tooltip / display). */
  psd_year?: string;
  /** Which row drove the projection. */
  mode: "forecast" | "proxy";
}

/** Map a chart's crop-year key (e.g. "2026/27") to USDA's ending-year label
 *  for the same crop. Universal rule: USDA MY ending year = crop-start + 1.
 *  Works for both aligned Oct-Sep origins (Vietnam, Uganda) and the offset
 *  Apr-Mar Brazil crop year, since USDA's Brazil Coffee MY ends in June of
 *  the year after the crop's first April. */
export function usdaYearForCropYear(cropYearKey: string): string {
  const start = parseInt(cropYearKey.split("/")[0] ?? "", 10);
  return Number.isFinite(start) ? String(start + 1) : "";
}

/** USDA MY for Brazil coffee is Jul→Jun (labelled by ending year): Jul 2026
 *  → MY "2027". The other coffee origins we ship (Vietnam, Uganda, etc.) use
 *  Oct→Sep, ending year. This helper covers both via the `monthStart`
 *  parameter (0-indexed month — 6=July for Brazil, 9=October otherwise).
 *
 *  Prefer `usdaYearForCropYear` when you already have the crop-year key —
 *  it side-steps Brazil's Apr-Mar vs USDA's Jul-Jun offset. */
export function inProgressUsdaYear(today: Date, monthStart: number): string {
  const m = today.getUTCMonth();      // 0..11
  const y = today.getUTCFullYear();
  return String(m >= monthStart ? y + 1 : y);
}

/** Find the row whose USDA `year` matches the in-progress MY label, plus
 *  the latest row in the series. Returns nulls when rows are missing. */
export function selectProjectionRows(
  rows: PsdRow[] | null | undefined,
  inProgressYear: string,
): { forecastRow: PsdRow | null; latestRow: PsdRow | null } {
  if (!rows || !rows.length) return { forecastRow: null, latestRow: null };
  const forecastRow = rows.find(r => r.year === inProgressYear) ?? null;
  const latestRow   = rows[rows.length - 1];
  return { forecastRow, latestRow };
}

/** Run the balance-sheet identity on the resolved row(s). Returns null when
 *  no row is available (caller decides whether to draw the projection bar). */
export function computeBalanceSheet(
  forecastRow: PsdRow | null,
  latestRow:   PsdRow | null,
  alreadyExportedKt: number,
): BalanceSheetProjection | null {
  const row = forecastRow ?? latestRow;
  if (!row) return null;

  // Stock semantics:
  //  - forecastRow.begin_stocks_mt = opening of in-progress year (= prior ending)
  //  - latestRow.stocks_mt         = ENDING of latest realized year
  //                                = opening of NEXT year (in-progress)
  const openingMt = forecastRow
    ? (forecastRow.begin_stocks_mt ?? 0)
    : (latestRow?.stocks_mt        ?? 0);

  const opening_kt     = openingMt                          / 1000;
  const production_kt  = (row.production_mt  ?? 0)          / 1000;
  const consumption_kt = (row.consumption_mt ?? 0)          / 1000;
  const expected_total_kt = opening_kt + production_kt - consumption_kt;

  const projected_gap_kt = Math.max(0, expected_total_kt - alreadyExportedKt);

  return {
    opening_kt,
    production_kt,
    consumption_kt,
    expected_total_kt,
    already_exported_kt: alreadyExportedKt,
    projected_gap_kt: Math.round(projected_gap_kt * 10) / 10,
    psd_year: row.year,
    mode: forecastRow ? "forecast" : "proxy",
  };
}

/** Format the balance-sheet tooltip body in a consistent way across origins. */
export function formatBalanceSheetTooltip(p: BalanceSheetProjection): string {
  const r = (n: number) => Math.round(n).toLocaleString();
  return (
    `Balance-sheet projection (USDA PSD ${p.psd_year ?? "latest"}` +
    `${p.mode === "forecast" ? " forecast" : " proxy"}):\n` +
    `  + Opening stocks   ${r(p.opening_kt)} kt\n` +
    `  + Production        ${r(p.production_kt)} kt\n` +
    `  − Consumption       ${r(p.consumption_kt)} kt\n` +
    `  = Expected exports  ${r(p.expected_total_kt)} kt`
  );
}
