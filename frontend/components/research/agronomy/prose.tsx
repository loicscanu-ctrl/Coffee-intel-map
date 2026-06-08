"use client";
import { useState } from "react";

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
export function AgronomyCard({ kicker, title, briefing, children }: {
  kicker: string;
  title: string;
  briefing: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-2">
        {kicker}
      </div>
      <h3 className="text-base font-bold text-slate-100 mb-3">{title}</h3>
      <div className="text-xs text-slate-300 leading-relaxed mb-3">{briefing}</div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-amber-400/80 hover:text-amber-400 transition-colors flex items-center gap-1"
      >
        {open ? "▲ Less detail" : "▼ Read more"}
      </button>
      {open && <div className="mt-4 space-y-5">{children}</div>}
    </div>
  );
}
