"use client";
import React, { useMemo } from "react";
import { CROP_MONTH_LABELS, CROP_MONTH_ORDER } from "./constants";
import { bagsToKT, cropYearKey, intensityColor } from "./helpers";
import type { VolumeSeries } from "./types";

export default function SeasonalityHeatmap({ series }: { series: VolumeSeries[] }) {
  const ROWS = 7;

  const { cropKeys, grid, latestCropMonth } = useMemo(() => {
    const byYear: Record<string, number[]> = {};
    series.forEach(r => {
      const ck  = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = Array(12).fill(0);
      byYear[ck][idx] += bagsToKT(r.total);
    });

    const sorted = Object.keys(byYear).sort();
    const shown  = sorted.slice(-ROWS);
    const currentCk = sorted[sorted.length - 1];

    const currentData = byYear[currentCk] ?? [];
    let lastIdx = -1;
    currentData.forEach((v, i) => { if (v > 0) lastIdx = i; });

    const grid = shown.map(ck => {
      const row = byYear[ck];
      const peak = Math.max(...row.filter(v => v > 0), 1);
      return { ck, cells: row.map(v => v > 0 ? v / peak : null), raw: row };
    });

    return { cropKeys: shown, grid, latestCropMonth: lastIdx };
  }, [series]);

  const currentCk = cropKeys[cropKeys.length - 1];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-200">Monthly Seasonality Heatmap</div>
        <div className="text-[10px] text-slate-500">
          Cell shade = volume relative to each year&apos;s peak month · dashed = not yet elapsed
        </div>
      </div>
      <div
        className="grid gap-[3px] text-[8px]"
        style={{ gridTemplateColumns: `44px repeat(12, 1fr)` }}
      >
        {/* Header row */}
        <div />
        {CROP_MONTH_LABELS.map(m => (
          <div key={m} className="text-center text-slate-500 pb-1">{m}</div>
        ))}

        {/* Data rows — newest first */}
        {[...grid].reverse().map(({ ck, cells, raw }) => (
          <React.Fragment key={ck}>
            <div
              className={`text-right pr-2 flex items-center justify-end ${
                ck === currentCk ? "text-slate-200 font-bold" : "text-slate-500"
              }`}
            >
              {ck.split("/")[1] ? `${ck.split("/")[0].slice(2)}/${ck.split("/")[1]}` : ck}
            </div>
            {cells.map((ratio, i) => {
              const isFuture = ck === currentCk && i > latestCropMonth;
              const kt       = Math.round(raw[i] * 10) / 10;
              const pct      = ratio !== null ? Math.round(ratio * 100) : null;
              return (
                <div
                  key={i}
                  title={ratio !== null ? `${CROP_MONTH_LABELS[i]}: ${kt}kt (${pct}% of peak)` : "No data"}
                  className={`h-5 rounded-[2px] ${isFuture ? "border border-dashed border-slate-700" : ""}`}
                  style={{
                    background: isFuture ? "#0f172a" : (ratio !== null ? intensityColor(ratio) : "#0f172a"),
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Color scale legend */}
      <div className="flex items-center gap-2 mt-3 text-[9px] text-slate-500">
        <span>Low</span>
        {[0.1, 0.3, 0.5, 0.68, 0.83, 0.95].map(r => (
          <div key={r} className="w-5 h-3 rounded-[2px]" style={{ background: intensityColor(r) }} />
        ))}
        <span>Peak</span>
      </div>
    </div>
  );
}
