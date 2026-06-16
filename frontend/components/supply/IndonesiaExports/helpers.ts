// Pure helpers for the Indonesia exports tab. No React imports.

import { COUNTRY_HUB, MONTH_LABELS, PORT_ISLAND } from "./constants";
import type { CountryYear, VolumeSeries } from "./types";

/** Brazil computes via 60 kg bags → kt; Indonesia is already in kilograms,
 * so the unit step is just kg → kt with one decimal place. */
export function kgToKT(kg: number): number {
  return Math.round((kg / 1_000_000) * 10) / 10;
}

export function getHub(country: string): string {
  return COUNTRY_HUB[country] ?? "Other";
}

export function getIsland(port: string): string {
  return PORT_ISLAND[port] ?? "Other";
}

export function monthLabel(ym: string): string {
  return MONTH_LABELS[parseInt(ym.split("-")[1]) - 1];
}

export function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]}-${String(y).slice(2)}`;
}

/** Crop year: Apr Y → Mar Y+1, labelled "Y/Y+1" (e.g. "2024/25"). Mirrors
 *  Brazil's convention so the visual layout stays identical. */
export function cropYearKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 4 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function offsetYM(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function fmtKg(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/** Heatmap intensity bucket (0..1 → hex color) — same scale as BrazilTab. */
export function intensityColor(ratio: number): string {
  if (ratio >= 0.90) return "#60a5fa";
  if (ratio >= 0.75) return "#2563eb";
  if (ratio >= 0.60) return "#1d4ed8";
  if (ratio >= 0.40) return "#1e3a5f";
  if (ratio >= 0.20) return "#1e293b";
  return "#0f172a";
}

/** Build a single combined VolumeSeries from a subset of country names by
 *  summing per-country monthly volumes across history + previous + current
 *  by_country tables. Type splits (arabica/robusta/other) aren't available
 *  in those breakdowns, so the filtered series only carries `total`. */
export function buildFilteredSeries(
  countries: string[],
  history: Record<string, CountryYear>,
  byPrev: CountryYear,
  byCurrent: CountryYear,
): VolumeSeries[] {
  const monthly: Record<string, number> = {};
  const sources = [...Object.values(history), byPrev, byCurrent];
  for (const cy of sources) {
    for (const c of countries) {
      const mv = cy.countries?.[c] ?? {};
      for (const [ym, vol] of Object.entries(mv)) {
        monthly[ym] = (monthly[ym] ?? 0) + vol;
      }
    }
  }
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({
      date, total, arabica: 0, robusta: 0, other: 0,
    }));
}
