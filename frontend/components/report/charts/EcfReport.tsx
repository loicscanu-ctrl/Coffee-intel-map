"use client";
/**
 * Report wrapper: ECF European Port Stocks. Reuses the exact EcfPanel rendered
 * on the Demand tab, fed from /data/ecf_history.json.
 */
import { useEffect, useState } from "react";
import { EcfPanel, type EcfData } from "@/components/demand/StocksPanel";

export default function EcfReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  const [data, setData] = useState<EcfData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/data/ecf_history.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: EcfData | null) => (j ? setData(j) : setErr(true)))
      .catch(() => setErr(true));
  }, []);

  if (err) return <div className="p-4 text-xs text-slate-500">ECF port-stocks data unavailable.</div>;
  if (!data) return <div className="p-4 text-xs text-slate-500">Loading ECF port stocks…</div>;
  return <EcfPanel ecf={data} />;
}
