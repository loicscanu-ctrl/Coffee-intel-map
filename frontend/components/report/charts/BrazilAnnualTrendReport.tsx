"use client";
/**
 * Report-mode wrapper for Brazil's Annual Export by Coffee Type.
 *
 * The in-app chart (BrazilTab/AnnualTrendChart) is prop-driven — its parent tab
 * fetches cecafe.json and passes a filtered series + origin/type filters. Here
 * we fetch the feed ourselves and render the unfiltered, all-origins view with
 * isReportMode set so the chart hides its "since year" controls.
 */
import { useEffect, useState } from "react";
import AnnualTrendChart from "@/components/supply/BrazilTab/AnnualTrendChart";
import type { CecafeData } from "@/components/supply/BrazilTab/types";

export default function BrazilAnnualTrendReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  const [data, setData] = useState<CecafeData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/data/cecafe.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CecafeData | null) => { if (!d) { setErr(true); return; } setData(d); })
      .catch(() => setErr(true));
  }, []);

  if (err) return <div className="p-4 text-xs text-slate-500">Cecafe data unavailable.</div>;
  if (!data) return <div className="p-4 text-xs text-slate-500">Loading Brazil exports…</div>;

  return <AnnualTrendChart series={data.series} isReportMode />;
}
