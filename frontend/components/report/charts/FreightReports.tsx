"use client";
/**
 * Report wrappers for freight visuals. Both read /data/freight.json: the spot
 * rates are rendered as a clean corridor table, the evolution reuses the
 * exchange's FreightHistoryChart.
 */
import { useEffect, useState } from "react";
import { FreightHistoryChart } from "@/app/freight/FreightCharts";

interface FreightRoute {
  id: string; from: string; to: string; rate: number; prev: number; unit: string; proxy?: boolean;
}
interface FreightData {
  updated?: string;
  routes: FreightRoute[];
  history: Record<string, number | string>[];
}

function useFreight() {
  const [data, setData] = useState<FreightData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/data/freight.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: FreightData | null) => (j ? setData(j) : setErr(true)))
      .catch(() => setErr(true));
  }, []);
  return { data, err };
}

export function FreightSpotRates() {
  const { data, err } = useFreight();
  if (err) return <div className="p-4 text-xs text-slate-500">Freight data unavailable.</div>;
  if (!data) return <div className="p-4 text-xs text-slate-500">Loading freight…</div>;
  return (
    <div className="p-3">
      <div className="text-sm font-semibold text-slate-200 mb-2">Current Spot Rates — Coffee Corridors</div>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-slate-500 text-left border-b border-slate-700">
            <th className="py-1 pr-2">Corridor</th>
            <th className="text-right px-2">Rate</th>
            <th className="text-right px-2">Prev</th>
            <th className="text-right px-2">Change</th>
          </tr>
        </thead>
        <tbody>
          {data.routes.map((r) => {
            const chg = r.prev ? (r.rate / r.prev - 1) * 100 : 0;
            return (
              <tr key={r.id} className="border-b border-slate-800/60">
                <td className="py-1 pr-2 text-slate-300">
                  {r.from} → {r.to}{r.proxy && <span className="ml-1 text-[9px] text-slate-600">(proxy)</span>}
                </td>
                <td className="text-right px-2 font-mono text-slate-100">
                  {r.rate.toLocaleString()} <span className="text-slate-500">{r.unit}</span>
                </td>
                <td className="text-right px-2 font-mono text-slate-500">{r.prev.toLocaleString()}</td>
                <td className={`text-right px-2 font-mono ${chg >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {chg >= 0 ? "+" : ""}{chg.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FreightRateEvolution() {
  const { data, err } = useFreight();
  if (err) return <div className="p-4 text-xs text-slate-500">Freight data unavailable.</div>;
  if (!data) return <div className="p-4 text-xs text-slate-500">Loading freight…</div>;
  return (
    <div className="p-3">
      <div className="text-sm font-semibold text-slate-200 mb-2">Freight Rate Evolution</div>
      <FreightHistoryChart history={data.history} />
    </div>
  );
}
