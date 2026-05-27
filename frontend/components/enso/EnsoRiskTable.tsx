"use client";
import { useMemo } from "react";
import { RISK_META, type EnsoRiskPin, type RiskLevel } from "@/lib/enso";

const LEVEL_ORDER: RiskLevel[] = ["high", "moderate", "low"];

export default function EnsoRiskTable({ pins }: { pins: EnsoRiskPin[] }) {
  const byCountry = useMemo(() => {
    const m = new Map<string, EnsoRiskPin[]>();
    for (const p of pins) {
      if (!m.has(p.country)) m.set(p.country, []);
      m.get(p.country)!.push(p);
    }
    // Worst-risk countries first, then by name.
    const sevOf = (ps: EnsoRiskPin[]) => Math.max(...ps.map((p) => p.severity));
    return Array.from(m.entries()).sort((a, b) => sevOf(b[1]) - sevOf(a[1]) || a[0].localeCompare(b[0]));
  }, [pins]);

  if (!pins || pins.length === 0) {
    return <div className="p-4 text-xs text-slate-500">No regional risk data.</div>;
  }

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">
        6-month crop-risk by growing region
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {byCountry.map(([country, regions]) => (
          <div key={country} className="bg-slate-900/60 rounded-md border border-slate-700/60 p-2">
            <div className="text-[11px] font-semibold text-slate-200 mb-1.5">{country}</div>
            <ul className="space-y-1">
              {regions
                .slice()
                .sort((a, b) => b.severity - a.severity)
                .map((r) => (
                  <li key={r.region} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                      <span className="text-slate-300 truncate">{r.region}</span>
                    </span>
                    <span className="text-slate-500 shrink-0">{r.driver}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 pt-1 text-[10px] text-slate-400">
        {LEVEL_ORDER.map((lvl) => (
          <span key={lvl} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: RISK_META[lvl].color }} />
            {RISK_META[lvl].label}
          </span>
        ))}
      </div>
    </div>
  );
}
