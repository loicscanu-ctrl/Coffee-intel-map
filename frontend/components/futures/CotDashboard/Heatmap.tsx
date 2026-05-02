"use client";
import { useState } from "react";
import { HM_CAT_COLORS } from "./constants";
import SectionHeader from "./SectionHeader";
import { MarketToggle } from "./Toggles";

export default function CotHeatmap({ data }: { data: any[] }) {
  const [market, setMarket] = useState<"ny" | "ldn">("ny");
  const [mode, setMode]     = useState<"net" | "long" | "short">("net");
  const weeks13 = data.slice(-13);
  const lsFields = [
    { label: "PMPU",      lf: "pmpuLong",   sf: "pmpuShort"   },
    { label: "Swap",      lf: "swapLong",   sf: "swapShort"   },
    { label: "MM",        lf: "mmLong",     sf: "mmShort"     },
    { label: "Other Rpt", lf: "otherLong",  sf: "otherShort"  },
    { label: "Non-Rep",   lf: "nonRepLong", sf: "nonRepShort" },
  ];
  const spreadFields = [
    { label: "MM Spr",    key: "mmSpread",    color: "#a78bfa" },
    { label: "Swap Spr",  key: "swapSpread",  color: "#34d399" },
    { label: "Other Spr", key: "otherSpread", color: "#67e8f9" },
  ];

  const gv = (d: any, field: string) => (d[market]?.[field] ?? 0) as number;

  const lsRows = lsFields.map(f => ({
    label: f.label,
    color: HM_CAT_COLORS[f.label] ?? "#64748b",
    vals: weeks13.map((d: any) => {
      if (mode === "long")  return gv(d, f.lf);
      if (mode === "short") return gv(d, f.sf);
      return gv(d, f.lf) - gv(d, f.sf);
    }),
  }));
  const spreadRows = spreadFields.map(f => ({
    label: f.label, color: f.color,
    vals: weeks13.map((d: any) => gv(d, f.key)),
  }));

  const cellBg = (val: number, min: number, max: number, isSpread: boolean): string => {
    if (max === min) return "#1e293b";
    if (isSpread) {
      const t = (val - min) / (max - min);
      return `rgba(167,139,250,${(0.12 + t * 0.65).toFixed(2)})`;
    }
    if (mode === "net") {
      const range = Math.max(Math.abs(min), Math.abs(max));
      if (!range) return "#1e293b";
      const t = val / range;
      return t >= 0
        ? `rgba(34,197,94,${(0.1 + t * 0.6).toFixed(2)})`
        : `rgba(239,68,68,${(0.1 + (-t) * 0.6).toFixed(2)})`;
    }
    const t = (val - min) / (max - min);
    return `rgba(99,102,241,${(0.1 + t * 0.65).toFixed(2)})`;
  };

  const renderRow = (row: { label: string; color: string; vals: number[] }, isSpread: boolean) => {
    const min = Math.min(...row.vals), max = Math.max(...row.vals);
    return (
      <div key={row.label} style={{ display: "grid", gridTemplateColumns: `72px repeat(${weeks13.length}, 1fr)`, gap: 2, marginBottom: 2 }}>
        <div style={{ fontSize: 10, color: row.color, fontWeight: 600, display: "flex", alignItems: "center" }}>{row.label}</div>
        {row.vals.map((val, wi) => {
          const isLast = wi === weeks13.length - 1;
          const range = isSpread ? (max - min) : mode === "net" ? Math.max(Math.abs(min), Math.abs(max)) : (max - min);
          const intensity = range > 0
            ? (isSpread ? (val - min) / range : mode === "net" ? Math.abs(val) / range : (val - min) / range)
            : 0;
          return (
            <div key={wi}
              title={`${row.label} ${weeks13[wi].date}: ${Math.round(val).toLocaleString()} lots`}
              style={{
                background: cellBg(val, min, max, isSpread),
                borderRadius: 3, height: 30,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9,
                color: intensity > 0.4 ? "rgba(255,255,255,0.9)" : "#475569",
                fontWeight: isLast ? 700 : 400,
                outline: isLast ? "2px solid #6366f1" : "none",
                outlineOffset: "-1px",
              }}>
              {Math.abs(val) >= 1000 ? (Math.abs(val) / 1000).toFixed(0) + "k" : Math.round(val)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <SectionHeader icon="Grid" title="2. 13-Week Positioning Heatmap"
        subtitle="Weekly position levels by category. Color intensity = level within each row's own 13-week range. Purple outline = latest week." />
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <MarketToggle markets={{ ny: market === "ny", ldn: market === "ldn" }} set={(m: string) => setMarket(m as "ny" | "ldn")} />
        <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(["net", "long", "short"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${mode === m ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              {m === "net" ? "Net" : m === "long" ? "Longs" : "Shorts"}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
        <div style={{ display: "grid", gridTemplateColumns: `72px repeat(${weeks13.length}, 1fr)`, gap: 2, marginBottom: 2 }}>
          <div />
          {weeks13.map((d: any, i: number) => (
            <div key={i} style={{ fontSize: 9, color: i === weeks13.length - 1 ? "#a5b4fc" : "#475569", textAlign: "center" }}>
              {String(d.date).slice(5)}
            </div>
          ))}
        </div>
        <div className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider mb-1">
          {mode === "net" ? "Net (L − S)" : mode === "long" ? "Longs" : "Shorts"}
        </div>
        {lsRows.map(row => renderRow(row, false))}
        <div style={{ borderTop: "1px dashed #334155", margin: "10px 0 6px" }} />
        <div className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider mb-1">Spreading</div>
        {spreadRows.map(row => renderRow(row, true))}
        <div className="text-[9px] text-slate-700 mt-2">Hover for exact lots · Colors normalized per row · Purple = latest week</div>
      </div>
    </>
  );
}
