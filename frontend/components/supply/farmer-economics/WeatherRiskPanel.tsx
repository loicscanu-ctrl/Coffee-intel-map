"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { FarmerEconomicsData, RiskLevel, DayRisk } from "./farmerEconomicsData";
import { computeRmse } from "./farmerEconomicsUtils";

interface Props {
  weather: FarmerEconomicsData["weather"];
}

const RISK_BADGE: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-600 text-white" },
  MED:  { label: "MED",  className: "bg-amber-500 text-black" },
  LOW:  { label: "LOW",  className: "bg-green-600 text-white" },
  NONE: { label: "—",   className: "bg-slate-800 text-slate-500 border border-slate-600" },
};

const FROST_CELL: Record<DayRisk, string> = {
  "H": "bg-blue-900 text-white",
  "M": "bg-blue-600 text-white",
  "L": "bg-blue-950 text-blue-300",
  "-": "bg-slate-900 text-slate-600",
};

const DROUGHT_CELL: Record<DayRisk, string> = {
  "H": "bg-amber-700 text-white",
  "M": "bg-amber-500 text-black",
  "L": "bg-amber-900 text-amber-300",
  "-": "bg-slate-900 text-slate-600",
};

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

export default function WeatherRiskPanel({ weather }: Props) {
  const chartData = weather.forecast_accuracy.map((p) => ({
    date: p.date,
    forecast: p.forecast_c,
    actual: p.actual_c,
  }));

  const allTemps = weather.forecast_accuracy.flatMap((p) => [p.forecast_c, p.actual_c]);
  const minTemp  = Math.floor(Math.min(...allTemps)) - 2;
  const maxTemp  = Math.ceil(Math.max(...allTemps)) + 2;

  const rmse = computeRmse(weather.forecast_accuracy);

  const today = new Date();
  const dayLabels = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return String(d.getDate());
  });

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Weather Risk</div>

      {/* Current risk badges */}
      <div className="grid grid-cols-2 gap-2">
        {weather.regions.map((r) => (
          <div key={r.name} className="bg-slate-900 rounded p-2">
            <div className="text-[9px] text-slate-500 mb-1.5">{r.name}</div>
            <div className="flex gap-1.5">
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${RISK_BADGE[r.frost].className}`}>
                ❄ {RISK_BADGE[r.frost].label}
              </span>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${RISK_BADGE[r.drought].className}`}>
                ☀ {RISK_BADGE[r.drought].label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 14-day frost risk grid */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1.5">14-day frost risk ❄</div>
        <div
          className="grid gap-[2px] text-[7px] font-bold"
          style={{ gridTemplateColumns: `80px repeat(14, 1fr)` }}
        >
          <div />
          {dayLabels.map((d) => (
            <div key={d} className="text-center text-slate-600">{d}</div>
          ))}
          {weather.daily_frost.map((row) => (
            <>
              <div key={`${row.region}-label`} className="text-slate-400 flex items-center text-[9px]">
                {row.region}
              </div>
              {row.days.map((cell, i) => (
                <div
                  key={i}
                  className={`h-4 flex items-center justify-center rounded-[2px] ${FROST_CELL[cell]}`}
                >
                  {cell}
                </div>
              ))}
            </>
          ))}
        </div>
      </div>

      {/* 14-day drought risk grid */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1.5">14-day drought risk ☀</div>
        <div
          className="grid gap-[2px] text-[7px] font-bold"
          style={{ gridTemplateColumns: `80px repeat(14, 1fr)` }}
        >
          <div />
          {dayLabels.map((d) => (
            <div key={d} className="text-center text-slate-600">{d}</div>
          ))}
          {weather.daily_drought.map((row) => (
            <>
              <div key={`${row.region}-label`} className="text-slate-400 flex items-center text-[9px]">
                {row.region}
              </div>
              {row.days.map((cell, i) => (
                <div
                  key={i}
                  className={`h-4 flex items-center justify-center rounded-[2px] ${DROUGHT_CELL[cell]}`}
                >
                  {cell}
                </div>
              ))}
            </>
          ))}
        </div>
      </div>

      {/* Forecast accuracy — dual-line chart */}
      <div>
        <div className="text-[10px] text-slate-500 mb-1">
          Forecast accuracy — min temp °C, {weather.forecast_region} (last 7 days)
        </div>
        <div className="flex gap-3 text-[9px] text-slate-500 mb-2">
          <span><span className="inline-block w-4 border-t-2 border-dashed border-blue-400 align-middle mr-1" />Forecast</span>
          <span><span className="inline-block w-4 border-t-2 border-orange-400 align-middle mr-1" />Actual</span>
        </div>
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 8 }} />
            <YAxis domain={[minTemp, maxTemp]} tick={{ fill: "#475569", fontSize: 8 }} width={28} unit="°" />
            <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, n: string | number | undefined) => [`${v}°C`, n === "forecast" ? "Forecast" : "Actual"]} />
            <Line
              type="monotone" dataKey="forecast" stroke="#60a5fa"
              strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line
              type="monotone" dataKey="actual" stroke="#f97316"
              strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="text-[9px] text-slate-600 mt-1">
          RMSE {rmse}°C over {weather.forecast_accuracy.length} days · Source: INMET / CPTEC
        </div>
      </div>
    </div>
  );
}
