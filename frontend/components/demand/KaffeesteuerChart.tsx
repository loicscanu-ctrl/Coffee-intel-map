"use client";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { useState, useMemo } from "react";

// Values in Tsd. EUR (thousands), sourced from Bundesfinanzministerium monthly PDFs
const RAW: Record<string, number> = {
  "2016-05":79238,"2016-06":78607,"2016-07":82893,"2016-08":85337,
  "2016-09":91130,"2016-10":87628,"2016-11":85458,"2016-12":101026,
  "2017-01":95690,"2017-02":74520,"2017-03":78936,"2017-04":97843,
  "2017-05":80552,"2017-06":90686,"2017-07":78221,"2017-08":75154,
  "2017-09":91049,"2017-10":92598,"2017-11":94053,"2017-12":108050,
  "2018-01":90128,"2018-03":76889,"2018-04":97593,"2018-05":79222,
  "2018-06":83076,"2018-07":79776,"2018-08":81747,"2018-09":85630,
  "2018-10":85353,"2018-11":94851,"2018-12":105875,
  "2019-01":83679,"2019-02":81031,"2019-03":81136,"2019-04":99284,
  "2019-05":99148,"2019-06":83626,"2019-07":77743,"2019-08":85762,
  "2019-09":79936,"2019-10":85981,"2019-11":93443,"2019-12":109484,
  "2020-01":92402,"2020-02":78886,"2020-03":79419,"2020-04":99610,
  "2020-05":67487,"2020-06":71277,"2020-07":88844,"2020-08":87520,
  "2020-09":87375,"2020-10":99977,"2020-11":98009,"2020-12":109502,
  "2021-01":101685,"2021-02":60251,"2021-03":89626,"2021-04":109864,
  "2021-05":78936,"2021-06":87757,"2021-07":82549,"2021-08":85915,
  "2021-09":82176,"2021-10":92776,"2021-11":81555,"2021-12":105334,
  "2022-01":101799,"2022-02":65864,"2022-03":85319,"2022-04":121042,
  "2022-05":82598,"2022-06":84258,"2022-07":81504,"2022-08":79336,
  "2022-09":80543,"2022-10":91463,"2022-11":89332,"2022-12":99482,
  "2023-01":96595,"2023-02":72930,"2023-03":85532,"2023-04":97970,
  "2023-05":73405,"2023-06":85795,"2023-07":77933,"2023-08":76251,
  "2023-09":85985,"2023-10":81125,"2023-11":93823,"2023-12":102885,
  "2024-01":87475,"2024-02":72543,"2024-03":87983,"2024-04":95297,
  "2024-05":78862,"2024-06":83932,"2024-07":74640,"2024-08":77993,
  "2024-09":68919,"2024-10":82153,"2024-11":86458,"2024-12":96044,
  "2025-01":91832,"2025-02":79591,"2025-03":75053,"2025-04":91242,
  "2025-05":91597,"2025-06":87166,"2025-07":77748,"2025-08":78941,
  "2025-09":77879,"2025-10":89570,"2025-11":93198,"2025-12":104082,
  "2026-01":96243,"2026-02":74721,
};

const YEAR_COLORS: Record<number, string> = {
  2016: "#64748b", 2017: "#6366f1", 2018: "#8b5cf6",
  2019: "#06b6d4", 2020: "#f59e0b", 2021: "#10b981",
  2022: "#ef4444", 2023: "#f97316", 2024: "#3b82f6",
  2025: "#a3e635", 2026: "#e2e8f0",
};

function toMillions(v: number) { return +(v / 1000).toFixed(2); }

const MONTH_ABB = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface DataPoint {
  period: string;
  label: string;
  value: number;
  yoy: number | null;
  ma12: number | null;
  year: number;
}

function buildSeries(): DataPoint[] {
  const sorted = Object.keys(RAW).sort();
  return sorted.map((period, i) => {
    const [y, m] = period.split("-").map(Number);
    const val = toMillions(RAW[period]);

    // YoY
    const prevKey = `${y - 1}-${String(m).padStart(2, "0")}`;
    const prev = RAW[prevKey];
    const yoy = prev != null ? +((RAW[period] / prev - 1) * 100).toFixed(1) : null;

    // 12-month rolling average (trailing)
    let ma12: number | null = null;
    if (i >= 11) {
      const slice = sorted.slice(i - 11, i + 1).map(k => RAW[k]);
      ma12 = +(slice.reduce((a, b) => a + b, 0) / 12 / 1000).toFixed(2);
    }

    return { period, label: `${MONTH_ABB[m]} ${y}`, value: val, yoy, ma12, year: y };
  });
}

const ALL_SERIES = buildSeries();
const ALL_YEARS = Array.from(new Set(ALL_SERIES.map(d => d.year))).sort();

