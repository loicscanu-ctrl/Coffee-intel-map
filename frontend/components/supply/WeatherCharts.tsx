"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, BarChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import EnsoPanel from "./farmer-economics/EnsoPanel";
import WeatherRiskPanel from "./farmer-economics/WeatherRiskPanel";
import type { FarmerEconomicsData } from "./farmer-economics/farmerEconomicsData";

// Subset of FarmerEconomicsData this view actually consumes — keeps the
// fetch loosely typed so future fields on that JSON don't trip us up.
type FarmerEconomicsLite = Pick<FarmerEconomicsData, "enso" | "weather">;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Province {
  name: string;
  station: string;
  prod_mt_k: number;
  weight: number;
  monthly_avg_rain: number[];
  monthly_min_rain: number[];
  monthly_max_rain: number[];
  monthly_dry_warn?: number[];
  monthly_last_year_rain: number[];
  // Populated by fetch_origin_weather.py only after the 30Y backfill (workflow 0.9)
  // has imported 1995-2024 into weather_history. Optional: charts fall back to
  // null cleanly when absent. Needed by the prior-crop-year line for origins
  // with a non-Jan start month (Brazil = Jun-May): its first 7 months land in
  // calendar year (cur_year-2), which monthly_last_year_rain doesn't reach.
  monthly_two_years_ago_rain?: number[];
  monthly_actual_cur: number[];
  monthly_avg_temp: number[];
  monthly_min_temp: number[];
  monthly_max_temp: number[];
  monthly_last_year_temp: number[];
  monthly_two_years_ago_temp?: number[];
  monthly_actual_temp_cur: number[];
  forecast_7d_rain: number[];
  daily_accum_cur?: (number | null)[];   // per-day cumulative rain, current month
  daily_accum_ly?: (number | null)[];    // per-day cumulative rain, last year same month
  // Per-day 10Y envelope built from real history in fetch_origin_weather.py.
  // Replaces the chart's linear interpolation of monthly_min/max_rain (which
  // mis-flagged bursty-rain years as exceeding the band — see ES Jun 2025
  // where day-3 actual = 9.4mm vs linear envelope of 2.7mm).
  daily_accum_min_10y?: (number | null)[];
  daily_accum_max_10y?: (number | null)[];
  essm_fraction?: number;                 // latest daily surface soil moisture (0–1)
  essm_recent?: { date: string; essm: number }[];  // last ~14 days of daily ESSM
  spi_1?: number;                         // Standardised Precipitation Index, 1-mo
  spi_3?: number;                         //   …trailing 3-mo
  spi_month?: string;                     // 'YYYY-MM' target month of the SPI(s) above
  spei_1?: number;                        // Standardised Precip-ET₀ Index, 1-mo (D = P − ET₀)
  spei_3?: number;                        //   …trailing 3-mo
  spei_month?: string;                    // 'YYYY-MM' target month of the SPEI(s) above
  // VHI fields are merged in client-side from vhi_{origin}.json (separate file
  // so the daily weather rebuild can't wipe these weekly NOAA STAR values).
  vhi?: number;                           // 0–100 vegetation health; <40 stress, >60 healthy
  vhi_iso_week?: string;                  // 'YYYY-Www' source week
  vhi_severity?: "stress" | "fair" | "healthy";
}

// Shape of frontend/public/data/vhi_{origin}.json — minimum we need to merge.
interface VhiFile {
  provinces?: Record<string, {
    vhi_latest?: { vhi: number; iso_week: string; severity: "stress" | "fair" | "healthy" };
  }>;
}

interface DailyRow {
  day: number;
  rain_mm: number;
  accum_mm: number | null;
  avg_accum_mm: number;
  min_accum_mm: number;
  max_accum_mm: number;
  last_year_accum_mm: number;
  temp_c: number;
}

interface ForecastRow {
  date: string;
  label: string;
  rain_mm: number;
  temp_max_c: number;
  temp_min_c: number;
}

interface WeatherData {
  updated: string;
  cur_year: number;
  last_year: number;
  label: string;
  share_label?: string;
  station: string;
  source_production: string;
  source_weather: string;
  provinces: Province[];
  daily_station: DailyRow[];
  forecast_7d: ForecastRow[];
}

