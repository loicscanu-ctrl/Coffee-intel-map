"use client";
import type { Signal, SignalSeverity, SignalMarket, HistoricalWeek } from "@/lib/cot/signalEngine";
import { computeCompositeScores } from "@/lib/cot/signalEngine";

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

// ── Composite score gauge ─────────────────────────────────────────────────────

type ScoreZone = "strongly-bearish" | "bearish" | "neutral" | "bullish" | "strongly-bullish";

function scoreZone(s: number): ScoreZone {
  if (s <= -5) return "strongly-bearish";
  if (s <  -2) return "bearish";
  if (s <=  2) return "neutral";
  if (s <   5) return "bullish";
  return "strongly-bullish";
}

const ZONE_COLOR: Record<ScoreZone, string> = {
  "strongly-bearish":  "#ef4444",
  "bearish":           "#f97316",
  "neutral":           "#94a3b8",
  "bullish":           "#22c55e",
  "strongly-bullish":  "#10b981",
};

const ZONE_LABEL: Record<ScoreZone, string> = {
  "strongly-bearish":  "Strongly Bearish",
  "bearish":           "Bearish",
  "neutral":           "Neutral",
  "bullish":           "Bullish",
  "strongly-bullish":  "Strongly Bullish",
};

/** Clamp score to [-10,10] and convert to 0–100% bar fill. */
function scoreToFill(s: number): number {
  const clamped = Math.max(-10, Math.min(10, s));
  return ((clamped + 10) / 20) * 100;
}

