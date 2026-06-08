/**
 * Chart registry — the backbone of the Dynamic Briefing Engine.
 *
 * One place maps a stable ID → how to render it in a report. The cart UI, the
 * preview canvas and the export all read from this list, so "make a chart
 * report-able" is a single entry here (plus, if needed, a self-contained
 * `*Report` wrapper that fetches its own data and hides interactive chrome).
 *
 * Visuals are loaded with `next/dynamic` (ssr:false): the heavy Recharts/COT
 * code only ships when a chart is actually selected, so importing this registry
 * on the News landing page stays cheap. The metadata (id/label/category) is
 * static, so the cart and the pin buttons resolve instantly.
 */
import type { ComponentType } from "react";
import dynamic from "next/dynamic";

export type ReportCategory = "Supply" | "Demand" | "Macro";

export interface ReportChartDef {
  id: string;
  label: string;
  category: ReportCategory;
  description?: string;
  /** Self-contained, control-free render of the visual for the report. */
  Component: ComponentType<{ isReportMode?: boolean }>;
}

const loading = () => (
  <div className="p-4 text-xs text-slate-500">Loading…</div>
);

export const REPORT_REGISTRY: ReportChartDef[] = [
  {
    id: "certified_stocks_flow",
    label: "Certified Stocks System Flow",
    category: "Demand",
    description:
      "ICE-certified arabica & robusta deliverable inventory — grading intake → warehouse density → outflow.",
    Component: dynamic(() => import("@/components/report/charts/CertifiedStocksFlowReport"), {
      ssr: false,
      loading,
    }),
  },
  {
    id: "kaffeesteuer",
    label: "German Coffee Tax (Kaffeesteuer)",
    category: "Demand",
    description:
      "Monthly Kaffeesteuer revenue with 12-mo average — a proxy for German (EU's largest) consumption.",
    Component: dynamic(() => import("@/components/demand/KaffeesteuerChart"), { ssr: false, loading }),
  },
  {
    id: "cot_overview",
    label: "COT Positioning Overview",
    category: "Macro",
    description:
      "Weekly per-market summary — OI, price/structure, industry coverage and managed-money flow (NY & London).",
    Component: dynamic(() => import("@/components/report/charts/CotOverviewReport"), { ssr: false, loading }),
  },
  {
    id: "brazil_annual_trend",
    label: "Brazil Annual Exports by Type",
    category: "Supply",
    description:
      "Cecafe crop-year exports split by arabica / conillon / soluble / R&G, with projected full-year gap.",
    Component: dynamic(() => import("@/components/report/charts/BrazilAnnualTrendReport"), {
      ssr: false,
      loading,
    }),
  },
];

export const REPORT_CATEGORIES: ReportCategory[] = ["Supply", "Demand", "Macro"];

export const REPORT_BY_ID: Record<string, ReportChartDef> = Object.fromEntries(
  REPORT_REGISTRY.map((d) => [d.id, d]),
);
