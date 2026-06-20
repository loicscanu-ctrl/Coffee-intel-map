"use client";
import OriginExplorer, { ImportKpiStrip } from "./OriginExplorer";

// Visual Lab (Test tab): the KPI strip plus the three production concepts now
// shared with the live Imports tab (rank/concentration, origins→blocs Sankey,
// change heatmap). Kept as a gallery entry point for iterating on new ideas.
export default function ImportsVisualsLab() {
  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-white">Imports — Visual Lab ✦</h2>
        <p className="text-xs text-slate-400">
          Data: UN Comtrade (global), USITC (US by origin), Eurostat (EU bloc + member states, by origin).
        </p>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
        <h3 className="text-base font-bold text-slate-100">Import KPIs</h3>
        <ImportKpiStrip />
      </div>
      <OriginExplorer />
    </div>
  );
}
