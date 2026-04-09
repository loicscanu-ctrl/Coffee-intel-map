"use client";

interface Factor {
  label: string;
  category: "Macro" | "Momentum" | "Positioning" | "Fundamentals" | "Seasonality";
  quantile: number; // -5 to 5
  beta: number;
  contribution: number;
}

const INTERCEPT = -12.5; // Expected Change intercept

const FACTORS: Factor[] = [
  { label: "BCOM Index",        category: "Macro",          quantile:  3, beta:  8.2,  contribution:  24.6 },
  { label: "USD Index (DXY)",   category: "Macro",          quantile: -2, beta: -6.1,  contribution:  12.2 },
  { label: "ROC RC 5d",         category: "Momentum",       quantile: -4, beta:  7.5,  contribution: -30.0 },
  { label: "ROC RC 20d",        category: "Momentum",       quantile: -2, beta:  5.3,  contribution: -10.6 },
  { label: "Managed Money Net", category: "Positioning",    quantile:  1, beta:  4.8,  contribution:   4.8 },
  { label: "Comm Index Net",    category: "Positioning",    quantile: -1, beta:  3.2,  contribution:  -3.2 },
  { label: "VN Stocks-to-Use",  category: "Fundamentals",   quantile:  2, beta:  9.1,  contribution:  18.2 },
  { label: "ICO Composite Px",  category: "Fundamentals",   quantile: -3, beta: -5.4,  contribution:  16.2 },
  { label: "RC Seasonal Bias",  category: "Seasonality",    quantile:  2, beta:  3.7,  contribution:   7.4 },
];

const CAT_COLOR: Record<string, string> = {
  Macro:          "text-blue-400 bg-blue-950/50 border-blue-800",
  Momentum:       "text-amber-400 bg-amber-950/50 border-amber-800",
  Positioning:    "text-purple-400 bg-purple-950/50 border-purple-800",
  Fundamentals:   "text-emerald-400 bg-emerald-950/50 border-emerald-800",
  Seasonality:    "text-sky-400 bg-sky-950/50 border-sky-800",
};

const HORIZONS = [
  { label: "Daily",   pred: 27.6,  ci: [12, 43]  },
  { label: "Weekly",  pred: 48.2,  ci: [-8, 104] },
  { label: "Monthly", pred: 91.5,  ci: [-42, 225] },
];

function QuantileBar({ value }: { value: number }) {
  const pct = ((value + 5) / 10) * 100;
  const color = value > 0 ? "bg-emerald-500" : value < 0 ? "bg-red-500" : "bg-slate-500";
  return (
    <div className="flex items-center gap-1 w-32">
      <span className="text-[9px] text-slate-600 w-3 text-right">-5</span>
      <div className="flex-1 h-2 bg-slate-700 rounded-full relative">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-500" />
        <div
          className={`absolute top-0.5 h-1 w-1.5 rounded-full ${color}`}
          style={{ left: `${Math.min(95, Math.max(2, pct))}%` }}
        />
      </div>
      <span className="text-[9px] text-slate-600 w-3">+5</span>
    </div>
  );
}

export default function RobustaForecastSection() {
  const totalContrib = FACTORS.reduce((a, f) => a + f.contribution, 0);
  const prediction = INTERCEPT + totalContrib;

  const maxContrib = Math.max(...FACTORS.map(f => Math.abs(f.contribution)));

  return (
    <section className="px-6 py-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded">Section 2</span>
          <h2 className="text-base font-bold text-white">Robusta Futures Forecast</h2>
          <span className="text-[10px] text-slate-500">Multi-Factor Analysis · Diamond-Shaped Model</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Linear scoring model. Continuous variables are transformed into an{" "}
          <span className="text-slate-200">11-Quantile range [−5, +5]</span>. Expected price change ={" "}
          <span className="font-mono text-slate-200">Intercept + Σ(Qᵢ × βᵢ)</span> across Macro, Momentum,
          Positioning, Fundamentals, and Seasonality factors.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Factor table */}
        <div className="xl:col-span-2 bg-slate-900 rounded-lg overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700">
                <th className="text-left px-3 py-2">Factor</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-center px-3 py-2">Q-Score</th>
                <th className="px-3 py-2">Range</th>
                <th className="text-right px-3 py-2">β</th>
                <th className="text-right px-3 py-2">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {FACTORS.map((f, i) => (
                <tr key={f.label} className={`border-b border-slate-800 ${i % 2 === 0 ? "" : "bg-slate-900/60"} hover:bg-slate-800/40`}>
                  <td className="px-3 py-1.5 text-slate-200 whitespace-nowrap">{f.label}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${CAT_COLOR[f.category]}`}>{f.category}</span>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`font-mono font-bold ${f.quantile > 0 ? "text-emerald-400" : f.quantile < 0 ? "text-red-400" : "text-slate-500"}`}>
                      {f.quantile > 0 ? "+" : ""}{f.quantile}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <QuantileBar value={f.quantile} />
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-400">{f.beta.toFixed(1)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${f.contribution >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-600">
                <td colSpan={4} className="px-3 py-2 text-[11px] text-slate-400">Intercept (Expected Change)</td>
                <td />
                <td className={`px-3 py-2 text-right font-mono font-semibold ${INTERCEPT >= 0 ? "text-emerald-400" : "text-red-400"}`}>{INTERCEPT >= 0 ? "+" : ""}{INTERCEPT.toFixed(1)}</td>
              </tr>
              <tr className="bg-slate-800/60">
                <td colSpan={4} className="px-3 py-2 text-[11px] font-bold text-white">Model Output ΔP</td>
                <td />
                <td className={`px-3 py-2 text-right font-mono font-bold text-lg ${prediction >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {prediction >= 0 ? "+" : ""}{prediction.toFixed(1)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Right panel: beta chart + horizons */}
        <div className="space-y-3">
          {/* Horizon forecasts */}
          <div className="bg-slate-900 rounded-lg p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Forecast Horizons ΔP</div>
            {HORIZONS.map(h => (
              <div key={h.label} className="space-y-0.5">
                <div className="flex justify-between items-baseline">
                  <span className="text-[11px] text-slate-400">{h.label}</span>
                  <span className={`font-mono font-bold text-sm ${h.pred >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {h.pred >= 0 ? "+" : ""}{h.pred.toFixed(1)}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full relative">
                  <div
                    className={`h-1.5 rounded-full ${h.pred >= 0 ? "bg-emerald-600" : "bg-red-600"}`}
                    style={{ width: `${Math.min(100, Math.abs(h.pred) / 1.5)}%` }}
                  />
                </div>
                <div className="text-[9px] text-slate-600 font-mono">
                  CI: [{h.ci[0] >= 0 ? "+" : ""}{h.ci[0]}, {h.ci[1] >= 0 ? "+" : ""}{h.ci[1]}]
                </div>
              </div>
            ))}
          </div>

          {/* Beta bar chart */}
          <div className="bg-slate-900 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Factor Betas (β)</div>
            <div className="space-y-1.5">
              {[...FACTORS].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).map(f => (
                <div key={f.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-28 shrink-0 truncate">{f.label}</span>
                  <div className="flex-1 h-2.5 bg-slate-700 rounded-full relative">
                    <div
                      className={`h-2.5 rounded-full ${f.contribution >= 0 ? "bg-emerald-600/70" : "bg-red-600/70"}`}
                      style={{ width: `${(Math.abs(f.contribution) / maxContrib) * 100}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-mono w-10 text-right ${f.contribution >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
