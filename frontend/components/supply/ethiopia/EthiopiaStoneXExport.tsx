"use client";
import { EXPORTS_OUTLOOK, FX_INFLATION, STONEX_META } from "./stonexSurvey";

const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";

export default function EthiopiaStoneXExport() {
  const e = EXPORTS_OUTLOOK;
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">2025/26 Export Outlook</div>
        <div className="text-[8px] text-slate-600">{STONEX_META.source} · {STONEX_META.cropYear}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">2024/25 record</div>
          <div className="text-white font-bold">{e.record2425.bagsM.toFixed(1)}M</div>
          <div className="text-[9px] text-slate-600">bags · ${e.record2425.revenueUsdBn.toFixed(2)}B</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">2025/26 forecast</div>
          <div className="text-white font-bold">{e.forecast2526.bagsM.toFixed(2)}M</div>
          <div className="text-[9px] font-semibold text-red-400">▼ {Math.abs(e.forecast2526.changePct)}% YoY</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">USD/Birr</div>
          <div className="text-white font-bold">{FX_INFLATION.birrPerUsd_2yAgo} → {FX_INFLATION.birrPerUsd_mar26}</div>
          <div className="text-[9px] font-semibold text-red-400">~{FX_INFLATION.depreciationPct}% (2y)</div>
        </div>
      </div>

      <div>
        <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">Why exports fall ~30%</div>
        <ul className="space-y-1">
          {e.drivers.map((d, i) => (
            <li key={i} className="flex gap-2 text-[10px] text-slate-300 leading-relaxed">
              <span className="text-amber-500/70">•</span><span>{d}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="text-[10px] text-amber-300/80 bg-amber-950/30 rounded px-2 py-1.5 border border-amber-900/40 leading-relaxed">
        {FX_INFLATION.summary}
      </div>
      <div className="text-[9px] text-slate-500">{e.ectaNote}</div>
    </div>
  );
}
