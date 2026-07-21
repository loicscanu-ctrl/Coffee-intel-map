"use client";
/**
 * Report wrappers for the COT dashboard sub-visuals.
 *
 * Six of the seven derive from the same /data/cot.json → transformApiData
 * pipeline the COT Overview report uses (a shared useCotData hook here); Global
 * Money Flow instead needs the macro-COT feed (fetchMacroCot) + flow metrics.
 * Each renders the real dashboard component so the briefing stays in lockstep
 * with the Futures tab.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { transformApiData } from "@/lib/cot/transformApiData";
import type { CotRawRow, ProcessedCotRow } from "@/lib/cot/types";
import { evaluateSignals, evaluateHistoricalSignals } from "@/lib/cot/signalEngine";
import { fetchMacroCot, type MacroCotWeek } from "@/lib/api";

import CotHeatmap from "@/components/futures/CotDashboard/Heatmap";
import CotGauges from "@/components/futures/CotDashboard/Gauges";
import Step1GlobalFlow from "@/components/futures/CotDashboard/Step1GlobalFlow";
import Step4IndustryPulse from "@/components/futures/CotDashboard/Step4IndustryPulse";
import Step5DryPowder from "@/components/futures/CotDashboard/Step5DryPowder";
import Step6CycleLocation from "@/components/futures/CotDashboard/Step6CycleLocation";
import Step7Report from "@/components/futures/CotDashboard/Step7Report";
import Step8Analysis from "@/components/futures/CotDashboard/Step8Analysis";

const Unavailable = () => <div className="p-4 text-xs text-slate-500">COT data unavailable.</div>;
const Loading = () => <div className="p-4 text-xs text-slate-500">Loading COT positioning…</div>;

/** Shared loader: static cot.json → ProcessedCotRow[] (mirrors CotOverviewReport). */
function useCotData() {
  const [rows, setRows] = useState<CotRawRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/data/cot.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CotRawRow[] | null) => {
        if (!d || !Array.isArray(d) || d.length === 0) { setError(true); return; }
        setRows(d);
      })
      .catch(() => setError(true));
  }, []);
  const data = useMemo<ProcessedCotRow[]>(() => (rows ? transformApiData(rows) : []), [rows]);
  return { data, error, loading: rows === null && !error };
}

/** Wrap a cot.json-derived visual with shared loading/error handling. */
function cotVisual(render: (data: ProcessedCotRow[]) => ReactElement) {
  return function CotVisual() {
    const { data, error, loading } = useCotData();
    if (error) return <Unavailable />;
    if (loading || !data.length) return <Loading />;
    return render(data);
  };
}

export const CotHeatmapReport       = cotVisual((data) => <CotHeatmap data={data} />);
export const CotGaugesReport        = cotVisual((data) => <CotGauges data={data} />);
export const CotIndustryPulseReport = cotVisual((data) => <Step4IndustryPulse data={data} />);
export const CotDryPowderReport     = cotVisual((data) => <Step5DryPowder data={data} />);
export const CotCycleLocationReport = cotVisual((data) => <Step6CycleLocation recent52={data.slice(-52)} />);
export const CotReportAnalysis      = cotVisual((data) => <Step7Report data={data} recent52={data.slice(-52)} />);
export const CotSignalsReport       = cotVisual((data) => (
  <Step8Analysis signals={evaluateSignals(data)} historicalSignals={evaluateHistoricalSignals(data)} />
));

export function CotGlobalFlowReport() {
  const [macroData, setMacroData] = useState<MacroCotWeek[]>([]);
  const [macroError, setMacroError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetchMacroCot()
      .then(setMacroData)
      .catch(() => setMacroError(true))
      .finally(() => setLoaded(true));
  }, []);
  if (!loaded && !macroError) return <Loading />;
  // Step1GlobalFlow computes its own window-aware GlobalFlowMetrics internally.
  return <Step1GlobalFlow macroData={macroData} macroError={macroError} />;
}
