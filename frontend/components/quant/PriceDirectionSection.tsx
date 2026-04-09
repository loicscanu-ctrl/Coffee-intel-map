"use client";

const BASE  = 0.4356;
const FINAL = 0.2067;

// Each feature: the raw observed value fed into the model, and its resulting SHAP φᵢ
const FEATURES = [
  {
    varName:   "rc_last_trade_settlement_diff",
    label:     "Settlement & Last Price Diff",
    rawValue:  -6,
    rawFmt:    "$(6.0)",
    phi:       -0.1183,
  },
  {
    varName:   "usd_eur_after_rc_pct_change",
    label:     "USD/EUR after RC Close Return",
    rawValue:  0.0022,
    rawFmt:    "0.22",
    phi:       -0.0651,
  },
  {
    varName:   "dxy_after_rc_pct_change",
    label:     "DXY after RC Close Return",
    rawValue:  0.0021,
    rawFmt:    "0.21",
    phi:       -0.0283,
  },
  {
    varName:   "kc_after_rc_diff",
    label:     "New York Price Gap",
    rawValue:  -0.3,
    rawFmt:    "¢(0.3)",
    phi:       -0.0171,
  },
  {
    varName:   "usd_brl_after_rc_pct_change",
    label:     "USD/BRL after RC Close Return",
    rawValue:  -0.0002,
    rawFmt:    "(0.02)",
    phi:       -0.0002,
  },
];

// Waterfall x-axis domain
const X_MIN = 0.18;
const X_MAX = 0.46;
const X_SPAN = X_MAX - X_MIN;

function toPct(v: number) {
  return ((v - X_MIN) / X_SPAN) * 100;
}

