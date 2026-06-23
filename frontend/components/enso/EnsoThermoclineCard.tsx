"use client";
/**
 * Subsurface Thermocline — Phase 3 v3 (NDBC pivot).
 *
 * Depth-resolved companion to the Phase 2 WWV card. Pulls the latest
 * subsurface temperature at ~150 m from 7 NDBC TAO/TRITON buoys
 * anchored inside the Niño 3.4 box (5°N-5°S, 170°W-120°W). The
 * Kelvin-wave signal is a |Δ| ≥ 1.0 °C 30-day delta — recent week's
 * mean minus the 30-37-day-ago week's mean at the same buoy.
 *
 * Visual layout:
 *   • Headline KPI strip — latest at 0°N 155°W (dead center of the
 *     Niño 3.4 box), with the 30-day delta + Kelvin classification.
 *   • West-to-east 3-column strip — mean 7-day T per longitude
 *     column (170°W, 155°W, 140°W). Lets the operator SEE the wave
 *     migrating east across the basin.
 *   • 7-buoy grid — per-station snapshot with lat/lon coords so
 *     the eye can correlate with the ENSO risk map below.
 *
 * Data: /data/enso_thermocline.json (NDBC; daily refresh, 07:00 UTC).
 * Falls back silently when missing — WWV card + rest of tab still render.
 */
import { useEffect, useState } from "react";

interface BuoySlot {
  station_id:        string;
  label:             string;
  lat:               number;
  lon:               number;
  column:            string;          // "170W" | "155W" | "140W"
  obs_count:         number;
  latest_temp_c:     number | null;
  latest_depth_m:    number | null;
  latest_ts:         string | null;
  recent_7d_mean_c:  number | null;
  baseline_30d_mean_c: number | null;
  delta_30d_c:       number | null;
  kelvin_signal:     "warm-kelvin-wave" | "cold-kelvin-wave" | "neutral" | "no-data";
}

interface ColumnAvg { mean_temp_c: number | null; n_buoys: number; }

interface ThermoclinePayload {
  scraped_at: string;
  thermocline: {
    source:          string;
    depth_m:         number;
    thresholds:      { warm_kelvin: number; cold_kelvin: number };
    lead_weeks:      string;
    headline: {
      station_id:     string;
      label:          string;
      lat:            number;
      lon:            number;
      latest_temp_c:  number | null;
      latest_depth_m: number | null;
      latest_ts:      string | null;
      delta_30d_c:    number | null;
      kelvin_signal:  BuoySlot["kelvin_signal"];
      reading:        string;
    } | null;
    buoys:           BuoySlot[];
    by_longitude:    Record<string, ColumnAvg>;
  };
}

const SIGNAL_META = {
  "warm-kelvin-wave": { color: "#ef4444", label: "WARM KELVIN WAVE" },
  "cold-kelvin-wave": { color: "#3b82f6", label: "COLD KELVIN WAVE" },
  "neutral":          { color: "#94a3b8", label: "NEUTRAL"           },
  "no-data":          { color: "#64748b", label: "NO DATA"           },
} as const;

const COLUMN_ORDER = ["170W", "155W", "140W"] as const;
const COLUMN_LABEL: Record<string, string> = {
  "170W": "170°W",
  "155W": "155°W",
  "140W": "140°W",
};