function annualTotal(year: number) {
  return Object.entries(RAW)
    .filter(([k]) => k.startsWith(String(year)))
    .reduce((s, [, v]) => s + v, 0);
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d: DataPoint = payload[0]?.payload;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs">
      <div className="font-semibold text-white mb-1">{d.label}</div>
      <div className="text-amber-300">Kaffeesteuer: <span className="font-bold">€{d.value.toFixed(2)}M</span></div>
      {d.yoy !== null && (
        <div className={d.yoy >= 0 ? "text-emerald-400" : "text-red-400"}>
          YoY: {d.yoy >= 0 ? "+" : ""}{d.yoy}%
        </div>
      )}
      {d.ma12 !== null && (
        <div className="text-sky-400">12-mo avg: €{d.ma12.toFixed(2)}M</div>
      )}
    </div>
  );
};

export default function KaffeesteuerChart() {
  const [selectedYears, setSelectedYears] = useState<number[]>(ALL_YEARS);
  const [showMA, setShowMA] = useState(true);

  const data = useMemo(
    () => ALL_SERIES.filter(d => selectedYears.includes(d.year)),
    [selectedYears]
  );

  const annuals = useMemo(
    () => ALL_YEARS.filter(y => {
      const months = Object.keys(RAW).filter(k => k.startsWith(String(y))).length;
      return months === 12;
    }).map(y => ({ year: y, total: toMillions(annualTotal(y)) })),
    []
  );

  function toggleYear(y: number) {
    setSelectedYears(prev =>
      prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort()
    );
  }

  const latestFull = annuals[annuals.length - 1];
  const prevFull   = annuals[annuals.length - 2];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">German Coffee Tax (Kaffeesteuer)</h2>
          <p className="text-xs text-slate-400">Monthly revenue — Bundesfinanzministerium · Tsd. EUR → millions</p>
        </div>
        <div className="flex gap-4 text-xs">
          {latestFull && (
            <div className="bg-slate-800 rounded px-3 py-2 text-center">
              <div className="text-slate-400">{latestFull.year} total</div>
              <div className="text-white font-bold text-base">€{latestFull.total.toFixed(0)}M</div>
              {prevFull && (
                <div className={latestFull.total >= prevFull.total ? "text-emerald-400" : "text-red-400"}>
                  {latestFull.total >= prevFull.total ? "+" : ""}
                  {(((latestFull.total / prevFull.total) - 1) * 100).toFixed(1)}% vs {prevFull.year}
                </div>
              )}
            </div>
          )}
          <div className="bg-slate-800 rounded px-3 py-2 text-center">
            <div className="text-slate-400">Latest</div>
            <div className="text-white font-bold text-base">
              €{toMillions(RAW[Object.keys(RAW).sort().at(-1)!]).toFixed(2)}M
            </div>
            <div className="text-slate-500">{Object.keys(RAW).sort().at(-1)}</div>
          </div>
        </div>
      </div>

      {/* Year filter */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedYears(ALL_YEARS)}
          className="px-2 py-0.5 rounded text-xs border border-slate-600 text-slate-300 hover:bg-slate-700"
        >
          All
        </button>
        {ALL_YEARS.map(y => (
          <button
            key={y}
            onClick={() => toggleYear(y)}
            className="px-2 py-0.5 rounded text-xs font-medium border transition-colors"
            style={{
              borderColor: YEAR_COLORS[y] ?? "#64748b",
              backgroundColor: selectedYears.includes(y) ? (YEAR_COLORS[y] ?? "#64748b") + "33" : "transparent",
              color: selectedYears.includes(y) ? (YEAR_COLORS[y] ?? "#e2e8f0") : "#94a3b8",
            }}
          >
            {y}
          </button>
        ))}
        <button
          onClick={() => setShowMA(v => !v)}
          className={`px-2 py-0.5 rounded text-xs border transition-colors ml-2 ${
            showMA ? "border-sky-500 bg-sky-500/20 text-sky-300" : "border-slate-600 text-slate-500"
          }`}
        >
          12-mo avg
        </button>
      </div>

      {/* Main chart */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3" style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              interval={selectedYears.length <= 2 ? 0 : Math.floor(data.length / 18)}
              angle={-35}
              textAnchor="end"
              height={45}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickFormatter={v => `€${v}M`}
              domain={[50, 130]}
              width={55}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={toMillions(Object.values(RAW).reduce((a, b) => a + b, 0) / Object.values(RAW).length)}
              stroke="#475569" strokeDasharray="4 4" />
            <Bar dataKey="value" name="Kaffeesteuer" radius={[2, 2, 0, 0]}
              fill="#f59e0b" opacity={0.85} />
            {showMA && (
              <Line dataKey="ma12" name="12-mo avg" dot={false} strokeWidth={2}
                stroke="#38bdf8" connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Annual totals bar */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3" style={{ height: 180 }}>
        <div className="text-xs text-slate-400 mb-2">Annual totals (complete years only) — EUR millions</div>
        <ResponsiveContainer width="100%" height="85%">
          <ComposedChart data={annuals} margin={{ top: 2, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={v => `€${v}M`}
              domain={[800, 1200]} width={58} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e293b", borderColor: "#475569", fontSize: 12 }}
              formatter={(v: any) => [`€${Number(v).toFixed(0)}M`, "Annual total"]}
            />
            <Bar dataKey="total" radius={[2, 2, 0, 0]}
              fill="#6366f1" opacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
