// Pure helper functions for the Brazil tab. No React imports.

import { COUNTRY_EN, COUNTRY_HUB, MONTH_LABELS } from "./constants";
import type { CountryYear, VolumeSeries } from "./types";

export function toEn(pt: string): string {
  return COUNTRY_EN[pt] ?? pt;
}

export function getHub(ptCountry: string): string {
  return COUNTRY_HUB[ptCountry] ?? "Other";
}

export function bagsToKT(bags: number): number {
  return Math.round((bags * 60) / 1e6 * 10) / 10;
}

export function monthLabel(ym: string): string {
  return MONTH_LABELS[parseInt(ym.split("-")[1]) - 1];
}

export function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
  return `${mo}-${String(y).slice(2)}`;
}

/** Crop year: Apr Y → Mar Y+1, labelled "Y/Y+1" (e.g. "2024/25") */
export function cropYearKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 4 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

/** Offset "YYYY-MM" by n months (negative = back) */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function fmtBags(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/** Offset a YYYY-MM string by `months` months (positive = back) — used by DestinationChart */
export function offsetYM(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Heatmap intensity bucket (0..1 → hex color) */
export function intensityColor(ratio: number): string {
  if (ratio >= 0.90) return "#60a5fa";
  if (ratio >= 0.75) return "#2563eb";
  if (ratio >= 0.60) return "#1d4ed8";
  if (ratio >= 0.40) return "#1e3a5f";
  if (ratio >= 0.20) return "#1e293b";
  return "#0f172a";
}

/**
 * Build a VolumeSeries[] for an arbitrary set of Portuguese country names by
 * summing monthly volumes across the available history + previous + current
 * by_country tables. Type breakdowns aren't available across history so
 * arabica/conillon/soluvel/torrado are zeroed and only `total` is meaningful.
 */
export function buildFilteredSeries(
  ptCountries: string[],
  history: Record<string, CountryYear>,
  byPrev: CountryYear,
  byCurrent: CountryYear,
): VolumeSeries[] {
  const monthly: Record<string, number> = {};
  const sources = [...Object.values(history), byPrev, byCurrent];
  for (const cy of sources) {
    for (const pt of ptCountries) {
      const mv = cy.countries?.[pt] ?? {};
      for (const [ym, vol] of Object.entries(mv)) {
        monthly[ym] = (monthly[ym] ?? 0) + vol;
      }
    }
  }
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({
      date, total, arabica: 0, conillon: 0, soluvel: 0,
      torrado: 0, total_verde: 0, total_industria: 0,
    }));
}
