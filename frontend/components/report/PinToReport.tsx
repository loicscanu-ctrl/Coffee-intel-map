"use client";
/**
 * 📌 Pin to Daily Report — drop this on any in-app chart whose ID lives in the
 * report registry. It toggles the chart in the cart store, so browsing the
 * COT/Supply/Demand tabs and pinning a visual routes it straight to the Report
 * Builder on the News tab. Renders nothing for IDs not in the registry.
 */
import { useEffect, useState } from "react";
import { useReportStore } from "@/lib/report/store";
import { REPORT_BY_ID } from "@/lib/report/registry";

export default function PinToReport({ id, className = "" }: { id: string; className?: string }) {
  const selected = useReportStore((s) => s.selectedIds.includes(id));
  const toggle = useReportStore((s) => s.toggle);

  // Persisted store only exists client-side — gate to avoid hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!REPORT_BY_ID[id]) return null;
  const on = mounted && selected;

  return (
    <button
      onClick={() => toggle(id)}
      title={on ? "Pinned to Daily Report — click to remove" : "Pin to Daily Report"}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors
        ${on
          ? "border-amber-600/60 bg-amber-500/15 text-amber-300"
          : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600"} ${className}`}
    >
      <span aria-hidden>📌</span>
      {on ? "Pinned" : "Pin to report"}
    </button>
  );
}