function CompositeGauge({ label, score }: { label: string; score: number }) {
  const zone  = scoreZone(score);
  const fill  = scoreToFill(score);
  const color = ZONE_COLOR[zone];
  return (
    <div className="flex-1 min-w-[140px] bg-slate-800/50 rounded-lg border border-slate-700/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">{label}</span>
        <span className="text-[11px] font-bold" style={{ color }}>{ZONE_LABEL[zone]}</span>
      </div>
      {/* Score bar: center = neutral, left = bearish, right = bullish */}
      <div className="relative h-2 rounded-full bg-slate-700 overflow-hidden">
        {/* Center tick */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-500 z-10" />
        {score >= 0 ? (
          <div
            className="absolute top-0 bottom-0 rounded-r-full"
            style={{ left: "50%", width: `${(fill - 50)}%`, backgroundColor: color }}
          />
        ) : (
          <div
            className="absolute top-0 bottom-0 rounded-l-full"
            style={{ right: `${100 - fill}%`, width: `${50 - fill}%`, backgroundColor: color }}
          />
        )}
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 font-mono">
        <span>−10</span>
        <span className="font-semibold" style={{ color }}>{score > 0 ? `+${score}` : score}</span>
        <span>+10</span>
      </div>
    </div>
  );
}

// ── 8-week history heatmap ────────────────────────────────────────────────────

const HEATMAP_SEVERITY_BG: Record<SignalSeverity | "none", string> = {
  none:  "bg-slate-800/30 text-slate-700",
  info:  "bg-slate-700/60 text-slate-400",
  warn:  "bg-amber-900/40 text-amber-400",
  alert: "bg-red-900/40 text-red-400",
};

function topSeverity(sigs: Signal[]): SignalSeverity | "none" {
  if (sigs.some(s => s.severity === "alert")) return "alert";
  if (sigs.some(s => s.severity === "warn"))  return "warn";
  if (sigs.length > 0)                        return "info";
  return "none";
}

function HistoricalHeatmap({ history }: { history: HistoricalWeek[] }) {
  if (!history.length) return null;
  const weeks = history.slice(-8);

  return (
    <div className="space-y-2">
      {/* Column headers (dates) */}
      <div className="grid gap-px" style={{ gridTemplateColumns: `80px repeat(${weeks.length}, 1fr)` }}>
        <div />
        {weeks.map(w => (
          <div key={w.date} className="text-[8px] font-mono text-slate-600 text-center truncate px-0.5">
            {w.date.slice(5)} {/* MM-DD */}
          </div>
        ))}
      </div>

      {/* Category rows */}
      {CATEGORY_ORDER.map(cat => (
        <div key={cat} className="grid gap-px items-center" style={{ gridTemplateColumns: `80px repeat(${weeks.length}, 1fr)` }}>
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-mono font-bold text-slate-600 uppercase">{cat}</span>
          </div>
          {weeks.map(w => {
            const catSigs = w.signals.filter(s => s.category === cat);
            const sev     = topSeverity(catSigs);
            return (
              <div
                key={w.date}
                title={catSigs.length ? `${catSigs.length} signal${catSigs.length > 1 ? "s" : ""}` : "—"}
                className={`h-5 rounded-sm flex items-center justify-center text-[8px] font-bold ${HEATMAP_SEVERITY_BG[sev]}`}
              >
                {catSigs.length > 0 ? catSigs.length : "·"}
              </div>
            );
          })}
        </div>
      ))}

      {/* Score bar at the bottom */}
      <div className="grid gap-px items-center mt-1" style={{ gridTemplateColumns: `80px repeat(${weeks.length}, 1fr)` }}>
        <div className="text-[8px] font-mono text-slate-600 uppercase">NY score</div>
        {weeks.map(w => {
          const z = scoreZone(w.scoreNY);
          return (
            <div key={w.date} className="flex flex-col items-center gap-0.5">
              <div className="text-[8px] font-mono font-bold" style={{ color: ZONE_COLOR[z] }}>
                {w.scoreNY > 0 ? `+${w.scoreNY}` : w.scoreNY}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-px items-center" style={{ gridTemplateColumns: `80px repeat(${weeks.length}, 1fr)` }}>
        <div className="text-[8px] font-mono text-slate-600 uppercase">LDN score</div>
        {weeks.map(w => {
          const z = scoreZone(w.scoreLDN);
          return (
            <div key={w.date} className="flex flex-col items-center gap-0.5">
              <div className="text-[8px] font-mono font-bold" style={{ color: ZONE_COLOR[z] }}>
                {w.scoreLDN > 0 ? `+${w.scoreLDN}` : w.scoreLDN}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Step8Analysis({
  signals,
  historicalSignals,
}: {
  signals: Signal[];
  historicalSignals?: HistoricalWeek[];
}) {
  const alerts = signals.filter(s => s.severity === "alert").length;
  const warns  = signals.filter(s => s.severity === "warn").length;
  const infos  = signals.filter(s => s.severity === "info").length;

  const { scoreNY, scoreLDN } = computeCompositeScores(signals);

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

      {/* Composite score gauges */}
      <div className="flex gap-3 flex-wrap">
        <CompositeGauge label="KC · Arabica (NY)" score={scoreNY}  />
        <CompositeGauge label="RC · Robusta (LDN)" score={scoreLDN} />
      </div>

      {/* 8-week signal history */}
      {historicalSignals && historicalSignals.length > 0 && (
        <div className="bg-slate-800/30 rounded-lg border border-slate-700/50 p-3">
          <div className="text-[10px] text-slate-500 font-medium mb-3 uppercase tracking-wide">
            8-Week Signal History
          </div>
          <HistoricalHeatmap history={historicalSignals} />
        </div>
      )}

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
                  {/* Rule ID · name · market badge · score */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="text-[9px] font-mono text-slate-600">{sig.id}</span>
                    <span className={`text-[11px] font-semibold ${SEVERITY_LABEL[sig.severity]}`}>
                      {sig.name}
                    </span>
                    <span className={`text-[9px] px-1.5 py-px rounded font-medium ${MARKET_BADGE[sig.market]}`}>
                      {MARKET_LABEL[sig.market]}
                    </span>
                    {sig.score !== 0 && (
                      <span className={`text-[9px] font-mono font-bold ml-auto ${sig.score > 0 ? "text-green-400" : "text-red-400"}`}>
                        {sig.score > 0 ? `+${sig.score}` : sig.score}
                      </span>
                    )}
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
