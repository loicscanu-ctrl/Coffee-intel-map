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
}

const loading = () => <div className="p-4 text-xs text-slate-500">Loading…</div>;

export const REPORT_REGISTRY: ReportChartDef[] = [
  // ── Futures ────────────────────────────────────────────────────────────────
  {
    id: "daily_quotes",
    label: "Daily Quotes",
    category: "Futures",
    description: "ICE futures chain (Barchart) — NY Arabica & London Robusta, last/change/spread/OI/volume.",
    Component: dynamic(() => import("@/components/report/charts/DailyQuotesReport"), { ssr: false, loading }),
  },
  {
    id: "cot_overview",
    label: "COT Positioning Overview",
    category: "Futures",
    description: "Weekly per-market summary — OI, price/structure, industry coverage and managed-money flow.",
    Component: dynamic(() => import("@/components/report/charts/CotOverviewReport"), { ssr: false, loading }),
  },
  {
    id: "oi_fnd",
    label: "OI Evolution to FND — NY & London",
    category: "Futures",
    description: "Open-interest run-down into First Notice Day — NY Arabica (left) & London Robusta (right).",
    Component: dynamic(() => import("@/components/report/charts/FuturesReports"), { ssr: false, loading }),
  },

  // ── Freight ────────────────────────────────────────────────────────────────
  {
    id: "freight_spot",
    label: "Freight Spot Rates — Coffee Corridors",
    category: "Freight",
    description: "Current container spot rates on the key coffee shipping corridors, vs prior reading.",
    Component: dynamic(() => import("@/components/report/charts/FreightReports").then((m) => ({ default: m.FreightSpotRates })), { ssr: false, loading }),
  },
  {
    id: "freight_evolution",
    label: "Freight Rate Evolution",
    category: "Freight",
    description: "Historical freight-rate trend across VN→EU, BR→EU, VN→US and ET→EU corridors.",
    Component: dynamic(() => import("@/components/report/charts/FreightReports").then((m) => ({ default: m.FreightRateEvolution })), { ssr: false, loading }),
  },

  // ── Supply ─────────────────────────────────────────────────────────────────
  {
    id: "brazil_daily_registration",
    label: "Brazil — Daily Export Registration",
    category: "Supply",
    description: "Cecafe daily cumulative registration (Arabica + Conilon) vs prior crop years.",
    Component: dynamic(() => import("@/components/supply/BrazilTab/DailyRegistration"), { ssr: false, loading }),
  },
  {
    id: "brazil_monthly_volume",
    label: "Brazil — Monthly Export Volume",
    category: "Supply",
    description: "Cecafe monthly export volumes by crop year (Apr–Mar).",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilMonthlyVolume })), { ssr: false, loading }),
  },
  {
    id: "brazil_annual_trend",
    label: "Brazil — Annual Exports by Type",
    category: "Supply",
    description: "Cecafe crop-year exports split by arabica / conillon / soluble / R&G, with projected gap.",
    Component: dynamic(() => import("@/components/report/charts/BrazilAnnualTrendReport"), { ssr: false, loading }),
  },
  {
    id: "brazil_cumulative_pace",
    label: "Brazil — Cumulative Crop-Year Pace",
    category: "Supply",
    description: "Current vs prior two crop years, cumulative export pace through the marketing year.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilCumulativePace })), { ssr: false, loading }),
  },
  {
    id: "brazil_destination",
    label: "Brazil — Export by Destination",
    category: "Supply",
    description: "Top destinations for Brazilian coffee, current vs prior period.",
    Component: dynamic(() => import("@/components/report/charts/BrazilExportReports").then((m) => ({ default: m.BrazilDestination })), { ssr: false, loading }),
  },
  {
    id: "brazil_supply_demand",
    label: "Brazil — Supply & Demand",
    category: "Supply",
    description: "USDA PSD balance: production, exports, domestic use and ending stocks.",
    Component: dynamic(() => import("@/components/report/charts/SupplyDemandReports").then((m) => ({ default: m.BrazilSupplyDemand })), { ssr: false, loading }),
  },
  {
    id: "brazil_weather_analogs",
    label: "Brazil — Top-5 Weather Analogs",
    category: "Supply",
    description: "Closest historical weather analogs with detrended crop outcomes.",
    Component: dynamic(() => import("@/components/report/charts/WeatherAnalogReports").then((m) => ({ default: m.BrazilWeatherAnalogs })), { ssr: false, loading }),
  },
  {
    id: "vietnam_monthly_volume",
    label: "Vietnam — Monthly Export Volume",
    category: "Supply",
    description: "Green coffee monthly exports by crop year (Oct–Sep).",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamMonthlyVolume })), { ssr: false, loading }),
  },
  {
    id: "vietnam_cumulative_pace",
    label: "Vietnam — Cumulative Crop-Year Pace",
    category: "Supply",
    description: "Current vs prior crop years, cumulative export pace (Oct–Sep).",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamCumulativePace })), { ssr: false, loading }),
  },
  {
    id: "vietnam_annual_volume",
    label: "Vietnam — Annual Export Volume",
    category: "Supply",
    description: "Annual green coffee export totals.",
    Component: dynamic(() => import("@/components/report/charts/VietnamExportReports").then((m) => ({ default: m.VietnamAnnualVolume })), { ssr: false, loading }),
  },
  {
    id: "vietnam_supply_demand",
    label: "Vietnam — Supply & Demand",
    category: "Supply",
    description: "USDA PSD balance: production, exports, domestic use and ending stocks.",
    Component: dynamic(() => import("@/components/report/charts/SupplyDemandReports").then((m) => ({ default: m.VietnamSupplyDemand })), { ssr: false, loading }),
  },
  {
    id: "vietnam_weather_analogs",
    label: "Vietnam — Top-5 Weather Analogs",
    category: "Supply",
    description: "Closest historical weather analogs with detrended crop outcomes.",
    Component: dynamic(() => import("@/components/report/charts/WeatherAnalogReports").then((m) => ({ default: m.VietnamWeatherAnalogs })), { ssr: false, loading }),
  },
  {
    id: "enso_oni",
    label: "ENSO — ONI Trajectory & Analogs",
    category: "Supply",
    description: "Current ONI window vs closest historical ENSO analogs (offset 0 = latest month).",
    Component: dynamic(() => import("@/components/report/charts/EnsoReport"), { ssr: false, loading }),
  },

  // ── Demand ─────────────────────────────────────────────────────────────────
  {
    id: "certified_stocks_tiles",
    label: "Certified Stocks (exchange-deliverable)",
    category: "Demand",
    description: "ICE-certified deliverable inventory — headline tiles for Arabica (KC) and Robusta (RC).",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksTilesReport"), { ssr: false, loading }),
  },
  {
    id: "ecf_port_stocks",
    label: "ECF European Port Stocks",
    category: "Demand",
    description: "Green coffee stocks at European ports — ECF series with ICE-certified subset.",
    Component: dynamic(() => import("@/components/report/charts/EcfReport"), { ssr: false, loading }),
  },
  {
    id: "kaffeesteuer",
    label: "German Coffee Tax (Kaffeesteuer)",
    category: "Demand",
    description: "Monthly Kaffeesteuer revenue with 12-mo average — a proxy for German consumption.",
    Component: dynamic(() => import("@/components/demand/KaffeesteuerChart"), { ssr: false, loading }),
  },

  // ── Macro ──────────────────────────────────────────────────────────────────
  {
    id: "coffee_currency_index",
    label: "Coffee Currency Index",
    category: "Macro",
    description: "Trade-weighted index of producer-currency moves vs USD, with per-currency breakdown.",
    Component: dynamic(() => import("@/components/macro/CurrencyIndexSection"), { ssr: false, loading }),
  },
  {
    id: "origin_farmgate_prices",
    label: "Origin Farmgate Prices",
    category: "Macro",
    description: "Reindexed farmgate price trends across Vietnam, Brazil arabica/conilon and Uganda.",
    Component: dynamic(() => import("@/components/macro/OriginPricesPanel"), { ssr: false, loading }),
  },
];

export const REPORT_CATEGORIES: ReportCategory[] = ["Futures", "Freight", "Supply", "Demand", "Macro"];

export const REPORT_BY_ID: Record<string, ReportChartDef> = Object.fromEntries(
  REPORT_REGISTRY.map((d) => [d.id, d]),
);
