/**
 * Chart registry — the backbone of the Dynamic Briefing Engine.
 *
 * One place maps a stable ID → how to render it in a report. The cart UI, the
 * preview canvas and the export all read from this list, so "make a chart
 * report-able" is a single entry here (plus, if needed, a self-contained
 * `*Report` wrapper that fetches its own data and hides interactive chrome).
 *
 * v1 ships one real entry (Certified Stocks); add more by appending below.
 */
import type { ComponentType } from "react";
import CertifiedStocksFlowReport from "@/components/report/charts/CertifiedStocksFlowReport";

export type ReportCategory = "Supply" | "Demand" | "Macro";

export interface ReportChartDef {
  id: string;
  label: string;
  category: ReportCategory;
  description?: string;
  /** Self-contained, control-free render of the visual for the report. */
  Component: ComponentType<{ isReportMode?: boolean }>;
}

export const REPORT_REGISTRY: ReportChartDef[] = [
  {
    id: "certified_stocks_flow",
    label: "Certified Stocks System Flow",
    category: "Demand",
    description:
      "ICE-certified arabica & robusta deliverable inventory — grading intake → warehouse density → outflow.",
    Component: CertifiedStocksFlowReport,
  },
];

export const REPORT_CATEGORIES: ReportCategory[] = ["Supply", "Demand", "Macro"];

export const REPORT_BY_ID: Record<string, ReportChartDef> = Object.fromEntries(
  REPORT_REGISTRY.map((d) => [d.id, d]),
);
