"use client";
import { useEffect, useMemo, useState } from "react";
import BrazilFarmerEconomics from "../farmer-economics/BrazilFarmerEconomics";
import { COUNTRY_HUB, EMPTY_CY } from "./constants";
import { bagsToKT, buildFilteredSeries, cropYearKey, monthLabel } from "./helpers";
import type { CecafeData, FilterState } from "./types";

import StatCard from "./StatCard";
import DailyRegistrationSection from "./DailyRegistration";
import MonthlyVolumeChart from "./MonthlyVolumeChart";
import AnnualTrendChart from "./AnnualTrendChart";
import TypeShareChart from "./TypeShareChart";
import SeasonalityHeatmap from "./SeasonalityHeatmap";
import YoYByTypeChart from "./YoYByTypeChart";
import RollingAvgChart from "./RollingAvgChart";
import CumulativePaceChart from "./CumulativePaceChart";
import CountryHubFilter from "./CountryHubFilter";
import DestinationChart from "./DestinationChart";

export default function BrazilTab() {
  const [data, setData]   = useState<CecafeData | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterState>({ hub: null, country: null, type: null });
  const [subTab, setSubTab] = useState<"exports" | "farmer-economics">("exports");

  useEffect(() => {
    fetch("/data/cecafe.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // All hooks must be called before any conditional return
  const filteredSeries = useMemo(() => {
    if (!data) return undefined;
    const { by_country_history, by_country_prev, by_country } = data;
    const history = by_country_history ?? {};
    const ptCountries = filter.country
      ? [filter.country]
      : filter.hub
      ? Object.entries(COUNTRY_HUB).filter(([, h]) => h === filter.hub).map(([pt]) => pt)
      : null;
    if (!ptCountries) return undefined;
    return buildFilteredSeries(ptCountries, history, by_country_prev ?? EMPTY_CY, by_country ?? EMPTY_CY);
  }, [filter, data]);

  if (error) return (
    <div className="text-center text-slate-500 py-16 text-sm">
      Cecafe data unavailable — scraper may not have run yet.
    </div>
  );
  if (!data) return (
    <div className="text-center text-slate-500 py-16 text-sm animate-pulse">Loading Cecafe data…</div>
  );

  const {
    series,
    by_country, by_country_prev,
    by_country_arabica, by_country_arabica_prev,
    by_country_conillon, by_country_conillon_prev,
    by_country_soluvel, by_country_soluvel_prev,
    by_country_torrado, by_country_torrado_prev,
    by_country_history,
    report, updated,
  } = data;
  const latest = series[series.length - 1];
  const prev   = series[series.length - 13]; // same month last year

  // Crop-to-date: Apr → latest month, using cropYearKey
  const latestCropKey  = cropYearKey(latest.date);
  const [cropStartY]   = latestCropKey.split("/").map(Number); // e.g. 2025 for "2025/26"
  const prevCropKey    = `${cropStartY - 1}/${String(cropStartY).slice(2)}`;

  // All months in the current crop year up to (and including) latest
  const ctdCurrent = series.filter(r => cropYearKey(r.date) === latestCropKey);
  // Same months in the previous crop year (same month indices)
  const ctdMonthIndices = new Set(ctdCurrent.map(r => parseInt(r.date.split("-")[1])));
  const ctdPrev    = series.filter(r =>
    cropYearKey(r.date) === prevCropKey &&
    ctdMonthIndices.has(parseInt(r.date.split("-")[1]))
  );

  const ctdTotal      = ctdCurrent.reduce((s, r) => s + r.total, 0);
  const ctdPrevTotal  = ctdPrev.reduce((s, r) => s + r.total, 0);
  const ctdChg        = ctdPrevTotal > 0 ? Math.round((ctdTotal - ctdPrevTotal) / ctdPrevTotal * 100) : null;
  const lyChg         = prev ? Math.round((latest.total - prev.total) / prev.total * 100) : null;
  const ctdMonthRange = ctdCurrent.length > 0
    ? `${monthLabel(ctdCurrent[0].date)}–${monthLabel(ctdCurrent[ctdCurrent.length - 1].date)}`
    : "";

  return (
    <div className="space-y-5">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "farmer-economics"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t === "exports" ? "Exports" : "Farmer Economics"}
          </button>
        ))}
      </div>

      {subTab === "farmer-economics" && <BrazilFarmerEconomics />}

      {subTab === "exports" && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Brazil — Cecafe Export Data</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Report: {report} · Updated {updated} · Source: Cecafe (60 kg bags)
              </p>
            </div>
            <span className="text-[10px] bg-green-900/50 text-green-400 px-2 py-0.5 rounded border border-green-800">
              Arabica &amp; Conillon origin
            </span>
          </div>

          {/* Daily export registration (top section, rendered only when cecafe_daily.json exists) */}
          <DailyRegistrationSection />

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={`${latest.date} — total exports`}
              value={`${bagsToKT(latest.total).toFixed(1)} kt`}
              sub={`${(latest.total / 1000).toFixed(0)}k bags`}
            />
            <StatCard
              label="vs same month last year"
              value={lyChg !== null ? `${lyChg > 0 ? "+" : ""}${lyChg}%` : "—"}
              sub={prev ? `${bagsToKT(prev.total).toFixed(1)} kt in ${prev.date}` : ""}
            />
            <StatCard
              label={`Crop ${latestCropKey} — ${ctdMonthRange}`}
              value={`${bagsToKT(ctdTotal).toFixed(1)} kt`}
              sub={`${(ctdTotal / 1000).toFixed(0)}k bags crop-to-date`}
            />
            <StatCard
              label={`vs crop ${prevCropKey} same period`}
              value={ctdChg !== null ? `${ctdChg > 0 ? "+" : ""}${ctdChg}%` : "—"}
              sub={`${prevCropKey}: ${bagsToKT(ctdPrevTotal).toFixed(1)} kt`}
            />
          </div>

          {/* Origin filter */}
          <CountryHubFilter byCountry={by_country} filter={filter} onChange={setFilter} />

          {/* Charts */}
          <MonthlyVolumeChart series={filteredSeries ?? series} typeFilter={filter.type} isFiltered={!!filteredSeries} />
          <CumulativePaceChart series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <AnnualTrendChart    series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <TypeShareChart series={series} />
          <YoYByTypeChart      series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <SeasonalityHeatmap series={series} />
          <RollingAvgChart     series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <DestinationChart
            byCountry={by_country}
            byCountryPrev={by_country_prev}
            byArabica={by_country_arabica} byArabicaPrev={by_country_arabica_prev}
            byConillon={by_country_conillon} byConillonPrev={by_country_conillon_prev}
            bySoluvel={by_country_soluvel} bySoluvelPrev={by_country_soluvel_prev}
            byTorrado={by_country_torrado} byTorradoPrev={by_country_torrado_prev}
            byCountryHistory={by_country_history}
          />
        </>
      )}
    </div>
  );
}
