"use client";
/**
 * Report wrappers for the extra ENSO visuals (beyond the analog chart in
 * EnsoReport). Both self-fetch /data/enso.json — the same source the ENSO tab
 * uses — and feed the tab's own components, so the report matches the tab.
 */
import { useEffect, useState } from "react";
import EnsoForecastPlume from "@/components/enso/EnsoForecastPlume";
import EnsoRiskTable from "@/components/enso/EnsoRiskTable";
import type { EnsoData } from "@/lib/enso";

function useEnso() {
  const [data, setData] = useState<EnsoData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/data/enso.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: EnsoData | null) => (j ? setData(j) : setError(true)))
      .catch(() => setError(true));
  }, []);
  return { data, error };
}

const fallback = (error: boolean, data: unknown) =>
  error ? <div className="p-4 text-xs text-slate-500">ENSO data unavailable.</div>
        : !data ? <div className="p-4 text-xs text-slate-500">Loading ENSO…</div>
        : null;

export function EnsoPlumeReport() {
  const { data, error } = useEnso();
  return fallback(error, data) ?? <EnsoForecastPlume forecast={data!.oni_forecast} />;
}

export function EnsoRiskTableReport() {
  const { data, error } = useEnso();
  return fallback(error, data) ?? <EnsoRiskTable pins={data!.risk.pins} />;
}
