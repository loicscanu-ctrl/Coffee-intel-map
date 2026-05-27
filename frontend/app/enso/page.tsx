"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import PageHeader from "@/components/PageHeader";
import EnsoForecastPlume from "@/components/enso/EnsoForecastPlume";
import EnsoAnalogChart from "@/components/enso/EnsoAnalogChart";
import EnsoRiskTable from "@/components/enso/EnsoRiskTable";
import { PHASE_META, phaseLabel, type EnsoData } from "@/lib/enso";

// Leaflet touches `window`, so the risk map is client-only (no SSR).
const EnsoRiskMap = dynamic(() => import("@/components/enso/EnsoRiskMap"), {
  ssr: false,
  loading: () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 text-xs text-slate-500" style={{ height: 360 }}>
      Loading risk map…
    </div>
  ),
});

function PhaseSummary({ data }: { data: EnsoData }) {
  const meta = PHASE_META[data.phase] ?? PHASE_META.neutral;
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-block w-3.5 h-3.5 rounded-full" style={{ background: meta.color }} />
          <div>
            <div className="text-lg font-bold text-white">
              {phaseLabel(data.phase)} <span className="text-slate-400 font-normal">· {data.intensity}</span>
            </div>
            <div className="text-xs text-slate-400">
              Current ONI <span className="font-mono text-slate-200">{data.oni ?? "—"}</span>
              {data.peak_month ? ` · peak ${data.peak_month}` : ""}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-slate-400 max-w-md">
          {data.forecast_direction && <div className="text-slate-300">{data.forecast_direction}</div>}
          {data.historical_stat && <div className="mt-0.5">{data.historical_stat}</div>}
          {data.last_updated && <div className="mt-0.5 text-[10px] text-slate-500">Updated {data.last_updated}</div>}
        </div>
      </div>
    </div>
  );
}

export default function EnsoPage() {
  const [data, setData] = useState<EnsoData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/enso.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-950">
      <PageHeader
        title="ENSO Intelligence"
        subtitle="El Niño / La Niña forecast plumes · historical analogs · coffee crop-risk map"
        healthKeys={["enso"]}
      />
      <div className="p-4 space-y-4">
        {error && (
          <div className="text-xs text-slate-500">
            ENSO data unavailable — enso.json failed to load. Populates after the next export-and-publish run.
          </div>
        )}
        {!data && !error && (
          <div className="text-xs text-slate-500 animate-pulse">Loading ENSO intelligence…</div>
        )}
        {data && (
          <>
            <PhaseSummary data={data} />
            <EnsoForecastPlume forecast={data.oni_forecast} />
            <EnsoAnalogChart current={data.current_window} analogs={data.analogs} />
            <EnsoRiskMap pins={data.risk.pins} />
            <EnsoRiskTable pins={data.risk.pins} />
          </>
        )}
      </div>
    </div>
  );
}
