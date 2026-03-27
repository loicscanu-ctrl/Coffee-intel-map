"use client";
import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart,
  ScatterChart, Scatter, Cell, PieChart, Pie, ReferenceLine, ReferenceArea, Label,
} from "recharts";
import { fetchCot, fetchMacroCot, type MacroCotWeek } from "@/lib/api";
import { buildGlobalFlowMetrics } from "@/lib/pdf/dataHelpers";
import type { GlobalFlowMetrics } from "@/lib/pdf/types";
import {
  ARABICA_MT_FACTOR,
  ROBUSTA_MT_FACTOR,
  MARGIN_OUTRIGHT,
  MARGIN_SPREAD,
  CENTS_LB_TO_USD_TON,
  transformApiData,
} from "@/lib/cot/transformApiData";
import { buildStandaloneHtml } from "@/lib/cot/standaloneTemplate";

// ── Types ──────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 5 | 6;

// ── Inline SVG icons ───────────────────────────────────────────────────────────
const ICONS: Record<string, React.ReactNode> = {
  Globe:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Factory:  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>,
  Droplets: <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7 2.9 7 2.9s-2.29 6.16-3.29 7.16C2.57 11.01 2 12.11 2 13.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 1 14 8c2 2 3 4.8 3 6.5s-1.8 3.5-4 3.5-4-1.5-4-3.5"/></svg>,
  Scale:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>,
  Grid:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  Sliders: <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
};

const NAV_STEPS = [
  { id: 1 as Step, icon: "Globe",    label: "Flow" },
  { id: 2 as Step, icon: "Grid",     label: "Heatmap" },
  { id: 3 as Step, icon: "Sliders",  label: "Gauges" },
  { id: 4 as Step, icon: "Factory",  label: "Industry" },
  { id: 5 as Step, icon: "Droplets", label: "Dry Powder" },
  { id: 6 as Step, icon: "Scale",    label: "Cycle" },
];

// ── Macro COT helpers ──────────────────────────────────────────────────────────
const SECTORS = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;
const SECTOR_COLORS: Record<string, string> = {
  energy: "#f97316",
  metals: "#6366f1",
  grains: "#f59e0b",
  meats:  "#ef4444",
  softs:  "#10b981",
  micros: "#8b5cf6",
};
const ENERGY_SYMBOLS = new Set(["wti", "brent", "natgas", "heating_oil", "rbob", "lsgo"]);

const SOFT_SYMBOLS: { key: string; label: string; color: string }[] = [
  { key: "arabica",     label: "Arabica Coffee",  color: "#f59e0b" },
  { key: "robusta",     label: "Robusta Coffee",  color: "#78350f" },
  { key: "sugar11",     label: "Sugar No. 11",    color: "#a3e635" },
  { key: "white_sugar", label: "White Sugar",     color: "#d1fae5" },
  { key: "cotton",      label: "Cotton",          color: "#60a5fa" },
  { key: "cocoa_ny",    label: "Cocoa NY",        color: "#a78bfa" },
  { key: "cocoa_ldn",   label: "Cocoa London",    color: "#7c3aed" },
  { key: "oj",          label: "Orange Juice",    color: "#fb923c" },
];

function transformMacroData(
  weeks: MacroCotWeek[],
  mode: "gross" | "gross_long" | "gross_short" | "net"
): { date: string; energy: number; metals: number; grains: number; meats: number; softs: number; micros: number; coffeeShare: number | null }[] {
  return weeks.map(week => {
    const sectorTotals: Record<string, number> = { energy: 0, metals: 0, grains: 0, meats: 0, softs: 0, micros: 0 };
    let coffeeGross = 0;
    let totalGross  = 0;
    let hasCoffeePrice = true;

    for (const c of week.commodities) {
      const g = c.gross_exposure_usd;
      const n = c.net_exposure_usd;
      const val =
        mode === "gross"       ? g :
        mode === "gross_long"  ? (g != null && n != null ? (g + n) / 2 : null) :
        mode === "gross_short" ? (g != null && n != null ? (g - n) / 2 : null) :
        n;

      if (val == null) continue;
      const valB = val / 1e9;
      // Split "hard" into energy vs metals
      const displaySector = c.sector === "hard"
        ? (ENERGY_SYMBOLS.has(c.symbol) ? "energy" : "metals")
        : c.sector;
      sectorTotals[displaySector] = (sectorTotals[displaySector] ?? 0) + valB;

      if (c.symbol === "arabica" || c.symbol === "robusta") {
        if (c.gross_exposure_usd == null) hasCoffeePrice = false;
        else coffeeGross += c.gross_exposure_usd;
      }
      if (c.gross_exposure_usd != null) totalGross += c.gross_exposure_usd;
    }

    const coffeeShare = (hasCoffeePrice && totalGross > 0)
      ? (coffeeGross / totalGross) * 100
      : null;

    return {
      date:   week.date,
      energy: sectorTotals.energy ?? 0,
      metals: sectorTotals.metals ?? 0,
      grains: sectorTotals.grains ?? 0,
      meats:  sectorTotals.meats  ?? 0,
      softs:  sectorTotals.softs  ?? 0,
      micros: sectorTotals.micros ?? 0,
      coffeeShare,
    };
  }).filter(row =>
    Math.abs(row.energy) + Math.abs(row.metals) + Math.abs(row.grains) +
    Math.abs(row.meats) + Math.abs(row.softs) + Math.abs(row.micros) > 0
  );
}

