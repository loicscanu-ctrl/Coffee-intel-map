"use client";
/**
 * Shared time-range selector for the ENSO command-center charts
 * (Niño 3.4 + SOI divergence, WWV subsurface). Single source of
 * truth — lifted to SupplyEnsoTab and passed down so all charts
 * read the same window.
 *
 * The thermocline card is not driven by this selector because it
 * only carries a ~75-day live window (no multi-year history in its
 * JSON yet). When the climatology backfill ships, it'll plug in
 * here too.
 *
 * Presets in months. "ALL" means "render every row the JSON has";
 * the chart components handle that as a no-slice case so we don't
 * have to hardcode a back-of-history sentinel.
 */
import type { EnsoTimeRange } from "@/lib/ensoTimeRange";
import { ENSO_TIME_RANGES } from "@/lib/ensoTimeRange";

interface Props {
  value:    EnsoTimeRange;
  onChange: (next: EnsoTimeRange) => void;
}

export default function EnsoTimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 bg-slate-800 rounded-lg border border-slate-700 px-2 py-1.5 text-[10px] font-mono">
      <span className="text-slate-500 uppercase tracking-wide pr-1">Range</span>
      {ENSO_TIME_RANGES.map((r) => {
        const active = r.key === value;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(r.key)}
            className={
              "px-2 py-1 rounded transition-colors " +
              (active
                ? "bg-slate-200 text-slate-900 font-bold"
                : "text-slate-400 hover:bg-slate-700 hover:text-slate-200")
            }
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
