"use client";
import React, { useState } from "react";
import type { FarmerEconomicsData, RiskLevel, DayRisk, CurrentCondition, DroughtDayDetail } from "./farmerEconomicsData";

interface Props {
  weather: NonNullable<FarmerEconomicsData["weather"]>;
}

const RISK_BADGE: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-600 text-white" },
  MED:  { label: "MED",  className: "bg-amber-500 text-black" },
  LOW:  { label: "LOW",  className: "bg-green-600 text-white" },
  NONE: { label: "—",    className: "bg-slate-800 text-slate-500 border border-slate-600" },
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

interface TooltipState {
  region: string;
  dayIndex: number;
  detail: DroughtDayDetail;
  x: number;
  y: number;
}

function DroughtTooltip({ tip }: { tip: TooltipState }) {
  const d = tip.detail;

  const vpdScore = d.vpd > 2.5 ? 3 : d.vpd > 1.5 ? 2 : d.vpd > 0.5 ? 1 : 0;
  const ppScore  = d.precip_prob < 15 ? 3 : d.precip_prob < 35 ? 2 : d.precip_prob < 60 ? 1 : 0;
  const modifier = d.soil_moisture > 0.28 ? "×0.50" : d.soil_moisture > 0.20 ? "×0.75" : d.soil_moisture < 0.15 ? "×1.50" : "×1.00";
  const modifierColor = d.soil_moisture > 0.28 ? "text-green-400" : d.soil_moisture < 0.15 ? "text-red-400" : "text-slate-400";

  return (
    <div
      className="fixed z-50 bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl text-[10px] w-44 pointer-events-none"
      style={{ left: tip.x + 12, top: tip.y - 10 }}
    >
      <div className="text-slate-300 font-semibold mb-2">{tip.region} · {d.date.slice(5)}</div>
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-slate-500">VPD</span>
          <span className="text-slate-200">{d.vpd.toFixed(2)} kPa <span className="text-slate-500">(score {vpdScore})</span></span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Rain prob</span>
          <span className="text-slate-200">{d.precip_prob}% <span className="text-slate-500">(score {ppScore})</span></span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Root-zone SM</span>
          <span className="text-slate-200">{d.soil_moisture.toFixed(3)} m³/m³</span>
        </div>
        <div className="flex justify-between border-t border-slate-700 pt-1 mt-1">
          <span className="text-slate-500">Soil modifier</span>
          <span className={modifierColor}>{modifier}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Result</span>
          <span className={
            d.drought_risk === "H" ? "text-amber-400 font-bold" :
            d.drought_risk === "M" ? "text-amber-300 font-bold" :
            d.drought_risk === "L" ? "text-green-400 font-bold" : "text-slate-500"
          }>{d.drought_risk === "-" ? "—" : d.drought_risk}</span>
        </div>
      </div>
    </div>
  );
}

export default function WeatherRiskPanel({ weather }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

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
        {weather.regions.map((r) => {
          const frost   = RISK_BADGE[r.frost];
          const drought = RISK_BADGE[r.drought];
          return (
            <div key={r.name} className="bg-slate-900 rounded p-2 border border-slate-700">
              <div className="text-[10px] text-slate-400 mb-1 truncate">{r.name}</div>
              <div className="flex gap-1 flex-wrap">
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${frost.className}`}>
                  ❄ {frost.label}
                </span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${drought.className}`}>
                  ☀ {drought.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 14-day frost grid */}
      {weather.daily_frost.length > 0 && (
        <div>
          <div className="text-[9px] text-blue-400 mb-1">14-Day Frost Risk</div>
          <div className="overflow-x-auto">
            <table className="text-[8px] border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left text-slate-500 pr-2 font-normal w-20">Region</th>
                  {dayLabels.map((d, i) => (
                    <th key={i} className="text-center text-slate-600 w-5 font-normal">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weather.daily_frost.map((row) => (
                  <React.Fragment key={row.region}>
                    <tr>
                      <td className="text-slate-400 pr-2 py-0.5 truncate max-w-[80px]">{row.region}</td>
                      {row.days.map((d, i) => (
                        <td key={i} className={`text-center py-0.5 ${FROST_CELL[d]}`}>{d}</td>
                      ))}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 14-day drought grid */}
      {weather.daily_drought.length > 0 && (
        <div>
          <div className="text-[9px] text-amber-400 mb-1">14-Day Drought Risk</div>
          <div className="overflow-x-auto">
            <table className="text-[8px] border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left text-slate-500 pr-2 font-normal w-20">Region</th>
                  {dayLabels.map((d, i) => (
                    <th key={i} className="text-center text-slate-600 w-5 font-normal">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weather.daily_drought.map((row) => {
                  const detail = weather.drought_detail?.find(r => r.region === row.region);
                  return (
                    <React.Fragment key={row.region}>
                      <tr>
                        <td className="text-slate-400 pr-2 py-0.5 truncate max-w-[80px]">{row.region}</td>
                        {row.days.map((d, i) => {
                          const dayDetail = detail?.days[i];
                          return (
                            <td
                              key={i}
                              className={`text-center py-0.5 cursor-default ${DROUGHT_CELL[d]}`}
                              onMouseEnter={dayDetail ? (e) => setTooltip({
                                region: row.region,
                                dayIndex: i,
                                detail: dayDetail,
                                x: e.clientX,
                                y: e.clientY,
                              }) : undefined}
                              onMouseMove={dayDetail ? (e) => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null) : undefined}
                              onMouseLeave={() => setTooltip(null)}
                            >
                              {d}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tooltip && <DroughtTooltip tip={tooltip} />}

      {/* Current Conditions (replaces Forecast Accuracy chart) */}
      {weather.current_conditions.length > 0 && (
        <div>
          <div className="text-[9px] text-slate-400 mb-2">Current Conditions (Today)</div>
          <div className="grid grid-cols-2 gap-2">
            {weather.current_conditions.map((cc: CurrentCondition) => (
              <div key={cc.region} className="bg-slate-900 rounded p-2 border border-slate-700">
                <div className="text-[9px] text-slate-400 mb-1 truncate">{cc.region}</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span className="text-[8px] text-slate-500">Temp</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.temp_c}°C</span>
                  <span className="text-[8px] text-slate-500">Dew pt</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.dew_point_c}°C</span>
                  <span className="text-[8px] text-slate-500">Cloud</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.cloud_cover_pct}%</span>
                  <span className="text-[8px] text-slate-500">Wind</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.wind_speed_kmh} km/h</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[8px] text-slate-600">
        Source: Open-Meteo · Updated {weather.scraped_at?.slice(0, 10) ?? "—"}
      </div>
    </div>
  );
}
