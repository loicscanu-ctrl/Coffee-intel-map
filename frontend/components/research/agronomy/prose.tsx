"use client";
import { ResearchCard, type Tone } from "../methodology/prose";

// Shared typography + card helpers for the agronomy articles
// (mirror ResearchView.tsx pattern).
export function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-300 leading-relaxed mb-2">{children}</p>;
}
export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-slate-300 leading-relaxed">
      <span className="text-amber-500/70">•</span><span>{children}</span>
    </li>
  );
}
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">
      {children}
    </code>
  );
}

// ── Expand/collapse article card ──────────────────────────────────────────────
// Delegates to the unified ResearchCard shell so collapsed size matches every
// other research article; the briefing paragraph now opens WITH the body
// (subtitle carries the one-line teaser).
export function AgronomyCard({ kicker, title, subtitle, briefing, tone = "green", updated = "2026-07-14", children }: {
  kicker: string;
  title: string;
  subtitle?: string;
  briefing: React.ReactNode;
  tone?: Tone;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <ResearchCard tone={tone} kicker={kicker} title={title} subtitle={subtitle} updated={updated}>
      <div className="text-xs text-slate-300 leading-relaxed mb-3 border-l-2 border-slate-700/60 pl-3 italic">{briefing}</div>
      <div className="space-y-5">{children}</div>
    </ResearchCard>
  );
}
