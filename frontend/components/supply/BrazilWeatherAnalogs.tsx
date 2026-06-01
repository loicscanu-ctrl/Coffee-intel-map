"use client";
/**
 * Brazil Weather Analogs — hedge-fund-grade analog-year forecast.
 *
 * Reads /data/weather_analogs_brazil.json (rebuilt nightly by
 * backend/scripts/compute_weather_analogs.py). Surfaces:
 *
 *   • Backtest skill card (RMSE + hit-rate vs naive baselines) — the
 *     "can we trust this?" answer comes first
 *   • Twin ensemble cards (same-cycle / lag-1) with 95% bootstrap CI
 *   • Current cycle's per-stage signature (rain, temp, ONI)
 *   • Stage rain chart: current year + top-5 analogs + 10Y avg
 *   • Ranked analog table with both raw and DETRENDED y/y
 *
 * Forecast lenses:
 *   • Same-cycle = analog year's own crop outcome (direct read)
 *   • Lag-1      = the crop after the analog (biennial lookahead)
 *
 * Numbers use DETRENDED y/y by default (secular yield growth stripped via
 * log-linear regression), with raw y/y in muted text below.
 */
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, BarChart,
} from "recharts";

interface Stage {
  name: string;
  rain_mm?: number | null;
  temp_c?: number | null;
  oni_avg?: number | null;
}

interface Ensemble {
  mean_pct: number;
  median_pct: number;
  stdev_pct: number;
  min_pct: number;
  max_pct: number;
  n: number;
  ci95_lo?: number | null;
  ci95_hi?: number | null;
}

interface Analog {
  year: number;
  distance: number;
  features_compared: number;
  same_cycle_crop_year: number;
  same_cycle_production_kbags: number | null;
  same_cycle_yoy_pct: number | null;
  same_cycle_yoy_detrended_pct: number | null;
  next_crop_year: number;
  next_crop_production_kbags: number | null;
  next_crop_yoy_pct: number | null;
  next_crop_yoy_detrended_pct: number | null;
  stages: Stage[];
}

interface BacktestYear { year: number; pred_pct: number; actual_pct: number; }
interface Backtest {
  n_years: number;
  first_year: number;
  last_year: number;
  rmse_model: number;
  rmse_naive_zero: number;
  rmse_naive_persist: number | null;
  hit_rate_model: number;
  hit_rate_persist: number | null;
  skill_vs_zero_pct: number | null;
  skill_vs_persist_pct: number | null;
  per_year_predictions: BacktestYear[];
}

interface HistoricalSig {
  year: number;
  stages: Stage[];
  production_kbags: number | null;
  detrended_residual: number;
}

