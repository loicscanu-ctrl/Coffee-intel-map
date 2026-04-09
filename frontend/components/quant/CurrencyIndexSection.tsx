"use client";

interface Currency {
  pair: string;
  name: string;
  type: "export" | "import";
  weight: number;
  dailyChg: number;
  contribution: number;
}

const CURRENCIES: Currency[] = [
  // Exporters (positive = BRL stronger = bullish coffee)
  { pair: "BRL/USD", name: "Brazilian Real",    type: "export", weight: 0.47, dailyChg:  0.38, contribution:  0.179 },
  { pair: "VND/USD", name: "Vietnamese Dong",   type: "export", weight: 0.27, dailyChg: -0.12, contribution: -0.032 },
  { pair: "COP/USD", name: "Colombian Peso",    type: "export", weight: 0.15, dailyChg:  0.21, contribution:  0.032 },
  { pair: "ETB/USD", name: "Ethiopian Birr",    type: "export", weight: 0.06, dailyChg: -0.05, contribution: -0.003 },
  { pair: "UGX/USD", name: "Ugandan Shilling",  type: "export", weight: 0.05, dailyChg:  0.09, contribution:  0.005 },
  // Importers
  { pair: "EUR/USD", name: "Euro",              type: "import", weight: 0.51, dailyChg: -0.24, contribution: -0.122 },
  { pair: "JPY/USD", name: "Japanese Yen",      type: "import", weight: 0.23, dailyChg:  0.31, contribution:  0.071 },
  { pair: "GBP/USD", name: "British Pound",     type: "import", weight: 0.14, dailyChg: -0.18, contribution: -0.025 },
  { pair: "CNY/USD", name: "Chinese Yuan",      type: "import", weight: 0.12, dailyChg: -0.07, contribution: -0.008 },
];

const INDEX_VALUE = 178.82;
const INDEX_ZSCORE = 1.33;
const INDEX_MEAN = 162.4;
const INDEX_STD = 12.35;

const HISTORY = [
  { date: "Apr 3", value: 171.2 },
  { date: "Apr 4", value: 174.5 },
  { date: "Apr 5", value: 172.8 },
  { date: "Apr 6", value: 176.1 },
  { date: "Apr 7", value: 175.4 },
  { date: "Apr 8", value: 177.9 },
  { date: "Apr 9", value: 178.82 },
];

const minVal = Math.min(...HISTORY.map(h => h.value)) - 2;
const maxVal = Math.max(...HISTORY.map(h => h.value)) + 2;

