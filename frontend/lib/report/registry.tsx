/**
 * Chart registry — the backbone of the Dynamic Briefing Engine.
 *
 * One place maps a stable ID → how to render it in a report. The cart UI, the
 * preview canvas and the export all read from this list, so "make a chart
 * report-able" is a single entry here (plus, if needed, a self-contained
 * wrapper that fetches its own data and hides interactive chrome).
 *
 * Every visual is loaded with `next/dynamic` (ssr:false) so the heavy chart
 * code only ships when a chart is actually selected — the News landing page
 * stays cheap. NOTE: next/dynamic's options must be an inline object literal
 * (SWC compile-time transform), so each call repeats `{ ssr: false, loading }`.
 */
import type { ComponentType } from "react";
import dynamic from "next/dynamic";

export type ReportCategory = "Futures" | "Freight" | "Supply" | "Demand" | "Macro";

export interface ReportChartDef {
  id: string;
  label: string;
  category: ReportCategory;
  description?: string;
  Component: ComponentType<{ isReportMode?: boolean }>;
  /**
   * Split note boxes. When set, the report canvas renders one note textarea per
   * entry (laid out in a row that aligns under the chart's columns) instead of a
   * single full-width box — e.g. a separate note under the NY and London charts.
   * Each note is stored under `${id}__${key}`.
   */
  notes?: { key: string; label: string }[];
  /**
   * Canvas footprint. "full" spans the report column (use for combined two-up
   * visuals like Arabica+Robusta, and dense panels); "half" takes half the
   * column so two consecutive half visuals pack side by side. Defaults to "full".
   */
  width?: "full" | "half";
  /**
   * Cart hierarchy mirroring the app's tab structure: category → group → subgroup
   * → item (e.g. Supply → Brazil → Exports). Both optional; items with no group
   * render directly under the category, items with no subgroup directly under the
   * group. Order follows the registry array.
   */
  group?: string;
  subgroup?: string;
}

const loading = () => <div className="p-4 text-xs text-slate-500">Loading…</div>;

// NY/London split notes — shared by the dual futures visuals.
const NY_LDN_NOTES = [
  { key: "ny", label: "NY · Arabica" },
  { key: "ldn", label: "London · Robusta" },
];

