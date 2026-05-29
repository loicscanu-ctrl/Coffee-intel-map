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
  monthly_actual_cur: number[];
  monthly_avg_temp: number[];
  monthly_min_temp: number[];
  monthly_max_temp: number[];
  monthly_last_year_temp: number[];
  monthly_actual_temp_cur: number[];
  forecast_7d_rain: number[];
  daily_accum_cur?: (number | null)[];   // per-day cumulative rain, current month
  daily_accum_ly?: (number | null)[];    // per-day cumulative rain, last year same month
  essm_fraction?: number;                 // latest daily surface soil moisture (0–1)
  essm_recent?: { date: string; essm: number }[];  // last ~14 days of daily ESSM
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
  const parts = updated.split("-");
  const dataYear  = parts.length >= 1 ? parseInt(parts[0]) : new Date().getFullYear();
  const dataMonth = parts.length >= 2 ? parseInt(parts[1]) - 1 : 0; // 0-indexed

  const monthLabel = MONTHS[selectedMonthIdx] + " " + selectedYear;
  const isCurrentPeriod = selectedYear === dataYear && selectedMonthIdx === dataMonth;

  // Extend the current-year accumulation into the future with the 7-day
  // forecast (same reference station), drawn dotted to flag it as projected.
  // Forecast rain is cumulated onto the last actual accum value; only forecast
  // days that fall within the displayed month are included.
  const chartData = useMemo(() => {
    type Row = Partial<DailyRow> & { day: number; forecast_accum_mm?: number | null };
    const rows: Row[] = daily.map((d) => ({ ...d }));
    const lastActual = [...daily].reverse().find((d) => d.accum_mm != null);
    if (!lastActual) return rows;

    const byDay = new Map<number, Row>(rows.map((r) => [r.day, r]));
    // Anchor the dotted line on the last actual point so the two lines join.
    byDay.get(lastActual.day)!.forecast_accum_mm = lastActual.accum_mm;

    let acc = lastActual.accum_mm ?? 0;
    for (const f of forecast) {
      const [y, m, d] = f.date.split("-").map(Number);
      if (y !== dataYear || m - 1 !== dataMonth || d <= lastActual.day) continue;
      acc += f.rain_mm;
      const existing = byDay.get(d);
      if (existing) existing.forecast_accum_mm = r1(acc);
      else byDay.set(d, { day: d, forecast_accum_mm: r1(acc) });
    }
    return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  }, [daily, forecast, dataYear, dataMonth]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Daily Accumulated Rainfall — {monthLabel} (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">{sourceLabel} · Band = 10yr min/max · Dotted = 7-day forecast</div>
      {isCurrentPeriod ? (
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
      ) : (
        <div className="h-[155px] flex items-center justify-center text-[9px] text-slate-600 italic">
          Daily station data only stored for current month ({MONTHS[dataMonth]} {dataYear})
        </div>
      )}
    </div>
  );
}

// ── 2. Monthly Rainfall ────────────────────────────────────────────────────────

interface MonthlyRainRow {
  month: string;
  avgRain: number;
  minRain: number;
  maxRain: number;
  lastYearRain: number;
  actualCur: number | null;
  proj: number;      // current (partial) month: projected remainder to month-end; 0 otherwise
  dryWarn: number;   // drought-risk threshold (≤P20 of last 30yr); 0 = no data
}

