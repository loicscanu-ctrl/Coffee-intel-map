"use client";
/**
 * Brazil Weather Analogs — past years ranked by similarity to the current
 * crop-cycle weather signature (rain + temp per phenology stage), each
 * annotated with what happened to the actual crop after that weather pattern.
 *
 * Two forecast lenses:
 *   • Same-cycle: the harvest produced BY the analog's weather. Direct
 *     read for the in-progress crop ("if 2026 weather looks like 2005's,
 *     expect 2026 to be like 2005's harvest").
 *   • Lag-1:     the crop AFTER the analog (captures arabica's biennial
 *     pattern — what the user's "1999 weather → 2000 crop" example points to).
 *
 * Data source: /data/weather_analogs_brazil.json, rebuilt by
 * backend/scripts/compute_weather_analogs.py on each daily weather run.
 */
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";

interface Stage {
  name: string;
  rain_mm?: number | null;
  temp_c?: number | null;
}

interface Ensemble {
  mean_pct: number;
  median_pct: number;
  stdev_pct: number;
  min_pct: number;
  max_pct: number;
  n: number;
}

interface Analog {
  year: number;
  distance: number;
  features_compared: number;
  same_cycle_crop_year: number;
  same_cycle_production_kbags: number | null;
  same_cycle_yoy_pct: number | null;
  next_crop_year: number;
  next_crop_production_kbags: number | null;
  next_crop_yoy_pct: number | null;
  stages: Stage[];
}

interface HistoricalSig {
  year: number;
  stages: Stage[];
  production_kbags: number | null;
}

interface AnalogDoc {
  current_crop_year: number;
  phenology: { name: string; months: number[] }[];
  current_year_signature: Stage[];
  top_analogs: Analog[];
  ensemble_same_cycle: Ensemble | null;
  ensemble_lag_one: Ensemble | null;
  historical_signatures: HistoricalSig[];
  generated_at: string;
}

const STAGE_LABEL: Record<string, string> = {
  pre_flowering: "Pre-flowering (Aug-Sep)",
  flowering:     "Flowering (Oct-Nov)",
  fruit_fill:    "Fruit fill (Dec-Feb)",
  maturation:    "Maturation (Mar-May)",
};

const ANALOG_COLOR = ["#f59e0b", "#a855f7", "#14b8a6", "#ec4899", "#22d3ee"];
const TT = { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function _pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function _pctColor(v: number | null | undefined): string {
  if (v == null) return "text-slate-500";
  if (v >= 5)    return "text-emerald-400";
  if (v >= -5)   return "text-slate-300";
  return "text-rose-400";
}

function EnsembleCard({ title, ensemble, sub }: {
  title: string;
  ensemble: Ensemble | null;
  sub: string;
}) {
  if (!ensemble) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
        <div className="text-[9px] text-slate-500 uppercase tracking-wider">{title}</div>
        <div className="text-xs text-slate-600 italic mt-1">No analog production data.</div>
      </div>
    );
  }
  const conviction = ensemble.stdev_pct < 10 ? "high"
    : ensemble.stdev_pct < 20 ? "moderate"
    : "low";
  const convictionCls = conviction === "high"
    ? "text-emerald-400" : conviction === "moderate"
    ? "text-amber-400" : "text-rose-400";
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{title}</div>
      <div className="text-[8.5px] text-slate-600 mt-0.5">{sub}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className={`text-2xl font-mono font-bold ${_pctColor(ensemble.mean_pct)}`}>
          {_pct(ensemble.mean_pct)}
        </span>
        <span className="text-[10px] text-slate-500">mean (n={ensemble.n})</span>
      </div>
      <div className="text-[10px] text-slate-400 mt-1 font-mono">
        median {_pct(ensemble.median_pct)} · spread {ensemble.stdev_pct.toFixed(1)}σ
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
        range [{_pct(ensemble.min_pct)}, {_pct(ensemble.max_pct)}]
      </div>
      <div className={`text-[9px] uppercase tracking-wide mt-1.5 ${convictionCls}`}>
        {conviction} conviction
      </div>
    </div>
  );
}

