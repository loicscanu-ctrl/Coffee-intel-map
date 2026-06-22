// Registry of downloadable datasets surfaced on the Data Map page.
//
// Each entry maps one of the static JSON files in /public/data to a flat
// row shape suitable for CSV. The `toRows` function is the only piece of
// per-dataset logic — it pulls the analytically useful slice out of the
// JSON (which often has nested time-series or per-region maps) and
// returns one object per row. Column order is first-seen across rows;
// `downloadCsv` handles RFC-4180 escaping and the UTF-8 BOM.
//
// Adding a new dataset: append an entry below. Keep `key` lowercase
// snake-case (used in the filename and as a stable identifier), `label`
// human-readable, and `group` from the closed enum so the UI groups it
// alongside its peers.
//
// Type contract: `toRows` receives the parsed JSON as `unknown`. We do
// runtime shape checks with optional chaining + `?? []` fallbacks so a
// missing key produces an empty CSV rather than a thrown stack trace —
// the UI surfaces "no rows" instead of a crash.

export type DatasetGroup =
  | "Origin exports"
  | "Destination imports"
  | "Destination stocks"
  | "Weather"
  | "Prices & markets"
  | "Macro";

export interface Dataset {
  key:      string;
  label:    string;
  group:    DatasetGroup;
  jsonPath: string;
  filename: string;
  note?:    string;
  toRows:   (raw: unknown) => Record<string, unknown>[];
}

// Helpers — typed as `any` because the source JSONs are heterogeneous and
// runtime-typed; widening here keeps the per-dataset toRows readable.
/* eslint-disable @typescript-eslint/no-explicit-any */