function MonthlyRainChart({ data, curYear, lastYear }: { data: MonthlyRainRow[]; curYear: number; lastYear: number }) {
  const hasZone = data.some((d) => d.dryWarn > d.minRain);
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Monthly Rainfall (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Pro-rata prod-weighted · Blue = {curYear} (MTD) · Faded = projected month-end · Light blue = {lastYear} · Band = 10yr min/max
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
          <Bar dataKey="lastYearRain" name={`${lastYear}`} fill="#93c5fd" opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar dataKey="actualCur" name={`${curYear}`} stackId="cur" fill="#38bdf8" opacity={0.9} />
          <Bar dataKey="proj" name={`${curYear} proj.`} stackId="cur" fill="#38bdf8" opacity={0.3} radius={[2, 2, 0, 0]} />
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
  cumLastYear: number;
  cumCur: number | null;
  cumProj: number | null;
}

function CumulativeRainChart({ data, curYear, lastYear }: { data: CumRainRow[]; curYear: number; lastYear: number }) {
  const lastActualMonth = [...data].reverse().find((d) => d.cumCur !== null)?.month;

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
          {/* last year */}
          <Line type="monotone" dataKey="cumLastYear" name={`${lastYear}`}
            stroke="#93c5fd" strokeWidth={1.5} dot={false} />
          {/* current year */}
          {lastActualMonth && <ReferenceLine x={lastActualMonth} stroke="#334155" strokeDasharray="2 2" />}
          <Line type="monotone" dataKey="cumCur" name={`${curYear}`}
            stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
          {/* projected current-month-end (month-to-date + forecast trend, extrapolated) */}
          <Line type="monotone" dataKey="cumProj" name={`${curYear} proj.`}
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
  lastYearTemp: number;
  actualCur: number | null;
}

function MeanTempChart({
  data, curYear, lastYear, domain,
}: {
  data: TempRow[]; curYear: number; lastYear: number; domain: [number, number];
}) {
  const lastActualMonth = [...data].reverse().find((d) => d.actualCur !== null)?.month;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Mean Temperature (°C)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Pro-rata prod-weighted · Blue = {curYear} · Light blue = {lastYear} · Band = 10yr min/max
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
          {/* last year */}
          <Line type="monotone" dataKey="lastYearTemp" name={`${lastYear}`}
            stroke="#93c5fd" strokeWidth={1.5} dot={false} />
          {/* current year */}
          {lastActualMonth && <ReferenceLine x={lastActualMonth} stroke="#334155" strokeDasharray="2 2" />}
          <Line type="monotone" dataKey="actualCur" name={`${curYear}`}
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

export default function WeatherCharts({
  dataUrl,
  title,
  farmerEconomicsUrl,
}: {
  /** Path under /public, e.g. "/data/brazil_weather.json". */
  dataUrl: string;
  /** Header label, e.g. "Weather · Brazil". */
  title: string;
  /** Optional farmer-economics JSON that also carries the country's ENSO
   *  context + 14-day frost risk grid. When provided, the weather tab
   *  renders the EnsoPanel and WeatherRiskPanel at the bottom. */
  farmerEconomicsUrl?: string;
}) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [selectedYear, setSelectedYear]   = useState<number>(new Date().getFullYear());
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(new Date().getMonth());
  const [econ, setEcon] = useState<FarmerEconomicsLite | null>(null);

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
    return data.provinces.filter((p) => selected.has(p.name));
  }, [data, selected]);

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

  const monthlyRainData = useMemo<MonthlyRainRow[]>(() => {
    if (!data || !totalProd) return [];
    const hasDryWarn = activeProv.every((p) => Array.isArray(p.monthly_dry_warn) && p.monthly_dry_warn.length === 12);
    const rows: MonthlyRainRow[] = MONTHS.map((month, i) => {
      const minRain = r1(wsum(activeProv, (p) => p.monthly_min_rain[i]) / totalProd);
      const dryWarn = hasDryWarn ? r1(wsum(activeProv, (p) => p.monthly_dry_warn![i]) / totalProd) : 0;
      return {
        month,
        avgRain:      r1(wsum(activeProv, (p) => p.monthly_avg_rain[i])      / totalProd),
        minRain,
        maxRain:      r1(wsum(activeProv, (p) => p.monthly_max_rain[i])      / totalProd),
        lastYearRain: r1(wsum(activeProv, (p) => p.monthly_last_year_rain[i]) / totalProd),
        actualCur:    activeProv.every((p) => p.monthly_actual_cur[i] != null)
          ? r1(wsum(activeProv, (p) => p.monthly_actual_cur[i]) / totalProd)
          : null,
        proj: 0,
        dryWarn,
      };
    });

    // Current (partial) month → project to month-end so the bar is comparable to
    // the full-month climatology (same basis as the cumulative chart & the daily
    // forecast): avg daily rate over (MTD + 7-day forecast) × days-in-month.
    const curIdx = rows.reduce((acc, r, i) => (r.actualCur !== null ? i : acc), -1);
    if (curIdx >= 0) {
      const parts = data.updated.split("-");
      const curYearNum  = parseInt(parts[0]);
      const daysElapsed = parts.length >= 3 ? parseInt(parts[2]) : 0;
      const daysInMonth = new Date(curYearNum, curIdx + 1, 0).getDate();
      let fcRain = 0, fcDays = 0;
      data.forecast_7d.forEach((f, i) => {
        const [y, m] = f.date.split("-").map(Number);
        if (y === curYearNum && m - 1 === curIdx) {
          fcRain += wsum(activeProv, (p) => p.forecast_7d_rain[i] ?? 0) / totalProd;
          fcDays += 1;
        }
      });
      const mtd = rows[curIdx].actualCur as number;
      const knownDays = daysElapsed + fcDays;
      if (knownDays > 0) {
        const projEnd = ((mtd + fcRain) / knownDays) * daysInMonth;
        rows[curIdx].proj = Math.max(r1(projEnd) - mtd, 0);
      }
    }
    return rows;
  }, [data, activeProv, totalProd]);

  const cumulativeData = useMemo<CumRainRow[]>(() => {
    if (!data || !totalProd) return [];
    let cumAvg = 0, cumMin = 0, cumMax = 0, cumLY = 0, cumC = 0;
    const rows: CumRainRow[] = MONTHS.map((month, i) => {
      cumAvg += wsum(activeProv, (p) => p.monthly_avg_rain[i])       / totalProd;
      cumMin += wsum(activeProv, (p) => p.monthly_min_rain[i])       / totalProd;
      cumMax += wsum(activeProv, (p) => p.monthly_max_rain[i])       / totalProd;
      cumLY  += wsum(activeProv, (p) => p.monthly_last_year_rain[i]) / totalProd;
      const hasActual = activeProv.every((p) => p.monthly_actual_cur[i] != null);
      if (hasActual) cumC += wsum(activeProv, (p) => p.monthly_actual_cur[i]) / totalProd;
      return {
        month,
        cumAvg:      Math.round(cumAvg),
        cumMin:      Math.round(cumMin),
        cumMax:      Math.round(cumMax),
        cumLastYear: Math.round(cumLY),
        cumCur:      hasActual ? Math.round(cumC) : null,
        cumProj:     null,
      };
    });

    // Project the current (partial) month to month-end: average daily rate over
    // the known window (month-to-date actuals + 7-day forecast) extrapolated
    // across the whole month. Drawn dissociated from the actual line.
    const curIdx = rows.reduce((acc, r, i) => (r.cumCur !== null ? i : acc), -1);
    if (curIdx >= 0) {
      const parts = data.updated.split("-");
      const curYearNum  = parseInt(parts[0]);
      const daysElapsed = parts.length >= 3 ? parseInt(parts[2]) : 0;
      const daysInMonth = new Date(curYearNum, curIdx + 1, 0).getDate();

      let fcRain = 0, fcDays = 0;
      data.forecast_7d.forEach((f, i) => {
        const [y, m] = f.date.split("-").map(Number);
        if (y === curYearNum && m - 1 === curIdx) {
          fcRain += wsum(activeProv, (p) => p.forecast_7d_rain[i] ?? 0) / totalProd;
          fcDays += 1;
        }
      });

      const mtd       = wsum(activeProv, (p) => p.monthly_actual_cur[curIdx]) / totalProd;
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
  }, [data, activeProv, totalProd]);

  const tempData = useMemo<TempRow[]>(() => {
    if (!totalProd) return [];
    return MONTHS.map((month, i) => ({
      month,
      avgTemp:      r1(wsum(activeProv, (p) => p.monthly_avg_temp[i])        / totalProd),
      minTemp:      r1(wsum(activeProv, (p) => p.monthly_min_temp[i])        / totalProd),
      maxTemp:      r1(wsum(activeProv, (p) => p.monthly_max_temp[i])        / totalProd),
      lastYearTemp: r1(wsum(activeProv, (p) => p.monthly_last_year_temp[i])  / totalProd),
      actualCur:    activeProv.every((p) => p.monthly_actual_temp_cur[i] != null)
        ? r1(wsum(activeProv, (p) => p.monthly_actual_temp_cur[i]) / totalProd)
        : null,
    }));
  }, [activeProv, totalProd]);

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

  // Prod-weighted daily accumulation across selected regions (falls back to the
  // single reference station when per-province daily series aren't in the data yet).
  const weightedDaily = useMemo<DailyRow[] | null>(() => {
    if (!data || !totalProd) return null;
    if (!activeProv.every((p) => Array.isArray(p.daily_accum_cur) && p.daily_accum_cur.length)) return null;
    const [yr, mo] = data.updated.split("-").map(Number);
    const mIdx = mo - 1;
    const dim = new Date(yr, mIdx + 1, 0).getDate();
    const wAvgMonth = wsum(activeProv, (p) => p.monthly_avg_rain[mIdx]) / totalProd;
    const haveLY = activeProv.every((p) => Array.isArray(p.daily_accum_ly) && p.daily_accum_ly!.length);
    const rows: DailyRow[] = [];
    for (let d = 1; d <= dim; d++) {
      const i = d - 1;
      const allCur = activeProv.every((p) => p.daily_accum_cur![i] != null);
      const avg_accum = r1(wAvgMonth * (d / dim));
      const lyOk = haveLY && activeProv.every((p) => p.daily_accum_ly![i] != null);
      rows.push({
        day: d,
        rain_mm: 0,
        accum_mm: allCur ? r1(wsum(activeProv, (p) => p.daily_accum_cur![i] as number) / totalProd) : null,
        avg_accum_mm: avg_accum,
        min_accum_mm: r1(avg_accum * 0.6),
        max_accum_mm: r1(avg_accum * 1.5),
        last_year_accum_mm: lyOk ? r1(wsum(activeProv, (p) => p.daily_accum_ly![i] as number) / totalProd) : r1(avg_accum * 1.08),
        temp_c: 0,
      });
    }
    return rows;
  }, [data, activeProv, totalProd]);

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
        <MeanTempChart data={tempData} curYear={data.cur_year} lastYear={data.last_year} domain={tempDomain} />
        <MonthlyRainChart data={monthlyRainData} curYear={data.cur_year} lastYear={data.last_year} />
        <CumulativeRainChart data={cumulativeData} curYear={data.cur_year} lastYear={data.last_year} />
        <SoilMoistureChart data={soilData} />
      </div>

      {/* Full-width forecast */}
      <ForecastRainChart data={forecastData} />

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
