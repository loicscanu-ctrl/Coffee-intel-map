"use client";
/**
 * Report wrappers for the Indonesia (BPS) export chart suite — mirrors the
 * Brazil report set. All reuse buildIndonesiaData (same transform as the Supply
 * tab) so the report matches the tab; interactive filters default to "all".
 */
import { useEffect, useMemo, useState } from "react";
import { buildIndonesiaData, type RawIndonesiaExports } from "@/components/supply/IndonesiaExports/data";
import type { IndonesiaExportsData } from "@/components/supply/IndonesiaExports/types";
import MonthlyVolumeChart from "@/components/supply/IndonesiaExports/MonthlyVolumeChart";
import CumulativePaceChart from "@/components/supply/IndonesiaExports/CumulativePaceChart";
import AnnualTrendChart from "@/components/supply/IndonesiaExports/AnnualTrendChart";
import TypeShareChart from "@/components/supply/IndonesiaExports/TypeShareChart";
import YoYByTypeChart from "@/components/supply/IndonesiaExports/YoYByTypeChart";
import SeasonalityHeatmap from "@/components/supply/IndonesiaExports/SeasonalityHeatmap";
import DestinationChart from "@/components/supply/IndonesiaExports/DestinationChart";

function useIndo() {
  const [raw, setRaw] = useState<RawIndonesiaExports | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/data/indonesia_exports.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setRaw)
      .catch(() => setError(true));
  }, []);
  const data = useMemo<IndonesiaExportsData | null>(() => (raw ? buildIndonesiaData(raw) : null), [raw]);
  return { data, error };
}

const fb = (error: boolean, data: unknown) =>
  error ? <div className="p-4 text-xs text-slate-500">Indonesia export data unavailable.</div>
        : !data ? <div className="p-4 text-xs text-slate-500">Loading Indonesia exports…</div>
        : null;

export function IndonesiaMonthlyVolume() {
  const { data, error } = useIndo();
  return fb(error, data) ?? <MonthlyVolumeChart series={data!.series} typeFilter={null} isFiltered={false} />;
}
export function IndonesiaCumulativePace() {
  const { data, error } = useIndo();
  return fb(error, data) ?? <CumulativePaceChart series={data!.series} typeFilter={null} />;
}
export function IndonesiaAnnualTrend() {
  const { data, error } = useIndo();
  return fb(error, data) ?? <AnnualTrendChart series={data!.series} typeFilter={null} />;
}
export function IndonesiaTypeShare() {
  const { data, error } = useIndo();
  return fb(error, data) ?? <TypeShareChart series={data!.series} />;
}
export function IndonesiaYoYType() {
  const { data, error } = useIndo();
  return fb(error, data) ?? <YoYByTypeChart series={data!.series} typeFilter={null} />;
}
export function IndonesiaSeasonality() {
  const { data, error } = useIndo();
  return fb(error, data) ?? <SeasonalityHeatmap series={data!.series} />;
}
export function IndonesiaDestination() {
  const { data, error } = useIndo();
  const d = data;
  return fb(error, d) ?? (
    <DestinationChart
      byCountry={d!.by_country}
      byCountryPrev={d!.by_country_prev}
      byCountryArabica={d!.by_country_arabica}
      byCountryArabicaPrev={d!.by_country_arabica_prev}
      byCountryRobusta={d!.by_country_robusta}
      byCountryRobustaPrev={d!.by_country_robusta_prev}
      byCountryHistory={d!.by_country_history}
      byPort={d!.by_port}
      byPortPrev={d!.by_port_prev}
      byPortHistory={d!.by_port_history}
    />
  );
}
