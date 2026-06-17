// Transforms the raw indonesia_exports.json payload (per-month rows with
// nested by_destination / by_port / by_hs breakdowns) into the
// `IndonesiaExportsData` shape the chart components consume.
//
// Brazil's cecafe.json is delivered pre-pivoted (series + by_country +
// per-type breakdowns), so the Brazil tab can read fields directly. The
// BPS payload puts all of that in `series[i].by_destination` etc., so we
// pivot here once and feed every chart from the same in-memory result.

import { cropYearKey } from "./helpers";
import type {
  CountryYear, IndonesiaExportsData, VolumeSeries,
} from "./types";

interface RawHs   { code: string; description?: string; kg: number; usd?: number; }
interface RawDest { country: string; kg: number; usd?: number; robusta_green_kg?: number; arabica_green_kg?: number; }
interface RawPort { port:    string; kg: number; usd?: number; robusta_green_kg?: number; arabica_green_kg?: number; }
interface RawMonthRow {
  month: string;
  row_count: number;
  total_coffee_kg:  number;
  total_coffee_usd?: number;
  robusta_green_kg: number;
  arabica_green_kg: number;
  by_destination?:  RawDest[];
  by_port?:         RawPort[];
  by_hs?:           RawHs[];
}
export interface RawIndonesiaExports {
  source:     string;
  source_url: string;
  scraped_at: string;
  series:     RawMonthRow[];
}

// HS codes that we treat as the per-species attribution. Everything else
// in the allowlist (decaf, roasted, husks, substitutes, plus the BTKI-2017
// lumped code 09011110 for pre-Apr-2022 months) lands in "other".
const HS_ARABICA_GREEN = "09011120";
const HS_ROBUSTA_GREEN = "09011130";

/** Bucket monthly per-country (or per-port) rows into CountryYear blocks
 *  keyed by crop year (Apr Y → Mar Y+1). The "current" crop year is the
 *  one containing the most recent month; everything else is history. */
function buildCountryYearMap<T extends { kg: number }>(
  rows: { month: string; entries: { key: string; v: T }[] }[],
): Record<string, CountryYear> {
  const result: Record<string, CountryYear> = {};
  for (const { month, entries } of rows) {
    const ck = cropYearKey(month);
    if (!result[ck]) result[ck] = { months: [], countries: {} };
    if (!result[ck].months.includes(month)) result[ck].months.push(month);
    for (const { key, v } of entries) {
      if (!result[ck].countries[key]) result[ck].countries[key] = {};
      result[ck].countries[key][month] =
        (result[ck].countries[key][month] ?? 0) + v.kg;
    }
  }
  for (const ck of Object.keys(result)) result[ck].months.sort();
  return result;
}

export function buildIndonesiaData(raw: RawIndonesiaExports): IndonesiaExportsData {
  // ── Per-month series with arabica / robusta / other split ──────────────
  const sortedMonths = [...raw.series].sort((a, b) => a.month.localeCompare(b.month));
  const series: VolumeSeries[] = sortedMonths.map(r => ({
    date:    r.month,
    arabica: r.arabica_green_kg ?? 0,
    robusta: r.robusta_green_kg ?? 0,
    other:   Math.max(0, r.total_coffee_kg - r.arabica_green_kg - r.robusta_green_kg),
    total:   r.total_coffee_kg,
  }));

  // ── Per-country (all types) ────────────────────────────────────────────
  const destRows = sortedMonths.map(r => ({
    month: r.month,
    entries: (r.by_destination ?? []).map(d => ({ key: d.country, v: { kg: d.kg } })),
  }));
  const countryByCrop = buildCountryYearMap(destRows);

  // ── Per-country, arabica-only ──────────────────────────────────────────
  const destArabicaRows = sortedMonths.map(r => ({
    month: r.month,
    entries: (r.by_destination ?? [])
      .filter(d => (d.arabica_green_kg ?? 0) > 0)
      .map(d => ({ key: d.country, v: { kg: d.arabica_green_kg ?? 0 } })),
  }));
  const countryArabicaByCrop = buildCountryYearMap(destArabicaRows);

  // ── Per-country, robusta-only ──────────────────────────────────────────
  const destRobustaRows = sortedMonths.map(r => ({
    month: r.month,
    entries: (r.by_destination ?? [])
      .filter(d => (d.robusta_green_kg ?? 0) > 0)
      .map(d => ({ key: d.country, v: { kg: d.robusta_green_kg ?? 0 } })),
  }));
  const countryRobustaByCrop = buildCountryYearMap(destRobustaRows);

  // ── Per-port (all types) ───────────────────────────────────────────────
  const portRows = sortedMonths.map(r => ({
    month: r.month,
    entries: (r.by_port ?? []).map(p => ({ key: p.port, v: { kg: p.kg } })),
  }));
  const portByCrop = buildCountryYearMap(portRows);

  // ── Split current / previous / history ─────────────────────────────────
  const allCrops = Object.keys(countryByCrop).sort();
  const currentCrop = allCrops[allCrops.length - 1] ?? "";
  const prevCrop    = allCrops[allCrops.length - 2] ?? "";

  const emptyCY = (): CountryYear => ({ months: [], countries: {} });
  const pick    = (m: Record<string, CountryYear>, key: string) => m[key] ?? emptyCY();
  const without = (m: Record<string, CountryYear>, keys: string[]): Record<string, CountryYear> => {
    const out: Record<string, CountryYear> = {};
    for (const [k, v] of Object.entries(m)) if (!keys.includes(k)) out[k] = v;
    return out;
  };

  return {
    source:     raw.source,
    source_url: raw.source_url,
    scraped_at: raw.scraped_at,
    series,

    by_country:              pick(countryByCrop, currentCrop),
    by_country_prev:         pick(countryByCrop, prevCrop),
    by_country_arabica:      pick(countryArabicaByCrop, currentCrop),
    by_country_arabica_prev: pick(countryArabicaByCrop, prevCrop),
    by_country_robusta:      pick(countryRobustaByCrop, currentCrop),
    by_country_robusta_prev: pick(countryRobustaByCrop, prevCrop),
    by_country_history:      without(countryByCrop, [currentCrop, prevCrop]),

    by_port:                 pick(portByCrop, currentCrop),
    by_port_prev:            pick(portByCrop, prevCrop),
    by_port_history:         without(portByCrop, [currentCrop, prevCrop]),
  };
}

// Re-export for the unused-var rule (referenced by transforms above).
export { HS_ARABICA_GREEN, HS_ROBUSTA_GREEN };
