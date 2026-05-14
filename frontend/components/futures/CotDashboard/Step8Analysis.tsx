"use client";
import { useState } from "react";
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

// ── Signal card colors: direction-first, severity for intensity ───────────────

function cardClass(sig: Signal): string {
  if (sig.score > 0) {
    if (sig.severity === "alert") return "border-green-500/60 bg-green-900/15";
    if (sig.severity === "warn")  return "border-green-500/40 bg-green-900/10";
    return "border-green-800/40 bg-green-900/5";
  }
  if (sig.score < 0) {
    if (sig.severity === "alert") return "border-red-500/50 bg-red-900/10";
    if (sig.severity === "warn")  return "border-red-500/30 bg-red-900/8";
    return "border-red-700/30 bg-red-900/5";
  }
  if (sig.severity === "alert") return "border-amber-500/40 bg-amber-900/10";
  if (sig.severity === "warn")  return "border-amber-500/30 bg-amber-900/5";
  return "border-slate-600/50 bg-slate-800/30";
}

function dotClass(sig: Signal): string {
  if (sig.score > 0) return sig.severity === "alert" ? "bg-green-400 shadow-[0_0_6px_#4ade80]" : "bg-green-500";
  if (sig.score < 0) return sig.severity === "alert" ? "bg-red-400 shadow-[0_0_6px_#f87171]"  : "bg-red-500";
  return sig.severity === "alert" ? "bg-amber-400" : sig.severity === "warn" ? "bg-amber-500" : "bg-slate-500";
}

function nameClass(sig: Signal): string {
  if (sig.score > 0) return "text-green-400";
  if (sig.score < 0) return "text-red-400";
  return sig.severity === "alert" ? "text-amber-400" : "text-slate-400";
}

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
  "strongly-bearish": "#ef4444",
  "bearish":          "#f97316",
  "neutral":          "#94a3b8",
  "bullish":          "#22c55e",
  "strongly-bullish": "#10b981",
};