function StageRainChart({ doc }: { doc: AnalogDoc }) {
  // For each phenology stage, show the prod-weighted rain total of the
  // current year + top-5 analog years. The "10Y avg" reference line is the
  // population mean (the .feature_means dict isn't exposed in the analog
  // object directly, so we re-derive from historical_signatures here).
  const stages = doc.current_year_signature.map((s) => s.name);
  const histAvg: Record<string, number> = {};
  for (const stageName of stages) {
    const vals = doc.historical_signatures
      .map((h) => h.stages.find((st) => st.name === stageName)?.rain_mm)
      .filter((v): v is number => typeof v === "number");
    histAvg[stageName] = vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : 0;
  }
  const data = stages.map((stageName) => {
    const cur = doc.current_year_signature.find((s) => s.name === stageName);
    const row: Record<string, string | number | null> = {
      stage: STAGE_LABEL[stageName] ?? stageName,
      current: cur?.rain_mm ?? null,
      avg: histAvg[stageName] ?? 0,
    };
    doc.top_analogs.forEach((a, i) => {
      const v = a.stages.find((s) => s.name === stageName)?.rain_mm ?? null;
      row[`a${i}`] = v;
    });
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
        Stage Rainfall — current crop {doc.current_crop_year} vs top-{doc.top_analogs.length} analogs (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Prod-weighted rain total per phenology stage · grey bar = 30Y avg of historical population
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="stage" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT}
            formatter={(v: unknown) => (v == null ? "—" : `${Math.round(Number(v))} mm`)} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          <Bar dataKey="avg" name="historical avg" fill="#334155" radius={[2, 2, 0, 0]} />
          {doc.top_analogs.map((a, i) => (
            <Line
              key={a.year}
              type="monotone"
              dataKey={`a${i}`}
              name={`${a.year}`}
              stroke={ANALOG_COLOR[i % ANALOG_COLOR.length]}
              strokeWidth={1.5}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
          <Line
            type="monotone"
            dataKey="current"
            name={`${doc.current_crop_year} (current)`}
            stroke="#38bdf8"
            strokeWidth={3}
            dot={{ r: 4 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function AnalogTable({ analogs }: { analogs: Analog[] }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold px-3 py-2 border-b border-slate-700">
        Top-{analogs.length} Weather Analogs · with their crop outcomes
      </div>
      <table className="w-full text-[10.5px]">
        <thead className="text-[9px] text-slate-500 uppercase">
          <tr className="border-b border-slate-800">
            <th className="text-left  px-3 py-1.5">Rank</th>
            <th className="text-left  px-3 py-1.5">Year</th>
            <th className="text-right px-3 py-1.5">Distance</th>
            <th className="text-right px-3 py-1.5">Same-cycle crop</th>
            <th className="text-right px-3 py-1.5">y/y</th>
            <th className="text-right px-3 py-1.5">Next crop</th>
            <th className="text-right px-3 py-1.5">y/y</th>
          </tr>
        </thead>
        <tbody>
          {analogs.map((a, i) => (
            <tr key={a.year} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/40">
              <td className="px-3 py-1.5 font-mono">
                <span style={{ color: ANALOG_COLOR[i % ANALOG_COLOR.length] }}>●</span> #{i + 1}
              </td>
              <td className="px-3 py-1.5 text-slate-200 font-mono font-semibold">{a.year}</td>
              <td className="px-3 py-1.5 text-right text-slate-500 font-mono">{a.distance.toFixed(3)}</td>
              <td className="px-3 py-1.5 text-right text-slate-300 font-mono">
                {a.same_cycle_production_kbags != null ? `${(a.same_cycle_production_kbags/1000).toFixed(1)}M bags` : "—"}
                <span className="text-slate-600 ml-1">({a.same_cycle_crop_year})</span>
              </td>
              <td className={`px-3 py-1.5 text-right font-mono ${_pctColor(a.same_cycle_yoy_pct)}`}>
                {_pct(a.same_cycle_yoy_pct)}
              </td>
              <td className="px-3 py-1.5 text-right text-slate-300 font-mono">
                {a.next_crop_production_kbags != null ? `${(a.next_crop_production_kbags/1000).toFixed(1)}M bags` : "—"}
                <span className="text-slate-600 ml-1">({a.next_crop_year})</span>
              </td>
              <td className={`px-3 py-1.5 text-right font-mono ${_pctColor(a.next_crop_yoy_pct)}`}>
                {_pct(a.next_crop_yoy_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CurrentSignature({ doc }: { doc: AnalogDoc }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-2">
        Current cycle ({doc.current_crop_year}) — stage-by-stage signature
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {doc.current_year_signature.map((s) => (
          <div key={s.name} className="bg-slate-950/50 rounded border border-slate-800 p-2">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">
              {STAGE_LABEL[s.name] ?? s.name}
            </div>
            <div className="flex items-baseline gap-3 mt-1">
              <div>
                <div className="text-[9px] text-slate-600">rain</div>
                <div className="text-sm font-mono text-sky-400">
                  {s.rain_mm != null ? `${Math.round(s.rain_mm)} mm` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-slate-600">temp</div>
                <div className="text-sm font-mono text-amber-400">
                  {s.temp_c != null ? `${s.temp_c.toFixed(1)}°C` : "—"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BrazilWeatherAnalogs() {
  const [doc, setDoc] = useState<AnalogDoc | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/weather_analogs_brazil.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setDoc)
      .catch(() => setError(true));
  }, []);

  if (error) return (
    <div className="text-xs text-slate-500 italic py-6">
      Weather analog forecast unavailable — backend script (compute_weather_analogs.py)
      hasn&apos;t run yet.
    </div>
  );
  if (!doc) return (
    <div className="text-xs text-slate-500 animate-pulse py-6">Computing weather analogs…</div>
  );

  return (
    <div className="space-y-3">
      {/* Header + methodology hint */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Weather analogs — Brazil arabica
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Past years ranked by Euclidean distance on z-scored (rain, temp) per phenology stage.
            Each analog&apos;s actual crop outcome reveals what historically followed similar weather.
          </p>
        </div>
        <div className="text-[9px] text-slate-600 font-mono">
          generated {doc.generated_at.slice(0, 10)}
        </div>
      </div>

      {/* Two ensemble cards side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <EnsembleCard
          title={`Same-cycle forecast · ${doc.current_crop_year} crop`}
          ensemble={doc.ensemble_same_cycle}
          sub="Direct: if this year's weather is like the analog's, expect this year's crop to look like the analog's actual production."
        />
        <EnsembleCard
          title={`Lag-1 forecast · ${doc.current_crop_year + 1} crop`}
          ensemble={doc.ensemble_lag_one}
          sub="Biennial: arabica's on/off cycle means a strong year often drains the next. Mean of analogs' next-year y/y."
        />
      </div>

      {/* Current cycle's stage-by-stage values */}
      <CurrentSignature doc={doc} />

      {/* Stage rain comparison chart */}
      <StageRainChart doc={doc} />

      {/* Ranked analog table */}
      <AnalogTable analogs={doc.top_analogs} />

      <div className="text-[9px] text-slate-600 italic px-1">
        Production figures are approximate USDA PSD historical seed (see backend/seed/brazil_arabica_production.py).
        Replace with CONAB safra series when plumbed in for production-grade accuracy.
      </div>
    </div>
  );
}
