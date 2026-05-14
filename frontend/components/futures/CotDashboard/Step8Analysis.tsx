"use client";
import type { Signal, SignalSeverity, SignalMarket } from "@/lib/cot/signalEngine";

const CATEGORY_ORDER = ["CP","CR","CI","ML","MS","MI","MPI","MRI","CS","OB","SP"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  CP:  "Producer Behavior",
  CR:  "Roaster Behavior",
  CI:  "Commercial Interaction",
  ML:  "MM Longs",
  MS:  "MM Shorts",
  MI:  "MM Interaction",
  MPI: "MM × Producers",
  MRI: "MM × Roasters",
  CS:  "Curve Structure",
  OB:  "Overbought / Oversold",
  SP:  "Spreading",
};

const SEVERITY_CARD: Record<SignalSeverity, string> = {
  info:  "border-slate-600/50 bg-slate-800/30",
  warn:  "border-amber-500/40 bg-amber-900/10",
  alert: "border-red-500/50 bg-red-900/10",
};

const SEVERITY_DOT: Record<SignalSeverity, string> = {
  info:  "bg-slate-500",
  warn:  "bg-amber-400",
  alert: "bg-red-400 shadow-[0_0_6px_#f87171]",
};

const SEVERITY_LABEL: Record<SignalSeverity, string> = {
  info:  "text-slate-400",
  warn:  "text-amber-400",
  alert: "text-red-400",
};

const MARKET_BADGE: Record<SignalMarket, string> = {
  NY:  "bg-blue-900/40 text-blue-300 border border-blue-700/40",
  LDN: "bg-violet-900/40 text-violet-300 border border-violet-700/40",
};

const MARKET_LABEL: Record<SignalMarket, string> = {
  NY:  "KC · Arabica",
  LDN: "RC · Robusta",
};

export default function Step8Analysis({ signals }: { signals: Signal[] }) {
  const alerts = signals.filter(s => s.severity === "alert").length;
  const warns  = signals.filter(s => s.severity === "warn").length;
  const infos  = signals.filter(s => s.severity === "info").length;

  const groups = CATEGORY_ORDER
    .map(cat => ({
      cat,
      label: CATEGORY_LABELS[cat],
      sigs:  signals.filter(s => s.category === cat),
    }))
    .filter(g => g.sigs.length > 0);

  return (
    <div id="cot-section-8" className="space-y-5">
      {/* Header + summary badges */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Rule-Based Signal Analysis</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            59 rules · proxies: pmpuShort = producers, pmpuLong = roasters · 52-week percentiles
          </p>
        </div>
        <div className="flex gap-2 text-[10px] flex-wrap">
          {alerts > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-700/40 font-medium">
              {alerts} alert{alerts !== 1 ? "s" : ""}
            </span>
          )}
          {warns > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/40 font-medium">
              {warns} warning{warns !== 1 ? "s" : ""}
            </span>
          )}
          {infos > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {infos} info
            </span>
          )}
          {signals.length === 0 && (
            <span className="text-slate-500">No signals triggered</span>
          )}
        </div>
      </div>

      {/* Signal groups */}
      {groups.map(({ cat, label, sigs }) => (
        <div key={cat} className="space-y-1.5">
          {/* Category header */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[9px] font-mono font-bold text-slate-600 uppercase tracking-widest">{cat}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-[10px] text-slate-600">{sigs.length}</span>
          </div>

          {/* Signal cards */}
          <div className="space-y-1">
            {sigs.map(sig => (
              <div
                key={`${sig.id}-${sig.market}`}
                className={`flex gap-2.5 items-start p-2.5 rounded-lg border ${SEVERITY_CARD[sig.severity]}`}
              >
                {/* Severity dot */}
                <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[sig.severity]}`} />

                <div className="flex-1 min-w-0">
                  {/* Rule ID · name · market badge */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="text-[9px] font-mono text-slate-600">{sig.id}</span>
                    <span className={`text-[11px] font-semibold ${SEVERITY_LABEL[sig.severity]}`}>
                      {sig.name}
                    </span>
                    <span className={`text-[9px] px-1.5 py-px rounded font-medium ${MARKET_BADGE[sig.market]}`}>
                      {MARKET_LABEL[sig.market]}
                    </span>
                  </div>

                  {/* Interpretation */}
                  <p className="text-[11px] text-slate-400 leading-relaxed">{sig.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {signals.length === 0 && (
        <div className="text-center text-slate-600 text-xs py-8">
          No signals triggered — insufficient data or all positions within flat threshold.
        </div>
      )}
    </div>
  );
}