interface AnalogDoc {
  current_crop_year: number;
  phenology: { name: string; months: number[] }[];
  stage_normals_10y: Record<string, { rain_mean: number | null; temp_mean: number | null }>;
  current_year_signature: Stage[];
  top_analogs: Analog[];
  ensemble_same_cycle: Ensemble | null;
  ensemble_lag_one: Ensemble | null;
  backtest: Backtest | null;
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

function _pct(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function _pctColor(v: number | null | undefined): string {
  if (v == null) return "text-slate-500";
  if (v >= 5)    return "text-emerald-400";
  if (v >= -5)   return "text-slate-300";
  return "text-rose-400";
}

function _oniBadge(v: number | null | undefined): { tag: string; cls: string } {
  if (v == null) return { tag: "—", cls: "text-slate-600" };
  if (v >= 0.5)  return { tag: "El Niño",  cls: "text-rose-400" };
  if (v <= -0.5) return { tag: "La Niña",  cls: "text-sky-400" };
  return { tag: "Neutral", cls: "text-slate-400" };
}

function BacktestCard({ bt }: { bt: Backtest | null }) {
  if (!bt) return null;
  const beatsZero    = bt.skill_vs_zero_pct    != null && bt.skill_vs_zero_pct    > 0;
  const beatsPersist = bt.skill_vs_persist_pct != null && bt.skill_vs_persist_pct > 0;
  const hitPct = (bt.hit_rate_model * 100).toFixed(0);
  const hitColor = bt.hit_rate_model >= 0.6 ? "text-emerald-400"
    : bt.hit_rate_model >= 0.5 ? "text-amber-400"
    : "text-rose-400";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">Model skill · walk-forward backtest</div>
          <div className="text-[8.5px] text-slate-600">
            Out-of-sample, {bt.n_years} years ({bt.first_year}-{bt.last_year}) · re-fit on prior years only
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10.5px]">
        <div>
          <div className="text-[9px] text-slate-500 uppercase">Directional hit rate</div>
          <div className={`text-xl font-mono font-bold ${hitColor}`}>{hitPct}%</div>
          <div className="text-[9px] text-slate-600">
            persistence: {bt.hit_rate_persist != null ? `${(bt.hit_rate_persist*100).toFixed(0)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500 uppercase">Model RMSE</div>
          <div className="text-xl font-mono text-slate-300">{bt.rmse_model.toFixed(1)}</div>
          <div className="text-[9px] text-slate-600">vs naive: zero={bt.rmse_naive_zero.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500 uppercase">Skill vs zero-naive</div>
          <div className={`text-xl font-mono ${beatsZero ? "text-emerald-400" : "text-rose-400"}`}>
            {bt.skill_vs_zero_pct != null ? _pct(bt.skill_vs_zero_pct, 1) : "—"}
          </div>
          <div className="text-[9px] text-slate-600">{beatsZero ? "model adds info" : "weather signal weak this domain"}</div>
        </div>
        <div>
          <div className="text-[9px] text-slate-500 uppercase">Skill vs persistence</div>
          <div className={`text-xl font-mono ${beatsPersist ? "text-emerald-400" : "text-rose-400"}`}>
            {bt.skill_vs_persist_pct != null ? _pct(bt.skill_vs_persist_pct, 1) : "—"}
          </div>
          <div className="text-[9px] text-slate-600">{beatsPersist ? "beats autoregressive" : "AR baseline tighter"}</div>
        </div>
      </div>

      {/* Per-year prediction vs actual scatter / bars */}
      <div className="mt-3">
        <div className="text-[9px] text-slate-500 uppercase mb-1">Per-year forecast vs actual (detrended y/y, %)</div>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={bt.per_year_predictions} margin={{ top: 0, right: 5, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="year" tick={{ fill: "#64748b", fontSize: 8 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#64748b", fontSize: 8 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TT}
              formatter={(v: unknown, n: unknown) => [_pct(Number(v), 1), String(n) === "pred_pct" ? "pred" : "actual"]} />
            <Legend wrapperStyle={{ fontSize: 8 }} />
            <Bar dataKey="pred_pct"   name="model pred"  fill="#38bdf8" opacity={0.85} />
            <Bar dataKey="actual_pct" name="actual"      fill="#475569" opacity={0.85} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function EnsembleCard({ title, ensemble, sub }: { title: string; ensemble: Ensemble | null; sub: string }) {
  if (!ensemble) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
        <div className="text-[9px] text-slate-500 uppercase tracking-wider">{title}</div>
        <div className="text-xs text-slate-600 italic mt-1">No analog production data.</div>
      </div>
    );
  }
  // Confidence comes from CI width — narrower band = higher conviction.
  const ciWidth = (ensemble.ci95_hi != null && ensemble.ci95_lo != null)
    ? ensemble.ci95_hi - ensemble.ci95_lo : ensemble.stdev_pct * 4;
  const conviction = ciWidth < 25 ? "high" : ciWidth < 50 ? "moderate" : "low";
  const convictionCls = conviction === "high" ? "text-emerald-400"
    : conviction === "moderate" ? "text-amber-400" : "text-rose-400";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[9px] text-slate-500 uppercase tracking-wider">{title}</div>
      <div className="text-[8.5px] text-slate-600 mt-0.5">{sub}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className={`text-2xl font-mono font-bold ${_pctColor(ensemble.mean_pct)}`}>
          {_pct(ensemble.mean_pct)}
        </span>
        <span className="text-[10px] text-slate-500">detrended y/y (n={ensemble.n})</span>
      </div>
      {ensemble.ci95_lo != null && ensemble.ci95_hi != null && (
        <div className="text-[10px] text-slate-400 mt-1 font-mono">
          95% CI [{_pct(ensemble.ci95_lo)}, {_pct(ensemble.ci95_hi)}]
        </div>
      )}
      <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
        median {_pct(ensemble.median_pct)} · range [{_pct(ensemble.min_pct)}, {_pct(ensemble.max_pct)}]
      </div>
      <div className={`text-[9px] uppercase tracking-wide mt-1.5 ${convictionCls}`}>
        {conviction} conviction · CI width {ciWidth.toFixed(0)}σ
      </div>
    </div>
  );
}

function CurrentSignature({ doc }: { doc: AnalogDoc }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-2">
        Current cycle ({doc.current_crop_year}) — phenology signature
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {doc.current_year_signature.map((s) => {
          const norm = doc.stage_normals_10y[s.name];
          const rainAnomPct = s.rain_mm != null && norm?.rain_mean
            ? ((s.rain_mm - norm.rain_mean) / norm.rain_mean * 100) : null;
          const oniBadge = _oniBadge(s.oni_avg);
          return (
            <div key={s.name} className="bg-slate-950/50 rounded border border-slate-800 p-2 space-y-1">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider">
                {STAGE_LABEL[s.name] ?? s.name}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] text-slate-600">rain</span>
                <span className="text-[11px] font-mono text-sky-400">
                  {s.rain_mm != null ? `${Math.round(s.rain_mm)} mm` : "—"}
                </span>
              </div>
              {rainAnomPct != null && (
                <div className="text-[8px] text-right font-mono">
                  <span className={_pctColor(rainAnomPct)}>{_pct(rainAnomPct, 0)} vs 10Y avg</span>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-[9px] text-slate-600">temp</span>
                <span className="text-[11px] font-mono text-amber-400">
                  {s.temp_c != null ? `${s.temp_c.toFixed(1)}°C` : "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between border-t border-slate-800 pt-1 mt-1">
                <span className="text-[9px] text-slate-600">ONI</span>
                <span className={`text-[11px] font-mono ${oniBadge.cls}`}>
                  {s.oni_avg != null ? s.oni_avg.toFixed(2) : "—"}
                  <span className="text-[8px] ml-1">{oniBadge.tag}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageRainChart({ doc }: { doc: AnalogDoc }) {
  const stages = doc.current_year_signature.map((s) => s.name);
  const data = stages.map((stageName) => {
    const cur = doc.current_year_signature.find((s) => s.name === stageName);
    const norm = doc.stage_normals_10y[stageName];
    const row: Record<string, string | number | null> = {
      stage: STAGE_LABEL[stageName] ?? stageName,
      current: cur?.rain_mm ?? null,
      avg: norm?.rain_mean ?? 0,
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
        Stage Rainfall — current {doc.current_crop_year} vs top-{doc.top_analogs.length} analogs (mm)
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        Prod-weighted rain total per phenology stage · grey bar = 10Y avg of historical population
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="stage" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT}
            formatter={(v: unknown) => (v == null ? "—" : `${Math.round(Number(v))} mm`)} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          <Bar dataKey="avg" name="10Y avg" fill="#334155" radius={[2, 2, 0, 0]} />
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

function StageOniChart({ doc }: { doc: AnalogDoc }) {
  const stages = doc.current_year_signature.map((s) => s.name);
  const data = stages.map((stageName) => {
    const cur = doc.current_year_signature.find((s) => s.name === stageName);
    const row: Record<string, string | number | null> = {
      stage: STAGE_LABEL[stageName] ?? stageName,
      current: cur?.oni_avg ?? null,
    };
    doc.top_analogs.forEach((a, i) => {
      const v = a.stages.find((s) => s.name === stageName)?.oni_avg ?? null;
      row[`a${i}`] = v;
    });
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
        Stage ENSO state (ONI) — current vs analogs
      </div>
      <div className="text-[8px] text-slate-600 mb-1">
        NOAA CPC 3-mo Niño-3.4 SST anomaly · &gt;+0.5 = El Niño · &lt;-0.5 = La Niña · ±0.5 = neutral
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="stage" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} />
          <Tooltip contentStyle={TT}
            formatter={(v: unknown) => (v == null ? "—" : Number(v).toFixed(2))} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
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
        Top-{analogs.length} Weather Analogs · with crop outcomes (detrended)
      </div>
      <table className="w-full text-[10.5px]">
        <thead className="text-[9px] text-slate-500 uppercase">
          <tr className="border-b border-slate-800">
            <th className="text-left  px-3 py-1.5">Rank</th>
            <th className="text-left  px-3 py-1.5">Year</th>
            <th className="text-right px-3 py-1.5">Mahal. dist</th>
            <th className="text-right px-3 py-1.5">Same-cycle crop</th>
            <th className="text-right px-3 py-1.5">y/y detr.</th>
            <th className="text-right px-3 py-1.5">Next crop</th>
            <th className="text-right px-3 py-1.5">y/y detr.</th>
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
              <td className={`px-3 py-1.5 text-right font-mono ${_pctColor(a.same_cycle_yoy_detrended_pct)}`}>
                {_pct(a.same_cycle_yoy_detrended_pct)}
                <div className="text-[8px] text-slate-600">raw {_pct(a.same_cycle_yoy_pct)}</div>
              </td>
              <td className="px-3 py-1.5 text-right text-slate-300 font-mono">
                {a.next_crop_production_kbags != null ? `${(a.next_crop_production_kbags/1000).toFixed(1)}M bags` : "—"}
                <span className="text-slate-600 ml-1">({a.next_crop_year})</span>
              </td>
              <td className={`px-3 py-1.5 text-right font-mono ${_pctColor(a.next_crop_yoy_detrended_pct)}`}>
                {_pct(a.next_crop_yoy_detrended_pct)}
                <div className="text-[8px] text-slate-600">raw {_pct(a.next_crop_yoy_pct)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      {/* Header + methodology */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Weather analogs — Brazil arabica · 20-dim Mahalanobis
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5 max-w-2xl">
            5 features per phenology stage (rain, temp, anomalies, ENSO ONI) × 4 stages.
            Distance: Mahalanobis on z-scored historical population. y/y figures are
            DETRENDED (log-linear trend removed) so 1999 and 2024 yields are
            apples-to-apples. 95% CIs are 1000-resample bootstrap on the analog set.
          </p>
        </div>
        <div className="text-[9px] text-slate-600 font-mono">
          generated {doc.generated_at.slice(0, 10)}
        </div>
      </div>

      {/* Backtest first — "can we trust this?" */}
      <BacktestCard bt={doc.backtest} />

      {/* Two ensemble cards side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <EnsembleCard
          title={`Same-cycle forecast · ${doc.current_crop_year} crop`}
          ensemble={doc.ensemble_same_cycle}
          sub="Direct: this year's crop likely tracks what the analogs' own crops actually did. Ensemble mean of detrended y/y change."
        />
        <EnsembleCard
          title={`Lag-1 forecast · ${doc.current_crop_year + 1} crop`}
          ensemble={doc.ensemble_lag_one}
          sub="Biennial: what happened the year AFTER each analog. Useful when this year's crop is largely set and you're sizing next year."
        />
      </div>

      <CurrentSignature doc={doc} />
      <StageRainChart doc={doc} />
      <StageOniChart doc={doc} />
      <AnalogTable analogs={doc.top_analogs} />

      <div className="text-[9px] text-slate-600 italic px-1 leading-relaxed">
        Production seed: USDA PSD historical, rounded to 100k bags (see
        backend/seed/brazil_arabica_production.json). Detrending uses log-linear
        regression on the full series. Mahalanobis covariance is computed from
        the historical population with a tiny diagonal ridge (1e-4 × mean variance)
        for numerical stability. Replace the seed with real CONAB safra data
        for production-grade trade implementation.
      </div>
    </div>
  );
}