export const REPORT_REGISTRY: ReportChartDef[] = [
  // ── Futures ────────────────────────────────────────────────────────────────
  {
    id: "daily_quotes",
    label: "Daily Quotes",
    category: "Futures",
    description: "ICE futures chain (Barchart) — NY Arabica & London Robusta, last/change/spread/OI/volume.",
    Component: dynamic(() => import("@/components/report/charts/DailyQuotesReport"), { ssr: false, loading }),
    notes: NY_LDN_NOTES,
    width: "full",
  },
  {
    id: "cot_overview",
    label: "COT Positioning Overview",
    category: "Futures",
    description: "Weekly per-market summary — OI, price/structure, industry coverage and managed-money flow.",
    Component: dynamic(() => import("@/components/report/charts/CotOverviewReport"), { ssr: false, loading }),
    notes: NY_LDN_NOTES,
    width: "full",
  },
  {
    id: "oi_fnd",
    label: "OI Evolution to FND — NY & London",
    category: "Futures",
    description: "Open-interest run-down into First Notice Day — NY Arabica (left) & London Robusta (right).",
    Component: dynamic(() => import("@/components/report/charts/FuturesReports"), { ssr: false, loading }),
    notes: NY_LDN_NOTES,
    width: "full",
  },

  // ── Freight ────────────────────────────────────────────────────────────────
  {
    id: "freight_spot",
    label: "Freight Spot Rates — Coffee Corridors",
    category: "Freight",
    description: "Current container spot rates on the key coffee shipping corridors, vs prior reading.",
    Component: dynamic(() => import("@/components/report/charts/FreightReports").then((m) => ({ default: m.FreightSpotRates })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "freight_evolution",
    label: "Freight Rate Evolution",
    category: "Freight",
    description: "Historical freight-rate trend across VN→EU, BR→EU, VN→US and ET→EU corridors.",
    Component: dynamic(() => import("@/components/report/charts/FreightReports").then((m) => ({ default: m.FreightRateEvolution })), { ssr: false, loading }),
    width: "half",
  },

  // ── Supply ─────────────────────────────────────────────────────────────────
  {
    id: "brazil_daily_registration",
    label: "Brazil — Daily Export Registration",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Cecafe daily cumulative registration (Arabica + Conilon) vs prior crop years.",
    Component: dynamic(() => import("@/components/supply/BrazilTab/DailyRegistration"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "brazil_monthly_volume",
    label: "Brazil — Monthly Export Volume",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Cecafe monthly export volumes by crop year (Apr–Mar).",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilMonthlyVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_annual_trend",
    label: "Brazil — Annual Exports by Type",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Cecafe crop-year exports split by arabica / conillon / soluble / R&G, with projected gap.",
    Component: dynamic(() => import("@/components/report/charts/BrazilAnnualTrendReport"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_cumulative_pace",
    label: "Brazil — Cumulative Crop-Year Pace",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Current vs prior two crop years, cumulative export pace through the marketing year.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilCumulativePace })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_destination",
    label: "Brazil — Export by Destination",
    group: "Brazil",
    subgroup: "Exports",
    category: "Supply",
    description: "Top destinations for Brazilian coffee, current vs prior period.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilDestination })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_supply_demand",
    label: "Brazil — Supply & Demand",
    group: "Brazil",
    subgroup: "Supply & Demand",
    category: "Supply",
    description: "USDA PSD balance: production, exports, domestic use and ending stocks.",
    Component: dynamic(() => import("@/components/report/charts/SupplyDemandReports").then((m) => ({ default: m.BrazilSupplyDemand })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "brazil_weather_analogs",
    label: "Brazil — Top-5 Weather Analogs",
    group: "Brazil",
    subgroup: "Weather",
    category: "Supply",
    description: "Closest historical weather analogs with detrended crop outcomes.",
    Component: dynamic(() => import("@/components/report/charts/WeatherAnalogReports").then((m) => ({ default: m.BrazilWeatherAnalogs })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "brazil_weather_pack",
    label: "Brazil — Weather (rainfall & temperature)",
    group: "Brazil",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.BrazilWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "vietnam_monthly_volume",
    label: "Vietnam — Monthly Export Volume",
    group: "Vietnam",
    subgroup: "Exports",
    category: "Supply",
    description: "Green coffee monthly exports by crop year (Oct–Sep).",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamMonthlyVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_cumulative_pace",
    label: "Vietnam — Cumulative Crop-Year Pace",
    group: "Vietnam",
    subgroup: "Exports",
    category: "Supply",
    description: "Current vs prior crop years, cumulative export pace (Oct–Sep).",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamCumulativePace })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_annual_volume",
    label: "Vietnam — Annual Export Volume",
    group: "Vietnam",
    subgroup: "Exports",
    category: "Supply",
    description: "Annual green coffee export totals.",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamAnnualVolume })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_supply_demand",
    label: "Vietnam — Supply & Demand",
    group: "Vietnam",
    subgroup: "Supply & Demand",
    category: "Supply",
    description: "USDA PSD balance: production, exports, domestic use and ending stocks.",
    Component: dynamic(() => import("@/components/report/charts/SupplyDemandReports").then((m) => ({ default: m.VietnamSupplyDemand })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "vietnam_weather_analogs",
    label: "Vietnam — Top-5 Weather Analogs",
    group: "Vietnam",
    subgroup: "Weather",
    category: "Supply",
    description: "Closest historical weather analogs with detrended crop outcomes.",
    Component: dynamic(() => import("@/components/report/charts/WeatherAnalogReports").then((m) => ({ default: m.VietnamWeatherAnalogs })), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "vietnam_weather_pack",
    label: "Vietnam — Weather (rainfall & temperature)",
    group: "Vietnam",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.VietnamWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "colombia_weather_pack",
    label: "Colombia — Weather (rainfall & temperature)",
    group: "Colombia",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.ColombiaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "honduras_weather_pack",
    label: "Honduras — Weather (rainfall & temperature)",
    group: "Honduras",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.HondurasWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "ethiopia_weather_pack",
    label: "Ethiopia — Weather (rainfall & temperature)",
    group: "Ethiopia",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.EthiopiaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "uganda_weather_pack",
    label: "Uganda — Weather (rainfall & temperature)",
    group: "Uganda",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.UgandaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "indonesia_weather_pack",
    label: "Indonesia — Weather (rainfall & temperature)",
    group: "Indonesia",
    subgroup: "Weather",
    category: "Supply",
    description: "Daily accumulated rainfall, mean temperature, monthly rainfall and cumulative YTD rainfall — prod-weighted.",
    Component: dynamic(() => import("@/components/report/charts/WeatherPackReports").then((m) => ({ default: m.IndonesiaWeather })), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "enso_oni",
    label: "ENSO — ONI Trajectory & Analogs",
    group: "Cross-origin",
    category: "Supply",
    description: "Current ONI window vs closest historical ENSO analogs (offset 0 = latest month).",
    Component: dynamic(() => import("@/components/report/charts/EnsoReport"), { ssr: false, loading }),
    width: "half",
  },

  // ── Demand ─────────────────────────────────────────────────────────────────
  {
    id: "certified_stocks_tiles",
    label: "Certified Stocks (exchange-deliverable)",
    category: "Demand",
    description: "ICE-certified deliverable inventory — headline tiles for Arabica (KC) and Robusta (RC).",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksTilesReport"), { ssr: false, loading }),
    notes: [
      { key: "arabica", label: "Arabica · KC" },
      { key: "robusta", label: "Robusta · RC" },
    ],
    width: "full",
  },
  {
    id: "ecf_port_stocks",
    label: "ECF European Port Stocks",
    category: "Demand",
    description: "Green coffee stocks at European ports — ECF series with ICE-certified subset.",
    Component: dynamic(() => import("@/components/report/charts/EcfReport"), { ssr: false, loading }),
    width: "half",
  },
  {
    id: "kaffeesteuer",
    label: "German Coffee Tax (Kaffeesteuer)",
    category: "Demand",
    description: "Monthly Kaffeesteuer revenue with 12-mo average — a proxy for German consumption.",
    Component: dynamic(() => import("@/components/demand/KaffeesteuerChart"), { ssr: false, loading }),
    width: "half",
  },

  // ── Macro ──────────────────────────────────────────────────────────────────
  {
    id: "coffee_currency_index",
    label: "Coffee Currency Index",
    category: "Macro",
    description: "Trade-weighted index of producer-currency moves vs USD, with per-currency breakdown.",
    Component: dynamic(() => import("@/components/macro/CurrencyIndexSection"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "origin_farmgate_prices",
    label: "Origin Farmgate Prices",
    category: "Macro",
    description: "Reindexed farmgate price trends across Vietnam, Brazil arabica/conilon and Uganda.",
    Component: dynamic(() => import("@/components/macro/OriginPricesPanel"), { ssr: false, loading }),
    width: "full",
  },
  {
    id: "fertilizer_inputs",
    label: "Fertilizer Inputs (N-P-K)",
    category: "Macro",
    description: "Headline N-P-K prices (World Bank Pink Sheet) that drive coffee production cost, with history.",
    Component: dynamic(() => import("@/components/macro/FertilizerInputsPanel"), { ssr: false, loading }),
    width: "full",
  },
];

export const REPORT_CATEGORIES: ReportCategory[] = ["Futures", "Freight", "Supply", "Demand", "Macro"];

export const REPORT_BY_ID: Record<string, ReportChartDef> = Object.fromEntries(
  REPORT_REGISTRY.map((d) => [d.id, d]),
);
