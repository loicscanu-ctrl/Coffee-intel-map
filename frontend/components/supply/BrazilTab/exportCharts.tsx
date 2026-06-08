"use client";
/**
 * Brazil export charts — single source of truth for how each Cecafe chart is
 * instantiated (which props/data it receives). BOTH the Supply tab and the News
 * report builder render through these cards + the shared data hook, so the
 * report can never drift from the tab: a new prop is added here once and both
 * surfaces get it. Visual/format changes live in the underlying chart
 * components and propagate automatically.
 */
import { useEffect, useState } from "react";
import MonthlyVolumeChart from "./MonthlyVolumeChart";
import CumulativePaceChart from "./CumulativePaceChart";
import AnnualTrendChart from "./AnnualTrendChart";
import DestinationChart from "./DestinationChart";
import type { BrazilProjection, CecafeData, SeriesKey, VolumeSeries } from "./types";

/** Fetches the two SSOT files the Brazil export charts need (cecafe.json + the
 *  crop-year projection). Projection is non-fatal when absent. */
export function useBrazilExportData() {
  const [data, setData] = useState<CecafeData | null>(null);
  const [projection, setProjection] = useState<BrazilProjection | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/data/cecafe.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CecafeData | null) => (d ? setData(d) : setError(true)))
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    fetch("/data/brazil_export_projection.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BrazilProjection | null) => d && setProjection(d))
      .catch(() => { /* engine hasn't run yet — silent */ });
  }, []);
  return { data, projection, error };
}

interface CardArgs {
  data: CecafeData;
  projection?: BrazilProjection | null;
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isReportMode?: boolean;
}

export function MonthlyVolumeCard({ data, projection, filteredSeries, typeFilter, isReportMode }: CardArgs) {
  return (
    <MonthlyVolumeChart
      series={filteredSeries ?? data.series}
      typeFilter={typeFilter}
      isFiltered={!!filteredSeries}
      projection={projection}
      isReportMode={isReportMode}
    />
  );
}

export function CumulativePaceCard({ data, projection, filteredSeries, typeFilter }: CardArgs) {
  return (
    <CumulativePaceChart
      series={data.series}
      filteredSeries={filteredSeries}
      typeFilter={typeFilter}
      projection={projection}
    />
  );
}

export function AnnualTrendCard({ data, filteredSeries, typeFilter, isReportMode }: CardArgs) {
  return (
    <AnnualTrendChart
      series={data.series}
      filteredSeries={filteredSeries}
      typeFilter={typeFilter}
      isReportMode={isReportMode}
    />
  );
}

export function DestinationCard({ data, isReportMode }: CardArgs) {
  return (
    <DestinationChart
      byCountry={data.by_country} byCountryPrev={data.by_country_prev}
      byArabica={data.by_country_arabica} byArabicaPrev={data.by_country_arabica_prev}
      byConillon={data.by_country_conillon} byConillonPrev={data.by_country_conillon_prev}
      bySoluvel={data.by_country_soluvel} bySoluvelPrev={data.by_country_soluvel_prev}
      byTorrado={data.by_country_torrado} byTorradoPrev={data.by_country_torrado_prev}
      byCountryHistory={data.by_country_history}
      isReportMode={isReportMode}
    />
  );
}
