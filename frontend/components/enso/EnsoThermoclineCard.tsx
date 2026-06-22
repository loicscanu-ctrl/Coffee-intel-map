"use client";
/**
 * Subsurface Thermocline — Phase 3 of the ENSO command-center.
 *
 * Companion to the Phase 2 WWV card (depth-integrated, 4-6 month
 * lead). This one is depth-RESOLVED — temperature anomaly at 150 m
 * across 5 equatorial Pacific buoys. Warm anomalies that propagate
 * eastward at this depth ARE Kelvin waves, which surface as El Niño
 * 4-6 WEEKS later.
 *
 * Visual layout:
 *   • KPI row — latest at 0°N 140°W (headline buoy where Kelvin waves
 *     surface first), with the warm/cold/neutral classification.
 *   • 5-site strip — current anomaly at each anchor longitude, west
 *     to east. Lets the operator SEE the wave propagating.
 *   • Time series — 24 months of headline-buoy anomaly evolution.
 *
 * Data: /data/enso_thermocline.json (NOAA PMEL ERDDAP; weekly
 * Tuesday refresh). Falls back silently when the file is missing —
 * the WWV card + rest of the ENSO tab still render unchanged.
 */
import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip,
} from "recharts";

interface SiteSnapshot {
  longitude_e:     number;
  site_label:      string;
  month:           string | null;
  temp_c:          number | null;
  temp_anomaly_c:  number | null;
  kelvin_signal:   "warm-kelvin-wave" | "cold-kelvin-wave" | "neutral" | "unknown";
}

interface MonthlyPoint { month: string; temp_c: number; temp_anomaly_c: number | null; }

interface ThermoclinePayload {
  scraped_at: string;
  thermocline: {
    source:           string;
    winning_dataset:  string | null;
    depth_m:          number;
    thresholds:       { warm_kelvin: number; cold_kelvin: number };
    lead_weeks:       string;
    headline_buoy: {
      longitude_e: number;
      label:       string;
      latest:      SiteSnapshot["temp_anomaly_c"] extends infer _
                   ? Pick<SiteSnapshot, "month"|"temp_c"|"temp_anomaly_c"|"kelvin_signal">
                   : never;
      monthly:     MonthlyPoint[];
    };
    by_site: SiteSnapshot[];
  };
}

const MONTHS_TO_PLOT = 24;

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

const SIGNAL_META = {
  "warm-kelvin-wave": { color: "#ef4444", label: "WARM KELVIN WAVE" },
  "cold-kelvin-wave": { color: "#3b82f6", label: "COLD KELVIN WAVE" },
  "neutral":          { color: "#94a3b8", label: "NEUTRAL"           },
  "unknown":          { color: "#64748b", label: "—"                 },
} as const;

function monthAbbr(iso: string): string {
  const [yr, mo] = iso.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[parseInt(mo) - 1]}'${yr.slice(2)}`;
}

