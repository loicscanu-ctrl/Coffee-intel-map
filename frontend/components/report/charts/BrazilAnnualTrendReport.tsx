"use client";
/**
 * Report wrapper for Brazil's Annual Export by Coffee Type. Renders through the
 * shared exportCharts module (same as the Supply tab), unfiltered + report mode.
 */
import { useBrazilExportData, AnnualTrendCard } from "@/components/supply/BrazilTab/exportCharts";

export default function BrazilAnnualTrendReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  const { data, error } = useBrazilExportData();
  if (error) return <div className="p-4 text-xs text-slate-500">Cecafe data unavailable.</div>;
  if (!data) return <div className="p-4 text-xs text-slate-500">Loading Brazil exports…</div>;
  return <AnnualTrendCard data={data} isReportMode />;
}
