"use client";
import { Fragment, useEffect, useState } from "react";

// ── Live open-direction model output (quant_report.json["open_direction"]) ──
// Produced PRE-OPEN (03:00 UTC) by backend/scraper/quant_model/
// open_direction_log.py → open_direction.py: a logistic classifier on ICE
// Robusta's OVERNIGHT GAP (first-bar open vs prior 17:30-London close, roll
// days excluded), with an EXACT additive (SHAP-style) decomposition. For
// logistic regression φᵢ = βᵢ·zᵢ in log-odds space and Σφᵢ = margin(x) −
// base_margin with zero residual, so the waterfall below is mathematically
// exact, not a sampled approximation. Every prediction is also logged
// append-only to open_direction_history.json and graded after the open.
// Methodology: docs/research/open-price-direction-findings.md

interface Feature {
  var_name:    string;
  label:       string;
  raw_value:   number;
  raw_fmt:     string;
  usd_per_ton: number | null;   // factor magnitude on the robusta USD/MT ruler
  phi:         number;          // margin (log-odds) units
  detail?:     { text: string };
}

interface OpenDirection {
  available:     boolean;
  reason?:       string;
  as_of?:        string;        // last session whose data fed the model
  for_session?:  string;        // the session being predicted
  direction?:    "Bullish" | "Bearish" | "Abstain";
  base_margin?:  number;
  final_margin?: number;
  base_prob?:    number;
  final_prob?:   number;
  prob_up?:      number;
  prob_down?:    number;
  features?:     Feature[];
  target?:       { kind: string; definition: string; abstain_band: number };
  model?: {
    kind:            string;
    active_features: string[];
    n_features:      number;
    n_train:         number;
    test_accuracy:   number | null;
    baseline_accuracy?: number | null;
    edge?:           number | null;
    acted_accuracy?: number | null;
    acted_n?:        number | null;
    abstain_rate?:   number | null;
    eval_method?:    string;
    n_test:          number;
  };
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtUsdTon(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}/t`;
}

export default function PriceDirectionSection() {
  const [data, setData] = useState<OpenDirection | null>(null);

  useEffect(() => {
    fetch("/data/quant_report.json")
      .then(r => (r.ok ? r.json() : null))
      .then(j => setData(j?.open_direction ?? { available: false, reason: "No data" }))
      .catch(() => setData({ available: false, reason: "Fetch failed" }));
  }, []);

  const loading = data === null;
  const unavailable = data !== null && !data.available;

  // ── Waterfall geometry (in MARGIN / log-odds units — the only space where
  // logistic SHAP is exactly additive). Bars walk from base_margin to
  // final_margin; each bar's signed width = φᵢ. ────────────────────────────
  const features = data?.features ?? [];
  const baseM  = data?.base_margin  ?? 0;
  const finalM = data?.final_margin ?? 0;
  // Domain padded around the [base, final] span plus the bar excursions.
  const marginsTouched = [baseM, finalM];
  let cursorScan = baseM;
  for (const f of features) { cursorScan += f.phi; marginsTouched.push(cursorScan); }
  const lo = Math.min(...marginsTouched);
  const hi = Math.max(...marginsTouched);
  const pad = Math.max((hi - lo) * 0.15, 0.05);
  const X_MIN = lo - pad;
  const X_MAX = hi + pad;
  const X_SPAN = X_MAX - X_MIN || 1;
  const toPct = (v: number) => ((v - X_MIN) / X_SPAN) * 100;

  const bars: { left: number; width: number; phi: number; positive: boolean }[] = [];
  let cursor = baseM;
  for (const f of features) {
    const start = cursor;
    const end = cursor + f.phi;
    const left = toPct(Math.min(start, end));
    const width = Math.abs(end - start) / X_SPAN * 100;
    bars.push({ left, width, phi: f.phi, positive: f.phi >= 0 });
    cursor = end;
  }

  const dir = data?.direction ?? "Bearish";
  const dirCls = dir === "Bullish" ? "text-emerald-400"
    : dir === "Bearish" ? "text-red-400" : "text-amber-400";
  const probUp = data?.prob_up ?? 0.5;
  const probDown = data?.prob_down ?? 0.5;

  return (
    <section className="px-6 py-5 space-y-4">
      {/* Title */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">Section 1</span>
        <h2 className="text-base font-bold text-white">Open Price Direction</h2>
        <span className="text-[10px] text-slate-500">
          Robusta · Overnight Gap (open vs prior 17:30 close) · fires pre-open 03:00 UTC
        </span>
        {data?.available && (
          <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded ml-auto">
            LIVE · predicts {data.for_session ?? data.as_of}
          </span>
        )}
      </div>

      {loading && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 animate-pulse h-40" />
      )}

      {unavailable && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-500">
          <span className="text-amber-400 font-bold">UNAVAILABLE</span>
          <span>{data?.reason ?? "Model output not present in quant_report.json."}</span>
        </div>
      )}

      {data?.available && (
        <>
          {/* ── Summary table ──────────────────────────────────────── */}
          <div className="bg-slate-900 rounded-lg overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700 bg-slate-800/60">
                  <th className="text-left px-4 py-2 w-56">Factor</th>
                  <th className="text-right px-4 py-2 w-24">Value</th>
                  <th className="text-right px-4 py-2 w-28">USD/ton</th>
                  <th className="text-center px-4 py-2 w-24">Direction</th>
                  <th className="text-center px-4 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f, i) => (
                  <Fragment key={f.var_name}>
                  <tr className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/60" : ""}`}>
                    <td className="px-4 py-2 text-slate-300">{f.label}</td>
                    <td className={`px-4 py-2 text-right font-mono font-semibold ${f.raw_value < 0 ? "text-red-400" : "text-slate-200"}`}>
                      {f.raw_fmt}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${(f.usd_per_ton ?? 0) < 0 ? "text-red-400" : "text-slate-300"}`}>
                      {fmtUsdTon(f.usd_per_ton)}
                    </td>
                    {i === 0 && (
                      <td className={`px-4 py-2 text-center font-bold text-sm ${dirCls}`} rowSpan={features.length}>
                        {dir}
                      </td>
                    )}
                    {i === 0 && (
                      <td className="px-4 py-2 text-center" rowSpan={features.length}>
                        <div className="space-y-1">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-[11px] text-emerald-400">Bullish:</span>
                            <span className="font-mono font-bold text-emerald-300">{fmtPct(probUp)}</span>
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-[11px] text-red-400">Bearish:</span>
                            <span className="font-mono font-bold text-red-300">{fmtPct(probDown)}</span>
                          </div>
                          <div className="mx-auto w-28 h-2 bg-slate-700 rounded-full overflow-hidden flex">
                            <div className="h-2 bg-emerald-700" style={{ width: `${probUp * 100}%` }} />
                            <div className="h-2 bg-red-700 flex-1" />
                          </div>
                        </div>
                      </td>
                    )}
                  </tr>
                  {/* Factor detail: the components written down beneath the row.
                      Guarded on .text so a transitional old-shape payload
                      (pre-gap-spec detail object) renders nothing. */}
                  {f.detail?.text && (
                    <tr className={i % 2 ? "bg-slate-900/60" : ""}>
                      <td colSpan={3} className="px-4 pb-2 pt-0">
                        <div className="text-[10px] text-slate-500 font-mono leading-relaxed border-l-2 border-slate-700 pl-3">
                          {f.detail.text}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── SHAP Waterfall (margin / log-odds space — exactly additive) ── */}
          <div className="bg-slate-900 rounded-lg p-5">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              SHAP Waterfall — log-odds margin
            </div>
            <div className="text-[10px] text-slate-500 mb-4">
              Bars in log-odds units (exactly additive for logistic regression). Endpoints
              labelled with the implied probability.
            </div>

            <div className="space-y-2">
              {features.map((f, i) => (
                <div key={f.var_name} className="flex items-center gap-3">
                  <div className="w-64 shrink-0 text-right">
                    <span className={`font-mono text-[11px] font-semibold ${f.raw_value < 0 ? "text-red-300" : "text-slate-300"}`}>
                      {f.raw_fmt}
                    </span>
                    {f.usd_per_ton != null && (
                      <span className="text-[10px] text-slate-500 ml-1">({fmtUsdTon(f.usd_per_ton)})</span>
                    )}
                    <span className="text-[10px] text-slate-500 ml-1">{f.var_name}</span>
                  </div>

                  <div className="flex-1 relative h-6 bg-slate-800 rounded">
                    {/* f(x) marker */}
                    <div className="absolute top-0 bottom-0 w-px bg-amber-400/40" style={{ left: `${toPct(finalM)}%` }} />
                    {/* E[f(x)] marker */}
                    <div className="absolute top-0 bottom-0 w-px bg-slate-500/40" style={{ left: `${toPct(baseM)}%` }} />
                    {/* SHAP bar — green = pushes up (bullish), red = pushes down */}
                    <div
                      className={`absolute top-1 bottom-1 rounded ${bars[i].positive ? "bg-emerald-600/80" : "bg-red-600/80"}`}
                      style={{ left: `${bars[i].left}%`, width: `${bars[i].width}%` }}
                    />
                    <span
                      className={`absolute top-0 bottom-0 flex items-center text-[10px] font-mono font-bold pl-1 ${bars[i].positive ? "text-emerald-200" : "text-red-200"}`}
                      style={{ left: `${bars[i].left}%` }}
                    >
                      {f.phi >= 0 ? "+" : ""}{f.phi.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* X-axis labels */}
            <div className="flex items-center gap-3 mt-3">
              <div className="w-64 shrink-0" />
              <div className="flex-1 relative h-8">
                <span
                  className="absolute text-[10px] font-mono text-amber-400 -translate-x-1/2 text-center"
                  style={{ left: `${toPct(finalM)}%` }}
                >
                  f(x)={finalM.toFixed(2)}
                  <br />
                  <span className="text-amber-300/70">{fmtPct(data.final_prob, 1)}</span>
                </span>
                <span
                  className="absolute text-[10px] font-mono text-slate-400 -translate-x-1/2 text-center"
                  style={{ left: `${toPct(baseM)}%` }}
                >
                  E[f(x)]={baseM.toFixed(2)}
                  <br />
                  <span className="text-slate-500">{fmtPct(data.base_prob, 1)}</span>
                </span>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 italic mt-3">
              Figure 1.1 — Each bar is feature i&apos;s exact SHAP value φᵢ = βᵢ·zᵢ (log-odds),
              shifting the estimate from the base rate E[f(x)] to the prediction f(x). Green
              pushes toward Bullish, red toward Bearish. The bars sum to f(x) − E[f(x)] with
              zero residual.
            </p>
          </div>

          {/* ── Model Performance ──────────────────────────────────── */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-2">
            <div className="text-xs font-bold text-slate-200">Model Performance</div>
            <div className="flex gap-8 flex-wrap">
              <div>
                <span className="text-[11px] text-slate-400">Test accuracy: </span>
                <span className="text-[11px] font-mono text-emerald-400">
                  {data.model?.test_accuracy != null ? fmtPct(data.model.test_accuracy, 1) : "—"}
                </span>
                {data.model?.baseline_accuracy != null && (
                  <span className="text-[11px] text-slate-500">
                    {" "}vs {fmtPct(data.model.baseline_accuracy, 1)} baseline
                    {data.model?.edge != null && (
                      <span className={data.model.edge >= 0 ? "text-emerald-500" : "text-rose-500"}>
                        {" "}({data.model.edge >= 0 ? "+" : ""}{(data.model.edge * 100).toFixed(1)}pp)
                      </span>
                    )}
                  </span>
                )}
                <span className="text-[11px] text-slate-500"> · n={data.model?.n_test ?? 0}, {data.model?.eval_method === "walk_forward" ? "walk-forward" : "holdout"}</span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400">Acted accuracy: </span>
                <span className="text-[11px] font-mono text-emerald-400">
                  {data.model?.acted_accuracy != null ? fmtPct(data.model.acted_accuracy, 1) : "—"}
                </span>
                <span className="text-[11px] text-slate-500"> (n={data.model?.acted_n ?? 0})</span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400">Abstain rate: </span>
                <span className="text-[11px] font-mono text-amber-400">
                  {data.model?.abstain_rate != null ? fmtPct(data.model.abstain_rate, 1) : "—"}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400">Train rows: </span>
                <span className="text-[11px] font-mono text-slate-300">{data.model?.n_train ?? 0}</span>
                <span className="text-[11px] text-slate-500"> · {data.model?.n_features ?? 0} features</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed max-w-2xl">
              Target: {data.target?.definition ?? "overnight gap direction"}. Accuracy is
              out-of-sample (expanding walk-forward, standardise-on-past) vs the rolling
              majority-class baseline on the same sessions; &ldquo;acted&rdquo; restricts to
              calls outside the ±{((data.target?.abstain_band ?? 0.03) * 100).toFixed(0)}pp
              abstain band, where the model abstains rather than forcing a coin-flip call.
              Every 03:00 UTC prediction is logged before the open and graded after it —
              see the calendar below. Methodology: docs/research/open-price-direction-findings.md
            </p>
          </div>
        </>
      )}
    </section>
  );
}
