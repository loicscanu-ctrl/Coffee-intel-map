"use client";
/**
 * Report wrappers for the remaining Brazil (Cecafe) export charts — type share,
 * Y/Y-by-type and the monthly seasonality heatmap. They reuse the shared
 * useBrazilExportData hook (same data as the Supply tab) and feed the tab's own
 * chart components their `series`, so the report matches the tab.
 */
import { useBrazilExportData } from "@/components/supply/BrazilTab/exportCharts";
import SeasonalityHeatmap from "@/components/supply/BrazilTab/SeasonalityHeatmap";
import TypeShareChart from "@/components/supply/BrazilTab/TypeShareChart";
import YoYByTypeChart from "@/components/supply/BrazilTab/YoYByTypeChart";

const fallback = (error: boolean, data: unknown) =>
  error ? <div className="p-4 text-xs text-slate-500">Cecafe data unavailable.</div>
        : !data ? <div className="p-4 text-xs text-slate-500">Loading Brazil exports…</div>
        : null;

export function BrazilTypeShare() {
  const { data, error } = useBrazilExportData();
  return fallback(error, data) ?? <TypeShareChart series={data!.series} />;
}

export function BrazilYoYType() {
  const { data, error } = useBrazilExportData();
  return fallback(error, data) ?? <YoYByTypeChart series={data!.series} />;
}

export function BrazilSeasonality() {
  const { data, error } = useBrazilExportData();
  return fallback(error, data) ?? <SeasonalityHeatmap series={data!.series} />;
}