function tsAge(ts: string | null): string {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function EnsoThermoclineCard() {
  const [data, setData] = useState<ThermoclinePayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/data/enso_thermocline.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setMissing(true));
  }, []);

  if (missing) return null;
  if (!data) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 text-xs text-slate-500 animate-pulse">
        Loading subsurface thermocline…
      </div>
    );
  }

  const { thermocline: t } = data;
  const headline = t.headline;
  const signal = headline
    ? SIGNAL_META[headline.kelvin_signal] ?? SIGNAL_META["no-data"]
    : SIGNAL_META["no-data"];

  // Buoys grouped by longitude column for the 7-station grid below.
  const buoysByColumn: Record<string, BuoySlot[]> = {};
  for (const b of t.buoys) {
    (buoysByColumn[b.column] = buoysByColumn[b.column] ?? []).push(b);
  }
  // Within each column, sort north-to-south for a stable visual layout.
  for (const col of Object.keys(buoysByColumn)) {
    buoysByColumn[col].sort((a, b) => b.lat - a.lat);
  }

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Subsurface Thermocline · TAO/TRITON ~{t.depth_m} m (NDBC)
        </div>
        <div className="text-[8px] text-slate-600">
          {t.buoys.filter((b) => b.latest_temp_c != null).length}/{t.buoys.length} buoys reporting · refreshed {data.scraped_at.slice(0, 10)}
        </div>
      </div>

      {/* Headline KPI strip — dead-center buoy at 0°N 155°W */}
      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">
            {headline?.label ?? "0°N 155°W"} · headline
          </div>
          <div className="text-white font-bold flex items-baseline gap-2">
            <span style={{ color: signal.color }}>
              {headline?.latest_temp_c != null
                ? `${headline.latest_temp_c.toFixed(2)} °C`
                : "—"}
            </span>
            {headline?.latest_depth_m != null && (
              <span className="text-[9px] text-slate-600">@ {headline.latest_depth_m.toFixed(0)} m</span>
            )}
          </div>
          <div className="text-[9px] text-slate-600">
            {tsAge(headline?.latest_ts ?? null)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">30-day Δ · Kelvin signal</div>
          <div className="text-white font-bold" style={{ color: signal.color }}>
            {headline?.delta_30d_c != null
              ? `${headline.delta_30d_c >= 0 ? "+" : ""}${headline.delta_30d_c.toFixed(2)} °C`
              : "—"}
          </div>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: signal.color }}>
            {signal.label}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Reading · {t.lead_weeks}-week lead</div>
          <div className="text-white text-[11px] leading-tight">
            {headline?.reading ?? "Headline buoy offline — see grid below for station-level coverage."}
          </div>
        </div>
      </div>

      {/* West-to-east 3-column mean strip — basin-scale propagation */}
      <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
        {COLUMN_ORDER.map((col) => {
          const c = t.by_longitude[col];
          return (
            <div key={col} className="bg-slate-900 rounded px-2 py-1.5 border border-slate-700">
              <div className="text-slate-500 text-[8px]">{COLUMN_LABEL[col]} · {c?.n_buoys ?? 0} buoys</div>
              <div className="font-bold text-[13px] text-slate-200">
                {c?.mean_temp_c != null
                  ? `${c.mean_temp_c.toFixed(1)} °C`
                  : "—"}
              </div>
              <div className="text-slate-600 text-[8px]">7-day mean</div>
            </div>
          );
        })}
      </div>

      {/* 7-station grid — per-buoy snapshot with lat/lon for map correlation */}
      <div className="space-y-1">
        {COLUMN_ORDER.map((col) => {
          const rows = buoysByColumn[col] ?? [];
          if (!rows.length) return null;
          return (
            <div key={col} className="grid grid-cols-[60px_repeat(3,1fr)] gap-1 text-[10px] font-mono">
              <div className="bg-slate-900 rounded px-1.5 py-1 border border-slate-700 text-slate-400 self-stretch flex items-center justify-center font-bold">
                {COLUMN_LABEL[col]}
              </div>
              {/* Always render 3 cells per row, padding with placeholders if a
                  longitude column has fewer than 3 buoys. */}
              {[0, 1, 2].map((i) => {
                const b = rows[i];
                if (!b) {
                  return <div key={i} className="bg-slate-900/40 rounded border border-slate-700/40" />;
                }
                const sig = SIGNAL_META[b.kelvin_signal] ?? SIGNAL_META["no-data"];
                return (
                  <div key={b.station_id} className="bg-slate-900 rounded px-2 py-1.5 border border-slate-700">
                    <div className="flex items-baseline justify-between">
                      <div className="text-slate-500 text-[8px]">{b.label.replace(` ${COLUMN_LABEL[col]}`, "")} · {b.station_id}</div>
                      <div className="text-[8px]" style={{ color: sig.color }}>●</div>
                    </div>
                    <div className="font-bold text-[12px]" style={{ color: sig.color }}>
                      {b.latest_temp_c != null ? `${b.latest_temp_c.toFixed(2)}` : "—"}
                    </div>
                    <div className="text-slate-600 text-[8px]">
                      Δ30d {b.delta_30d_c != null
                        ? `${b.delta_30d_c >= 0 ? "+" : ""}${b.delta_30d_c.toFixed(2)}`
                        : "—"} · {b.obs_count} obs
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="text-[9px] text-slate-600 leading-snug">
        Subsurface T at ~{t.depth_m} m at 7 TAO/TRITON buoys anchored inside the Niño 3.4 box
        (5°N-5°S, 170°W-120°W). Kelvin signal = mean of last 7 days minus mean of 30-37 days ago at the
        same station and depth — |Δ| ≥ {t.thresholds.warm_kelvin} °C qualifies as a downwelling
        (warm) or upwelling (cold) Kelvin wave. Surface SST response expected ~{t.lead_weeks} weeks
        later. The Phase 2 WWV card above shows the depth-integrated reservoir (4–6 month lead);
        this card shows the specific slugs of heat breaching the thermocline now. Source: NOAA NDBC
        realtime2 .ocean feeds — each buoy's lat/lon also pinned on the ENSO risk map below.
      </div>
    </div>
  );
}