export default function CurrencyIndexSection() {
  const totalDeltaI = CURRENCIES.reduce((a, c) => a + c.contribution, 0);

  return (
    <section className="px-6 py-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">Section 3</span>
          <h2 className="text-base font-bold text-white">Coffee Currency Index</h2>
          <span className="text-[10px] text-slate-500">DXY-replication framework · Import vs Export weighted</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Weighted composite of producing/consuming currency pairs.{" "}
          <span className="font-mono text-slate-200">ΔI = Σ w_Ex,i · ΔC_Ex,i + Σ w_Im,j · ΔC_Im,j</span>.
          Z-scores contextualize index readings against historical volatility.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Currency table */}
        <div className="xl:col-span-2 bg-slate-900 rounded-lg overflow-hidden">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-700">
                <th className="text-left px-3 py-2">Pair</th>
                <th className="text-left px-3 py-2">Currency</th>
                <th className="text-center px-3 py-2">Role</th>
                <th className="text-right px-3 py-2">Weight</th>
                <th className="text-right px-3 py-2">Daily Chg%</th>
                <th className="text-right px-3 py-2">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {/* Exporters */}
              <tr className="bg-emerald-950/30">
                <td colSpan={6} className="px-3 py-1 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                  Exporting Nations
                </td>
              </tr>
              {CURRENCIES.filter(c => c.type === "export").map((c, i) => (
                <tr key={c.pair} className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/40" : ""} hover:bg-slate-800/40`}>
                  <td className="px-3 py-1.5 font-mono font-semibold text-slate-200">{c.pair}</td>
                  <td className="px-3 py-1.5 text-slate-400">{c.name}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-[9px] px-1.5 py-0.5 rounded border text-emerald-400 bg-emerald-950/50 border-emerald-800">Export</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-300">{(c.weight * 100).toFixed(0)}%</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${c.dailyChg >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {c.dailyChg >= 0 ? "+" : ""}{c.dailyChg.toFixed(2)}%
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${c.contribution >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {c.contribution >= 0 ? "+" : ""}{c.contribution.toFixed(3)}
                  </td>
                </tr>
              ))}
              {/* Importers */}
              <tr className="bg-blue-950/30">
                <td colSpan={6} className="px-3 py-1 text-[10px] text-blue-400 font-bold uppercase tracking-wider">
                  Importing Nations
                </td>
              </tr>
              {CURRENCIES.filter(c => c.type === "import").map((c, i) => (
                <tr key={c.pair} className={`border-b border-slate-800 ${i % 2 ? "bg-slate-900/40" : ""} hover:bg-slate-800/40`}>
                  <td className="px-3 py-1.5 font-mono font-semibold text-slate-200">{c.pair}</td>
                  <td className="px-3 py-1.5 text-slate-400">{c.name}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-[9px] px-1.5 py-0.5 rounded border text-blue-400 bg-blue-950/50 border-blue-800">Import</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-300">{(c.weight * 100).toFixed(0)}%</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${c.dailyChg >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {c.dailyChg >= 0 ? "+" : ""}{c.dailyChg.toFixed(2)}%
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${c.contribution >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {c.contribution >= 0 ? "+" : ""}{c.contribution.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800/60 border-t border-slate-600">
                <td colSpan={5} className="px-3 py-2 text-[11px] font-bold text-white">ΔI (Total Daily Index Move)</td>
                <td className={`px-3 py-2 text-right font-mono font-bold text-base ${totalDeltaI >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {totalDeltaI >= 0 ? "+" : ""}{totalDeltaI.toFixed(3)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Right panel */}
        <div className="space-y-3">
          {/* Index KPIs */}
          <div className="bg-slate-900 rounded-lg p-4 space-y-3">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Index Level</div>
            <div className="text-3xl font-bold font-mono text-white">{INDEX_VALUE.toFixed(2)}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[9px] text-slate-500">Z-Score</div>
                <div className={`font-mono font-bold text-sm ${INDEX_ZSCORE >= 0 ? "text-amber-400" : "text-blue-400"}`}>+{INDEX_ZSCORE.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[9px] text-slate-500">Mean μ</div>
                <div className="font-mono text-sm text-slate-300">{INDEX_MEAN.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-[9px] text-slate-500">Std σ</div>
                <div className="font-mono text-sm text-slate-300">{INDEX_STD.toFixed(2)}</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              Z = (x − μ) / σ = ({INDEX_VALUE.toFixed(0)} − {INDEX_MEAN.toFixed(1)}) / {INDEX_STD.toFixed(2)} = +{INDEX_ZSCORE.toFixed(2)}
            </div>
          </div>

          {/* Mini sparkline */}
          <div className="bg-slate-900 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">7-Day Index History</div>
            <div className="flex items-end gap-1 h-16">
              {HISTORY.map((h) => {
                const heightPct = ((h.value - minVal) / (maxVal - minVal)) * 100;
                const isLatest = h.date === "Apr 9";
                return (
                  <div key={h.date} className="flex flex-col items-center flex-1 gap-1">
                    <div className="w-full flex items-end" style={{ height: "48px" }}>
                      <div
                        className={`w-full rounded-sm ${isLatest ? "bg-amber-400" : "bg-slate-600"}`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-slate-600 whitespace-nowrap">{h.date.split(" ")[1]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weight donut legend */}
          <div className="bg-slate-900 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Key Weights</div>
            <div className="space-y-1.5">
              {CURRENCIES.map(c => (
                <div key={c.pair} className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${c.type === "export" ? "bg-emerald-500" : "bg-blue-500"}`} />
                  <span className="text-[10px] font-mono text-slate-300 w-16">{c.pair}</span>
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full">
                    <div
                      className={`h-1.5 rounded-full ${c.type === "export" ? "bg-emerald-600" : "bg-blue-600"}`}
                      style={{ width: `${c.weight * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 w-8 text-right">{(c.weight * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
