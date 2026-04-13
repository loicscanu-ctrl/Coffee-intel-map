"use client";
import { useEffect, useState, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

interface VolumeSeries {
  date: string;          // "YYYY-MM"
  conillon: number;
  arabica: number;
  total_verde: number;
  torrado: number;
  soluvel: number;
  total_industria: number;
  total: number;
}

interface CountryYear {
  months: string[];
  countries: Record<string, Record<string, number>>;
}

interface CecafeData {
  source: string;
  report: string;
  updated: string;
  unit: string;
  series: VolumeSeries[];
  by_country: CountryYear;
  by_country_prev: CountryYear;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BAG = 60;   // kg per bag
const KT  = 1e6;  // bags to metric tons (÷ 1e6 * 60 = ÷ 16 667)

function bagsToKT(bags: number) {
  return Math.round((bags * BAG) / 1e6 * 10) / 10;
}

function fmtKT(v: number) {
  return `${v.toFixed(1)} kt`;
}

function fmtBags(v: number) {
  return `${(v / 1000).toFixed(0)}k bags`;
}

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(ym: string) {
  const [, m] = ym.split("-");
  return MONTH_LABELS[parseInt(m) - 1];
}

const GREEN  = "#22c55e";
const AMBER  = "#f59e0b";
const BLUE   = "#60a5fa";
const SLATE  = "#94a3b8";
const TEAL   = "#2dd4bf";

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Monthly Volume Chart (last N years) ──────────────────────────────────────

function MonthlyVolumeChart({ series }: { series: VolumeSeries[] }) {
  const [years, setYears] = useState(3);

  const yearGroups = useMemo(() => {
    const byYear: Record<number, Record<number, VolumeSeries>> = {};
    series.forEach(r => {
      const [y, m] = r.date.split("-").map(Number);
      if (!byYear[y]) byYear[y] = {};
      byYear[y][m] = r;
    });
    return byYear;
  }, [series]);

  const latestYear = Math.max(...Object.keys(yearGroups).map(Number));
  const showYears = Array.from({ length: years }, (_, i) => latestYear - i).reverse();
  const YEAR_COLORS = ["#475569", "#64748b", "#94a3b8", "#60a5fa", GREEN];

  const chartData = MONTH_LABELS.map((label, mi) => {
    const row: Record<string, number | string> = { month: label };
    showYears.forEach(y => {
      const d = yearGroups[y]?.[mi + 1];
      row[String(y)] = d ? bagsToKT(d.total) : 0;
    });
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-200">Monthly Export Volume</div>
        <div className="flex gap-1">
          {[2, 3, 5].map(n => (
            <button
              key={n}
              onClick={() => setYears(n)}
              className={`text-[10px] px-2 py-0.5 rounded ${years === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
            >
              {n}Y
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-slate-500 mb-3">Thousand metric tons (60 kg bags × 60 / 1,000,000)</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}`} tick={{ fill: "#94a3b8", fontSize: 10 }}
            label={{ value: "kt", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: any) => [`${v} kt`, ""]}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
          {showYears.map((y, i) => (
            <Bar key={y} dataKey={String(y)}
              fill={YEAR_COLORS[i % YEAR_COLORS.length]}
              opacity={y === latestYear ? 1 : 0.7}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Long-term trend (annual totals) ─────────────────────────────────────────

function AnnualTrendChart({ series }: { series: VolumeSeries[] }) {
  const annualData = useMemo(() => {
    const byYear: Record<number, { total: number; arabica: number; conillon: number; soluvel: number; torrado: number }> = {};
    series.forEach(r => {
      const y = parseInt(r.date.split("-")[0]);
      if (!byYear[y]) byYear[y] = { total: 0, arabica: 0, conillon: 0, soluvel: 0, torrado: 0 };
      byYear[y].total    += r.total;
      byYear[y].arabica  += r.arabica;
      byYear[y].conillon += r.conillon;
      byYear[y].soluvel  += r.soluvel;
      byYear[y].torrado  += r.torrado;
    });
    // Only include years with 12 months of data
    const latestYear = Math.max(...Object.keys(byYear).map(Number));
    return Object.entries(byYear)
      .filter(([y]) => parseInt(y) < latestYear)  // exclude incomplete current year
      .map(([y, v]) => ({
        year: y,
        arabica:  bagsToKT(v.arabica),
        conillon: bagsToKT(v.conillon),
        soluvel:  bagsToKT(v.soluvel),
        torrado:  bagsToKT(v.torrado),
      }))
      .sort((a, b) => parseInt(a.year) - parseInt(b.year));
  }, [series]);

  const [since, setSince] = useState(2010);

  const filtered = annualData.filter(r => parseInt(r.year) >= since);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-200">Annual Export by Type</div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-slate-500 mb-3">Thousand metric tons — full years only</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={filtered} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}`} tick={{ fill: "#94a3b8", fontSize: 10 }}
            label={{ value: "kt", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 10 }} />
          <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: any) => [`${v} kt`, ""]} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
          <Bar dataKey="arabica"  stackId="a" fill={GREEN}  name="Arabica"  />
          <Bar dataKey="conillon" stackId="a" fill={TEAL}   name="Conillon" />
          <Bar dataKey="soluvel"  stackId="a" fill={AMBER}  name="Solúvel"  />
          <Bar dataKey="torrado"  stackId="a" fill={BLUE}   name="Torrado"  />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Country breakdown ────────────────────────────────────────────────────────

function CountryChart({ byCountry, byCountryPrev }: { byCountry: CountryYear; byCountryPrev: CountryYear }) {
  const [topN, setTopN] = useState(15);

  const currentMonths = byCountry.months ?? [];
  const prevMonths    = byCountryPrev.months ?? [];

  // Aggregate totals per country (current year YTD)
  const totals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};
    Object.entries(byCountry.countries ?? {}).forEach(([c, mv]) => {
      out[c] = { current: Object.values(mv).reduce((a, b) => a + b, 0), prev: 0 };
    });
    // Match prev year for same months (by month index, not absolute date)
    Object.entries(byCountryPrev.countries ?? {}).forEach(([c, mv]) => {
      const prevFiltered = prevMonths
        .slice(0, currentMonths.length)
        .reduce((sum, m) => sum + (mv[m] ?? 0), 0);
      if (!out[c]) out[c] = { current: 0, prev: 0 };
      out[c].prev = prevFiltered;
    });
    return out;
  }, [byCountry, byCountryPrev, currentMonths, prevMonths]);

  const chartData = useMemo(() =>
    Object.entries(totals)
      .sort((a, b) => b[1].current - a[1].current)
      .slice(0, topN)
      .map(([country, v]) => ({
        country: country.length > 18 ? country.slice(0, 17) + "…" : country,
        current: bagsToKT(v.current),
        prev:    bagsToKT(v.prev),
        pct_chg: v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
      }))
  , [totals, topN]);

  const ytdLabel = currentMonths.length > 0
    ? `${monthLabel(currentMonths[0])}–${monthLabel(currentMonths[currentMonths.length - 1])} YTD`
    : "YTD";
  const prevLabel = prevMonths.length > 0 ? String(prevMonths[0]).split("-")[0] : "Prev yr";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">Export by Destination Country</div>
          <div className="text-[10px] text-slate-500">{ytdLabel} vs same period {prevLabel}</div>
        </div>
        <div className="flex gap-1">
          {[10, 15, 25].map(n => (
            <button key={n} onClick={() => setTopN(n)}
              className={`text-[10px] px-2 py-0.5 rounded ${topN === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              Top {n}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={topN * 26 + 40}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 60, bottom: 4, left: 120 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis type="number" tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <YAxis type="category" dataKey="country" tick={{ fill: "#cbd5e1", fontSize: 9 }} width={115} />
          <Tooltip
            contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 }}
            formatter={(v: any) => [`${v} kt`]}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
          <Bar dataKey="prev"    name={prevLabel} fill={SLATE} opacity={0.6} />
          <Bar dataKey="current" name="2026 YTD"  radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.pct_chg !== null && entry.pct_chg < 0 ? "#ef4444" : GREEN} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Small pct-change table */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
        {chartData.map(r => (
          <div key={r.country} className="flex justify-between items-center border-b border-slate-800 py-0.5">
            <span className="text-slate-300 truncate">{r.country}</span>
            <span className={r.pct_chg === null ? "text-slate-500" : r.pct_chg >= 0 ? "text-green-400" : "text-red-400"}>
              {r.pct_chg === null ? "—" : `${r.pct_chg > 0 ? "+" : ""}${r.pct_chg}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function BrazilTab() {
  const [data, setData] = useState<CecafeData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/cecafe.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return (
    <div className="text-center text-slate-500 py-16 text-sm">
      Cecafe data not available — scraper may not have run yet.
    </div>
  );
  if (!data) return (
    <div className="text-center text-slate-500 py-16 text-sm animate-pulse">Loading Cecafe data…</div>
  );

  const { series, by_country, by_country_prev, report, updated } = data;
  const latest  = series[series.length - 1];
  const prev    = series[series.length - 13]; // same month last year
  const ytd2026 = series.filter(r => r.date.startsWith("2026"));
  const ytd2025_same = series.filter(r => {
    const [y, m] = r.date.split("-");
    return y === "2025" && parseInt(m) <= ytd2026.length;
  });

  const ytdTotal2026 = ytd2026.reduce((s, r) => s + r.total, 0);
  const ytdTotal2025 = ytd2025_same.reduce((s, r) => s + r.total, 0);
  const ytdChg = ytdTotal2025 > 0 ? Math.round((ytdTotal2026 - ytdTotal2025) / ytdTotal2025 * 100) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-200">Brazil — Cecafe Export Data</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Report: {report} · Updated {updated} · Source: Cecafe
          </p>
        </div>
        <span className="text-[10px] bg-green-900/50 text-green-400 px-2 py-0.5 rounded border border-green-800">
          Arabica origin
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={`${latest.date} total`}
          value={`${bagsToKT(latest.total).toFixed(1)} kt`}
          sub={`${(latest.total / 1000).toFixed(0)}k bags`}
        />
        <StatCard
          label="vs same month LY"
          value={prev ? `${Math.round((latest.total - prev.total) / prev.total * 100) > 0 ? "+" : ""}${Math.round((latest.total - prev.total) / prev.total * 100)}%` : "—"}
          sub={prev ? `${bagsToKT(prev.total).toFixed(1)} kt last year` : ""}
        />
        <StatCard
          label={`${ytd2026.map(r => r.date.split("-")[1]).join("/")} YTD 2026`}
          value={`${bagsToKT(ytdTotal2026).toFixed(1)} kt`}
          sub={`${(ytdTotal2026 / 1000).toFixed(0)}k bags`}
        />
        <StatCard
          label="YTD vs 2025"
          value={ytdChg !== null ? `${ytdChg > 0 ? "+" : ""}${ytdChg}%` : "—"}
          sub={`2025 same period: ${bagsToKT(ytdTotal2025).toFixed(1)} kt`}
        />
      </div>

      {/* Charts */}
      <MonthlyVolumeChart series={series} />
      <AnnualTrendChart series={series} />
      <CountryChart byCountry={by_country} byCountryPrev={by_country_prev} />
    </div>
  );
}
