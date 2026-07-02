"use client";
import { useState } from "react";
import type { WeatherRegion } from "./farmerEconomicsData";
import { FROST_HISTORY } from "./frostHistory";

interface Props {
  regions: WeatherRegion[];
}

// Severity → styling + label. Mirrors the backend alert ladder (critical /
// alert / watch) so the panel reads the same as the Telegram alert.
const SEV_META: Record<string, { label: string; className: string; ring: string }> = {
  critical: { label: "CRITICAL", className: "bg-red-600 text-white",   ring: "border-red-500" },
  alert:    { label: "ALERT",    className: "bg-orange-500 text-black", ring: "border-orange-500" },
  watch:    { label: "WATCH",    className: "bg-amber-400 text-black",  ring: "border-amber-500/60" },
};

const MECH_LABEL: Record<string, string> = {
  radiative: "radiative — clear, calm night; canopy radiates heat to space",
  advective: "advective — wind-driven sub-zero air mass; wind won't protect",
  black:     "black frost — dry hard freeze; tissue desiccation",
  none:      "marginal",
};

const MECH_SHORT: Record<string, string> = {
  radiative: "radiative", advective: "advective", black: "black frost", none: "marginal",
};

function fmt(n: number | null | undefined, unit = "°C"): string {
  return n == null ? "—" : `${n.toFixed(1)} ${unit}`;
}

export default function FrostWatchPanel({ regions }: Props) {
  const [showHistory, setShowHistory] = useState(false);

  // Regions with a fired frost in the forecast (physics-based), worst first.
  const fired = regions
    .filter((r) => r.frost_detail && r.frost_detail.severity)
    .sort((a, b) => {
      const rank = { critical: 3, alert: 2, watch: 1 } as Record<string, number>;
      return (rank[b.frost_detail!.severity!] ?? 0) - (rank[a.frost_detail!.severity!] ?? 0);
    });

  return (
    <div className="space-y-2">
      <div className="text-[9px] text-blue-400 uppercase tracking-wide flex items-center gap-1">
        ❄ Frost Watch
        <span className="text-slate-600 normal-case tracking-normal">· per-region physics · 14-day forecast</span>
      </div>

      {fired.length === 0 ? (
        <div className="text-[9px] text-slate-500 bg-slate-900 rounded px-2 py-1.5 border border-slate-700">
          No frost in the 14-day forecast across the belt (Sul de Minas · Cerrado · Paraná).
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {fired.map((r) => {
            const d = r.frost_detail!;
            const sev = SEV_META[d.severity!] ?? SEV_META.watch;
            return (
              <div key={r.name} className={`bg-slate-900 rounded p-2 border ${sev.ring}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-200 font-semibold truncate">{r.name}</span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${sev.className}`}>
                    {sev.label}
                  </span>
                </div>
                <div
                  className="text-[9px] text-slate-300 font-mono"
                  title={MECH_LABEL[d.frost_type]}
                >
                  {fmt(d.surface_c)} canopy
                  <span className="text-slate-600"> · air </span>{fmt(d.air_min_c)}
                </div>
                <div className="text-[8px] text-slate-500 mt-0.5">
                  {MECH_SHORT[d.frost_type]}
                  {d.hours_below_0 > 0 && ` · ${d.hours_below_0} h below 0`}
                  {d.date && ` · ${d.date.slice(5)}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Historical anchor — how bad the belt's frosts get */}
      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="text-[8px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
      >
        <span>{showHistory ? "▼" : "▶"}</span> Historic frost disasters
      </button>
      {showHistory && (
        <div className="space-y-1">
          {FROST_HISTORY.map((e) => (
            <div key={e.id} className="bg-slate-900/60 rounded px-2 py-1 border border-slate-800">
              <div className="flex items-baseline gap-2">
                <span className="text-[9px] text-slate-300 font-semibold">{e.year}</span>
                <span className="text-[9px] text-slate-400">{e.label}</span>
                <span className="text-[8px] text-blue-300 font-mono ml-auto">
                  air {e.airMinC.toFixed(1)}°C · {MECH_SHORT[e.mechanism]}
                </span>
              </div>
              <div className="text-[8px] text-slate-500 leading-snug">{e.regions} — {e.impact}</div>
            </div>
          ))}
          <div className="text-[7px] text-slate-600 italic">
            Screen (2 m) air minima shown; the canopy ran several degrees colder on radiative nights.
          </div>
        </div>
      )}
    </div>
  );
}