export default function PriceDirectionSection() {
  // Build cumulative positions from f(x) outward toward E[f(x)]
  // Each bar starts where the previous ended and extends by |φᵢ|
  const bars: { left: number; width: number; phi: number }[] = [];
  let cursor = FINAL;
  for (const f of FEATURES) {
    const start = cursor;
    const end   = cursor - f.phi; // phi is negative, so end > start
    bars.push({ left: toPct(start), width: ((end - start) / X_SPAN) * 100, phi: f.phi });
    cursor = end;
  }

  return (
    <section className="px-6 py-5 space-y-4">
      {/* Title */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">Section 1</span>
        <h2 className="text-base font-bold text-white">Open Price Direction</h2>
        <span className="text-[10px] text-slate-500">Robusta · First 30 Minutes · Triple Barrier Classification</span>
      </div>

      {/* ── Summary table ──────────────────────────────────────── */}
      <div className="bg-slate-900 rounded-lg overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700 bg-slate-800/60">
              <th className="text-left px-4 py-2 w-56">Factor</th>
              <th className="text-right px-4 py-2 w-28">Value</th>
              <th className="text-center px-4 py-2 w-28">Direction</th>
              <th className="text-center px-4 py-2">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f, i) => (
              <tr key={f.varName} className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/60" : ""}`}>
                <td className="px-4 py-2 text-slate-300">{f.label}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${f.rawValue < 0 ? "text-red-400" : "text-slate-200"}`}>
                  {f.rawFmt}
                </td>
                {/* Direction & Confidence span all rows */}
                {i === 0 && (
                  <td className="px-4 py-2 text-center font-bold text-red-400 text-sm" rowSpan={FEATURES.length}>
                    Bearish
                  </td>
                )}
                {i === 0 && (
                  <td className="px-4 py-2 text-center" rowSpan={FEATURES.length}>
                    <div className="space-y-1">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-[11px] text-emerald-400">Bullish:</span>
                        <span className="font-mono font-bold text-emerald-300">20.67%</span>
                      </div>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-[11px] text-red-400">Bearish:</span>
                        <span className="font-mono font-bold text-red-300">79.33%</span>
                      </div>
                      {/* Confidence bar */}
                      <div className="mx-auto w-28 h-2 bg-slate-700 rounded-full overflow-hidden flex">
                        <div className="h-2 bg-emerald-700" style={{ width: "20.67%" }} />
                        <div className="h-2 bg-red-700 flex-1" />
                      </div>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SHAP Waterfall ─────────────────────────────────────── */}
      <div className="bg-slate-900 rounded-lg p-5">
        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
          SHAP Waterfall — f(x) = {FINAL}
        </div>

        {/* Rows */}
        <div className="space-y-2">
          {FEATURES.map((f, i) => (
            <div key={f.varName} className="flex items-center gap-3">
              {/* Left label: raw_value = variable_name */}
              <div className="w-64 shrink-0 text-right">
                <span className={`font-mono text-[11px] font-semibold ${f.rawValue < 0 ? "text-red-300" : "text-slate-300"}`}>
                  {f.rawFmt}
                </span>
                <span className="text-[10px] text-slate-500 ml-1">= {f.varName}</span>
              </div>

              {/* Bar track */}
              <div className="flex-1 relative h-6 bg-slate-800 rounded">
                {/* f(x) marker line */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-amber-400/40"
                  style={{ left: `${toPct(FINAL)}%` }}
                />
                {/* E[f(x)] marker line */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-slate-500/40"
                  style={{ left: `${toPct(BASE)}%` }}
                />
                {/* SHAP bar */}
                <div
                  className="absolute top-1 bottom-1 rounded bg-red-600/80"
                  style={{ left: `${bars[i].left}%`, width: `${bars[i].width}%` }}
                />
                {/* phi label inside bar */}
                <span
                  className="absolute top-0 bottom-0 flex items-center text-[10px] font-mono font-bold text-red-200 pl-1"
                  style={{ left: `${bars[i].left}%` }}
                >
                  {f.phi.toFixed(4)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* X-axis labels */}
        <div className="flex items-center gap-3 mt-3">
          <div className="w-64 shrink-0" />
          <div className="flex-1 relative h-4">
            {/* f(x) tick */}
            <span
              className="absolute text-[10px] font-mono text-amber-400 -translate-x-1/2"
              style={{ left: `${toPct(FINAL)}%` }}
            >
              {FINAL}
            </span>
            {/* 0.3 tick */}
            <span
              className="absolute text-[10px] font-mono text-slate-500 -translate-x-1/2"
              style={{ left: `${toPct(0.3)}%` }}
            >
              0.3
            </span>
            {/* 0.4 tick */}
            <span
              className="absolute text-[10px] font-mono text-slate-500 -translate-x-1/2"
              style={{ left: `${toPct(0.4)}%` }}
            >
              0.4
            </span>
            {/* E[f(x)] tick */}
            <span
              className="absolute text-[10px] font-mono text-slate-400 -translate-x-1/2"
              style={{ left: `${toPct(BASE)}%` }}
            >
              E[f(x)] = {BASE}
            </span>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 italic mt-3">
          Figure 1.1 — The waterfall chart shows how each raw feature value incrementally shifts the model&apos;s
          prediction from the baseline E[f(x)] = {BASE} to the final output f(x) = {FINAL}.
          Left label = observed raw value fed into the model. Bar width = SHAP φᵢ (marginal contribution).
        </p>
      </div>

      {/* ── Model Performance ──────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-2">
        <div className="text-xs font-bold text-slate-200">Model Performance</div>
        <div className="flex gap-8">
          <div>
            <span className="text-[11px] text-slate-400">Accuracy: </span>
            <span className="text-[11px] font-mono text-emerald-400">828/1146</span>
            <span className="text-[11px] text-emerald-400 font-bold"> (72.25%)</span>
          </div>
          <div>
            <span className="text-[11px] text-slate-400">Undefined ratio: </span>
            <span className="text-[11px] font-mono text-amber-400">1381/2527</span>
            <span className="text-[11px] text-amber-400 font-bold"> (54.65%)</span>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed max-w-2xl">
          Accuracy measures correctly classified directional outcomes (up/down) out of defined predictions.
          The undefined ratio reflects observations where the vertical time barrier was hit before either
          price barrier — the model abstains rather than forcing a classification.
        </p>
      </div>
    </section>
  );
}
