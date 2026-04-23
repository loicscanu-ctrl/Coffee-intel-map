"use client";
import { useEffect, useState } from "react";

interface RiverRow {
  river: string;
  river_vn: string;
  provinces: string[];
  station: string;
  actual_mm3?: number | null;
  tbnn_pct?: number | null;
  forecast_tbnn_pct?: number | null;
  signal: "critical" | "low" | "normal" | "high" | "unknown";
}

interface WaterData {
  updated: string;
  bulletin_date: string | null;
  source: string;
  rivers: RiverRow[];
  has_live_data: boolean;
  pdf_url?: string;
}

const SIGNAL_CONFIG = {
  critical: { label: "Critical",      color: "#ef4444", bg: "#ef444415", barColor: "#ef4444" },
  low:      { label: "Below avg",     color: "#f97316", bg: "#f9731615", barColor: "#f97316" },
  normal:   { label: "Near avg",      color: "#22c55e", bg: "#22c55e15", barColor: "#22c55e" },
  high:     { label: "Above avg",     color: "#3b82f6", bg: "#3b82f615", barColor: "#3b82f6" },
  unknown:  { label: "No data",       color: "#64748b", bg: "#64748b15", barColor: "#64748b" },
};

function GaugeBar({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <div className="h-1.5 bg-slate-700 rounded-full" />;
  // Map -100..+100 to a visual bar. Center = 50% width = TBNN.
  const clamped = Math.max(-100, Math.min(100, pct));
  const isNeg   = clamped < 0;
  const absW    = Math.abs(clamped) / 100 * 50; // max 50% each side
  const color   = pct <= -50 ? "#ef4444" : pct <= -20 ? "#f97316" : pct <= 20 ? "#22c55e" : "#3b82f6";
  return (
    <div className="relative h-1.5 bg-slate-700 rounded-full overflow-hidden">
      {/* Center marker */}
      <div className="absolute top-0 bottom-0 w-px bg-slate-500" style={{ left: "50%" }} />
      {/* Bar */}
      <div
        className="absolute top-0 bottom-0 rounded-full"
        style={{
          background: color,
          width: `${absW}%`,
          left:  isNeg ? `${50 - absW}%` : "50%",
        }}
      />
    </div>
  );
}

function RiverCard({ rv }: { rv: RiverRow }) {
  const cfg = SIGNAL_CONFIG[rv.signal] ?? SIGNAL_CONFIG.unknown;
  const pct = rv.tbnn_pct;
  const pctStr = pct != null ? `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%` : "—";

  return (
    <div className="rounded-lg p-3 border space-y-1.5"
      style={{ borderColor: cfg.color + "44", background: cfg.bg }}>
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-[10px] font-bold text-slate-200">{rv.river}</span>
          <span className="text-[8px] text-slate-500 ml-1">@ {rv.station}</span>
        </div>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ color: cfg.color, background: cfg.color + "22" }}>
          {cfg.label}
        </span>
      </div>

      {/* Provinces */}
      <div className="flex flex-wrap gap-1">
        {rv.provinces.map(p => (
          <span key={p} className="text-[7px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">
            {p}
          </span>
        ))}
      </div>

      {/* Gauge bar */}
      <GaugeBar pct={pct} />

      {/* Values row */}
      <div className="flex items-center justify-between text-[8px]">
        <div className="text-slate-500">
          vs TBNN:&nbsp;
          <span className="font-bold" style={{ color: cfg.color }}>{pctStr}</span>
        </div>
        {rv.actual_mm3 != null && (
          <div className="text-slate-600 font-mono">
            {rv.actual_mm3.toFixed(2)} M m³/wk
          </div>
        )}
        {rv.forecast_tbnn_pct != null && (
          <div className="text-slate-600 text-[7px]">
            fcst: {rv.forecast_tbnn_pct > 0 ? "+" : ""}{rv.forecast_tbnn_pct.toFixed(0)}%
          </div>
        )}
      </div>
    </div>
  );
}

export default function VnWaterLevels() {
  const [data, setData] = useState<WaterData | null>(null);
  const [err, setErr]   = useState(false);

  useEffect(() => {
    fetch("/data/vn_water_levels.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setErr(true));
  }, []);

  if (err || !data) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-600 text-xs italic">
        {err ? "Water level data unavailable" : "Loading…"}
      </div>
    );
  }

  const { rivers, bulletin_date, has_live_data, source, pdf_url } = data;

  // Summary signal for header
  const criticalCount = rivers.filter(r => r.signal === "critical").length;
  const lowCount      = rivers.filter(r => r.signal === "low").length;
  const headerSignal  = criticalCount > 0 ? "critical" : lowCount > 0 ? "low" : "normal";
  const headerCfg     = SIGNAL_CONFIG[headerSignal];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold flex items-center gap-1.5">
            River Flow · Coffee Regions
            {!has_live_data && (
              <span className="text-[7px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">static seed</span>
            )}
          </div>
          <div className="text-[8px] text-slate-600 mt-0.5">
            % vs TBNN (multi-year historical avg) · bulletin {bulletin_date ?? "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold px-2 py-0.5 rounded"
            style={{ color: headerCfg.color, background: headerCfg.color + "22" }}>
            {criticalCount > 0
              ? `${criticalCount} basin${criticalCount > 1 ? "s" : ""} critical`
              : lowCount > 0
              ? `${lowCount} basin${lowCount > 1 ? "s" : ""} below avg`
              : "All basins normal / above"}
          </div>
          {pdf_url && (
            <a href={pdf_url} target="_blank" rel="noopener noreferrer"
              className="text-[7px] text-slate-600 hover:text-slate-400 transition-colors block mt-0.5">
              PDF source ↗
            </a>
          )}
        </div>
      </div>

      {/* Gauge legend */}
      <div className="flex items-center gap-1 text-[7px] text-slate-600">
        <span className="text-red-400">◀ deficit</span>
        <div className="flex-1 h-px bg-slate-700 relative">
          <div className="absolute inset-y-0 w-px bg-slate-500" style={{ left: "50%" }} />
        </div>
        <span className="text-slate-500">TBNN</span>
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-blue-400">surplus ▶</span>
      </div>

      {/* River cards */}
      {rivers.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rivers.map(rv => <RiverCard key={rv.river} rv={rv} />)}
        </div>
      ) : (
        <div className="text-slate-600 text-xs italic">No river data available.</div>
      )}

      {/* Coffee relevance note */}
      <div className="text-[7px] text-slate-700 italic border-t border-slate-700 pt-2">
        Irrigation critical Jan–Apr dry season. Srepok = Đắk Lắk (main Robusta origin).
        Dak Bla = Gia Lai/Kon Tum. TBNN = multi-year normal.
        Source: {source}
      </div>
    </div>
  );
}