// ── Data generation ────────────────────────────────────────────────────────────
function generateData() {
  const weeks = 1040; // ~20 years
  const data: any[] = [];
  let priceNY = 130, priceLDN = 1800, oiNY = 180000, oiLDN = 110000;
  let cumulativeNominal = 0, cumulativeMargin = 0;

  for (let i = 0; i < weeks; i++) {
    // Start ~20 years ago (early 2006)
    const date = new Date(2006, 0, 1 + i * 7).toISOString().split("T")[0];
    priceNY  = Math.max(60,  Math.min(400, priceNY  + (Math.random() - 0.48) * 8));
    priceLDN = Math.max(800, Math.min(5000, priceLDN + (Math.random() - 0.48) * 60));
    oiNY     = Math.max(80000,  Math.min(380000, oiNY  + (Math.random() - 0.5) * 5000));
    oiLDN    = Math.max(50000,  Math.min(250000, oiLDN + (Math.random() - 0.5) * 3000));

    const spreadingNY  = Math.floor(oiNY  * (0.18 + Math.random() * 0.04));
    const spreadingLDN = Math.floor(oiLDN * (0.10 + Math.random() * 0.03));
    const totalOI = oiNY + oiLDN;
    const priceNY_USD_Ton = priceNY * CENTS_LB_TO_USD_TON;
    const avgPrice_USD_Ton = ((priceNY_USD_Ton * oiNY) + (priceLDN * oiLDN)) / totalOI;

    const deltaOINY  = i > 0 ? oiNY  - data[i-1].oiNY  : 0;
    const deltaOILDN = i > 0 ? oiLDN - data[i-1].oiLDN : 0;
    const flowNY  = (deltaOINY  * priceNY  * 375) / 1_000_000;
    const flowLDN = (deltaOILDN * priceLDN * 10)  / 1_000_000;
    const weeklyNominalFlow = flowNY + flowLDN;

    const prevSpread   = i > 0 ? data[i-1].spreadingTotal  : 0;
    const prevOutright = i > 0 ? data[i-1].outrightTotal   : 0;
    const deltaSpread  = (spreadingNY + spreadingLDN) - prevSpread;
    const deltaOutright = (totalOI - (spreadingNY + spreadingLDN)) - prevOutright;
    const weeklyMarginFlow = ((deltaOutright * MARGIN_OUTRIGHT) + (deltaSpread * MARGIN_SPREAD)) / 1_000_000;

    cumulativeNominal += weeklyNominalFlow;
    cumulativeMargin  += weeklyMarginFlow;

    const mkBreakdown = (oi: number, baseT: number) => ({
      oi: {
        pmpuLong:   oi * 0.05, pmpuShort:  oi * 0.45,
        mmLong:     oi * 0.175, mmShort:   oi * 0.075,
        swapLong:   oi * 0.06,  swapShort:  oi * 0.04,
        otherLong:  oi * 0.03,  otherShort: oi * 0.02,
        nonRepLong: oi * 0.05,  nonRepShort: oi * 0.05,
      },
      traders: {
        pmpu: Math.floor(baseT * 0.15), mm:     Math.floor(baseT * 0.15),
        swap: Math.floor(baseT * 0.05), other:  Math.floor(baseT * 0.10),
        nonrep: Math.floor(baseT * 0.55),
      },
    });

    const nyD  = mkBreakdown(oiNY,  200 + Math.floor(Math.random() * 50));
    const ldnD = mkBreakdown(oiLDN, 150 + Math.floor(Math.random() * 40));
    const efp  = Math.floor(Math.random() * 1500);

    const isLast  = i === weeks - 1;
    const isPrev1 = i === weeks - 2;
    const isPrev4 = i >= weeks - 6 && i <= weeks - 3;
    const isYear  = i >= weeks - 58 && i <= weeks - 7;

    data.push({
      id: i, date, priceNY, priceLDN, avgPrice_USD_Ton,
      oiNY, oiLDN, totalOI,
      spreadingTotal: spreadingNY + spreadingLDN,
      outrightTotal: (oiNY + oiLDN) - (spreadingNY + spreadingLDN),
      weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
      ny: nyD.oi, ldn: ldnD.oi,
      tradersNY: nyD.traders, tradersLDN: ldnD.traders,
      pmpuShortMT_NY:  nyD.oi.pmpuShort * ARABICA_MT_FACTOR,
      pmpuShortMT_LDN: ldnD.oi.pmpuShort * ROBUSTA_MT_FACTOR,
      pmpuShortMT:     (nyD.oi.pmpuShort * ARABICA_MT_FACTOR) + (ldnD.oi.pmpuShort * ROBUSTA_MT_FACTOR),
      pmpuLongMT_NY:   nyD.oi.pmpuLong  * ARABICA_MT_FACTOR,
      pmpuLongMT_LDN:  ldnD.oi.pmpuLong * ROBUSTA_MT_FACTOR,
      pmpuLongMT:      (nyD.oi.pmpuLong * ARABICA_MT_FACTOR) + (ldnD.oi.pmpuLong * ROBUSTA_MT_FACTOR),
      efpMT: efp * ARABICA_MT_FACTOR,
      timeframe: isLast ? "current" : isPrev1 ? "recent_1" : isPrev4 ? "recent_4" : isYear ? "year" : "historical",
    });
  }

  return data.map((d, i) => {
    const slice    = data.slice(Math.max(0, i - 260), i + 1);
    const maxP     = Math.max(...slice.map(s => s.priceNY));
    const minP     = Math.min(...slice.map(s => s.priceNY));
    const net      = d.ny.mmLong - d.ny.mmShort;
    const nets     = slice.map(s => s.ny.mmLong - s.ny.mmShort);
    const maxLP    = Math.max(...slice.map(s => s.priceLDN));
    const minLP    = Math.min(...slice.map(s => s.priceLDN));
    const netLDN   = d.ldn.mmLong - d.ldn.mmShort;
    const netsLDN  = slice.map(s => s.ldn.mmLong - s.ldn.mmShort);
    return {
      ...d,
      priceRank:    (maxP  - minP)  > 0 ? ((d.priceNY  - minP)  / (maxP  - minP))  * 100 : 50,
      oiRank:       (Math.max(...nets)  - Math.min(...nets))  > 0 ? ((net    - Math.min(...nets))   / (Math.max(...nets)   - Math.min(...nets)))   * 100 : 50,
      priceRankLDN: (maxLP - minLP) > 0 ? ((d.priceLDN - minLP) / (maxLP - minLP)) * 100 : 50,
      oiRankLDN:    (Math.max(...netsLDN) - Math.min(...netsLDN)) > 0 ? ((netLDN - Math.min(...netsLDN)) / (Math.max(...netsLDN) - Math.min(...netsLDN))) * 100 : 50,
    };
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 mb-5 border-b border-slate-800 pb-3">
      <div className="p-2 bg-slate-800 rounded-lg border border-slate-700 text-amber-500 shrink-0">
        {ICONS[icon]}
      </div>
      <div>
        <h3 className="text-base font-bold text-slate-100">{title}</h3>
        <p className="text-xs text-slate-400 max-w-xl">{subtitle}</p>
      </div>
    </div>
  );
}

type CpUnit = "contracts" | "mt" | "usd";

const CP_CATS: { name: string; longF: string | string[]; shortF: string | string[]; longC: string; shortC: string }[] = [
  { name: "PMPU",      longF: "pmpuLong",    shortF: "pmpuShort",    longC: "#92400e", shortC: "#92400e" },
  { name: "Swap",      longF: "swapLong",    shortF: "swapShort",    longC: "#10b981", shortC: "#10b981" },
  { name: "MM",        longF: "mmLong",      shortF: "mmShort",      longC: "#1e40af", shortC: "#1e40af" },
  { name: "Other Rpt", longF: "otherLong",   shortF: "otherShort",   longC: "#38bdf8", shortC: "#38bdf8" },
  { name: "Non-Rep",   longF: "nonRepLong",  shortF: "nonRepShort",  longC: "#64748b", shortC: "#64748b" },
];
const CP_SPREADS: { name: string; f: string; color: string }[] = [
  { name: "MM",    f: "mmSpread",    color: "#f59e0b" },
  { name: "Swap",  f: "swapSpread",  color: "#10b981" },
  { name: "Other", f: "otherSpread", color: "#64748b" },
];

function RadialCounterparty({
  latest, prev1, prev4, market, unit,
}: {
  latest: any;
  prev1: any | null;
  prev4: any | null;
  market: "ny" | "ldn";
  unit: CpUnit;
}) {
  const mtFactor = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
  const usdPerMT = market === "ny" ? latest.priceNY * CENTS_LB_TO_USD_TON : latest.priceLDN;

  const cv = (row: any, field: string | string[]): number => {
    const obj = row?.[market] ?? {};
    const contracts: number = Array.isArray(field)
      ? field.reduce((s: number, f: string) => s + (obj[f] ?? 0), 0)
      : (obj[field] ?? 0);
    if (unit === "contracts") return contracts;
    const mt = contracts * mtFactor;
    return unit === "mt" ? mt : mt * usdPerMT;
  };

  const gs = (row: any, f: string): number => row?.[market]?.[f] ?? 0;

  const fmtVal = (v: number): string => {
    if (unit === "usd") return `$${(v / 1_000_000_000).toFixed(2)}B`;
    if (unit === "mt")  return `${(v / 1_000).toFixed(0)}k MT`;
    return `${(v / 1_000).toFixed(0)}k lots`;
  };
  const fmtDelta = (v: number): string => {
    const sign = v >= 0 ? "+" : "";
    if (unit === "usd") return `${sign}$${(v / 1_000_000).toFixed(0)}M`;
    if (unit === "mt")  return `${sign}${(v / 1_000).toFixed(1)}k`;
    return `${sign}${(v / 1_000).toFixed(1)}k`;
  };
  const dc = (v: number | null, invert = false): string =>
    v == null ? "text-slate-600" : v === 0 ? "text-slate-500"
      : (invert ? v < 0 : v > 0) ? "text-emerald-400" : "text-red-400";

  const longData  = CP_CATS.map(c => ({ name: c.name + " Long",  value: cv(latest, c.longF),  fill: c.longC  }));
  const shortData = CP_CATS.map(c => ({ name: c.name + " Short", value: cv(latest, c.shortF), fill: c.shortC }));
  const pieData   = [...longData, ...shortData];
  const totalLong = longData.reduce((s, d) => s + d.value, 0);
  const oiTotal   = (market === "ny" ? latest.oiNY : latest.oiLDN) ?? 0;

  const totalSpread     = CP_SPREADS.reduce((s, c) => s + gs(latest, c.f), 0);
  const prevTotalSpread = prev1 ? CP_SPREADS.reduce((s, c) => s + gs(prev1, c.f), 0) : null;
  const spreadWow       = prevTotalSpread != null ? totalSpread - prevTotalSpread : null;

  const tooltipStyle = { backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px" };

  return (
    <div>
      {/* Combined half/half donut: longs on left, shorts on right */}
      <div className="relative h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%"
              startAngle={90} endAngle={450}
              innerRadius={46} outerRadius={82} paddingAngle={1} dataKey="value">
              {pieData.map((_: any, i: number) => <Cell key={i} fill={pieData[i].fill} stroke="rgba(0,0,0,0)" />)}
              <Label value={fmtVal(totalLong)} position="center" fill="#f1f5f9" fontSize={11} fontWeight="bold" dy={-7} />
              <Label value={`OI: ${(oiTotal / 1000).toFixed(0)}k`} position="center" fill="#94a3b8" fontSize={9} dy={7} />
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ fontSize: 10 }}
              formatter={(v: any, name: any) => [fmtVal(Number(v)), name]} />
          </PieChart>
        </ResponsiveContainer>
        <span className="absolute text-[8px] font-bold text-emerald-400 uppercase" style={{ top: "50%", left: 4, transform: "translateY(-50%)" }}>← L</span>
        <span className="absolute text-[8px] font-bold text-red-400 uppercase" style={{ top: "50%", right: 4, transform: "translateY(-50%)" }}>S →</span>
      </div>

      {/* Delta table: L 1W | L 4W | S 1W | S 4W per category */}
      <div className="mt-1">
        <div className="grid pb-1 border-b border-slate-700/50 gap-1" style={{ gridTemplateColumns: "auto 1fr 1fr 1fr 1fr" }}>
          <span></span>
          <span className="text-[8px] text-emerald-700 font-bold text-center uppercase">L 1W</span>
          <span className="text-[8px] text-emerald-700 font-bold text-center uppercase">L 4W</span>
          <span className="text-[8px] text-red-700 font-bold text-center uppercase">S 1W</span>
          <span className="text-[8px] text-red-700 font-bold text-center uppercase">S 4W</span>
        </div>
        {CP_CATS.map(cat => {
          const ld1 = prev1 ? cv(latest, cat.longF)  - cv(prev1, cat.longF)  : null;
          const ld4 = prev4 ? cv(latest, cat.longF)  - cv(prev4, cat.longF)  : null;
          const sd1 = prev1 ? cv(latest, cat.shortF) - cv(prev1, cat.shortF) : null;
          const sd4 = prev4 ? cv(latest, cat.shortF) - cv(prev4, cat.shortF) : null;
          return (
            <div key={cat.name} className="grid gap-1 py-0.5 items-center" style={{ gridTemplateColumns: "auto 1fr 1fr 1fr 1fr" }}>
              <div className="flex items-center gap-1 pr-2">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat.longC }} />
                <span className="text-[8px] text-slate-400">{cat.name}</span>
              </div>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(ld1)}`}>{ld1 == null ? "—" : fmtDelta(ld1)}</span>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(ld4)}`}>{ld4 == null ? "—" : fmtDelta(ld4)}</span>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(sd1, true)}`}>{sd1 == null ? "—" : fmtDelta(sd1)}</span>
              <span className={`text-[9px] font-semibold text-center tabular-nums ${dc(sd4, true)}`}>{sd4 == null ? "—" : fmtDelta(sd4)}</span>
            </div>
          );
        })}
      </div>

      {/* Spreading section */}
      <div className="mt-3 pt-2 border-t border-slate-700/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Spreading</span>
          <span className="text-[9px] text-slate-500">
            {(totalSpread / 1000).toFixed(1)}k lots
            {spreadWow != null && (
              <span className={`ml-1 font-bold ${spreadWow > 0 ? "text-emerald-400" : spreadWow < 0 ? "text-red-400" : "text-slate-500"}`}>
                ({spreadWow >= 0 ? "+" : ""}{(spreadWow / 1000).toFixed(1)}k WoW)
              </span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-3 text-[8px] text-slate-500 font-bold uppercase pb-0.5 border-b border-slate-700/50 gap-1">
          <span></span>
          <span className="text-center">Lots</span>
          <span className="text-center">WoW</span>
        </div>
        {CP_SPREADS.map(cat => {
          const cur = gs(latest, cat.f);
          const wow = prev1 ? cur - gs(prev1, cat.f) : null;
          return (
            <div key={cat.name} className="grid grid-cols-3 items-center gap-1 py-0.5">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-[8px] text-slate-400">{cat.name}</span>
              </div>
              <span className="text-[9px] text-slate-300 text-center tabular-nums">{(cur / 1000).toFixed(1)}k</span>
              <span className={`text-[9px] text-center tabular-nums ${wow == null ? "text-slate-600" : wow > 0 ? "text-emerald-400" : wow < 0 ? "text-red-400" : "text-slate-500"}`}>
                {wow == null ? "—" : (wow >= 0 ? "+" : "") + (wow / 1000).toFixed(1) + "k"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Toggle button helpers ──────────────────────────────────────────────────────

function MarketToggle({ markets, set }: { markets: Record<string, boolean>; set: (k: string) => void }) {
  return (
    <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
      {(["ny", "ldn"] as const).map(m => (
        <button key={m} onClick={() => set(m)}
          className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${markets[m] ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
          {m === "ny" ? "NY Arabica" : "LDN Robusta"}
        </button>
      ))}
    </div>
  );
}

function CatToggles({ cats, set, items }: { cats: Record<string, boolean>; set: (k: string) => void; items: { k: string; l: string; c: string }[] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {items.map(cat => (
        <button key={cat.k} onClick={() => set(cat.k)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase transition-all ${cats[cat.k] ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-transparent border-slate-800 text-slate-600"}`}>
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cats[cat.k] ? cat.c : "transparent", border: cats[cat.k] ? "none" : `1px solid ${cat.c}` }} />
          {cat.l}
        </button>
      ))}
    </div>
  );
}

