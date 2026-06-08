"use client";
/**
 * Report wrappers for Brazil (Cecafe) export charts. All read /data/cecafe.json
 * once and feed the prop-driven BrazilTab charts, unfiltered/all-origins, with
 * isReportMode set so filter controls are hidden.
 */
import { useEffect, useState } from "react";
import MonthlyVolumeChart from "@/components/supply/BrazilTab/MonthlyVolumeChart";
import CumulativePaceChart from "@/components/supply/BrazilTab/CumulativePaceChart";
import DestinationChart from "@/components/supply/BrazilTab/DestinationChart";
import type { CecafeData } from "@/components/supply/BrazilTab/types";

function useCecafe() {
  const [data, setData] = useState<CecafeData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/data/cecafe.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: CecafeData | null) => (j ? setData(j) : setErr(true)))
      .catch(() => setErr(true));
  }, []);
  return { data, err };
}

const fallback = (err: boolean, d: unknown) =>
  err ? <div className="p-4 text-xs text-slate-500">Cecafe data unavailable.</div>
      : !d ? <div className="p-4 text-xs text-slate-500">Loading Brazil exports…</div>
      : null;

export function BrazilMonthlyVolume() {
  const { data, err } = useCecafe();
  return fallback(err, data) ?? <MonthlyVolumeChart series={data!.series} isReportMode />;
}

export function BrazilCumulativePace() {
  const { data, err } = useCecafe();
  return fallback(err, data) ?? <CumulativePaceChart series={data!.series} />;
}

export function BrazilDestination() {
  const { data, err } = useCecafe();
  if (fallback(err, data)) return fallback(err, data);
  const d = data!;
  return (
    <DestinationChart
      byCountry={d.by_country} byCountryPrev={d.by_country_prev}
      byArabica={d.by_country_arabica} byArabicaPrev={d.by_country_arabica_prev}
      byConillon={d.by_country_conillon} byConillonPrev={d.by_country_conillon_prev}
      bySoluvel={d.by_country_soluvel} bySoluvelPrev={d.by_country_soluvel_prev}
      byTorrado={d.by_country_torrado} byTorradoPrev={d.by_country_torrado_prev}
      byCountryHistory={d.by_country_history}
      isReportMode
    />
  );
}