function asArr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asObj(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

// Flatten a per-month series object {"2024-01": 123, ...} into rows tagged
// with one or more context fields (e.g. country, origin).
function pivotMonthly(monthly: Record<string, any>, context: Record<string, unknown>, valueKey = "value"): Record<string, unknown>[] {
  return Object.entries(monthly || {}).map(([month, value]) => ({ ...context, month, [valueKey]: value }));
}

// Flatten a per-year series object {"2020": 123, ...} into rows.
function pivotAnnual(annual: Record<string, any>, context: Record<string, unknown>, valueKey = "value"): Record<string, unknown>[] {
  return Object.entries(annual || {}).map(([year, value]) => ({ ...context, year, [valueKey]: value }));
}

export const DATASETS: Dataset[] = [
  // =========================================================================
  // ORIGIN EXPORTS — what each producing country shipped out, monthly.
  // =========================================================================
  {
    key: "brazil_exports_monthly",
    label: "Brazil — exports (monthly aggregate, 1990–now)",
    group: "Origin exports",
    jsonPath: "/data/cecafe.json",
    filename: "brazil_exports_monthly",
    note: "Cecafe · arabica + conillon + soluvel + torrado, 60kg bags",
    toRows: (raw: any) => asArr(raw?.series),
  },
  {
    key: "brazil_exports_by_country",
    label: "Brazil — exports by destination country",
    group: "Origin exports",
    jsonPath: "/data/cecafe.json",
    filename: "brazil_exports_by_country",
    note: "Cecafe by-country · last 5 months",
    toRows: (raw: any) => {
      const bc = asObj(raw?.by_country);
      const countries = asObj(bc.countries);
      return Object.entries(countries).flatMap(([country, monthly]) =>
        Object.entries(asObj(monthly)).map(([month, bags]) => ({ country, month, bags_60kg: bags }))
      );
    },
  },
  {
    key: "vietnam_exports_monthly",
    label: "Vietnam — exports (monthly)",
    group: "Origin exports",
    jsonPath: "/data/vietnam_supply.json",
    filename: "vietnam_exports_monthly",
    note: "Vietnam Customs · last ~36 months",
    toRows: (raw: any) => asArr(raw?.exports?.monthly),
  },
  {
    key: "colombia_exports_monthly",
    label: "Colombia — exports (monthly)",
    group: "Origin exports",
    jsonPath: "/data/colombia_supply.json",
    filename: "colombia_exports_monthly",
    note: "FNC monthly bulletin",
    toRows: (raw: any) => asArr(raw?.exports?.monthly),
  },
  // Honduras / Ethiopia / Indonesia don't publish monthly export bulletins,
  // so the supply JSONs carry annual series only (USDA FAS PSD historical).
  {
    key: "honduras_exports_annual",
    label: "Honduras — exports (annual)",
    group: "Origin exports",
    jsonPath: "/data/honduras_supply.json",
    filename: "honduras_exports_annual",
    note: "USDA FAS PSD · 1960–present",
    toRows: (raw: any) => asArr(raw?.exports?.annual),
  },
  {
    key: "ethiopia_exports_annual",
    label: "Ethiopia — exports (annual)",
    group: "Origin exports",
    jsonPath: "/data/ethiopia_supply.json",
    filename: "ethiopia_exports_annual",
    note: "USDA FAS PSD · 1960–present",
    toRows: (raw: any) => asArr(raw?.exports?.annual),
  },
  {
    key: "indonesia_exports_annual",
    label: "Indonesia — exports (annual)",
    group: "Origin exports",
    jsonPath: "/data/indonesia_supply.json",
    filename: "indonesia_exports_annual",
    note: "USDA FAS PSD · 1960–present",
    toRows: (raw: any) => asArr(raw?.exports?.annual),
  },
  {
    key: "uganda_exports_monthly",
    label: "Uganda — exports (monthly)",
    group: "Origin exports",
    jsonPath: "/data/uganda_supply.json",
    filename: "uganda_exports_monthly",
    note: "UCDA · arabica + robusta split",
    toRows: (raw: any) => asArr(raw?.exports?.monthly),
  },

  // =========================================================================
  // DESTINATION IMPORTS — what each consuming country brought in.
  // =========================================================================
  {
    key: "eu_imports_by_origin_year",
    label: "EU — imports by origin (annual)",
    group: "Destination imports",
    jsonPath: "/data/eu_coffee_imports.json",
    filename: "eu_imports_by_origin_annual",
    note: "Eurostat Comext · MT green-equivalent",
    toRows: (raw: any) => {
      const origins = asArr<any>(raw?.origins);
      return origins.flatMap(o =>
        pivotAnnual(asObj(o?.by_year), { origin: o?.name }, "imports_mt")
      );
    },
  },
  {
    key: "eu_imports_by_origin_monthly",
    label: "EU — imports by origin (monthly)",
    group: "Destination imports",
    jsonPath: "/data/eu_coffee_imports.json",
    filename: "eu_imports_by_origin_monthly",
    note: "Eurostat Comext · MT green-equivalent",
    toRows: (raw: any) => {
      const origins = asArr<any>(raw?.origins);
      return origins.flatMap(o =>
        pivotMonthly(asObj(o?.monthly), { origin: o?.name }, "imports_mt")
      );
    },
  },
  {
    key: "us_imports_by_origin_year",
    label: "US — imports by origin (annual)",
    group: "Destination imports",
    jsonPath: "/data/us_coffee_imports.json",
    filename: "us_imports_by_origin_annual",
    note: "USITC DataWeb · MT green-equivalent",
    toRows: (raw: any) => {
      const origins = asArr<any>(raw?.origins);
      return origins.flatMap(o =>
        pivotAnnual(asObj(o?.by_year), { origin: o?.name }, "imports_mt")
      );
    },
  },
  {
    key: "us_imports_by_origin_monthly",
    label: "US — imports by origin (monthly)",
    group: "Destination imports",
    jsonPath: "/data/us_coffee_imports.json",
    filename: "us_imports_by_origin_monthly",
    // Schema quirk: US monthly data is in a top-level `monthly_origins`
    // map (origin → month → mt) rather than `origins[i].monthly` like EU.
    toRows: (raw: any) => {
      const mo = asObj(raw?.monthly_origins);
      return Object.entries(mo).flatMap(([origin, monthly]) =>
        pivotMonthly(asObj(monthly), { origin }, "imports_mt")
      );
    },
  },
  {
    key: "global_imports_by_country",
    label: "Global — coffee imports by destination country (annual)",
    group: "Destination imports",
    jsonPath: "/data/coffee_imports.json",
    filename: "global_imports_by_country_annual",
    note: "UN Comtrade · green + roasted + decaf + husks",
    toRows: (raw: any) => {
      const countries = asObj(raw?.countries);
      return Object.entries(countries).flatMap(([key, c]: [string, any]) =>
        asArr<any>(c?.annual).map(row => ({
          country_code: key,
          country_name: c?.name,
          ...row,
        }))
      );
    },
  },

  // =========================================================================
  // DESTINATION STOCKS — ICE-certified exchange stocks + national stocks.
  // =========================================================================
  {
    key: "ice_certified_arabica",
    label: "ICE certified — Arabica (daily snapshots)",
    group: "Destination stocks",
    jsonPath: "/data/certified_stocks_arabica.json",
    filename: "ice_certified_arabica_snapshots",
    note: "ICE Futures US · KC contract certified stocks",
    toRows: (raw: any) => asArr<any>(raw?.snapshots).map(s => ({
      date:                   s?.date,
      report_date:            s?.report_date,
      total_bags:             s?.total_bags,
      transition_bags:        s?.transition_bags,
      pending_grading_bags:   s?.pending_grading_bags,
      rebagging_bags:         s?.rebagging_bags,
      passed_today_bags:      s?.passed_today_bags,
      failed_today_bags:      s?.failed_today_bags,
      issued_total_today:     s?.issued_total_today,
      received_total_today:   s?.received_total_today,
    })),
  },
  {
    key: "ice_certified_robusta",
    label: "ICE certified — Robusta (daily snapshots)",
    group: "Destination stocks",
    jsonPath: "/data/certified_stocks_robusta.json",
    filename: "ice_certified_robusta_snapshots",
    note: "ICE Futures Europe · RC contract certified stocks",
    toRows: (raw: any) => asArr<any>(raw?.snapshots).map(s => ({
      date:                 s?.date,
      report_date:          s?.report_date,
      total_tonnes:         s?.total_tonnes ?? s?.total_bags,
      pending_grading:      s?.pending_grading_bags ?? s?.pending_grading_tonnes,
      passed_today:         s?.passed_today_bags ?? s?.passed_today_tonnes,
      failed_today:         s?.failed_today_bags ?? s?.failed_today_tonnes,
    })),
  },
  {
    key: "demand_stocks_eu",
    label: "EU — supply & demand (annual)",
    group: "Destination stocks",
    jsonPath: "/data/demand_stocks.json",
    filename: "eu_supply_demand_annual",
    note: "USDA FAS PSD · imports / consumption / ending stocks",
    toRows: (raw: any) => asArr<any>(raw?.eu?.annual),
  },
  {
    key: "demand_stocks_usa",
    label: "US — supply & demand (annual)",
    group: "Destination stocks",
    jsonPath: "/data/demand_stocks.json",
    filename: "us_supply_demand_annual",
    note: "USDA FAS PSD",
    toRows: (raw: any) => asArr<any>(raw?.usa?.annual),
  },
  {
    key: "demand_stocks_japan",
    label: "Japan — supply & demand (annual)",
    group: "Destination stocks",
    jsonPath: "/data/demand_stocks.json",
    filename: "japan_supply_demand_annual",
    note: "USDA FAS PSD",
    toRows: (raw: any) => asArr<any>(raw?.japan?.annual),
  },

  // =========================================================================
  // WEATHER — per-region monthly climatology (avg / current / last-year)
  // plus current temperature. One row per (region × month_idx 1-12).
  // =========================================================================
  ...([
    ["brazil",    "Brazil"],
    ["colombia",  "Colombia"],
    ["honduras",  "Honduras"],
    ["ethiopia",  "Ethiopia"],
    ["indonesia", "Indonesia"],
    ["uganda",    "Uganda"],
    ["vn",        "Vietnam"],
  ] as const).map<Dataset>(([slug, label]) => ({
    key: `${slug}_weather`,
    label: `${label} — weather (monthly per growing region)`,
    group: "Weather",
    jsonPath: `/data/${slug}_weather.json`,
    filename: `${slug}_weather_monthly`,
    note: "Avg / current / last-year rainfall + temperature, 12 calendar months",
    toRows: (raw: any) => {
      const provinces = asArr<any>(raw?.provinces);
      return provinces.flatMap(p =>
        Array.from({ length: 12 }, (_, i) => ({
          region:          p?.name,
          station:         p?.station,
          prod_weight:     p?.weight,
          prod_mt_k:       p?.prod_mt_k,
          month_idx:       i + 1,
          rain_avg_mm:     p?.monthly_avg_rain?.[i],
          rain_cur_mm:     p?.monthly_actual_cur?.[i],
          rain_last_yr_mm: p?.monthly_last_year_rain?.[i],
          temp_avg_c:      p?.monthly_avg_temp?.[i],
          temp_cur_c:      p?.monthly_actual_temp_cur?.[i],
          temp_last_yr_c:  p?.monthly_last_year_temp?.[i],
        }))
      );
    },
  })),

  // =========================================================================
  // PRICES & MARKETS — futures chain, spot prices, freight, COT.
  // =========================================================================
  {
    key: "futures_chain",
    label: "Futures chain — Arabica (KC) + Robusta (RC)",
    group: "Prices & markets",
    jsonPath: "/data/futures_chain.json",
    filename: "futures_chain",
    note: "Latest snapshot of both chains, tagged by market",
    toRows: (raw: any) => {
      const a = asArr<any>(raw?.arabica?.contracts).map(c => ({ market: "arabica", pub_date: raw?.arabica?.pub_date, ...c }));
      const r = asArr<any>(raw?.robusta?.contracts).map(c => ({ market: "robusta", pub_date: raw?.robusta?.pub_date, ...c }));
      return [...a, ...r];
    },
  },
  {
    key: "latest_prices",
    label: "Latest prices — tickers panel",
    group: "Prices & markets",
    jsonPath: "/data/latest_prices.json",
    filename: "latest_prices",
    toRows: (raw: any) => asArr<any>(raw?.tickers),
  },
  {
    key: "origin_prices_history",
    label: "Origin farmgate prices — daily history",
    group: "Prices & markets",
    jsonPath: "/data/origin_prices_history.json",
    filename: "origin_prices_history",
    note: "Vietnam / Brazil / Uganda farmgate, daily",
    toRows: (raw: any) => {
      const origins = asObj(raw?.origins);
      return Object.entries(origins).flatMap(([key, o]: [string, any]) =>
        asArr<any>(o?.history).map(row => ({
          origin_key:  key,
          origin_name: o?.name,
          source:      o?.source,
          currency:    o?.currency,
          unit:        o?.unit,
          date:        row?.date,
          price:       row?.price,
        }))
      );
    },
  },
  {
    key: "freight_routes_now",
    label: "Freight — current rates (USD / FEU)",
    group: "Prices & markets",
    jsonPath: "/data/freight.json",
    filename: "freight_routes_current",
    note: "Freightos / proxy mix · latest week",
    toRows: (raw: any) => asArr<any>(raw?.routes),
  },
  {
    key: "freight_history",
    label: "Freight — weekly history",
    group: "Prices & markets",
    jsonPath: "/data/freight.json",
    filename: "freight_history",
    note: "Per-route weekly closes",
    toRows: (raw: any) => asArr<any>(raw?.history),
  },
  {
    key: "cot_weekly",
    label: "COT — Coffee (NY + LDN weekly, 6y)",
    group: "Prices & markets",
    jsonPath: "/data/cot.json",
    filename: "cot_weekly",
    note: "CFTC disaggregated · one row per (date × market)",
    toRows: (raw: any) => {
      const series = Array.isArray(raw) ? raw : asArr(raw);
      return series.flatMap((w: any) => {
        const out: Record<string, unknown>[] = [];
        for (const mkt of ["ny", "ldn"] as const) {
          const m = asObj((w as any)?.[mkt]);
          if (Object.keys(m).length === 0) continue;
          out.push({ date: (w as any)?.date, market: mkt, ...m });
        }
        return out;
      });
    },
  },
  {
    key: "macro_cot",
    label: "COT — Macro commodities (weekly)",
    group: "Prices & markets",
    jsonPath: "/data/macro_cot.json",
    filename: "macro_cot_weekly",
    note: "CFTC disaggregated · all macro commodities, one row per (date × symbol)",
    toRows: (raw: any) => {
      const series = Array.isArray(raw) ? raw : asArr(raw);
      return series.flatMap((w: any) =>
        asArr<any>(w?.commodities).map(c => ({ date: w?.date, ...c }))
      );
    },
  },

  // =========================================================================
  // MACRO — inflation, FX.
  // =========================================================================
  {
    key: "retail_cpi",
    label: "Retail coffee CPI — US / EU / Brazil",
    group: "Macro",
    jsonPath: "/data/retail_cpi.json",
    filename: "retail_coffee_cpi_monthly",
    note: "BLS / Eurostat / BCB-SGS · monthly indices + YoY%",
    toRows: (raw: any) => {
      const series = asObj(raw?.series);
      return Object.entries(series).flatMap(([key, s]: [string, any]) =>
        asArr<any>(s?.monthly).map(row => ({
          series_key:  key,
          series_name: s?.name,
          ...row,
        }))
      );
    },
  },
  {
    key: "us_cpi",
    label: "US CPI — headline + core + food + energy",
    group: "Macro",
    jsonPath: "/data/us_cpi.json",
    filename: "us_cpi_monthly",
    note: "BLS CPI-U · monthly",
    toRows: (raw: any) => {
      const series = asObj(raw?.series);
      return Object.entries(series).flatMap(([key, s]: [string, any]) =>
        asArr<any>(s?.monthly).map(row => ({
          series_key:  key,
          series_name: s?.name,
          ...row,
        }))
      );
    },
  },
  {
    key: "fx_history",
    label: "FX — origin currencies vs USD (daily, ~1y)",
    group: "Macro",
    jsonPath: "/data/fx_history.json",
    filename: "fx_history_daily",
    note: "12 pairs · BRL/VND/COP/IDR/PEN/etc · daily closes",
    toRows: (raw: any) => {
      const pairs = asObj(raw?.pairs);
      return Object.entries(pairs).flatMap(([sym, p]: [string, any]) =>
        asArr<any>(p?.history).map(row => ({
          pair:       sym,
          pair_name:  p?.name,
          type:       p?.type,
          weight:     p?.weight,
          date:       row?.date,
          close:      row?.close,
        }))
      );
    },
  },
];
