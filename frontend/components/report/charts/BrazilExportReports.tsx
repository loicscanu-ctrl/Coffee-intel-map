"use client";
/**
 * Report wrappers for Brazil (Cecafe) export charts. These render through the
 * SAME shared exportCharts module the Supply tab uses (data hook + cards), so
 * the report is guaranteed to match the tab — format AND data wiring.
 */
import {
  useBrazilExportData,
  MonthlyVolumeCard,
  CumulativePaceCard,
  DestinationCard,
} from "@/components/supply/BrazilTab/exportCharts";

const fallback = (error: boolean, data: unknown) =>
  error ? <div className="p-4 text-xs text-slate-500">Cecafe data unavailable.</div>
        : !data ? <div className="p-4 text-xs text-slate-500">Loading Brazil exports…</div>
        : null;

export function BrazilMonthlyVolume() {
  const { data, projection, error } = useBrazilExportData();
  return fallback(error, data) ?? <MonthlyVolumeCard data={data!} projection={projection} isReportMode />;
}

export function BrazilCumulativePace() {
  const { data, projection, error } = useBrazilExportData();
  return fallback(error, data) ?? <CumulativePaceCard data={data!} projection={projection} isReportMode />;
}

export function BrazilDestination() {
  const { data, error } = useBrazilExportData();
  return fallback(error, data) ?? <DestinationCard data={data!} isReportMode />;
}