const CAT_ITEMS = [
  { k: "pmpu",   l: "PMPU",          c: "#3b82f6" },
  { k: "mm",     l: "Managed Money", c: "#f59e0b" },
  { k: "swap",   l: "Swap/Index",    c: "#10b981" },
  { k: "other",  l: "Other Rept",    c: "#64748b" },
  { k: "nonrep", l: "Non Rept",      c: "#94a3b8" },
];

const CHART_STYLE = { backgroundColor: "#0f172a", borderColor: "#334155" };

// ── Attribution Table helpers (HTML inline styles — NOT react-pdf styles) ──────
const SECTOR_ORDER_ATTR = ["energy", "metals", "grains", "meats", "softs", "micros"] as const;
const SECTOR_LABELS_ATTR: Record<string, string> = {
  energy: "Energy", metals: "Metals", grains: "Grains",
  meats: "Meats", softs: "Softs", micros: "Micros",
};
function fmtAttr(n: number | null): string {
  if (n == null) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "B";
}
function attrColor(n: number | null): string {
  if (n == null) return "#6b7280";
  return n >= 0 ? "#10b981" : "#ef4444";
}

function AttributionTable({ gfm }: { gfm: GlobalFlowMetrics }) {
  // Sort commodity rows: by sector order, then by absolute deltaB descending within sector
  const sortedRows = [...gfm.commodityTable].sort((a, b) => {
    const ai = SECTOR_ORDER_ATTR.indexOf(a.displaySector as (typeof SECTOR_ORDER_ATTR)[number]);
    const bi = SECTOR_ORDER_ATTR.indexOf(b.displaySector as (typeof SECTOR_ORDER_ATTR)[number]);
    if (ai !== bi) return ai - bi;
    return Math.abs(b.deltaB) - Math.abs(a.deltaB);
  });

  const headerCell = (align: "left" | "right" = "right"): React.CSSProperties => ({
    padding: "4px 8px", fontSize: 10, color: "#9ca3af", fontWeight: 600,
    textAlign: align, borderBottom: "1px solid #374151", whiteSpace: "nowrap",
  });
  const dataCell = (color: string, bold = false): React.CSSProperties => ({
    padding: "3px 8px", fontSize: 10, color, textAlign: "right",
    fontWeight: bold ? 700 : 400, fontFamily: "monospace",
  });
  const nameCell = (bold = false, color = "#e5e7eb"): React.CSSProperties => ({
    padding: "3px 8px 3px 16px", fontSize: 10, color, fontWeight: bold ? 700 : 400,
    textAlign: "left",
  });

  const grouped = SECTOR_ORDER_ATTR.map(sector => ({
    sector,
    label: SECTOR_LABELS_ATTR[sector],
    sd: gfm.sectorBreakdown.find(s => s.sector === sector) ?? null,
    rows: sortedRows.filter(r => r.displaySector === sector),
  })).filter(g => g.rows.length > 0);

  return (
    <div style={{ overflowX: "auto", marginTop: 4 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ background: "#0f172a" }}>
            <th style={headerCell("left")}>Commodity</th>
            <th style={headerCell()}>Gross $B</th>
            <th style={headerCell()}>Gross WoW $B</th>
            <th style={headerCell()}>OI Δ</th>
            <th style={headerCell()}>Px Δ</th>
            <th style={headerCell()}>Net $B</th>
            <th style={headerCell()}>Net WoW $B</th>
            <th style={headerCell()}>OI Δ</th>
            <th style={headerCell()}>Px Δ</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ sector, label, sd, rows: sectorRows }) => (
            <React.Fragment key={sector}>
              {sd && (
                <tr style={{ background: "#1e293b" }}>
                  <td style={{ ...nameCell(true, "#f9fafb"), paddingLeft: 8 }}>{label}</td>
                  <td style={dataCell(attrColor(sd.grossB), true)}>{fmtAttr(sd.grossB)}</td>
                  <td style={dataCell(attrColor(sd.deltaB), true)}>{fmtAttr(sd.deltaB)}</td>
                  <td style={dataCell(attrColor(sd.grossOiEffectB), true)}>{fmtAttr(sd.grossOiEffectB)}</td>
                  <td style={dataCell(attrColor(sd.grossPriceEffectB), true)}>{fmtAttr(sd.grossPriceEffectB)}</td>
                  <td style={dataCell(attrColor(sd.netB), true)}>{fmtAttr(sd.netB)}</td>
                  <td style={dataCell(attrColor(sd.netDeltaB), true)}>{fmtAttr(sd.netDeltaB)}</td>
                  <td style={dataCell(attrColor(sd.netOiEffectB), true)}>{fmtAttr(sd.netOiEffectB)}</td>
                  <td style={dataCell(attrColor(sd.netPriceEffectB), true)}>{fmtAttr(sd.netPriceEffectB)}</td>
                </tr>
              )}
              {sectorRows.map((row, idx) => (
                <tr key={row.symbol} style={{ background: idx % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={nameCell(row.isCoffee, row.isCoffee ? "#f59e0b" : "#d1d5db")}>
                    {row.isCoffee ? "► " : ""}{row.name}
                  </td>
                  <td style={dataCell(attrColor(row.grossB))}>{fmtAttr(row.grossB)}</td>
                  <td style={dataCell(attrColor(row.deltaB))}>{fmtAttr(row.deltaB)}</td>
                  <td style={dataCell(attrColor(row.grossOiEffectB))}>{fmtAttr(row.grossOiEffectB)}</td>
                  <td style={dataCell(attrColor(row.grossPriceEffectB))}>{fmtAttr(row.grossPriceEffectB)}</td>
                  <td style={dataCell(attrColor(row.netB))}>{fmtAttr(row.netB)}</td>
                  <td style={dataCell(attrColor(row.netDeltaB))}>{fmtAttr(row.netDeltaB)}</td>
                  <td style={dataCell(attrColor(row.netOiEffectB))}>{fmtAttr(row.netOiEffectB)}</td>
                  <td style={dataCell(attrColor(row.netPriceEffectB))}>{fmtAttr(row.netPriceEffectB)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Constants for sections 2 & 3 ───────────────────────────────────────────────
const HM_CAT_COLORS: Record<string, string> = {
  "PMPU": "#92400e", "Swap": "#10b981", "MM": "#1e40af",
  "Other Rpt": "#38bdf8", "Non-Rep": "#64748b",
};

// ── Section 2: 13-Week Heatmap ─────────────────────────────────────────────────
function CotHeatmap({ data }: { data: any[] }) {
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

// ── Section 3: 52-Week Positioning Gauges ──────────────────────────────────────
function CotGauges({ data }: { data: any[] }) {
  const [market, setMarket] = useState<"ny" | "ldn">("ny");
  const hist52 = data.slice(-52);
  const curr = hist52[hist52.length - 1];
  const prev = hist52.length >= 2 ? hist52[hist52.length - 2] : null;

  type GRData = { label: string; color: string; curr: number; prev: number; min: number; max: number; pct: number; isSpread?: boolean };

  const mkRow = (label: string, cat: string, field: string, isSpread?: boolean): GRData => {
    const vals = hist52.map((d: any) => (d[market]?.[field] ?? 0) as number);
    const min = Math.min(...vals), max = Math.max(...vals);
    const cv = curr[market]?.[field] ?? 0;
    const pv = prev?.[market]?.[field] ?? cv;
    return { label, color: HM_CAT_COLORS[cat] ?? "#64748b", curr: cv, prev: pv, min, max,
      pct: max > min ? (cv - min) / (max - min) * 100 : 50, isSpread };
  };

  const longRows: GRData[]  = [
    mkRow("PMPU Long",    "PMPU",      "pmpuLong"),
    mkRow("Swap Long",    "Swap",      "swapLong"),
    mkRow("MM Long",      "MM",        "mmLong"),
    mkRow("Other Long",   "Other Rpt", "otherLong"),
    mkRow("Non-Rep Long", "Non-Rep",   "nonRepLong"),
  ];
  const shortRows: GRData[] = [
    mkRow("PMPU Short",    "PMPU",      "pmpuShort"),
    mkRow("Swap Short",    "Swap",      "swapShort"),
    mkRow("MM Short",      "MM",        "mmShort"),
    mkRow("Other Short",   "Other Rpt", "otherShort"),
    mkRow("Non-Rep Short", "Non-Rep",   "nonRepShort"),
  ];
  const spreadRows: GRData[] = [
    mkRow("MM Spread",    "MM",        "mmSpread",    true),
    mkRow("Swap Spread",  "Swap",      "swapSpread",  true),
    mkRow("Other Spread", "Other Rpt", "otherSpread", true),
  ];

  const extremes = [...longRows, ...shortRows].filter(r => r.pct >= 80 || r.pct <= 20);

  const pctColor = (pct: number) => {
    if (pct >= 80) return "#ef4444";
    if (pct >= 60) return "#f97316";
    if (pct <= 20) return "#22c55e";
    if (pct <= 40) return "#84cc16";
    return "#94a3b8";
  };

  const fmtLot = (v: number) => Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + "k" : String(Math.round(v));

  const renderGauge = (r: GRData) => {
    const pct = Math.max(0, Math.min(100, r.pct));
    const prevPct = r.max > r.min ? Math.max(0, Math.min(100, (r.prev - r.min) / (r.max - r.min) * 100)) : 50;
    const delta = r.curr - r.prev;
    const color = r.isSpread ? "#a78bfa" : pctColor(pct);
    return (
      <div key={r.label} style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "baseline" }}>
          <span style={{ fontSize: 11, color: r.color, fontWeight: 600 }}>{r.label}</span>
          <span style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#475569" }}>{fmtLot(r.curr)}</span>
            <span style={{ color, fontWeight: 600 }}>{Math.round(pct)}th</span>
            <span style={{ color: delta >= 0 ? "#22c55e" : "#ef4444", fontSize: 9 }}>
              {delta >= 0 ? "▲" : "▼"} {fmtLot(Math.abs(delta))}
            </span>
          </span>
        </div>
        <div style={{ position: "relative", height: 11, background: "#1e293b", borderRadius: 6 }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: color, borderRadius: 6, opacity: 0.28 }} />
          <div style={{ position: "absolute", top: 1, left: `calc(${prevPct}% - 1px)`, width: 2, height: 9, background: "#60a5fa", borderRadius: 1, opacity: 0.6 }} title={`Prev: ${fmtLot(r.prev)}`} />
          <div style={{ position: "absolute", top: 0.5, left: `calc(${pct}% - 5px)`, width: 10, height: 10, background: color, borderRadius: "50%", border: "2px solid #0f172a", boxShadow: `0 0 4px ${color}80` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span style={{ fontSize: 9, color: "#334155" }}>{fmtLot(r.min)}</span>
          <span style={{ fontSize: 9, color: "#334155" }}>{fmtLot(r.max)}</span>
        </div>
      </div>
    );
  };

  return (
    <>
      <SectionHeader icon="Sliders" title="3. 52-Week Positioning Gauges"
        subtitle="Current level vs. 52-week range. Colored dot = current week, blue tick = previous week. Red ≥80th pct · Green ≤20th." />
      <div className="flex items-center gap-3 mb-4">
        <MarketToggle markets={{ ny: market === "ny", ldn: market === "ldn" }} set={(m: string) => setMarket(m as "ny" | "ldn")} />
      </div>
      {extremes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 mb-4 flex flex-wrap gap-3">
          <span className="text-[10px] text-slate-500 font-semibold self-center uppercase tracking-wider">Extremes:</span>
          {extremes.map(r => (
            <span key={r.label} style={{ fontSize: 11, color: pctColor(r.pct) }}>
              {r.label} {Math.round(r.pct)}th
            </span>
          ))}
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-3">Longs</div>
            {longRows.map(renderGauge)}
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-3">Shorts</div>
            {shortRows.map(renderGauge)}
          </div>
        </div>
        <div style={{ borderTop: "1px dashed #334155", marginTop: 16, paddingTop: 14 }}>
          <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-3">Spreading positions</div>
          <div className="grid grid-cols-3 gap-x-8">
            {spreadRows.map(renderGauge)}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CotDashboard() {
  const [step, setStep] = useState<Step>(1);
  const [cotRows, setCotRows] = useState<any[] | null>(null);
  const [cotError, setCotError] = useState(false);
  const [macroData, setMacroData] = useState<MacroCotWeek[]>([]);
  const [macroError, setMacroError] = useState(false);
  const [macroToggle, setMacroToggle] = useState<"gross" | "gross_long" | "gross_short" | "net">("gross");
  const [step1View, setStep1View] = useState<"chart" | "table">("chart");

  useEffect(() => {
    fetchCot()
      .then(rows => {
        if (!rows.length) setCotError(true);
        setCotRows(rows);
      })
      .catch(() => setCotError(true));
    fetchMacroCot().then(setMacroData).catch(() => setMacroError(true));
  }, []);

  const data = useMemo(
    () => (cotRows?.length ? transformApiData(cotRows) : generateData()),
    [cotRows]
  );
  const latest = data[data.length - 1];


  const macroChartData = useMemo(
    () => transformMacroData(macroData, macroToggle),
    [macroData, macroToggle]
  );

  const globalFlowMetrics = useMemo(
    (): GlobalFlowMetrics | null =>
      macroData.length >= 2 ? buildGlobalFlowMetrics(macroData) : null,
    [macroData]
  );

  const macroNetSplitData = useMemo(() => {
    if (macroToggle !== "net") return null;
    return macroChartData.map(row => {
      const result: Record<string, any> = { date: row.date };
      for (const s of SECTORS) {
        const v = (row as any)[s] as number;
        result[`${s}_pos`] = v > 0 ? v : 0;
        result[`${s}_neg`] = v < 0 ? v : 0;
      }
      return result;
    });
  }, [macroChartData, macroToggle]);

  const macroYDomain = useMemo(() => {
    if (macroToggle !== "net" || !macroChartData.length) return undefined;
    const allVals = macroChartData.flatMap(d =>
      SECTORS.map(s => (d as any)[s] as number)
    );
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const pad = Math.max(Math.abs(min), Math.abs(max)) * 0.15;
    return [+(min - pad).toFixed(2), +(max + pad).toFixed(2)] as [number, number];
  }, [macroChartData, macroToggle]);

  const macroKpis = useMemo(() => {
    if (!macroData.length) return null;
    const weekTotals = (week: MacroCotWeek) => {
      let g = 0, n = 0;
      for (const c of week.commodities) {
        g += c.gross_exposure_usd ?? 0;
        n += c.net_exposure_usd   ?? 0;
      }
      return { gross: g, net: n };
    };
    const cur  = weekTotals(macroData[macroData.length - 1]);
    const prev = macroData.length >= 2 ? weekTotals(macroData[macroData.length - 2]) : null;
    return {
      totalGross: cur.gross,
      netExp:     cur.net,
      grossWoW:   prev ? cur.gross - prev.gross : null,
      netWoW:     prev ? cur.net   - prev.net   : null,
      date:       macroData[macroData.length - 1].date,
    };
  }, [macroData]);

  const softChartData = useMemo(() =>
    macroData
      .map(week => {
        const row: Record<string, any> = { date: week.date };
        for (const sym of SOFT_SYMBOLS) {
          const c = week.commodities.find(c => c.symbol === sym.key);
          if (!c) { row[sym.key] = 0; continue; }
          const g = c.gross_exposure_usd;
          const n = c.net_exposure_usd;
          const val =
            macroToggle === "gross"       ? g :
            macroToggle === "gross_long"  ? (g != null && n != null ? (g + n) / 2 : null) :
            macroToggle === "gross_short" ? (g != null && n != null ? (g - n) / 2 : null) :
            n;
          row[sym.key] = val != null ? val / 1e9 : 0;
        }
        return row;
      })
      .filter(row => SOFT_SYMBOLS.some(s => Math.abs(row[s.key]) > 0)),
    [macroData, macroToggle]);

  // Step 5
  const [dpCats, setDpCats] = useState({ pmpu: false, mm: true, swap: false, other: false, nonrep: false });

  // ── HTML export ──────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!exporting) return;
    let cancelled = false;

    const doExport = async () => {
      if (cancelled) return;
      try {
        // 1. Fetch CDN libraries (once — they get embedded in the file)
        const CDN = {
          react:     "https://unpkg.com/react@18.2.0/umd/react.production.min.js",
          reactDom:  "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js",
          propTypes: "https://unpkg.com/prop-types@15.8.1/prop-types.min.js",
          recharts:  "https://unpkg.com/recharts@2.12.7/umd/Recharts.js",
          babel:     "https://unpkg.com/@babel/standalone/babel.min.js",
        };
        const [reactJs, reactDomJs, propTypesJs, rechartsJs, babelJs] = await Promise.all(
          Object.values(CDN).map(url => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.text(); }))
        );

        // 2. Fetch compiled app CSS (Tailwind output — exact classes used in the app)
        const linkEls = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
        const cssTexts = await Promise.all(linkEls.map(l => fetch(l.href).then(r => r.text()).catch(() => "")));
        const inlineStyleEls = Array.from(document.querySelectorAll("style")).map(s => s.textContent ?? "");
        const appCss = [...cssTexts, ...inlineStyleEls].join("\n");

        // 3. Build the standalone HTML
        const dateStr = new Date().toISOString().split("T")[0];
        const html = buildStandaloneHtml(
          data,
          macroData,
          globalFlowMetrics ?? null,
          dateStr,
          reactJs, reactDomJs, propTypesJs, rechartsJs, babelJs,
          appCss
        );

        // 4. Download
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url;
        a.download = `COT-Dashboard-${dateStr}.html`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert("Export failed — check your internet connection and try again.\n" + String(err));
      }
      if (!cancelled) setExporting(false);
    };

    doExport();
    return () => { cancelled = true; };
  }, [exporting]);


  const processedDpData = useMemo(() => {
    const compute = (market: "ny" | "ldn") => {
      const byTf: Record<string, { date: string; traders: number; oi: number }[]> = {
        historical: [], year: [], recent_4: [], recent_1: [], current: [],
      };
      const mt = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
      data.forEach(d => {
        const trL = market === "ny" ? d.tradersNY : d.tradersLDN;
        const trS = market === "ny" ? (d as any).tradersNY_short : (d as any).tradersLDN_short;
        let dpLong = 0, dpShort = 0, dpTradersLong = 0, dpTradersShort = 0;
        Object.keys(dpCats).forEach(cat => {
          if ((dpCats as any)[cat]) {
            const oiKey = cat === "nonrep" ? "nonRep" : cat;
            dpLong         += ((d as any)[market][`${oiKey}Long`])  * mt;
            dpShort        += ((d as any)[market][`${oiKey}Short`]) * mt;
            dpTradersLong  += (trL as any)?.[cat] ?? 0;
            dpTradersShort += (trS as any)?.[cat] ?? 0;
          }
        });
        const tf = d.timeframe as string;
        if (byTf[tf]) {
          if (dpTradersLong  > 0) byTf[tf].push({ date: d.date, traders: dpTradersLong,  oi: dpLong  });
          if (dpTradersShort > 0) byTf[tf].push({ date: d.date, traders: dpTradersShort, oi: -dpShort });
        }
      });
      return byTf;
    };
    return { ny: compute("ny"), ldn: compute("ldn") };
  }, [data, dpCats]);

  const dpDomain = useMemo(() => {
    const calc = (byTf: Record<string, { date: string; traders: number; oi: number }[]>) => {
      const all = Object.values(byTf).flat();
      if (!all.length) return { x: [0, 1000] as [number, number], y: [-5000000, 5000000] as [number, number] };
      const tVals = all.map(p => p.traders).filter(v => v > 0);
      const oVals = all.map(p => p.oi);
      const tMin  = tVals.length ? Math.min(...tVals) : 0;
      const tMax  = tVals.length ? Math.max(...tVals) : 1000;
      const oMin  = oVals.length ? Math.min(...oVals) : -5000000;
      const oMax  = oVals.length ? Math.max(...oVals) : 5000000;
      const tPad  = (tMax - tMin) * 0.1 || 10;
      const oPad  = Math.max(Math.abs(oMax), Math.abs(oMin)) * 0.1;
      return {
        x: [Math.floor(tMin - tPad), Math.ceil(tMax + tPad)] as [number, number],
        y: [Math.floor(oMin < 0 ? oMin * 1.1 : oMin - oPad), Math.ceil(oMax > 0 ? oMax * 1.1 : oMax + oPad)] as [number, number],
      };
    };
    return { ny: calc(processedDpData.ny), ldn: calc(processedDpData.ldn) };
  }, [processedDpData]);

  const recent52 = data.slice(-52);

  return (
    <div className="space-y-4" style={{ position: "relative" }}>
      {cotError && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-400 text-xs font-medium">
          Backend unavailable — showing illustrative data only (prices random, data ends ~Nov 2025). Start the backend server to load real CoT data.
        </div>
      )}
      {cotRows === null && !cotError && (
        <div className="mb-3 h-2 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full bg-slate-600 animate-pulse w-full" />
        </div>
      )}
      {/* Horizontal step nav — sticky, scrolls to section */}
      <div className="flex items-center gap-1 flex-wrap border-b border-slate-700 pb-1 sticky top-0 z-10 bg-gray-900 pt-1">
        {NAV_STEPS.map(s => (
          <button key={s.id} data-nav={String(s.id)}
            onClick={() => { setStep(s.id); document.getElementById(`cot-section-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              step === s.id ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300"
            }`}>
            <span className={step === s.id ? "text-amber-400" : "text-slate-600"}>{ICONS[s.icon]}</span>
            {s.label}
          </button>
        ))}
        {cotRows !== null && (
          <span className="ml-auto text-[10px] text-slate-600 font-mono">
            NY {latest.priceNY.toFixed(2)}¢ · LDN ${latest.priceLDN.toFixed(0)}
          </span>
        )}
        <button
          onClick={() => setExporting(true)}
          disabled={!recent52.length || exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {exporting ? "Generating…" : "↓ Download HTML"}
        </button>
      </div>

      {/* ── Step 1: Global Money Flow ── */}
      <div id="cot-section-1">
          <SectionHeader icon="Globe" title="1. Global Money Flow"
            subtitle="MM speculative exposure across 28 commodity markets (CFTC + ICE Europe). Toggle metric below." />
          {macroError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-400 text-xs font-medium">
              Macro COT data unavailable — run the backfill script and ensure the backend is running.
            </div>
          )}

          {/* Toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            {/* View toggle — Chart or Attribution Table */}
            {(["chart", "table"] as const).map(v => (
              <button
                key={v}
                onClick={() => setStep1View(v)}
                style={{
                  padding: "4px 12px", borderRadius: 4, border: "1px solid #374151",
                  background: step1View === v ? "#065f46" : "#1f2937",
                  color: "#f9fafb", cursor: "pointer", fontSize: 12,
                }}
              >
                {v === "chart" ? "Chart" : "Attribution Table"}
              </button>
            ))}
            <span style={{ width: 1, height: 20, background: "#374151", margin: "0 4px" }} />
            {/* Existing mode toggle — gross/net/long/short */}
            {(["gross", "gross_long", "gross_short", "net"] as const).map(m => {
              const labels: Record<string, string> = {
                gross:       "Total Gross",
                gross_long:  "Gross Long",
                gross_short: "Gross Short",
                net:         "Net Exposure",
              };
              return (
                <button
                  key={m}
                  onClick={() => setMacroToggle(m)}
                  style={{
                    padding: "4px 12px", borderRadius: 4, border: "1px solid #374151",
                    background: macroToggle === m ? "#4f46e5" : "#1f2937",
                    color: "#f9fafb", cursor: "pointer", fontSize: 12,
                  }}
                >
                  {labels[m]}
                </button>
              );
            })}
          </div>

          {/* KPI Toddles */}
          {macroKpis && (() => {
            const fmtB  = (v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v / 1e9).toFixed(1)}B`;
            const fmtWoW = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v / 1e9).toFixed(2)}B`;
            const kpis = [
              { label: "Gross Exposure",     value: fmtB(macroKpis.totalGross),  color: "#f9fafb" },
              { label: "Gross Exposure WoW", value: fmtWoW(macroKpis.grossWoW), color: macroKpis.grossWoW == null ? "#6b7280" : macroKpis.grossWoW >= 0 ? "#10b981" : "#ef4444" },
              { label: "Net Exposure",       value: fmtB(macroKpis.netExp),      color: macroKpis.netExp >= 0 ? "#10b981" : "#ef4444" },
              { label: "Net Exposure WoW",   value: fmtWoW(macroKpis.netWoW),   color: macroKpis.netWoW == null ? "#6b7280" : macroKpis.netWoW >= 0 ? "#10b981" : "#ef4444" },
            ];
            return (
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {kpis.map(k => (
                  <div key={k.label} style={{
                    flex: "1 1 140px", background: "#111827", border: "1px solid #1f2937",
                    borderRadius: 8, padding: "10px 14px",
                  }}>
                    <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>{k.value}</div>
                    <div style={{ fontSize: 9, color: "#4b5563", marginTop: 2 }}>{macroKpis.date}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {step1View === "chart" && (
          <>
          {/* Panel A — MM Exposure by Sector */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>MM Exposure by Sector (USD bn)</span>
          </div>
          {!macroData.length && !macroError && (
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-center" style={{ height: 260, marginBottom: 16 }}>
              <div className="h-2 w-32 rounded-full bg-slate-700 animate-pulse" />
            </div>
          )}
          {macroData.length > 0 && <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={macroToggle === "net" && macroNetSplitData ? macroNetSplitData : macroChartData}
                margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                  tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
                  tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(0)}B`} width={52}
                  domain={macroYDomain} />
                {macroToggle === "net" && <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />}
                {macroToggle === "net" ? (
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                    content={(props: any) => {
                      if (!props.active || !props.payload) return null;
                      const byLabel: Record<string, { value: number; color: string }> = {};
                      for (const entry of props.payload) {
                        const key = String(entry.dataKey);
                        const sector = key.replace("_pos", "").replace("_neg", "");
                        const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                        if (!byLabel[label]) byLabel[label] = { value: 0, color: SECTOR_COLORS[sector] };
                        byLabel[label].value += entry.value || 0;
                      }
                      return (
                        <div style={{ background: "#111827", border: "1px solid #374151", padding: "6px 10px", fontSize: 11, borderRadius: 4 }}>
                          <p style={{ color: "#9ca3af", margin: "0 0 4px" }}>Week: {props.label}</p>
                          {Object.entries(byLabel)
                            .filter(([, d]) => Math.abs(d.value) >= 0.001)
                            .sort((a, b) => b[1].value - a[1].value)
                            .map(([label, d]) => (
                              <p key={label} style={{ color: d.value < 0 ? "#dc2626" : d.color, margin: "2px 0" }}>
                                {label}: {d.value < 0 ? "-$" : "$"}{Math.abs(d.value).toFixed(1)}B
                              </p>
                            ))}
                        </div>
                      );
                    }}
                  />
                ) : (
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                    formatter={(v: any, name: any) => [`${(v as number) < 0 ? "-$" : "$"}${Math.abs(v as number).toFixed(1)}B`, name]}
                    labelFormatter={(l: any) => `Week: ${l}`}
                  />
                )}
                <Legend wrapperStyle={{ fontSize: 11 }} content={(props: any) => {
                  const labelMap: Record<string, string> = { energy: "Energies", metals: "Metals", grains: "Grains", meats: "Meats", softs: "Softs", micros: "Micros" };
                  const lastRow = macroChartData[macroChartData.length - 1];
                  const order = lastRow
                    ? [...SECTORS].sort((a, b) => Math.abs((lastRow as any)[b]) - Math.abs((lastRow as any)[a]))
                    : [...SECTORS];
                  return (
                    <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", fontSize: 11, paddingTop: 4 }}>
                      {order.map(s => (
                        <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, color: "#d1d5db" }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: SECTOR_COLORS[s], display: "inline-block" }} />
                          {labelMap[s]}
                        </span>
                      ))}
                    </div>
                  );
                }} />
                {macroToggle === "net" ? (
                  <>
                    {SECTORS.map(sector => {
                      const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                      return (
                        <Area key={`${sector}_pos`} type="monotone" dataKey={`${sector}_pos`}
                          stackId="pos" name={label}
                          stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
                          fillOpacity={0.6} dot={false} />
                      );
                    })}
                    {SECTORS.map(sector => (
                      <Area key={`${sector}_neg`} type="monotone" dataKey={`${sector}_neg`}
                        stackId="neg" name={`${sector}_neg`}
                        stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
                        fillOpacity={0.6} dot={false} legendType="none" />
                    ))}
                  </>
                ) : (
                  SECTORS.map(sector => {
                    const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                    return (
                      <Area key={sector} type="monotone" dataKey={sector}
                        stackId="1" name={label}
                        stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
                        fillOpacity={0.6} dot={false} />
                    );
                  })
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>}

          {/* Panel B — Weekly Change */}
          {(() => {
            const weeklyChangeData = macroChartData.slice(1).map((row, i) => {
              const prev = macroChartData[i];
              return {
                date:   row.date,
                energy: row.energy - prev.energy,
                metals: row.metals - prev.metals,
                grains: row.grains - prev.grains,
                meats:  row.meats  - prev.meats,
                softs:  row.softs  - prev.softs,
                micros: row.micros - prev.micros,
              };
            });
            return (
              <>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Weekly Change by Sector (USD bn) — inflows positive, outflows negative</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={weeklyChangeData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(1)}B`} width={52} />
                      <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                        formatter={(v: any, name: any) => [`${(v as number) < 0 ? "-$" : "$"}${Math.abs(v as number).toFixed(2)}B`, name]}
                        labelFormatter={(l: any) => `Week: ${l}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {SECTORS.map(sector => {
                        const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                        return (
                          <Bar key={sector} dataKey={sector} stackId="1" name={label}
                            fill={SECTOR_COLORS[sector]} />
                        );
                      })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            );
          })()}
          </>
          )}

          {step1View === "table" && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", padding: 16, borderRadius: 12 }}>
              {globalFlowMetrics
                ? <AttributionTable gfm={globalFlowMetrics} />
                : <p style={{ color: "#6b7280", fontSize: 12 }}>Loading attribution data…</p>
              }
            </div>
          )}

          {/* Panel C — MM Exposure on Softs (by contract) */}
          {(() => {
            if (!softChartData.length) return null;

            // For net mode: split pos/neg per contract
            const softNetSplit = macroToggle === "net"
              ? softChartData.map(row => {
                  const r: Record<string, any> = { date: row.date };
                  for (const s of SOFT_SYMBOLS) {
                    const v = row[s.key] as number;
                    r[`${s.key}_pos`] = v > 0 ? v : 0;
                    r[`${s.key}_neg`] = v < 0 ? v : 0;
                  }
                  return r;
                })
              : null;

            const softYDomain: [number, number] | undefined = macroToggle === "net" ? (() => {
              const vals = softChartData.flatMap(row => SOFT_SYMBOLS.map(s => row[s.key] as number));
              const mn = Math.min(...vals), mx = Math.max(...vals);
              const pad = Math.max(Math.abs(mn), Math.abs(mx)) * 0.15;
              return [+(mn - pad).toFixed(2), +(mx + pad).toFixed(2)];
            })() : undefined;

            return (
              <>
                <div style={{ marginBottom: 8, marginTop: 16 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>MM Exposure — Softs by Contract (USD bn)</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom: 16 }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart
                      data={macroToggle === "net" && softNetSplit ? softNetSplit : softChartData}
                      margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(2)}B`} width={58}
                        domain={softYDomain} />
                      {macroToggle === "net" && <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />}
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                        content={(props: any) => {
                          if (!props.active || !props.payload) return null;
                          const byLabel: Record<string, { value: number; color: string }> = {};
                          for (const entry of props.payload) {
                            const key = String(entry.dataKey).replace("_pos", "").replace("_neg", "");
                            const sym = SOFT_SYMBOLS.find(s => s.key === key);
                            if (!sym) continue;
                            if (!byLabel[sym.label]) byLabel[sym.label] = { value: 0, color: sym.color };
                            byLabel[sym.label].value += entry.value || 0;
                          }
                          return (
                            <div style={{ background: "#111827", border: "1px solid #374151", padding: "6px 10px", fontSize: 11, borderRadius: 4 }}>
                              <p style={{ color: "#9ca3af", margin: "0 0 4px" }}>Week: {props.label}</p>
                              {Object.entries(byLabel)
                                .filter(([, d]) => Math.abs(d.value) >= 0.0001)
                                .sort((a, b) => b[1].value - a[1].value)
                                .map(([label, d]) => (
                                  <p key={label} style={{ color: d.value < 0 ? "#dc2626" : d.color, margin: "2px 0" }}>
                                    {label}: {d.value < 0 ? "-$" : "$"}{Math.abs(d.value).toFixed(2)}B
                                  </p>
                                ))}
                            </div>
                          );
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {macroToggle === "net" ? (
                        <>
                          {SOFT_SYMBOLS.map(s => (
                            <Area key={`${s.key}_pos`} type="monotone" dataKey={`${s.key}_pos`}
                              stackId="pos" name={s.label}
                              stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} />
                          ))}
                          {SOFT_SYMBOLS.map(s => (
                            <Area key={`${s.key}_neg`} type="monotone" dataKey={`${s.key}_neg`}
                              stackId="neg" name={`${s.key}_neg`}
                              stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} legendType="none" />
                          ))}
                        </>
                      ) : (
                        SOFT_SYMBOLS.map(s => (
                          <Area key={s.key} type="monotone" dataKey={s.key}
                            stackId="1" name={s.label}
                            stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} />
                        ))
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            );
          })()}

          {/* Panel D — Weekly Change by Contract (Softs) */}
          {(() => {
            if (softChartData.length < 2) return null;

            const weeklyChangeData = softChartData.slice(1).map((row, i) => {
              const prev = softChartData[i];
              const r: Record<string, any> = { date: row.date };
              for (const s of SOFT_SYMBOLS) r[s.key] = (row[s.key] as number) - (prev[s.key] as number);
              return r;
            });

            return (
              <>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Weekly Change — Softs by Contract (USD bn) — inflows positive, outflows negative</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={weeklyChangeData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(2)}B`} width={58} />
                      <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                        formatter={(v: any, name: any) => {
                          if (Math.abs(v) < 0.0001) return null;
                          return [`${(v as number) < 0 ? "-$" : "$"}${Math.abs(v as number).toFixed(2)}B`, name];
                        }}
                        labelFormatter={(l: any) => `Week: ${l}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {SOFT_SYMBOLS.map(s => (
                        <Bar key={s.key} dataKey={s.key} stackId="1" name={s.label} fill={s.color} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            );
          })()}
        </div>

      {/* ── Section 2: Heatmap ── */}
      <div id="cot-section-2">
        <CotHeatmap data={data} />
      </div>

      {/* ── Section 3: Gauges ── */}
      <div id="cot-section-3">
        <CotGauges data={data} />
      </div>

      {/* ── Step 4: Industry Pulse ── */}
      <div id="cot-section-4">
      {(() => {
        const mtFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;
        const mkChart = (market: "ny" | "ldn") => {
          const longKey  = market === "ny" ? "pmpuLongMT_NY"  : "pmpuLongMT_LDN";
          const shortKey = market === "ny" ? "pmpuShortMT_NY" : "pmpuShortMT_LDN";
          const priceKey = market === "ny" ? "priceNY"        : "priceLDN";
          const prices   = recent52.map(d => (d as any)[priceKey] as number).filter(v => v > 0);
          const priceDomain: [number, number] = prices.length
            ? [Math.floor(Math.min(...prices) / 100) * 100, Math.ceil(Math.max(...prices) / 100) * 100]
            : [0, 500];
          const mtVals = recent52.flatMap(d => [(d as any)[longKey] as number, (d as any)[shortKey] as number]).filter(v => v > 0);
          const mtDomain: [number, number] = mtVals.length
            ? [Math.floor(Math.min(...mtVals) / 1000) * 1000, Math.ceil(Math.max(...mtVals) / 1000) * 1000]
            : [0, 100000];
          const deltaData = recent52.slice(1).map((d, i) => {
            const dl  = (d as any)[longKey]  - (recent52[i] as any)[longKey];
            const ds  = (d as any)[shortKey] - (recent52[i] as any)[shortKey];
            const efp = market === "ny" ? (d as any).efpMT : 0;
            return { date: d.date, deltaLong: dl, deltaShort: ds, efpMT: efp };
          });
          return (
            <div>
              {/* Panel A */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[300px] mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={recent52}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                    <YAxis yAxisId="left" stroke="#475569" fontSize={10} tickFormatter={mtFmt} domain={mtDomain}
                      label={{ value: "MT", angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} domain={priceDomain} />
                    <Tooltip contentStyle={CHART_STYLE} formatter={(v: any, name: any) => [
                      name === "Price" ? v.toFixed(0) : `${(Number(v) / 1000).toFixed(1)}k MT`, name
                    ]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Area yAxisId="left" type="monotone" dataKey={longKey}  name="Industry Long"  stroke="#10b981" fill="#10b981" fillOpacity={0.3} strokeWidth={2} dot={false} />
                    <Area yAxisId="left" type="monotone" dataKey={shortKey} name="Industry Short" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey={priceKey} name="Price" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Panel B */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={deltaData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                    <YAxis stroke="#475569" fontSize={10} tickFormatter={mtFmt}
                      label={{ value: "MT", angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
                    <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
                    <Tooltip contentStyle={CHART_STYLE} formatter={(v: any, name: any) => [`${(Number(v) / 1000).toFixed(1)}k MT`, name]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="deltaLong"  name="Δ Long (wk)"  fill="#10b981" opacity={0.8} barSize={4} />
                    <Bar dataKey="deltaShort" name="Δ Short (wk)" fill="#3b82f6" opacity={0.8} barSize={4} />
                    {market === "ny" && <Line type="monotone" dataKey="efpMT" name="EFP Physical" stroke="#f59e0b" strokeWidth={1.5} dot={false} />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        };
        return (
          <div>
            <SectionHeader icon="Factory" title="4. Industry Pulse (Metric Tons)"
              subtitle="PMPU Gross Long & Short vs Price. Bottom: weekly position changes (NY includes EFP physical delivery)." />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
                {mkChart("ny")}
              </div>
              <div>
                <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
                {mkChart("ldn")}
              </div>
            </div>
          </div>
        );
      })()}
      </div>

      {/* ── Step 5: Dry Powder ── */}
      <div id="cot-section-5">
        <SectionHeader icon="Droplets" title="5. Dry Powder Indicator"
          subtitle="Gross Long OI (positive) and Gross Short OI (negative) vs number of traders. Color = recency." />
        <div className="flex items-center gap-3 mb-4">
          <CatToggles cats={dpCats} set={k => setDpCats(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} items={CAT_ITEMS} />
        </div>
        {(() => {
          const mkScatter = (market: "ny" | "ldn") => {
            const d = processedDpData[market];
            const dom = dpDomain[market];
            const legendContent = (props: any) => {
              const items = [...(props.payload ?? [])].reverse();
              return (
                <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 10, paddingTop: 8 }}>
                  {items.map((e: any, i: number) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, color: "#94a3b8" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: e.color, display: "inline-block" }} />
                      {e.value}
                    </span>
                  ))}
                </div>
              );
            };
            return (
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" dataKey="traders" name="# traders" stroke="#475569" fontSize={10}
                      domain={dom.x}
                      label={{ value: "# traders", position: "insideBottom", offset: -10, fill: "#475569", fontSize: 10 }} />
                    <YAxis type="number" dataKey="oi" name="OI" stroke="#475569" fontSize={10}
                      domain={dom.y}
                      tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                      label={{ value: "OI (k MT)", angle: -90, position: "insideLeft", offset: -10, fill: "#475569", fontSize: 10 }} />
                    <ReferenceLine y={0} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE}
                      formatter={(v: any, name: any) => name === "# traders"
                        ? [Math.round(Number(v)).toString(), name]
                        : [`${(Number(v) / 1000).toFixed(1)}k MT`, name]} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} content={legendContent} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Scatter name="Historic"   data={d.historical} fill="#bfdbfe" fillOpacity={0.18} {...{ size: 12  } as any} />
                    <Scatter name="Prior Y"    data={d.year}       fill="#3b82f6" fillOpacity={0.45} {...{ size: 28  } as any} />
                    <Scatter name="Prior 4W"   data={d.recent_4}   fill="#eab308" fillOpacity={0.9}  {...{ size: 78  } as any} />
                    <Scatter name="Prior week" data={d.recent_1}   fill="#c2410c" fillOpacity={1.0}  {...{ size: 154 } as any} />
                    <Scatter name="Last CoT"   data={d.current}    fill="#ef4444" fillOpacity={1.0}  {...{ size: 314 } as any} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            );
          };
          return (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
                {mkScatter("ny")}
              </div>
              <div>
                <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
                {mkScatter("ldn")}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Step 6: Cycle Location ── */}
      <div id="cot-section-6">
      {(() => {
        const cycleColor = (d: any, market: "ny" | "ldn") => {
          if (d.timeframe === "current")  return market === "ny" ? "#ef4444" : "#3b82f6";
          if (d.timeframe === "recent_1") return "#f97316";
          if (d.timeframe === "recent_4") return "#eab308";
          return "#64748b";
        };
        const cycleOpacity = (d: any) => {
          if (d.timeframe === "current")  return 1.0;
          if (d.timeframe === "recent_1") return 0.85;
          if (d.timeframe === "recent_4") return 0.75;
          if (d.timeframe === "year")     return 0.25;
          return 0.12;
        };
        const nyPts  = recent52.map(d => ({ x: d.oiRank,    y: d.priceRank,    timeframe: d.timeframe, date: d.date }));
        const ldnPts = recent52.map(d => ({ x: d.oiRankLDN, y: d.priceRankLDN, timeframe: d.timeframe, date: d.date }));
        const mkCycle = (pts: typeof nyPts, market: "ny" | "ldn") => (
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" dataKey="x" domain={[0, 100]} stroke="#475569" fontSize={10}
                  label={{ value: "Net Positioning Rank (%)", position: "bottom", offset: 0, fill: "#475569", fontSize: 10 }} />
                <YAxis type="number" dataKey="y" domain={[0, 100]} stroke="#475569" fontSize={10}
                  label={{ value: "Price Rank (%)", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 10 }} />
                <ReferenceArea x1={0}  x2={25}  y1={0}  y2={25}  fill="#10b981" fillOpacity={0.08} stroke="#10b981" strokeOpacity={0.25}
                  label={{ value: "OVERSOLD",   position: "insideTopRight",    fill: "#10b981", fontSize: 9, fontWeight: "bold" }} />
                <ReferenceArea x1={75} x2={100} y1={75} y2={100} fill="#ef4444" fillOpacity={0.08} stroke="#ef4444" strokeOpacity={0.25}
                  label={{ value: "OVERBOUGHT", position: "insideBottomLeft",  fill: "#ef4444", fontSize: 9, fontWeight: "bold" }} />
                <ReferenceLine x={50} stroke="#475569" strokeDasharray="5 5" />
                <ReferenceLine y={50} stroke="#475569" strokeDasharray="5 5" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE}
                  formatter={(v: any, _: any, props: any) => [`${Number(v).toFixed(1)}%`, props.name]}
                  labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.date ?? ""} />
                <Scatter name={market === "ny" ? "NY Arabica" : "LDN Robusta"} data={pts}>
                  {pts.map((d, i) => (
                    <Cell key={i} fill={cycleColor(d, market)} fillOpacity={cycleOpacity(d)} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        );
        return (
          <div>
            <SectionHeader icon="Scale" title="6. Cycle Location (OB/OS Matrix)"
              subtitle="X = MM Net Positioning 5Y rank · Y = Price 5Y rank · Red=last week · Orange=prior week · Yellow=prior 4 weeks · Grey=history." />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
                {mkCycle(nyPts, "ny")}
              </div>
              <div>
                <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
                {mkCycle(ldnPts, "ldn")}
              </div>
            </div>
          </div>
        );
      })()}
      </div>

    </div>
  );
}
