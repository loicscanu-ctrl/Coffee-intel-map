"use client";
// Shared typography + layout helpers for the Research "methodology paper"
// components. Dark-theme, mirrors the inline helpers in ResearchView.tsx so the
// new papers read identically to the existing ones.

export function H2({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-bold text-slate-100 mt-7 mb-1 pb-1 border-b border-slate-700">{children}</h3>;
}
export function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
export function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs text-slate-300 leading-relaxed mb-2${className ? ` ${className}` : ""}`}>{children}</p>;
}
export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1 mb-2">{children}</ul>;
}
export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-slate-300 leading-relaxed">
      <span className="text-amber-500/70">•</span><span>{children}</span>
    </li>
  );
}
export function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">{children}</code>;
}
// Block-level formula / pseudo-code, monospace on a tinted panel.
export function Fml({ children }: { children: React.ReactNode }) {
  return (
    <pre className="font-mono text-[11px] leading-relaxed bg-slate-800/70 border border-slate-700/60 rounded px-3 py-2 my-2 text-amber-200 whitespace-pre-wrap">
      {children}
    </pre>
  );
}
export function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-500/10 border-l-4 border-amber-400/70 rounded-r p-3 my-3 text-xs text-slate-300 italic leading-relaxed">
      {children}
    </div>
  );
}

// Outer card for a methodology paper.
export function Paper({ kicker, title, subtitle, children }: {
  kicker: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-3xl">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">{kicker}</div>
      <h3 className="text-xl font-bold text-slate-100 leading-tight mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-slate-400 mb-2">{subtitle}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

// Simple 2- or 3-column reference table.
export function RefTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
            {head.map((h, i) => (
              <th key={i} className={`pb-1.5 pr-4${i > 0 ? " text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-800">
              {r.map((c, ci) => (
                <td key={ci} className={`py-1.5 pr-4 ${ci === 0 ? "text-slate-200 font-semibold" : "text-right font-mono text-slate-300"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