const TT = { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const r1 = (n: number) => Math.round(n * 10) / 10;
const wsum = (provs: Province[], fn: (p: Province) => number) =>
  provs.reduce((s, p) => s + fn(p) * p.prod_mt_k, 0);

// ── Province selector ─────────────────────────────────────────────────────────

function ProvinceSelector({
  provinces, selected, onToggle,
}: {
  provinces: Province[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  const totalProd = provinces.reduce((s, p) => s + p.prod_mt_k, 0) || 1;
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-[8px] text-slate-600 uppercase tracking-wider mr-0.5">Filter:</span>
      {provinces.map((p) => {
        const active = selected.has(p.name);
        const share = Math.round((p.prod_mt_k / totalProd) * 100);
        return (
          <button
            key={p.name}
            onClick={() => onToggle(p.name)}
            title={`${p.name} · ${p.prod_mt_k.toLocaleString()}k MT · ${share}% of crop`}
            className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors border leading-tight ${
              active
                ? "bg-slate-700 text-slate-200 border-slate-500"
                : "bg-transparent text-slate-600 border-slate-700"
            }`}
          >
            <span className="block">{p.name}</span>
            <span className={`block text-[7px] ${active ? "text-amber-400/90" : "text-slate-600"}`}>{share}% of crop</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 1. Daily Accumulated Rainfall (reference station) ────────────────────────

function DailyAccumChart({
  daily, forecast, sourceLabel, updated, curYear, lastYear, selectedYear, selectedMonthIdx,
}: {
  daily: DailyRow[];
  forecast: ForecastRow[];
  sourceLabel: string;
  updated: string;
  curYear: number;
  lastYear: number;
  selectedYear: number;
  selectedMonthIdx: number;
}) {
  const monthLabel = MONTHS[selectedMonthIdx] + " " + selectedYear;
  void updated;  // kept in the props for future use (e.g. stamping data-source recency).

  // Build the chart series for the *selected* month. Forecast accumulates from
  // the last actual point when one exists in this month, else from day 0 so
  // the line still renders during the day-1-of-new-month window.
  const chartData = useMemo(() => {
    type Row = Partial<DailyRow> & { day: number; forecast_accum_mm?: number | null };
    const rows: Row[] = daily.map((d) => ({ ...d }));
    const byDay = new Map<number, Row>(rows.map((r) => [r.day, r]));
    const lastActual = [...daily].reverse().find((d) => d.accum_mm != null);
    const anchorDay = lastActual?.day ?? 0;
    const anchorAccum = lastActual?.accum_mm ?? 0;
    if (lastActual) byDay.get(anchorDay)!.forecast_accum_mm = anchorAccum;
    let acc = anchorAccum;
    for (const f of forecast) {
      const [y, m, d] = f.date.split("-").map(Number);
      if (y !== selectedYear || m - 1 !== selectedMonthIdx || d <= anchorDay) continue;
      acc += f.rain_mm;
      const existing = byDay.get(d);
      if (existing) existing.forecast_accum_mm = r1(acc);
      else byDay.set(d, { day: d, forecast_accum_mm: r1(acc) });
    }
    return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  }, [daily, forecast, selectedYear, selectedMonthIdx]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Daily Accumulated Rainfall — {monthLabel} (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">{sourceLabel} · Band = 10yr min/max · Dotted = 7-day forecast</div>
      <ResponsiveContainer width="100%" height={155}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={(v) => `${v}`} interval={4} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} labelFormatter={(v) => `Day ${v}`}
            formatter={(v: unknown) => [`${Number(v).toFixed(1)} mm`]} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          <Area type="monotone" dataKey="max_accum_mm" name="10yr max" fill="#1e3a5f"
            stroke="none" opacity={0.5} legendType="none" />
          <Area type="monotone" dataKey="min_accum_mm" name="10yr min" fill="#0f172a"
            stroke="none" opacity={1} legendType="none" />
          <Line type="monotone" dataKey="avg_accum_mm" name="30yr avg"
            stroke="#475569" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          <Line type="monotone" dataKey="last_year_accum_mm" name={`${lastYear}`}
            stroke="#93c5fd" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="accum_mm" name={`${curYear}`}
            stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
          <Line type="monotone" dataKey="forecast_accum_mm" name={`${curYear} forecast`}
            stroke="#38bdf8" strokeWidth={2} strokeDasharray="2 3" dot={false}
            activeDot={{ r: 3 }} connectNulls opacity={0.85} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 2. Monthly Rainfall ────────────────────────────────────────────────────────

interface MonthlyRainRow {
  month: string;
  avgRain: number;
  minRain: number;
  maxRain: number;
  lastYearRain: number | null;
  actualCur: number | null;
  proj: number;      // current (partial) month: projected remainder to month-end; 0 otherwise
  dryWarn: number;   // drought-risk threshold (≤P20 of last 30yr); 0 = no data
}

function MonthlyRainChart({ data, curLabel, lyLabel }: { data: MonthlyRainRow[]; curLabel: string; lyLabel: string }) {
  const hasZone = data.some((d) => d.dryWarn > d.minRain);
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Monthly Rainfall (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Pro-rata prod-weighted · Blue = {curLabel} (MTD) · Faded = projected month-end · Light blue = {lyLabel} · Band = 10yr min/max
        {hasZone && " · Orange = drought-risk zone (below 30yr P20)"}
      </div>
      <ResponsiveContainer width="100%" height={155}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} formatter={(v: unknown) => {
            if (v == null) return "—";
            return `${Number(v).toFixed(1)} mm`;
          }} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          {/* 10yr range band — rendered first (behind bars).
              Paint order matters: max (blue) → dry-warning (orange) → min (bg)
              so the visible orange is confined to [min, dryWarn] and the bg
              area masks everything below the 10yr min. */}
          <Area type="monotone" dataKey="maxRain" name="10yr max" fill="#1e3a5f"
            stroke="none" opacity={0.5} legendType="none" />
          <Area type="monotone" dataKey="dryWarn" name="drought-risk (≤P20)"
            fill="#fb923c" stroke="none" opacity={0.4} isAnimationActive={false}
            legendType={hasZone ? "rect" : "none"} />
          <Area type="monotone" dataKey="minRain" name="10yr min" fill="#0f172a"
            stroke="none" opacity={1} legendType="none" />
          {/* last-year and current-year bars — current month stacks MTD (solid) +
              projected remainder (faded) so it's comparable to the full-month band */}
          <Bar dataKey="lastYearRain" name={lyLabel} fill="#93c5fd" opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar dataKey="actualCur" name={curLabel} stackId="cur" fill="#38bdf8" opacity={0.9} />
          <Bar dataKey="proj" name={`${curLabel} proj.`} stackId="cur" fill="#38bdf8" opacity={0.3} radius={[2, 2, 0, 0]} />
          {/* 30yr avg line */}
          <Line type="monotone" dataKey="avgRain" name="30yr avg"
            stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 3. Cumulative YTD Rainfall ────────────────────────────────────────────────

interface CumRainRow {
  month: string;
  cumAvg: number;
  cumMin: number;
  cumMax: number;
  cumLastYear: number | null;
  cumCur: number | null;
  cumProj: number | null;
}

function CumulativeRainChart({ data, curLabel, lyLabel }: { data: CumRainRow[]; curLabel: string; lyLabel: string }) {
  const lastActualMonth = [...data].reverse().find((d) => d.cumCur !== null)?.month;
  const curYear = curLabel;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Cumulative YTD Rainfall (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Pro-rata prod-weighted · {curYear} through {lastActualMonth ?? "—"} · Band = 10yr min/max · Amber dots = projected month-end (MTD+forecast trend)
      </div>
      <ResponsiveContainer width="100%" height={155}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} formatter={(v: unknown) => {
            if (v == null) return "—";
            return `${Number(v).toFixed(0)} mm`;
          }} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          {/* 10yr cumulative range band */}
          <Area type="monotone" dataKey="cumMax" name="10yr max" fill="#1e3a5f"
            stroke="none" opacity={0.5} legendType="none" />
          <Area type="monotone" dataKey="cumMin" name="10yr min" fill="#0f172a"
            stroke="none" opacity={1} legendType="none" />
          {/* 30yr avg */}
          <Line type="monotone" dataKey="cumAvg" name="30yr avg"
            stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
          {/* last year (or previous crop year for crop-aligned charts) */}
          <Line type="monotone" dataKey="cumLastYear" name={lyLabel}
            stroke="#93c5fd" strokeWidth={1.5} dot={false} connectNulls={false} />
          {/* current year (or current crop year for crop-aligned charts) */}
          {lastActualMonth && <ReferenceLine x={lastActualMonth} stroke="#334155" strokeDasharray="2 2" />}
          <Line type="monotone" dataKey="cumCur" name={curLabel}
            stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
          {/* projected current-month-end (month-to-date + forecast trend, extrapolated) */}
          <Line type="monotone" dataKey="cumProj" name={`${curLabel} proj.`}
            stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="2 3"
            dot={{ r: 2, fill: "#fbbf24", strokeWidth: 0 }} activeDot={{ r: 3 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 4. Mean Temperature ────────────────────────────────────────────────────────

interface TempRow {
  month: string;
  avgTemp: number;
  minTemp: number;
  maxTemp: number;
  lastYearTemp: number | null;
  actualCur: number | null;
}

function MeanTempChart({
  data, curLabel, lyLabel, domain,
}: {
  data: TempRow[]; curLabel: string; lyLabel: string; domain: [number, number];
}) {
  const lastActualMonth = [...data].reverse().find((d) => d.actualCur !== null)?.month;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Mean Temperature (°C)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Pro-rata prod-weighted · Blue = {curLabel} · Light blue = {lyLabel} · Band = 10yr min/max
      </div>
      <ResponsiveContainer width="100%" height={155}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={(v) => `${v}°`} domain={domain} />
          <Tooltip contentStyle={TT} formatter={(v: unknown) => {
            if (v == null) return "—";
            return `${Number(v).toFixed(1)} °C`;
          }} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          {/* 10yr range band */}
          <Area type="monotone" dataKey="maxTemp" name="10yr max" fill="#1e3a5f"
            stroke="none" opacity={0.5} legendType="none" />
          <Area type="monotone" dataKey="minTemp" name="10yr min" fill="#0f172a"
            stroke="none" opacity={1} legendType="none" />
          {/* 30yr avg */}
          <Line type="monotone" dataKey="avgTemp" name="30yr avg"
            stroke="#475569" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
          {/* last year (or previous crop year for crop-aligned charts) */}
          <Line type="monotone" dataKey="lastYearTemp" name={lyLabel}
            stroke="#93c5fd" strokeWidth={1.5} dot={false} connectNulls={false} />
          {/* current year (or current crop year for crop-aligned charts) */}
          {lastActualMonth && <ReferenceLine x={lastActualMonth} stroke="#334155" strokeDasharray="2 2" />}
          <Line type="monotone" dataKey="actualCur" name={curLabel}
            stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 5. 7-Day Rainfall Forecast ────────────────────────────────────────────────

interface ForecastBarRow {
  label: string;
  rain_mm: number;
}

function ForecastRainChart({ data }: { data: ForecastBarRow[] }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        7-Day Rainfall Forecast (mm/day) · Prod-weighted
      </div>
      <div className="text-[8px] text-slate-600 mb-1">Open-Meteo 7-day model</div>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT}
            formatter={(v: unknown) => [`${Number(v).toFixed(1)} mm`]} />
          <Bar dataKey="rain_mm" name="Forecast"
            radius={[3, 3, 0, 0]} isAnimationActive={false} fill="#38bdf8"
            label={{ position: "top", fontSize: 8, fill: "#94a3b8",
              formatter: (v: unknown) => typeof v === "number" && v > 0 ? `${v.toFixed(1)}` : "" }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Production-at-risk readout ─────────────────────────────────────────────────
// A prod-weighted average can hide a small region in drought. This surfaces the
// SHARE of selected production whose projected current-month rainfall is in its
// own drought-risk zone (below the 30yr P20, or <60% of normal where P20 is
// absent), and names the stressed regions — something the average can't mask.
// Only evaluated in months that are climatologically rainy for the region (a dry
// month with low rain isn't a drought signal).

interface RiskRegion { name: string; weight: number; ratio: number; risk: boolean }

function ProductionAtRisk({ month, regions }: { month: string; regions: RiskRegion[] }) {
  const flagged = regions.filter((r) => r.risk).sort((a, b) => b.weight - a.weight);
  const atRiskPct = flagged.reduce((s, r) => s + r.weight, 0) * 100;
  if (!flagged.length) {
    return (
      <div className="text-[9px] text-emerald-400/80 bg-emerald-950/20 border border-emerald-900/40 rounded px-2 py-1">
        ✓ No drought-risk regions in season ({month}, projected)
      </div>
    );
  }
  return (
    <div className="text-[9px] bg-amber-950/30 border border-amber-900/50 rounded px-2 py-1.5 space-y-1">
      <div className="text-amber-300 font-semibold">
        ⚠ {atRiskPct.toFixed(0)}% of selected production below drought-risk rainfall ({month}, projected)
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-400">
        {flagged.map((r) => (
          <span key={r.name}>
            {r.name} <span className="text-slate-500">({(r.weight * 100).toFixed(0)}%)</span> —{" "}
            <span className="text-amber-400/90">{(r.ratio * 100).toFixed(0)}% of normal</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

// ── Surface soil moisture (ESSM) ───────────────────────────────────────────────
interface SoilRow { label: string; essm: number }

function SoilMoistureChart({ data }: { data: SoilRow[] }) {
  if (!data.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-300 mb-0.5">Surface Soil Moisture (last {data.length} days)</div>
      <div className="text-[9px] text-slate-500 mb-2">
        Prod-weighted daily ESSM · 0–1 volumetric fraction (0–81 cm) · dashed line = dry threshold
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis domain={[0, "auto"]} tick={{ fill: "#94a3b8", fontSize: 9 }} width={34} tickFormatter={(v) => Number(v).toFixed(2)} />
          <Tooltip contentStyle={TT} formatter={(v) => [Number(v).toFixed(3), "ESSM"]} />
          <ReferenceLine y={0.15} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Area type="monotone" dataKey="essm" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.22} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Drought-index panel (SPI + SPEI per province) ───────────────────────────
// Renders a small chip strip per region: SPI-1 / SPI-3 / SPEI-1 / SPEI-3
// with the same red→amber→green ramp drought scientists use. Hidden when no
// province carries the indices yet (graceful — the panel only appears once
// the fetcher starts emitting them).

const _droughtTone = (z: number | null | undefined): string => {
  if (z == null) return "bg-slate-800 text-slate-500 border border-slate-700";
  if (z <= -1.5) return "bg-rose-950/40 text-rose-300 border border-rose-800/60";
  if (z <= -1.0) return "bg-orange-950/40 text-orange-300 border border-orange-800/60";
  if (z <= -0.5) return "bg-amber-950/40 text-amber-300 border border-amber-800/60";
  if (z <   0.5) return "bg-slate-900 text-slate-300 border border-slate-700";
  if (z <   1.0) return "bg-emerald-950/30 text-emerald-300 border border-emerald-800/60";
  return              "bg-emerald-900/40 text-emerald-200 border border-emerald-700/60";
};

function DroughtChip({ label, z }: { label: string; z?: number }) {
  return (
    <span
      title={z != null
        ? `${label} = ${z.toFixed(2)} (vs 30-yr climatology). <-1 → drought, >1 → wet.`
        : `${label} not available yet — waiting on baseline seed or complete month.`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${_droughtTone(z)}`}
    >
      <span className="opacity-70 uppercase tracking-wider">{label}</span>
      <span>{z != null ? z.toFixed(2) : "—"}</span>
    </span>
  );
}

// VHI: 0–100 vegetation health blend from NOAA STAR (weekly admin-1). Same
// red→amber→green ramp as SPI/SPEI so the eye reads them as one severity
// language. Bin thresholds match scraper/vhi.py:vhi_severity.
const _vhiTone = (v: number | null | undefined): string => {
  if (v == null) return "bg-slate-800 text-slate-500 border border-slate-700";
  if (v < 40)    return "bg-rose-950/40 text-rose-300 border border-rose-800/60";
  if (v <= 60)   return "bg-amber-950/40 text-amber-300 border border-amber-800/60";
  return              "bg-emerald-900/40 text-emerald-200 border border-emerald-700/60";
};

function VhiChip({ v, week }: { v?: number; week?: string }) {
  return (
    <span
      title={v != null
        ? `VHI = ${v.toFixed(1)} (${week ?? "n/a"}). <40 stressed canopy, 40–60 fair, >60 healthy. Source: NOAA STAR.`
        : "VHI not available — waiting on NOAA STAR provinceID mapping or weekly fetch."}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${_vhiTone(v)}`}
    >
      <span className="opacity-70 uppercase tracking-wider">VHI</span>
      <span>{v != null ? v.toFixed(0) : "—"}</span>
    </span>
  );
}

function DroughtIndexPanel({ provinces }: { provinces: Province[] }) {
  const visible = provinces.filter(
    (p) => p.spi_1 != null || p.spi_3 != null
      || p.spei_1 != null || p.spei_3 != null
      || p.vhi != null,
  );
  if (visible.length === 0) return null;
  // SPI/SPEI share the same target month; VHI carries its own ISO week.
  // Surface both in the header so the user knows the indices aren't co-dated.
  const monthLabels = Array.from(new Set(
    visible.flatMap((p) => [p.spi_month, p.spei_month]).filter((m): m is string => !!m),
  )).sort();
  const headerMonth = monthLabels.length ? monthLabels[monthLabels.length - 1] : null;
  const vhiWeeks = Array.from(new Set(
    visible.map((p) => p.vhi_iso_week).filter((w): w is string => !!w),
  )).sort();
  const headerVhiWeek = vhiWeeks.length ? vhiWeeks[vhiWeeks.length - 1] : null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
          Drought + vegetation indices
          {headerMonth && (
            <span className="text-slate-500 font-normal normal-case ml-2">· month {headerMonth}</span>
          )}
          {headerVhiWeek && (
            <span className="text-slate-500 font-normal normal-case ml-2">· VHI {headerVhiWeek}</span>
          )}
        </h3>
        <div className="text-[9px] text-slate-500">
          <span className="text-rose-400">stress</span> ← &nbsp;
          <span className="text-slate-400">normal</span>
          &nbsp; → <span className="text-emerald-400">healthy</span>
        </div>
      </div>
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left py-1 pr-2">Region</th>
            <th className="text-right py-1 px-1">SPI-1</th>
            <th className="text-right py-1 px-1">SPI-3</th>
            <th className="text-right py-1 px-1">SPEI-1</th>
            <th className="text-right py-1 px-1">SPEI-3</th>
            <th className="text-right py-1 px-1">VHI</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((p) => (
            <tr key={p.name} className="border-t border-slate-800">
              <td className="text-slate-300 py-1 pr-2">{p.name}</td>
              <td className="text-right py-1 px-1"><DroughtChip label="SPI-1"  z={p.spi_1}  /></td>
              <td className="text-right py-1 px-1"><DroughtChip label="SPI-3"  z={p.spi_3}  /></td>
              <td className="text-right py-1 px-1"><DroughtChip label="SPEI-1" z={p.spei_1} /></td>
              <td className="text-right py-1 px-1"><DroughtChip label="SPEI-3" z={p.spei_3} /></td>
              <td className="text-right py-1 px-1"><VhiChip v={p.vhi} week={p.vhi_iso_week} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[8.5px] text-slate-600 italic mt-2">
        SPI is precipitation-only; SPEI adds the climatic water balance
        D = P − ET₀ so heat-driven deficits show up before SPI. VHI blends
        vegetation condition (VCI) and temperature condition (TCI) into a
        0–100 canopy-health score from NOAA STAR satellite — the
        downstream symptom of what SPI/SPEI are predicting upstream.
      </div>
    </div>
  );
}

export default function WeatherCharts({
  dataUrl,
  title,
  farmerEconomicsUrl,
  startMonthIdx = 0,
}: {
  /** Path under /public, e.g. "/data/brazil_weather.json". */
  dataUrl: string;
  /** Header label, e.g. "Weather · Brazil". */
  title: string;
  /** Optional farmer-economics JSON that also carries the country's ENSO
   *  context + 14-day frost risk grid. When provided, the weather tab
   *  renders the EnsoPanel and WeatherRiskPanel at the bottom. */
  farmerEconomicsUrl?: string;
  /** Calendar month (0=Jan … 11=Dec) the yearly charts should *start* at.
   *  Northern-hemisphere origins (Honduras, Vietnam, Ethiopia, Uganda) and
   *  Equatorial origins (Colombia, Indonesia) keep the default 0 = January.
   *  Southern-hemisphere origins (Brazil) pass 5 = June so the calendar
   *  matches the local coffee year. The underlying JSON arrays stay
   *  Jan-Dec; we just rotate the display order. */
  startMonthIdx?: number;
}) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [selectedYear, setSelectedYear]   = useState<number>(new Date().getFullYear());
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(new Date().getMonth());
  const [econ, setEcon] = useState<FarmerEconomicsLite | null>(null);
  const [vhi, setVhi] = useState<VhiFile | null>(null);

  useEffect(() => {
    fetch(dataUrl)
      .then((r) => r.json())
      .then((d: WeatherData) => {
        setData(d);
        setSelected(new Set(d.provinces.map((p) => p.name)));
        const parts = d.updated.split("-");
        if (parts.length >= 2) {
          setSelectedYear(parseInt(parts[0]));
          setSelectedMonthIdx(parseInt(parts[1]) - 1);
        }
      })
      .catch((err) => console.error(`[WeatherCharts] ${dataUrl} fetch failed:`, err));
  }, [dataUrl]);

  // VHI lives in a sibling file (vhi_{origin}.json) so the daily weather
  // rebuild can't wipe the weekly NOAA STAR values. We derive the URL from
  // dataUrl by convention. Silent 404 — file is absent until the Saturday
  // fetcher has run for the origin at least once.
  useEffect(() => {
    const m = dataUrl.match(/^(\/data\/)([^_/]+)_weather\.json$/);
    if (!m) return;
    const vhiUrl = `${m[1]}vhi_${m[2]}.json`;
    fetch(vhiUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: VhiFile | null) => d && setVhi(d))
      .catch(() => { /* absent file is the expected state pre-CI-run */ });
  }, [dataUrl]);

  useEffect(() => {
    if (!farmerEconomicsUrl) return;
    fetch(farmerEconomicsUrl)
      .then((r) => r.json())
      .then(setEcon)
      .catch((err) => console.error(`[WeatherCharts] ${farmerEconomicsUrl} fetch failed:`, err));
  }, [farmerEconomicsUrl]);

  function toggleProvince(name: string) {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.size === 1 && next.has(name)) return prev;
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const activeProv = useMemo(() => {
    if (!data || !selected) return [];
    const vhiByName = vhi?.provinces ?? {};
    return data.provinces
      .filter((p) => selected.has(p.name))
      .map((p) => {
        const v = vhiByName[p.name]?.vhi_latest;
        return v ? { ...p, vhi: v.vhi, vhi_iso_week: v.iso_week, vhi_severity: v.severity } : p;
      });
  }, [data, selected, vhi]);

  // Prod-weighted daily surface soil moisture (ESSM) across selected regions.
  const soilData = useMemo<SoilRow[]>(() => {
    const sum = new Map<string, number>();    // date → Σ(essm·prod)
    const wgt = new Map<string, number>();     // date → Σ(prod) present that date
    for (const p of activeProv) {
      for (const r of p.essm_recent ?? []) {
        if (r?.essm == null) continue;
        sum.set(r.date, (sum.get(r.date) ?? 0) + r.essm * p.prod_mt_k);
        wgt.set(r.date, (wgt.get(r.date) ?? 0) + p.prod_mt_k);
      }
    }
    return Array.from(sum.keys())
      .sort()
      .map((date) => ({ label: date.slice(5), essm: sum.get(date)! / (wgt.get(date) || 1) }));
  }, [activeProv]);

  const totalProd = useMemo(
    () => activeProv.reduce((s, p) => s + p.prod_mt_k, 0),
    [activeProv]
  );

  // Crop-year-aware lookup helpers. For startMonthIdx > 0 (e.g. Brazil = 5 = Jun),
  // the X-axis spans a 12-month crop year that crosses a calendar boundary, so a
  // single calendar-year array can't supply the right values on both sides of
  // Dec → Jan. These helpers determine the actual calendar year for each display
  // slot, then route to monthly_actual_cur (cur_year data) or monthly_last_year_*
  // (last_year data) accordingly. Without this, the line crossing the year
  // boundary jumps backwards in time (Dec 2025 followed by Jan 2025 instead of
  // Jan 2026), which is what the user observed.
  const cropFrame = useMemo(() => {
    // Calendar-year chart (startMonthIdx=0): every slot stays in curYear and
    // the helpers route to monthly_actual_cur — existing behaviour preserved.
    //
    // Crop-year chart (startMonthIdx>0, e.g. Brazil=5=Jun): the X-axis crosses
    // a calendar boundary, so a single calendar-year array can't supply the
    // right values on both sides of Dec → Jan. We anchor the displayed crop
    // year on the latest filled month of monthly_actual_cur:
    //   • Latest filled month ≥ startMonthIdx → display the in-progress crop
    //     year (cropStartYear = curYear). Pivot only happens once new-crop-
    //     year data has actually started landing.
    //   • Latest filled month < startMonthIdx (or no data yet) → display the
    //     just-completed crop year (cropStartYear = curYear − 1). E.g. Brazil
    //     on Jun 1 2026 still shows the 2025-26 crop year that just ended.
    const curYear = data?.cur_year ?? new Date().getFullYear();
    const lastYear = data?.last_year ?? curYear - 1;
    let cropStartYear = curYear;
    if (startMonthIdx > 0) {
      const refLen = data?.provinces?.[0]?.monthly_actual_cur?.length ?? 0;
      const latestFilledIdx = refLen - 1;
      cropStartYear = latestFilledIdx >= startMonthIdx ? curYear : curYear - 1;
    }
    return { curYear, lastYear, cropStartYear };
  }, [data, startMonthIdx]);

  // Legend labels. Calendar charts read as plain "2026" / "2025"; crop-year
  // charts (Brazil = Jun-May) read as "2025/26" / "2024/25" so the year span
  // matches what the line is actually drawing.
  const { curLabel, lyLabel } = useMemo(() => {
    if (startMonthIdx === 0) {
      return { curLabel: String(cropFrame.curYear), lyLabel: String(cropFrame.lastYear) };
    }
    const csy = cropFrame.cropStartYear;
    const fmt = (start: number) => `${start}/${String(start + 1).slice(-2)}`;
    return { curLabel: fmt(csy), lyLabel: fmt(csy - 1) };
  }, [cropFrame, startMonthIdx]);

  // Per-slot calendar year on the displayed crop-year span.
  const _slotYear = (dispIdx: number) =>
    cropFrame.cropStartYear + Math.floor((startMonthIdx + dispIdx) / 12);

  // Rain lookup keyed by year: pulls monthly_actual_cur for cur_year,
  // monthly_last_year_rain for cur_year-1, monthly_two_years_ago_rain for
  // cur_year-2 (populated after the 30Y backfill workflow 0.9 ran). Null
  // otherwise — chart's connectNulls={false} hides the gap cleanly.
  const _rainForYear = (p: WeatherData["provinces"][number], calIdx: number, yr: number): number | null => {
    if (yr === cropFrame.curYear)      return p.monthly_actual_cur?.[calIdx] ?? null;
    if (yr === cropFrame.lastYear)     return p.monthly_last_year_rain?.[calIdx] ?? null;
    if (yr === cropFrame.lastYear - 1) return p.monthly_two_years_ago_rain?.[calIdx] ?? null;
    return null;
  };

  // Temperature mirror of _rainForYear for the temperature chart.
  const _tempForYear = (p: WeatherData["provinces"][number], calIdx: number, yr: number): number | null => {
    if (yr === cropFrame.curYear)      return p.monthly_actual_temp_cur?.[calIdx] ?? null;
    if (yr === cropFrame.lastYear)     return p.monthly_last_year_temp?.[calIdx] ?? null;
    if (yr === cropFrame.lastYear - 1) return p.monthly_two_years_ago_temp?.[calIdx] ?? null;
    return null;
  };

  const monthlyRainData = useMemo<MonthlyRainRow[]>(() => {
    if (!data || !totalProd) return [];
    const hasDryWarn = activeProv.every((p) => Array.isArray(p.monthly_dry_warn) && p.monthly_dry_warn.length === 12);
    // `dispIdx` walks 0..11 in display order; `i` is the calendar-month
    // index used to look up the (Jan-Dec) data arrays. Rotating by
    // startMonthIdx is the only change for Southern-hemisphere countries.
    const rows: MonthlyRainRow[] = Array.from({ length: 12 }, (_, dispIdx) => {
      const i = (dispIdx + startMonthIdx) % 12;
      const slotYear = _slotYear(dispIdx);     // Actual calendar year for this slot.
      const prevYear = slotYear - 1;           // Same month, one crop year earlier.
      const minRain = r1(wsum(activeProv, (p) => p.monthly_min_rain[i]) / totalProd);
      const dryWarn = hasDryWarn ? r1(wsum(activeProv, (p) => p.monthly_dry_warn![i]) / totalProd) : 0;
      const lyVals  = activeProv.map((p) => _rainForYear(p, i, prevYear));
      const curVals = activeProv.map((p) => _rainForYear(p, i, slotYear));
      return {
        month: MONTHS[i],
        avgRain:      r1(wsum(activeProv, (p) => p.monthly_avg_rain[i])      / totalProd),
        minRain,
        maxRain:      r1(wsum(activeProv, (p) => p.monthly_max_rain[i])      / totalProd),
        lastYearRain: lyVals.every((v) => v != null)
          ? r1(activeProv.reduce((acc, p, k) => acc + (lyVals[k] as number) * p.prod_mt_k, 0) / totalProd)
          : null,
        actualCur: curVals.every((v) => v != null)
          ? r1(activeProv.reduce((acc, p, k) => acc + (curVals[k] as number) * p.prod_mt_k, 0) / totalProd)
          : null,
        proj: 0,
        dryWarn,
      };
    });

    // Current (partial) month → project to month-end so the bar is comparable to
    // the full-month climatology (same basis as the cumulative chart & the daily
    // forecast): avg daily rate over (MTD + 7-day forecast) × days-in-month.
    // Only project when the last filled slot maps to today's calendar month
    // (otherwise on Brazil June 1 we'd project May's full-month total as a
    // phantom partial-month MTD).
    const curDispIdx = rows.reduce((acc, r, i) => (r.actualCur !== null ? i : acc), -1);
    const parts = data.updated.split("-");
    const todayCalIdx = parts.length >= 2 ? parseInt(parts[1]) - 1 : -1;
    if (curDispIdx >= 0 && ((curDispIdx + startMonthIdx) % 12) === todayCalIdx) {
      const curCalIdx = (curDispIdx + startMonthIdx) % 12;
      const curYearNum  = parseInt(parts[0]);
      const daysElapsed = parts.length >= 3 ? parseInt(parts[2]) : 0;
      const daysInMonth = new Date(curYearNum, curCalIdx + 1, 0).getDate();
      let fcRain = 0, fcDays = 0;
      data.forecast_7d.forEach((f, i) => {
        const [y, m] = f.date.split("-").map(Number);
        if (y === curYearNum && m - 1 === curCalIdx) {
          fcRain += wsum(activeProv, (p) => p.forecast_7d_rain[i] ?? 0) / totalProd;
          fcDays += 1;
        }
      });
      const curIdx = curDispIdx;  // alias: subsequent block uses this label
      const mtd = rows[curIdx].actualCur as number;
      const knownDays = daysElapsed + fcDays;
      if (knownDays > 0) {
        const projEnd = ((mtd + fcRain) / knownDays) * daysInMonth;
        rows[curIdx].proj = Math.max(r1(projEnd) - mtd, 0);
      }
    }
    return rows;
  }, [data, activeProv, totalProd, startMonthIdx]);

  const cumulativeData = useMemo<CumRainRow[]>(() => {
    if (!data || !totalProd) return [];
    let cumAvg = 0, cumMin = 0, cumMax = 0, cumLY = 0, cumC = 0;
    let lyHasNull = false;   // Once the LY line hits a null slot (no data for that
                             // year), drop it for the rest of the span — a flat
                             // 0-stretch followed by a jump would mis-suggest a dry spell.
    const rows: CumRainRow[] = Array.from({ length: 12 }, (_, dispIdx) => {
      const i = (dispIdx + startMonthIdx) % 12;
      const slotYear = _slotYear(dispIdx);
      const prevYear = slotYear - 1;
      const month = MONTHS[i];
      cumAvg += wsum(activeProv, (p) => p.monthly_avg_rain[i]) / totalProd;
      cumMin += wsum(activeProv, (p) => p.monthly_min_rain[i]) / totalProd;
      cumMax += wsum(activeProv, (p) => p.monthly_max_rain[i]) / totalProd;
      // Crop-year-aware: each slot pulls from the calendar-year array that
      // actually contains its date. Without this, Brazil's Dec → Jan slot
      // accumulated Jan 2025 onto Dec 2025 instead of Jan 2026 (the user's
      // reported bug).
      const lyVals  = activeProv.map((p) => _rainForYear(p, i, prevYear));
      const curVals = activeProv.map((p) => _rainForYear(p, i, slotYear));
      const hasLY     = !lyHasNull && lyVals.every((v) => v != null);
      const hasActual = curVals.every((v) => v != null);
      if (hasLY) {
        cumLY += activeProv.reduce((acc, p, k) => acc + (lyVals[k] as number) * p.prod_mt_k, 0) / totalProd;
      } else {
        lyHasNull = true;
      }
      if (hasActual) {
        cumC += activeProv.reduce((acc, p, k) => acc + (curVals[k] as number) * p.prod_mt_k, 0) / totalProd;
      }
      return {
        month,
        cumAvg:      Math.round(cumAvg),
        cumMin:      Math.round(cumMin),
        cumMax:      Math.round(cumMax),
        cumLastYear: hasLY ? Math.round(cumLY) : null,
        cumCur:      hasActual ? Math.round(cumC) : null,
        cumProj:     null,
      };
    });

    // Project the current (partial) month to month-end: average daily rate over
    // the known window (month-to-date actuals + 7-day forecast) extrapolated
    // across the whole month. Drawn dissociated from the actual line.
    //
    // Only project when the last filled slot is actually the current calendar
    // month — otherwise on Brazil June 1 we'd extrapolate May's 26.6mm MTD into
    // a phantom May projection (the chart's last slot is the crop year's end,
    // not a partial month under observation).
    const curDispIdx = rows.reduce((acc, r, i) => (r.cumCur !== null ? i : acc), -1);
    const parts = data.updated.split("-");
    const todayCalIdx = parts.length >= 2 ? parseInt(parts[1]) - 1 : -1;
    if (curDispIdx >= 0 && ((curDispIdx + startMonthIdx) % 12) === todayCalIdx) {
      const curCalIdx = (curDispIdx + startMonthIdx) % 12;
      const curYearNum  = parseInt(parts[0]);
      const daysElapsed = parts.length >= 3 ? parseInt(parts[2]) : 0;
      const daysInMonth = new Date(curYearNum, curCalIdx + 1, 0).getDate();

      let fcRain = 0, fcDays = 0;
      data.forecast_7d.forEach((f, i) => {
        const [y, m] = f.date.split("-").map(Number);
        if (y === curYearNum && m - 1 === curCalIdx) {
          fcRain += wsum(activeProv, (p) => p.forecast_7d_rain[i] ?? 0) / totalProd;
          fcDays += 1;
        }
      });

      const curIdx    = curDispIdx;
      const mtd       = wsum(activeProv, (p) => p.monthly_actual_cur[curCalIdx]) / totalProd;
      const prevCum   = (rows[curIdx].cumCur as number) - mtd;
      const knownDays = daysElapsed + fcDays;
      if (knownDays > 0) {
        const avgDaily   = (mtd + fcRain) / knownDays;
        const projEndCum = prevCum + avgDaily * daysInMonth;
        if (curIdx > 0) rows[curIdx - 1].cumProj = rows[curIdx - 1].cumCur; // anchor on the actual line
        rows[curIdx].cumProj = Math.round(projEndCum);
      }
    }
    return rows;
  }, [data, activeProv, totalProd, startMonthIdx]);

  const tempData = useMemo<TempRow[]>(() => {
    if (!totalProd) return [];
    return Array.from({ length: 12 }, (_, dispIdx) => {
      const i = (dispIdx + startMonthIdx) % 12;
      const slotYear = _slotYear(dispIdx);
      const prevYear = slotYear - 1;
      const lyVals  = activeProv.map((p) => _tempForYear(p, i, prevYear));
      const curVals = activeProv.map((p) => _tempForYear(p, i, slotYear));
      return {
        month: MONTHS[i],
        avgTemp: r1(wsum(activeProv, (p) => p.monthly_avg_temp[i]) / totalProd),
        minTemp: r1(wsum(activeProv, (p) => p.monthly_min_temp[i]) / totalProd),
        maxTemp: r1(wsum(activeProv, (p) => p.monthly_max_temp[i]) / totalProd),
        lastYearTemp: lyVals.every((v) => v != null)
          ? r1(activeProv.reduce((acc, p, k) => acc + (lyVals[k] as number) * p.prod_mt_k, 0) / totalProd)
          : null,
        actualCur: curVals.every((v) => v != null)
          ? r1(activeProv.reduce((acc, p, k) => acc + (curVals[k] as number) * p.prod_mt_k, 0) / totalProd)
          : null,
      };
    });
  }, [activeProv, totalProd, startMonthIdx]);

  const tempDomain = useMemo<[number, number]>(() => {
    const vals = tempData.flatMap((d) => [d.minTemp, d.maxTemp]).filter((v) => v > 0);
    if (!vals.length) return [0, 40];
    const lo = Math.floor(Math.min(...vals) - 2);
    const hi = Math.ceil(Math.max(...vals) + 2);
    return [lo, hi];
  }, [tempData]);

  const forecastData = useMemo<ForecastBarRow[]>(() => {
    if (!data || !totalProd) return [];
    return data.forecast_7d.map((row, i) => ({
      label: row.label,
      rain_mm: r1(wsum(activeProv, (p) => p.forecast_7d_rain[i] ?? 0) / totalProd),
    }));
  }, [data, activeProv, totalProd]);

  // Prod-weighted daily accumulation across selected regions for the *selected*
  // month (not the data's stored month). Always emits a full month's rows so
  // the climatology band + 30yr avg + last-year curve + 7-day forecast stay
  // visible even when no current-year actuals exist yet for that month.
  //
  // Per-day daily_accum_cur / daily_accum_ly arrays in the JSON are only
  // populated for the data's stored month. When the user is looking at a
  // different month (e.g. today is May 31 with updated="2026-05-31" but the
  // user picks Jun 2026), accum_mm goes null and last_year_accum_mm falls
  // back to a linear interpolation from monthly_last_year_rain[selectedMonthIdx]
  // — rougher than the day-by-day real series, but at least shows the right
  // monthly shape.
  const weightedDaily = useMemo<DailyRow[] | null>(() => {
    if (!data || !totalProd) return null;
    const tgtYear = selectedYear;
    const tgtMIdx = selectedMonthIdx;
    const dim = new Date(tgtYear, tgtMIdx + 1, 0).getDate();
    const [storedYr, storedMo] = data.updated.split("-").map(Number);
    const isStored = tgtYear === storedYr && tgtMIdx === storedMo - 1;

    const wAvgMonth      = wsum(activeProv, (p) => p.monthly_avg_rain[tgtMIdx])             / totalProd;
    const wMinMonth      = wsum(activeProv, (p) => p.monthly_min_rain[tgtMIdx])             / totalProd;
    const wMaxMonth      = wsum(activeProv, (p) => p.monthly_max_rain[tgtMIdx])             / totalProd;
    const wLastYearMonth = wsum(activeProv, (p) => p.monthly_last_year_rain?.[tgtMIdx] ?? 0) / totalProd;
    // Per-day historical/current series only line up when the selected month
    // matches the data's stored month — otherwise we fall back to monthly
    // interpolations.
    const haveCur = isStored && activeProv.every((p) => Array.isArray(p.daily_accum_cur) && p.daily_accum_cur!.length);
    const haveLY  = isStored && activeProv.every((p) => Array.isArray(p.daily_accum_ly)  && p.daily_accum_ly!.length);
    // 10Y envelope: prefer the real per-day percentile arrays when the file
    // ships them (and we're in the stored window). Linear interpolation of
    // monthly_min/max stays as a fallback so charts don't go blank pre-refresh.
    const haveEnvelope = isStored
      && activeProv.every((p) => Array.isArray(p.daily_accum_min_10y) && p.daily_accum_min_10y!.length === dim)
      && activeProv.every((p) => Array.isArray(p.daily_accum_max_10y) && p.daily_accum_max_10y!.length === dim);
    const rows: DailyRow[] = [];
    for (let d = 1; d <= dim; d++) {
      const i = d - 1;
      const avg_accum = r1(wAvgMonth * (d / dim));
      const minEnvOk = haveEnvelope && activeProv.every((p) => p.daily_accum_min_10y![i] != null);
      const maxEnvOk = haveEnvelope && activeProv.every((p) => p.daily_accum_max_10y![i] != null);
      const min_accum = minEnvOk
        ? r1(wsum(activeProv, (p) => p.daily_accum_min_10y![i] as number) / totalProd)
        : r1(wMinMonth * (d / dim));
      const max_accum = maxEnvOk
        ? r1(wsum(activeProv, (p) => p.daily_accum_max_10y![i] as number) / totalProd)
        : r1(wMaxMonth * (d / dim));
      const allCur = haveCur && activeProv.every((p) => p.daily_accum_cur![i] != null);
      const lyOk = haveLY && activeProv.every((p) => p.daily_accum_ly![i] != null);
      const last_year_accum_mm = lyOk
        ? r1(wsum(activeProv, (p) => p.daily_accum_ly![i] as number) / totalProd)
        : r1(wLastYearMonth * (d / dim));
      rows.push({
        day: d,
        rain_mm: 0,
        accum_mm: allCur ? r1(wsum(activeProv, (p) => p.daily_accum_cur![i] as number) / totalProd) : null,
        avg_accum_mm: avg_accum,
        min_accum_mm: min_accum,
        max_accum_mm: max_accum,
        last_year_accum_mm,
        temp_c: 0,
      });
    }
    return rows;
  }, [data, activeProv, totalProd, selectedYear, selectedMonthIdx]);

  const weightedForecast = useMemo<ForecastRow[]>(() => {
    if (!data || !totalProd) return [];
    return data.forecast_7d.map((f, i) => ({ ...f, rain_mm: r1(wsum(activeProv, (p) => p.forecast_7d_rain[i] ?? 0) / totalProd) }));
  }, [data, activeProv, totalProd]);

  // Production-at-risk: per active region, project the current month and flag it
  // if the projection lands in its drought-risk zone (< 30yr P20, else < 60% of normal).
  const risk = useMemo<{ month: string; regions: RiskRegion[] } | null>(() => {
    if (!data || !totalProd) return null;
    const parts = data.updated.split("-");
    const curYearNum  = parseInt(parts[0]);
    const curIdx      = parseInt(parts[1]) - 1;
    const daysElapsed = parts.length >= 3 ? parseInt(parts[2]) : 0;
    const daysInMonth = new Date(curYearNum, curIdx + 1, 0).getDate();
    const fcInMonth = data.forecast_7d.map((f) => {
      const [y, m] = f.date.split("-").map(Number);
      return y === curYearNum && m - 1 === curIdx;
    });
    const fcDays = fcInMonth.filter(Boolean).length;
    const known  = daysElapsed + fcDays;
    const regions: RiskRegion[] = [];
    for (const p of activeProv) {
      const mtd = p.monthly_actual_cur[curIdx];
      if (mtd == null) continue;
      let fcRain = 0;
      data.forecast_7d.forEach((f, i) => { if (fcInMonth[i]) fcRain += p.forecast_7d_rain[i] ?? 0; });
      const proj = known > 0 ? ((mtd + fcRain) / known) * daysInMonth : mtd;
      const avg  = p.monthly_avg_rain[curIdx] || 0;
      // Only flag drought risk in months that are climatologically rainy for this
      // region — in the dry season low rain is normal (and for some crops desirable),
      // so a deficit then isn't a stress signal.
      const meanMonthly  = p.monthly_avg_rain.reduce((a, b) => a + b, 0) / 12;
      const rainExpected = avg >= 0.5 * meanMonthly;
      const p20  = (p.monthly_dry_warn && p.monthly_dry_warn[curIdx]) || 0;
      const ratio = avg > 0 ? proj / avg : 1;
      const isRisk = rainExpected && (p20 > 0 ? proj < p20 : ratio < 0.6);
      regions.push({ name: p.name, weight: p.prod_mt_k / totalProd, ratio, risk: isRisk });
    }
    return regions.length ? { month: MONTHS[curIdx], regions } : null;
  }, [data, activeProv, totalProd]);

  if (!data || !selected) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-slate-500 text-xs italic animate-pulse">
        Loading weather data…
      </div>
    );
  }

  const fullProd = data.provinces.reduce((s, p) => s + p.prod_mt_k, 0);
  const activeNames = activeProv.map((p) => p.name).join(", ");

  // Month navigation helpers
  const canGoPrev = selectedMonthIdx > 0 || selectedYear > 2020;
  const canGoNext = !(selectedYear === new Date().getFullYear() && selectedMonthIdx >= new Date().getMonth());

  function prevMonth() {
    if (selectedMonthIdx === 0) {
      setSelectedYear(y => y - 1);
      setSelectedMonthIdx(11);
    } else {
      setSelectedMonthIdx(m => m - 1);
    }
  }

  function nextMonth() {
    if (selectedMonthIdx === 11) {
      setSelectedYear(y => y + 1);
      setSelectedMonthIdx(0);
    } else {
      setSelectedMonthIdx(m => m + 1);
    }
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
          {title}
        </div>
        <div className="flex items-center gap-2">
          {/* Month/year selector */}
          <button
            onClick={prevMonth}
            disabled={!canGoPrev}
            className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ←
          </button>
          <span className="text-[10px] text-slate-300 font-medium w-20 text-center">
            {MONTHS[selectedMonthIdx]} {selectedYear}
          </span>
          <button
            onClick={nextMonth}
            disabled={!canGoNext}
            className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-slate-200 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            →
          </button>
          <span className="text-[9px] text-slate-600 ml-1">Updated {data.updated}</span>
        </div>
      </div>

      {/* Province selector */}
      <ProvinceSelector
        provinces={data.provinces}
        selected={selected}
        onToggle={toggleProvince}
      />

      {/* Active region note */}
      <div className="text-[8px] text-slate-600">
        Weighted across: {activeNames} · total {(totalProd / 1000).toFixed(0)}k MT
        {fullProd > 0 && ` (${((totalProd / fullProd) * 100).toFixed(0)}% ${data.share_label ?? data.label})`}
      </div>

      {/* Production-at-risk — surfaces localized drought the weighted average hides */}
      {risk && <ProductionAtRisk month={risk.month} regions={risk.regions} />}

      {/* 2×2 grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DailyAccumChart
          daily={weightedDaily ?? data.daily_station}
          forecast={weightedDaily ? weightedForecast : data.forecast_7d}
          sourceLabel={weightedDaily
            ? `Prod-weighted · ${activeProv.length} region${activeProv.length > 1 ? "s" : ""}`
            : `${data.station} station`}
          updated={data.updated}
          curYear={data.cur_year}
          lastYear={data.last_year}
          selectedYear={selectedYear}
          selectedMonthIdx={selectedMonthIdx}
        />
        <MeanTempChart data={tempData} curLabel={curLabel} lyLabel={lyLabel} domain={tempDomain} />
        <MonthlyRainChart data={monthlyRainData} curLabel={curLabel} lyLabel={lyLabel} />
        <CumulativeRainChart data={cumulativeData} curLabel={curLabel} lyLabel={lyLabel} />
        <SoilMoistureChart data={soilData} />
      </div>

      {/* Full-width forecast */}
      <ForecastRainChart data={forecastData} />

      {/* Drought-index strip — only renders when the fetcher has emitted
          SPI / SPEI for at least one of the visible regions. */}
      <DroughtIndexPanel provinces={activeProv} />

      {/* ENSO context + 14-day frost risk grid — moved here from
          farmer-economics so weather lives in one place. Both render
          only when the farmer-economics JSON is loaded and carries
          the relevant fields. */}
      {econ?.enso && (
        <EnsoPanel enso={econ.enso} />
      )}
      {econ?.weather && (
        <WeatherRiskPanel weather={econ.weather} />
      )}

      <div className="text-[8px] text-slate-700 italic border-t border-slate-700 pt-2">
        Production weights: {data.source_production} ·
        Weather: {data.source_weather} ·
        Weighted avg = Σ(value_i × prod_i) / Σ(prod_i) across selected regions
      </div>
    </div>
  );
}
