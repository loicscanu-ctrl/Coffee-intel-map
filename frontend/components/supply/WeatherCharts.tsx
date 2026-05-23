"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, BarChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Province {
  name: string;
  station: string;
  prod_mt_k: number;
  weight: number;
  monthly_avg_rain: number[];
  monthly_min_rain: number[];
  monthly_max_rain: number[];
  monthly_last_year_rain: number[];
  monthly_actual_cur: number[];
  monthly_avg_temp: number[];
  monthly_min_temp: number[];
  monthly_max_temp: number[];
  monthly_last_year_temp: number[];
  monthly_actual_temp_cur: number[];
  forecast_7d_rain: number[];
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
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-[8px] text-slate-600 uppercase tracking-wider mr-0.5">Filter:</span>
      {provinces.map((p) => {
        const active = selected.has(p.name);
        return (
          <button
            key={p.name}
            onClick={() => onToggle(p.name)}
            className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors border ${
              active
                ? "bg-slate-700 text-slate-200 border-slate-500"
                : "bg-transparent text-slate-600 border-slate-700"
            }`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

// ── 1. Daily Accumulated Rainfall (reference station) ────────────────────────

function DailyAccumChart({
  daily, station, updated, curYear, lastYear, selectedYear, selectedMonthIdx,
}: {
  daily: DailyRow[];
  station: string;
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

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Daily Accumulated Rainfall — {monthLabel} (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">{station} station · Band = 10yr min/max</div>
      {isCurrentPeriod ? (
        <ResponsiveContainer width="100%" height={155}>
          <ComposedChart data={daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
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
            <Line type="monotone" dataKey="avg_accum_mm" name="hist. avg"
              stroke="#475569" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line type="monotone" dataKey="last_year_accum_mm" name={`${lastYear}`}
              stroke="#93c5fd" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="accum_mm" name={`${curYear}`}
              stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} />
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
}

function MonthlyRainChart({ data, curYear, lastYear }: { data: MonthlyRainRow[]; curYear: number; lastYear: number }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Monthly Rainfall (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Pro-rata prod-weighted · Blue = {curYear} · Light blue = {lastYear} · Band = 10yr min/max
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
          {/* 10yr range band — rendered first (behind bars) */}
          <Area type="monotone" dataKey="maxRain" name="10yr max" fill="#1e3a5f"
            stroke="none" opacity={0.5} legendType="none" />
          <Area type="monotone" dataKey="minRain" name="10yr min" fill="#0f172a"
            stroke="none" opacity={1} legendType="none" />
          {/* last-year and current-year bars */}
          <Bar dataKey="lastYearRain" name={`${lastYear}`} fill="#93c5fd" opacity={0.7} radius={[2, 2, 0, 0]} />
          <Bar dataKey="actualCur" name={`${curYear}`} fill="#38bdf8" opacity={0.9} radius={[2, 2, 0, 0]} />
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
}

function CumulativeRainChart({ data, curYear, lastYear }: { data: CumRainRow[]; curYear: number; lastYear: number }) {
  const lastActualMonth = [...data].reverse().find((d) => d.cumCur !== null)?.month;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
        Cumulative YTD Rainfall (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Pro-rata prod-weighted · {curYear} through {lastActualMonth ?? "—"} · Band = 10yr min/max
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

// ── Main ───────────────────────────────────────────────────────────────────────

export default function WeatherCharts({
  dataUrl,
  title,
}: {
  /** Path under /public, e.g. "/data/brazil_weather.json". */
  dataUrl: string;
  /** Header label, e.g. "Weather · Brazil". */
  title: string;
}) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [selectedYear, setSelectedYear]   = useState<number>(new Date().getFullYear());
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(new Date().getMonth());

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

  const totalProd = useMemo(
    () => activeProv.reduce((s, p) => s + p.prod_mt_k, 0),
    [activeProv]
  );

  const monthlyRainData = useMemo<MonthlyRainRow[]>(() => {
    if (!totalProd) return [];
    return MONTHS.map((month, i) => ({
      month,
      avgRain:      r1(wsum(activeProv, (p) => p.monthly_avg_rain[i])      / totalProd),
      minRain:      r1(wsum(activeProv, (p) => p.monthly_min_rain[i])      / totalProd),
      maxRain:      r1(wsum(activeProv, (p) => p.monthly_max_rain[i])      / totalProd),
      lastYearRain: r1(wsum(activeProv, (p) => p.monthly_last_year_rain[i]) / totalProd),
      actualCur:    activeProv.every((p) => p.monthly_actual_cur.length > i)
        ? r1(wsum(activeProv, (p) => p.monthly_actual_cur[i]) / totalProd)
        : null,
    }));
  }, [activeProv, totalProd]);

  const cumulativeData = useMemo<CumRainRow[]>(() => {
    if (!totalProd) return [];
    let cumAvg = 0, cumMin = 0, cumMax = 0, cumLY = 0, cumC = 0;
    return MONTHS.map((month, i) => {
      cumAvg += wsum(activeProv, (p) => p.monthly_avg_rain[i])       / totalProd;
      cumMin += wsum(activeProv, (p) => p.monthly_min_rain[i])       / totalProd;
      cumMax += wsum(activeProv, (p) => p.monthly_max_rain[i])       / totalProd;
      cumLY  += wsum(activeProv, (p) => p.monthly_last_year_rain[i]) / totalProd;
      const hasActual = activeProv.every((p) => p.monthly_actual_cur.length > i);
      if (hasActual) cumC += wsum(activeProv, (p) => p.monthly_actual_cur[i]) / totalProd;
      return {
        month,
        cumAvg:      Math.round(cumAvg),
        cumMin:      Math.round(cumMin),
        cumMax:      Math.round(cumMax),
        cumLastYear: Math.round(cumLY),
        cumCur:      hasActual ? Math.round(cumC) : null,
      };
    });
  }, [activeProv, totalProd]);

  const tempData = useMemo<TempRow[]>(() => {
    if (!totalProd) return [];
    return MONTHS.map((month, i) => ({
      month,
      avgTemp:      r1(wsum(activeProv, (p) => p.monthly_avg_temp[i])        / totalProd),
      minTemp:      r1(wsum(activeProv, (p) => p.monthly_min_temp[i])        / totalProd),
      maxTemp:      r1(wsum(activeProv, (p) => p.monthly_max_temp[i])        / totalProd),
      lastYearTemp: r1(wsum(activeProv, (p) => p.monthly_last_year_temp[i])  / totalProd),
      actualCur:    activeProv.every((p) => p.monthly_actual_temp_cur.length > i)
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

      {/* 2×2 grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DailyAccumChart
          daily={data.daily_station}
          station={data.station}
          updated={data.updated}
          curYear={data.cur_year}
          lastYear={data.last_year}
          selectedYear={selectedYear}
          selectedMonthIdx={selectedMonthIdx}
        />
        <MeanTempChart data={tempData} curYear={data.cur_year} lastYear={data.last_year} domain={tempDomain} />
        <MonthlyRainChart data={monthlyRainData} curYear={data.cur_year} lastYear={data.last_year} />
        <CumulativeRainChart data={cumulativeData} curYear={data.cur_year} lastYear={data.last_year} />
      </div>

      {/* Full-width forecast */}
      <ForecastRainChart data={forecastData} />

      <div className="text-[8px] text-slate-700 italic border-t border-slate-700 pt-2">
        Production weights: {data.source_production} ·
        Weather: {data.source_weather} ·
        Weighted avg = Σ(value_i × prod_i) / Σ(prod_i) across selected regions
      </div>
    </div>
  );
}
