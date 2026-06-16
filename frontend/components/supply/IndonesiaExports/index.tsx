"use client";
import { useEffect, useMemo, useState } from "react";
import { buildIndonesiaData, type RawIndonesiaExports } from "./data";
import { COUNTRY_HUB } from "./constants";
import { buildFilteredSeries, cropYearKey, kgToKT, monthLabel } from "./helpers";
import type { FilterState, IndonesiaExportsData } from "./types";

import StatCard from "./StatCard";
import CountryHubFilter from "./CountryHubFilter";
import MonthlyVolumeChart from "./MonthlyVolumeChart";
import CumulativePaceChart from "./CumulativePaceChart";
import AnnualTrendChart from "./AnnualTrendChart";
import TypeShareChart from "./TypeShareChart";
import YoYByTypeChart from "./YoYByTypeChart";
import SeasonalityHeatmap from "./SeasonalityHeatmap";
import RollingAvgChart from "./RollingAvgChart";
import DestinationChart from "./DestinationChart";

/**
 * Indonesia exports panel — Brazil-tab visual layout reproduced
 * against the BPS Web API payload. The structure mirrors
 * BrazilTab/index.tsx so any future genericisation is a 1:1 swap.
 *
 * Skipped relative to Brazil:
 *   • CecafeDailyKPIs / DailyRegistrationSection — no daily Indonesia
 *     equivalent (BPS publishes monthly only).
 *   • SSOT projection overlay on MonthlyVolume / CumulativePace —
 *     no Indonesia forecast engine yet. The charts render history only.
 */
export default function IndonesiaExportsPanel() {
  const [raw, setRaw]     = useState<RawIndonesiaExports | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterState>({
    hub: null, country: null, port: null, type: null,
  });

  useEffect(() => {
    fetch("/data/indonesia_exports.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setRaw)
      .catch(() => setError(true));
  }, []);

  const data: IndonesiaExportsData | null = useMemo(
    () => (raw ? buildIndonesiaData(raw) : null),
    [raw],
  );

  // Filtered series for the country/hub origin filter (totals only —
  // by_country tables don't carry the per-type split across history).
  const filteredSeries = useMemo(() => {
    if (!data) return undefined;
    const { by_country_history, by_country_prev, by_country } = data;
    const countries = filter.country
      ? [filter.country]
      : filter.hub
      ? Object.entries(COUNTRY_HUB).filter(([, h]) => h === filter.hub).map(([c]) => c)
      : null;
    if (!countries) return undefined;
    return buildFilteredSeries(countries, by_country_history, by_country_prev, by_country);
  }, [filter, data]);

  if (error) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
        Indonesia BPS export data not available — workflow 0.9 has not run yet.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-xs text-slate-500 animate-pulse py-12 text-center">
        Loading BPS exports…
      </div>
    );
  }

  const { series } = data;
  const latest = series[series.length - 1];
  const prev   = series[series.length - 13]; // same month last year

  // Crop-to-date: Apr → latest month, using cropYearKey.
  const latestCropKey  = cropYearKey(latest.date);
  const [cropStartY]   = latestCropKey.split("/").map(Number);
  const prevCropKey    = `${cropStartY - 1}/${String(cropStartY).slice(2)}`;

  const ctdCurrent = series.filter(r => cropYearKey(r.date) === latestCropKey);
  const ctdMonthIndices = new Set(ctdCurrent.map(r => parseInt(r.date.split("-")[1])));
  const ctdPrev = series.filter(r =>
    cropYearKey(r.date) === prevCropKey &&
    ctdMonthIndices.has(parseInt(r.date.split("-")[1]))
  );

  const ctdTotal     = ctdCurrent.reduce((s, r) => s + r.total, 0);
  const ctdPrevTotal = ctdPrev.reduce((s, r) => s + r.total, 0);
  const ctdChg       = ctdPrevTotal > 0
    ? Math.round((ctdTotal - ctdPrevTotal) / ctdPrevTotal * 100)
    : null;
  const lyChg = prev && prev.total > 0
    ? Math.round((latest.total - prev.total) / prev.total * 100)
    : null;
  const ctdMonthRange = ctdCurrent.length > 0
    ? `${monthLabel(ctdCurrent[0].date)}–${monthLabel(ctdCurrent[ctdCurrent.length - 1].date)}`
    : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-200">
            Indonesia — BPS Export Data
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Updated {raw?.scraped_at?.slice(0, 10)} · Source:{" "}
            <a href={raw?.source_url} target="_blank" rel="noreferrer" className="underline">
              webapi.bps.go.id/v1/api/dataexim
            </a>{" "}
            · HS-0901xx coffee family · kg
          </p>
        </div>
        <span className="text-[10px] bg-orange-900/50 text-orange-400 px-2 py-0.5 rounded border border-orange-800">
          Arabica &amp; Robusta origin
        </span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={`${latest.date} — total exports`}
          value={`${kgToKT(latest.total).toFixed(1)} kt`}
          sub={`${(latest.total / 1_000_000).toFixed(2)}M kg`}
        />
        <StatCard
          label="vs same month last year"
          value={lyChg !== null ? `${lyChg > 0 ? "+" : ""}${lyChg}%` : "—"}
          sub={prev ? `${kgToKT(prev.total).toFixed(1)} kt in ${prev.date}` : ""}
        />
        <StatCard
          label={`Crop ${latestCropKey} — ${ctdMonthRange}`}
          value={`${kgToKT(ctdTotal).toFixed(1)} kt`}
          sub={`${(ctdTotal / 1_000_000).toFixed(1)}M kg crop-to-date`}
        />
        <StatCard
          label={`vs crop ${prevCropKey} same period`}
          value={ctdChg !== null ? `${ctdChg > 0 ? "+" : ""}${ctdChg}%` : "—"}
          sub={`${prevCropKey}: ${kgToKT(ctdPrevTotal).toFixed(1)} kt`}
        />
      </div>

      {/* Origin/type filter */}
      <CountryHubFilter byCountry={data.by_country} filter={filter} onChange={setFilter} />

      {/* Charts — same order as Brazil's */}
      <MonthlyVolumeChart series={series} typeFilter={filter.type} isFiltered={!!filteredSeries} />
      <CumulativePaceChart series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
      <AnnualTrendChart    series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
      <TypeShareChart      series={series} />
      <YoYByTypeChart      series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
      <SeasonalityHeatmap  series={series} />
      <RollingAvgChart     series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
      <DestinationChart
        byCountry={data.by_country}
        byCountryPrev={data.by_country_prev}
        byCountryArabica={data.by_country_arabica}
        byCountryArabicaPrev={data.by_country_arabica_prev}
        byCountryRobusta={data.by_country_robusta}
        byCountryRobustaPrev={data.by_country_robusta_prev}
        byCountryHistory={data.by_country_history}
        byPort={data.by_port}
        byPortPrev={data.by_port_prev}
        byPortHistory={data.by_port_history}
      />
    </div>
  );
}