const ZONE_LABEL: Record<ScoreZone, string> = {
  "strongly-bearish": "Strongly Bearish",
  "bearish":          "Bearish",
  "neutral":          "Neutral",
  "bullish":          "Bullish",
  "strongly-bullish": "Strongly Bullish",
};

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
      <div className="relative h-2 rounded-full bg-slate-700 overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-500 z-10" />
        {score >= 0 ? (
          <div className="absolute top-0 bottom-0 rounded-r-full"
            style={{ left: "50%", width: `${fill - 50}%`, backgroundColor: color }} />
        ) : (
          <div className="absolute top-0 bottom-0 rounded-l-full"
            style={{ right: `${100 - fill}%`, width: `${50 - fill}%`, backgroundColor: color }} />
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

const HEATMAP_SEV_BG: Record<SignalSeverity | "none", string> = {
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

function fmt(score: number) { return score > 0 ? `+${score}` : String(score); }

function HeatmapMarketCols({ weeks, market }: { weeks: HistoricalWeek[]; market: "NY" | "LDN" }) {
  const n = weeks.length;
  return (
    <div className="flex-1 min-w-0 space-y-px">
      {/* Date headers */}
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {weeks.map(w => (
          <div key={w.date} className="text-[8px] font-mono text-slate-600 text-center truncate">
            {w.date.slice(5)}
          </div>
        ))}
      </div>
      {/* Category rows */}
      {CATEGORY_ORDER.map(cat => (
        <div key={cat} className="grid gap-px" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {weeks.map(w => {
            const sigs = w.signals.filter(s => s.category === cat && s.market === market);
            const sev  = topSeverity(sigs);
            return (
              <div key={w.date}
                title={sigs.length ? `${sigs.length} signal${sigs.length > 1 ? "s" : ""}` : "—"}
                className={`h-5 rounded-sm flex items-center justify-center text-[8px] font-bold ${HEATMAP_SEV_BG[sev]}`}>
                {sigs.length > 0 ? sigs.length : "·"}
              </div>
            );
          })}
        </div>
      ))}
      {/* Score row */}
      <div className="grid gap-px mt-0.5" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {weeks.map(w => {
          const score = market === "NY" ? w.scoreNY : w.scoreLDN;
          const z     = scoreZone(score);
          return (
            <div key={w.date} className="text-[8px] font-mono font-bold text-center h-4 flex items-center justify-center"
              style={{ color: ZONE_COLOR[z] }}>
              {fmt(score)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoricalHeatmap({ history }: { history: HistoricalWeek[] }) {
  const weeks = history.slice(-8);
  if (!weeks.length) return null;

  // Row height constants to keep labels in sync:
  // 1 date header row (h-4) + 11 category rows (h-5 + gap-px each) + 1 score row (h-4)
  return (
    <div className="flex gap-2 overflow-x-auto">
      {/* Shared row labels */}
      <div className="shrink-0 flex flex-col">
        <div className="h-4" />{/* date header spacer */}
        {CATEGORY_ORDER.map(cat => (
          <div key={cat} className="h-5 mb-px flex items-center">
            <span className="text-[8px] text-slate-500 pr-2 whitespace-nowrap">
              {CATEGORY_LABELS[cat]}
            </span>
          </div>
        ))}
        <div className="h-4 mt-0.5 flex items-center">
          <span className="text-[8px] font-mono text-slate-600 uppercase pr-2">Score</span>
        </div>
      </div>

      {/* KC columns */}
      <div className="flex-1 min-w-0 space-y-0">
        <div className="text-[9px] text-blue-400 font-semibold text-center mb-0.5">KC · Arabica</div>
        <HeatmapMarketCols weeks={weeks} market="NY" />
      </div>

      {/* Divider */}
      <div className="w-px bg-slate-700/50 self-stretch mx-1" />

      {/* RC columns */}
      <div className="flex-1 min-w-0 space-y-0">
        <div className="text-[9px] text-violet-400 font-semibold text-center mb-0.5">RC · Robusta</div>
        <HeatmapMarketCols weeks={weeks} market="LDN" />
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
  const [showInfo, setShowInfo] = useState(false);

  const alerts = signals.filter(s => s.severity === "alert").length;
  const warns  = signals.filter(s => s.severity === "warn").length;
  const infos  = signals.filter(s => s.severity === "info").length;

  const { scoreNY, scoreLDN } = computeCompositeScores(signals);

  const visible = showInfo ? signals : signals.filter(s => s.severity !== "info");

  function buildGroups(market: SignalMarket) {
    return CATEGORY_ORDER
      .map(cat => ({
        cat,
        label: CATEGORY_LABELS[cat],
        sigs:  visible.filter(s => s.category === cat && s.market === market),
      }))
      .filter(g => g.sigs.length > 0);
  }
  const kcGroups = buildGroups("NY");
  const rcGroups = buildGroups("LDN");

  return (
    <div id="cot-section-8" className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Rule-Based Signal Analysis</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            59 rules · proxies: pmpuShort = producers, pmpuLong = roasters · 52-week percentiles
          </p>
        </div>
        <div className="flex gap-2 text-[10px] flex-wrap items-center">
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
            <button
              onClick={() => setShowInfo(v => !v)}
              className={`px-2 py-0.5 rounded-full border font-medium transition-colors ${
                showInfo
                  ? "bg-slate-700 text-slate-300 border-slate-500"
                  : "bg-slate-800/60 text-slate-600 border-slate-700 hover:text-slate-400"
              }`}
            >
              {infos} info {showInfo ? "▲" : "▼"}
            </button>
          )}
          {signals.length === 0 && <span className="text-slate-500">No signals triggered</span>}
        </div>
      </div>

      {/* Composite score gauges */}
      <div className="flex gap-3 flex-wrap">
        <CompositeGauge label="KC · Arabica (NY)"  score={scoreNY}  />
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

      {/* Two-column signal layout */}
      <div className="grid grid-cols-2 gap-4 items-start">
        {(["NY", "LDN"] as const).map(mkt => {
          const isNY      = mkt === "NY";
          const groups    = isNY ? kcGroups : rcGroups;
          const colTitle  = isNY ? "KC · Arabica"    : "RC · Robusta";
          const colBorder = isNY ? "border-blue-900/40"   : "border-violet-900/40";
          const colText   = isNY ? "text-blue-400"        : "text-violet-400";
          return (
            <div key={mkt} className="space-y-3">
              <div className={`text-[10px] font-semibold uppercase tracking-wide px-1 border-b pb-1 ${colText} ${colBorder}`}>
                {colTitle}
              </div>

              {groups.length === 0 && (
                <div className="text-[10px] text-slate-600 px-1">No active signals</div>
              )}

              {groups.map(({ cat, label, sigs }) => (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] text-slate-400 font-medium">{label}</span>
                    <div className="flex-1 h-px bg-slate-800" />
                    <span className="text-[10px] text-slate-600">{sigs.length}</span>
                  </div>

                  {sigs.map(sig => (
                    <div key={sig.id}
                      className={`flex gap-2 items-start p-2 rounded-lg border ${cardClass(sig)}`}>
                      <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${dotClass(sig)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className={`text-[11px] font-semibold ${nameClass(sig)}`}>
                            {sig.name}
                          </span>
                          {sig.score !== 0 && (
                            <span className={`text-[9px] font-mono font-bold ml-auto ${sig.score > 0 ? "text-green-400" : "text-red-400"}`}>
                              {fmt(sig.score)}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed">{sig.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {signals.length === 0 && (
        <div className="text-center text-slate-600 text-xs py-8">
          No signals triggered — insufficient data or all positions within flat threshold.
        </div>
      )}
    </div>
  );
}
