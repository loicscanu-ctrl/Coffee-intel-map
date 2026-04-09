"use client";

const BASE = 0.4356;
const FEATURES: { label: string; value: number; desc: string }[] = [
  { label: "Momentum (ROC 5d)",      value: -0.1183, desc: "Short-term bearish momentum dominant driver" },
  { label: "OI Δ / Volume Ratio",    value: -0.0653, desc: "Declining open interest vs volume" },
  { label: "BCOM Index Divergence",  value: -0.0283, desc: "Macro commodity index misalignment" },
  { label: "Volatility Regime",      value: -0.0171, desc: "Elevated realized vol dampens upside prob" },
  { label: "Seasonal Bias",          value: -0.0002, desc: "Marginal seasonal headwind" },
];
const FINAL = 0.2067;

const maxAbs = Math.max(...FEATURES.map(f => Math.abs(f.value)));

export default function PriceDirectionSection() {
  let running = BASE;

  return (
    <section className="px-6 py-5 space-y-4">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">Section 1</span>
          <h2 className="text-base font-bold text-white">Short-Term Price Direction</h2>
          <span className="text-[10px] text-slate-500">First Open Hour Prediction</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Classification model using the <span className="text-slate-200">Triple Barrier Method</span>. For a given price{" "}
          <span className="font-mono text-amber-300">P_t</span>, an upper barrier is set at{" "}
          <span className="font-mono text-emerald-400">P_t + 27</span>, lower at{" "}
          <span className="font-mono text-red-400">P_t − 27</span>, plus a vertical time barrier. The target{" "}
          <span className="font-mono text-slate-200">y</span> is classified by which barrier is intersected first.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* SHAP Waterfall */}
        <div className="bg-slate-900 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">SHAP Waterfall</span>
            <span className="text-[10px] text-slate-500 font-mono">f(x) = E[f(x)] + Σφᵢ</span>
          </div>

          {/* Baseline */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 w-44 text-right shrink-0">E[f(x)] baseline</span>
            <div className="flex-1 h-5 bg-slate-800 rounded relative flex items-center">
              <div
                className="h-5 rounded bg-slate-600"
                style={{ width: `${(BASE / 0.5) * 100}%` }}
              />
              <span className="absolute right-1 text-[10px] font-mono text-slate-300">{BASE.toFixed(4)}</span>
            </div>
          </div>

          {/* Feature bars */}
          {FEATURES.map((f) => {
            const prev = running;
            running += f.value;
            const barPct = (Math.abs(f.value) / maxAbs) * 60;
            return (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400 w-44 text-right shrink-0 leading-tight">{f.label}</span>
                <div className="flex-1 h-5 bg-slate-800 rounded relative flex items-center">
                  <div
                    className="h-5 rounded bg-red-700/70"
                    style={{ width: `${barPct}%` }}
                  />
                  <span className="absolute right-1 text-[10px] font-mono text-red-400">
                    {f.value > 0 ? "+" : ""}{f.value.toFixed(4)}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 w-14 text-right">{running.toFixed(4)}</span>
              </div>
            );
          })}

          {/* Final output */}
          <div className="border-t border-slate-700 pt-2 flex items-center gap-3">
            <span className="text-[11px] font-semibold text-white w-44 text-right shrink-0">f(x) output</span>
            <div className="flex-1 h-6 bg-slate-800 rounded relative flex items-center">
              <div
                className="h-6 rounded bg-amber-600/60"
                style={{ width: `${(FINAL / 0.5) * 100}%` }}
              />
              <span className="absolute right-1 text-[10px] font-mono text-amber-300 font-bold">{FINAL.toFixed(4)}</span>
            </div>
          </div>
        </div>

        {/* Methodology + output panel */}
        <div className="space-y-3">
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Baseline E[f(x)]</div>
              <div className="text-lg font-bold font-mono text-slate-200 mt-1">{BASE.toFixed(4)}</div>
            </div>
            <div className="bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">SHAP Σφᵢ</div>
              <div className="text-lg font-bold font-mono text-red-400 mt-1">
                {FEATURES.reduce((a, f) => a + f.value, 0).toFixed(4)}
              </div>
            </div>
            <div className="bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Output f(x)</div>
              <div className="text-lg font-bold font-mono text-amber-300 mt-1">{FINAL.toFixed(4)}</div>
            </div>
          </div>

          {/* Barrier visualization */}
          <div className="bg-slate-900 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Triple Barrier Setup</div>
            <div className="relative h-24 border border-slate-700 rounded bg-slate-800 flex items-center justify-center">
              {/* Upper barrier */}
              <div className="absolute top-1 left-0 right-0 flex items-center gap-2 px-3">
                <div className="flex-1 border-t-2 border-dashed border-emerald-500" />
                <span className="text-[10px] text-emerald-400 font-mono whitespace-nowrap">Upper: P_t + 27</span>
              </div>
              {/* Entry */}
              <div className="absolute left-0 right-0 flex items-center gap-2 px-3">
                <div className="flex-1 border-t border-slate-500" />
                <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">Entry P_t</span>
              </div>
              {/* Lower barrier */}
              <div className="absolute bottom-1 left-0 right-0 flex items-center gap-2 px-3">
                <div className="flex-1 border-t-2 border-dashed border-red-500" />
                <span className="text-[10px] text-red-400 font-mono whitespace-nowrap">Lower: P_t − 27</span>
              </div>
              {/* Time barrier */}
              <div className="absolute top-0 bottom-0 right-12 border-r-2 border-dashed border-slate-500" />
              <span className="absolute right-1 top-1 text-[9px] text-slate-500">T max</span>
            </div>
          </div>

          {/* Feature list */}
          <div className="bg-slate-900 rounded-lg p-4 space-y-1.5">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Feature Contributions</div>
            {FEATURES.map(f => (
              <div key={f.label} className="flex items-start gap-2">
                <span className="text-[10px] font-mono text-red-400 w-14 shrink-0 mt-0.5">{f.value.toFixed(4)}</span>
                <div>
                  <div className="text-[11px] text-slate-300">{f.label}</div>
                  <div className="text-[10px] text-slate-500">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