function signalReading(signal: string, anomaly: number | null): string {
  if (anomaly == null) {
    return "No recent buoy measurement available — TAO/TRITON array may have data gaps at this site.";
  }
  if (signal === "warm-kelvin-wave") {
    return `Warm anomaly of +${anomaly.toFixed(2)} °C at 150 m, central-east Pacific. Surface SST response expected in 4–6 weeks.`;
  }
  if (signal === "cold-kelvin-wave") {
    return `Cold anomaly of ${anomaly.toFixed(2)} °C at 150 m. Surface cooling expected in 4–6 weeks.`;
  }
  return `Thermocline anomaly ${anomaly >= 0 ? "+" : ""}${anomaly.toFixed(2)} °C — below the ±1.0 °C threshold that historically anchors a wave classification.`;
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
  const latest = t.headline_buoy.latest;
  const signal = SIGNAL_META[latest.kelvin_signal] ?? SIGNAL_META.unknown;

  const recent = t.headline_buoy.monthly.slice(-MONTHS_TO_PLOT);
  const chartData = recent.map((r) => ({
    month: r.month,
    label: monthAbbr(r.month),
    anomaly: r.temp_anomaly_c,
  }));

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Subsurface Thermocline · TAO/TRITON {t.depth_m} m
        </div>
        <div className="text-[8px] text-slate-600">
          NOAA PMEL ERDDAP · {t.winning_dataset ?? "—"} · refreshed {data.scraped_at.slice(0, 10)}
        </div>
      </div>

      {/* Headline KPI strip */}
      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">{t.headline_buoy.label} · {t.depth_m} m</div>
          <div className="text-white font-bold flex items-baseline gap-2">
            <span style={{ color: signal.color }}>
              {latest.temp_anomaly_c != null
                ? `${latest.temp_anomaly_c >= 0 ? "+" : ""}${latest.temp_anomaly_c.toFixed(2)} °C`
                : "—"}
            </span>
          </div>
          <div className="text-[9px] text-slate-600">
            anomaly · {latest.month ?? ""}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Lead signal</div>
          <div className="font-bold text-[11px] uppercase tracking-wider" style={{ color: signal.color }}>
            {signal.label}
          </div>
          <div className="text-[9px] text-slate-600">
            {t.lead_weeks}-week surface lead
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Reading</div>
          <div className="text-white text-[11px] leading-tight">
            {signalReading(latest.kelvin_signal, latest.temp_anomaly_c)}
          </div>
        </div>
      </div>

      {/* 5-site west-to-east strip — see the wave propagate */}
      <div className="grid grid-cols-5 gap-1 text-[10px] font-mono">
        {t.by_site.map((s) => {
          const sig = SIGNAL_META[s.kelvin_signal] ?? SIGNAL_META.unknown;
          const anom = s.temp_anomaly_c;
          return (
            <div key={s.longitude_e} className="bg-slate-900 rounded px-2 py-1.5 border border-slate-700">
              <div className="text-slate-500 text-[8px]">{s.site_label}</div>
              <div className="font-bold text-[12px]" style={{ color: sig.color }}>
                {anom != null
                  ? `${anom >= 0 ? "+" : ""}${anom.toFixed(2)}`
                  : "—"}
              </div>
              <div className="text-slate-600 text-[8px]">°C anom</div>
            </div>
          );
        })}
      </div>

      {/* Headline-buoy time series */}
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="thermoPos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="thermoNeg" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label" tick={{ fontSize: 7, fill: "#64748b" }}
              axisLine={false} tickLine={false}
              interval={Math.floor(MONTHS_TO_PLOT / 6)}
            />
            <YAxis
              tick={{ fontSize: 7, fill: "#64748b" }}
              axisLine={false} tickLine={false}
              tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}°`}
              domain={[-3, 3]}
            />
            <ReferenceLine y={0}                                stroke="#475569" strokeDasharray="3 3" />
            <ReferenceLine y={t.thresholds.warm_kelvin}         stroke="#7f1d1d" strokeDasharray="1 4" />
            <ReferenceLine y={t.thresholds.cold_kelvin}         stroke="#1e3a8a" strokeDasharray="1 4" />
            <Tooltip
              contentStyle={TT_STYLE}
              labelFormatter={(_label, payload) => {
                const p = (payload?.[0]?.payload ?? null) as { month?: string } | null;
                return p?.month ?? "";
              }}
              formatter={(v: unknown) => [
                v != null
                  ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)} °C`
                  : "—",
                "T anomaly @ 150m",
              ]}
            />
            <Area
              type="monotone" dataKey="anomaly"
              stroke={signal.color} strokeWidth={1.5}
              fill={latest.temp_anomaly_c != null && latest.temp_anomaly_c >= 0
                ? "url(#thermoPos)"
                : "url(#thermoNeg)"}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[9px] text-slate-600 leading-snug">
        Subsurface T at 150 m at 0°N 140°W (and four neighbouring longitudes). Anomaly is current T minus
        the trailing-12-month mean at the same buoy. Warm anomalies that propagate eastward at this depth
        are downwelling Kelvin waves — they surface as El Niño 4–6 weeks later. The Phase 2 WWV card above
        shows the depth-integrated reservoir (4–6 month lead); this card shows the specific slugs of heat
        breaching it now. Source: NOAA PMEL TAO/TRITON via ERDDAP.
      </div>
    </div>
  );
}
