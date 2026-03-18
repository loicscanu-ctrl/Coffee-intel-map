"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart,
  ScatterChart, Scatter, Cell, PieChart, Pie, ReferenceLine, ReferenceArea, Label,
} from "recharts";
import { fetchCot, fetchMacroCot, type MacroCotWeek } from "@/lib/api";
import { buildGlobalFlowMetrics } from "@/lib/pdf/dataHelpers";
import type { GlobalFlowMetrics } from "@/lib/pdf/types";

// ── Types ──────────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 5 | 6;

// ── Inline SVG icons ───────────────────────────────────────────────────────────
const ICONS: Record<string, React.ReactNode> = {
  Globe:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Activity: <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  Users:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Factory:  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>,
  Droplets: <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7 2.9 7 2.9s-2.29 6.16-3.29 7.16C2.57 11.01 2 12.11 2 13.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 1 14 8c2 2 3 4.8 3 6.5s-1.8 3.5-4 3.5-4-1.5-4-3.5"/></svg>,
  Scale:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>,
};

const NAV_STEPS = [
  { id: 1 as Step, icon: "Globe",    label: "Flow" },
  { id: 2 as Step, icon: "Activity", label: "Structure" },
  { id: 3 as Step, icon: "Users",    label: "Players" },
  { id: 4 as Step, icon: "Factory",  label: "Industry" },
  { id: 5 as Step, icon: "Droplets", label: "Dry Powder" },
  { id: 6 as Step, icon: "Scale",    label: "Cycle" },
];

// ── Constants ──────────────────────────────────────────────────────────────────
const ARABICA_MT_FACTOR = 17.01;
const ROBUSTA_MT_FACTOR = 10.00;
const MARGIN_OUTRIGHT   = 6000;
const MARGIN_SPREAD     = 1200;
const CENTS_LB_TO_USD_TON = 22.0462;

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

// ── Real data transform ─────────────────────────────────────────────────────
function transformApiData(rows: any[]): any[] {
  if (!rows.length) return [];

  // Forward-fill missing market data (e.g. US holiday shifts NY release by 1 day)
  let lastNY:  any = null;
  let lastLDN: any = null;
  const filledRows = rows.map(row => {
    const ny  = row.ny  ?? lastNY  ?? null;
    const ldn = row.ldn ?? lastLDN ?? null;
    if (row.ny  != null) lastNY  = row.ny;
    if (row.ldn != null) lastLDN = row.ldn;
    return { ...row, ny, ldn };
  });

  let prevPriceNY  = 130;
  let prevPriceLDN = 1800;
  let cumulativeNominal = 0;
  let cumulativeMargin  = 0;

  // Pass 1: ordered for-loop — delta fields require access to previous row
  const base: any[] = [];
  for (let i = 0; i < filledRows.length; i++) {
    const row = filledRows[i];
    const ny  = row.ny  ?? {};
    const ldn = row.ldn ?? {};

    const oiNY  = ny.oi_total  ?? 0;
    const oiLDN = ldn.oi_total ?? 0;
    const totalOI = oiNY + oiLDN;

    // Spreading — from RAW API spread fields (NOT from the ny/ldn sub-objects below)
    const spreadingNY  = (ny.swap_spread  ?? 0) + (ny.mm_spread  ?? 0) + (ny.other_spread  ?? 0);
    const spreadingLDN = (ldn.swap_spread ?? 0) + (ldn.mm_spread ?? 0) + (ldn.other_spread ?? 0);
    const spreadingTotal = spreadingNY + spreadingLDN;
    const outrightTotal  = totalOI - spreadingTotal;

    // Price carry-forward
    const priceNY  = ny.price_ny   != null ? ny.price_ny   : prevPriceNY;
    const priceLDN = ldn.price_ldn != null ? ldn.price_ldn : prevPriceLDN;
    prevPriceNY  = priceNY;
    prevPriceLDN = priceLDN;

    const priceNY_USD_Ton  = priceNY * CENTS_LB_TO_USD_TON;
    const avgPrice_USD_Ton = totalOI > 0
      ? ((priceNY_USD_Ton * oiNY) + (priceLDN * oiLDN)) / totalOI
      : 0;

    // Delta OI
    const prev       = base[i - 1] ?? null;
    const deltaOINY  = prev ? oiNY  - prev.oiNY  : 0;
    const deltaOILDN = prev ? oiLDN - prev.oiLDN : 0;

    // Weekly nominal flow ($M)
    const flowNY  = (deltaOINY  * priceNY  * 375) / 1_000_000;
    const flowLDN = (deltaOILDN * priceLDN * 10)  / 1_000_000;
    const weeklyNominalFlow = flowNY + flowLDN;

    // Weekly margin flow ($M)
    const prevSpread   = prev ? prev.spreadingTotal : 0;
    const prevOutright = prev ? prev.outrightTotal  : 0;
    const deltaSpread   = spreadingTotal - prevSpread;
    const deltaOutright = outrightTotal  - prevOutright;
    const weeklyMarginFlow =
      ((deltaOutright * MARGIN_OUTRIGHT) + (deltaSpread * MARGIN_SPREAD)) / 1_000_000;

    cumulativeNominal += weeklyNominalFlow;
    cumulativeMargin  += weeklyMarginFlow;

    // ny/ldn sub-objects: camelCase OI fields used by Tabs 2-6
    // nonRepLong (capital R) matches d.ny[`${cat}Long`] where cat="nonRep" in Tab 2
    const nyObj = {
      pmpuLong:    ny.pmpu_long   ?? 0,  pmpuShort:   ny.pmpu_short  ?? 0,  pmpuSpread:   0,
      swapLong:    ny.swap_long   ?? 0,  swapShort:   ny.swap_short  ?? 0,  swapSpread:   ny.swap_spread  ?? 0,
      mmLong:      ny.mm_long     ?? 0,  mmShort:     ny.mm_short    ?? 0,  mmSpread:     ny.mm_spread    ?? 0,
      otherLong:   ny.other_long  ?? 0,  otherShort:  ny.other_short ?? 0,  otherSpread:  ny.other_spread ?? 0,
      nonRepLong:  ny.nr_long     ?? 0,  nonRepShort: ny.nr_short    ?? 0,  nonRepSpread: 0,
    };
    const ldnObj = {
      pmpuLong:    ldn.pmpu_long  ?? 0,  pmpuShort:   ldn.pmpu_short  ?? 0,  pmpuSpread:   0,
      swapLong:    ldn.swap_long  ?? 0,  swapShort:   ldn.swap_short  ?? 0,  swapSpread:   ldn.swap_spread  ?? 0,
      mmLong:      ldn.mm_long    ?? 0,  mmShort:     ldn.mm_short    ?? 0,  mmSpread:     ldn.mm_spread    ?? 0,
      otherLong:   ldn.other_long ?? 0,  otherShort:  ldn.other_short ?? 0,  otherSpread:  ldn.other_spread ?? 0,
      nonRepLong:  ldn.nr_long    ?? 0,  nonRepShort: ldn.nr_short    ?? 0,  nonRepSpread: 0,
    };

    // tradersNY/LDN: lowercase keys used by Tab 5 dpCats loop as m.tr["nonrep"]
    const tradersNY = {
      pmpu:   ny.t_pmpu_long  ?? 0,
      mm:     ny.t_mm_long    ?? 0,
      swap:   ny.t_swap_long  ?? 0,
      other:  ny.t_other_long ?? 0,
      nonrep: ny.t_nr_long    ?? 0,
    };
    const tradersLDN = {
      pmpu:   ldn.t_pmpu_long  ?? 0,
      mm:     ldn.t_mm_long    ?? 0,
      swap:   ldn.t_swap_long  ?? 0,
      other:  ldn.t_other_long ?? 0,
      nonrep: 0,  // ICE has no NR trader count
    };

    const pmpuShortMT_NY  = nyObj.pmpuShort * ARABICA_MT_FACTOR;
    const pmpuShortMT_LDN = ldnObj.pmpuShort * ROBUSTA_MT_FACTOR;
    const pmpuLongMT_NY   = nyObj.pmpuLong  * ARABICA_MT_FACTOR;
    const pmpuLongMT_LDN  = ldnObj.pmpuLong * ROBUSTA_MT_FACTOR;
    const efpMT = (ny.efp_ny ?? 0) * ARABICA_MT_FACTOR;

    base.push({
      id: i,
      date: row.date,
      priceNY, priceLDN, avgPrice_USD_Ton,
      oiNY, oiLDN, totalOI,
      spreadingTotal, outrightTotal,
      weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
      ny: nyObj, ldn: ldnObj,
      tradersNY, tradersLDN,
      pmpuShortMT_NY, pmpuShortMT_LDN,
      pmpuShortMT: pmpuShortMT_NY + pmpuShortMT_LDN,
      pmpuLongMT_NY, pmpuLongMT_LDN,
      pmpuLongMT: pmpuLongMT_NY + pmpuLongMT_LDN,
      efpMT,
      timeframe: "historical",
    });
  }

  // Pass 2: timeframe buckets + 52-week rolling ranks
  const n = base.length;
  return base.map((d, i) => {
    const timeframe =
      i === n - 1                ? "current"    :
      i === n - 2                ? "recent_1"   :
      (i >= n - 6 && i <= n - 3) ? "recent_4"  :
      (i >= n - 58 && i <= n - 7) ? "year"      :
                                    "historical";

    const slice    = base.slice(Math.max(0, i - 52), i + 1);
    const prices   = slice.map(s => s.priceNY);
    const maxP     = Math.max(...prices);
    const minP     = Math.min(...prices);
    const net      = d.ny.mmLong - d.ny.mmShort;
    const nets     = slice.map(s => s.ny.mmLong - s.ny.mmShort);
    const maxNet   = Math.max(...nets);
    const minNet   = Math.min(...nets);

    const ldnPrices = slice.map(s => s.priceLDN);
    const maxLP     = Math.max(...ldnPrices);
    const minLP     = Math.min(...ldnPrices);
    const netLDN    = d.ldn.mmLong - d.ldn.mmShort;
    const netsLDN   = slice.map(s => s.ldn.mmLong - s.ldn.mmShort);
    const maxNetLDN = Math.max(...netsLDN);
    const minNetLDN = Math.min(...netsLDN);

    return {
      ...d,
      timeframe,
      priceRank:    maxP     !== minP     ? ((d.priceNY - minP)    / (maxP     - minP))     * 100 : 50,
      oiRank:       maxNet   !== minNet   ? ((net       - minNet)   / (maxNet   - minNet))   * 100 : 50,
      priceRankLDN: maxLP    !== minLP    ? ((d.priceLDN - minLP)   / (maxLP    - minLP))    * 100 : 50,
      oiRankLDN:    maxNetLDN !== minNetLDN ? ((netLDN  - minNetLDN)/ (maxNetLDN - minNetLDN)) * 100 : 50,
    };
  });
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
    const slice    = data.slice(Math.max(0, i - 52), i + 1);
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

function RadialCounterparty({
  latest, prev1, prev4, markets, unit,
}: {
  latest: any;
  prev1: any | null;
  prev4: any | null;
  markets: { ny: boolean; ldn: boolean };
  unit: CpUnit;
}) {
  const mtFactor = (m: "ny" | "ldn") => m === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
  const usdPerMT = (m: "ny" | "ldn") => m === "ny" ? latest.priceNY * CENTS_LB_TO_USD_TON : latest.priceLDN;

  const convert = (contracts: number, m: "ny" | "ldn") => {
    if (unit === "contracts") return contracts;
    const mt = contracts * mtFactor(m);
    return unit === "mt" ? mt : mt * usdPerMT(m);
  };

  const sumRow = (row: any, nyFields: string | string[], ldnFields: string | string[]) => {
    const nyFs  = Array.isArray(nyFields)  ? nyFields  : [nyFields];
    const ldnFs = Array.isArray(ldnFields) ? ldnFields : [ldnFields];
    let v = 0;
    if (markets.ny)  nyFs.forEach(f  => { v += convert(row?.ny[f]  ?? 0, "ny");  });
    if (markets.ldn) ldnFs.forEach(f => { v += convert(row?.ldn[f] ?? 0, "ldn"); });
    return v;
  };

  const fmtVal = (v: number) => {
    if (unit === "usd") return `$${(v / 1_000_000_000).toFixed(2)}B`;
    if (unit === "mt")  return `${(v / 1_000).toFixed(0)}k MT`;
    return `${(v / 1_000).toFixed(0)}k lots`;
  };

  const fmtDelta = (v: number) => {
    const sign = v >= 0 ? "+" : "";
    if (unit === "usd") return `${sign}$${(v / 1_000_000).toFixed(0)}M`;
    if (unit === "mt")  return `${sign}${(v / 1_000).toFixed(1)}k`;
    return `${sign}${(v / 1_000).toFixed(1)}k`;
  };

  const LONG_CATS: { name: string; fill: string; f: string | string[] }[] = [
    { name: "MM",        fill: "#f59e0b", f: "mmLong"                         },
    { name: "Swap",      fill: "#10b981", f: "swapLong"                       },
    { name: "PMPU",      fill: "#3b82f6", f: "pmpuLong"                       },
    { name: "Oth/NR",    fill: "#64748b", f: ["otherLong", "nonRepLong"]      },
  ];
  const SHORT_CATS: { name: string; fill: string; f: string | string[] }[] = [
    { name: "PMPU",      fill: "#3b82f6", f: "pmpuShort"                      },
    { name: "MM",        fill: "#f59e0b", f: "mmShort"                        },
    { name: "Swap",      fill: "#10b981", f: "swapShort"                      },
    { name: "Oth/NR",    fill: "#64748b", f: ["otherShort", "nonRepShort"]    },
  ];

  const tooltipStyle = { backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px" };

  const sides = [
    { label: "LONGS (Buyers)",  color: "text-emerald-400", dir:  1, cats: LONG_CATS  },
    { label: "SHORTS (Sellers)", color: "text-red-400",    dir: -1, cats: SHORT_CATS },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[380px]">
      {sides.map(side => {
        const PIE_LABELS: Record<string, string> = { MM: "Managed Money", PMPU: "Industry (PMPU)", Swap: "Swap Dealers", "Oth/NR": "Other/Non-Rep" };
        const pieData = side.cats.map(c => ({ name: PIE_LABELS[c.name] ?? c.name, value: sumRow(latest, c.f, c.f), fill: c.fill }));
        const total   = pieData.reduce((s, d) => s + d.value, 0);
        return (
          <div key={side.label} className="h-full bg-slate-800/30 rounded-xl border border-slate-800/50 flex flex-col p-4">
            <h4 className={`${side.color} font-bold text-xs uppercase tracking-widest text-center mb-2`}>{side.label}</h4>
            <div className="flex flex-row flex-1 min-h-0 gap-3">
              {/* Pie */}
              <div className="flex-1 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%"
                      startAngle={90} endAngle={90 + side.dir * 360}
                      innerRadius={52} outerRadius={80} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="rgba(0,0,0,0)" />)}
                      <Label value={fmtVal(total)} position="center" fill="#f1f5f9" fontSize={11} fontWeight="bold" />
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ fontSize: 11 }}
                      formatter={(v: any, name: string) => [fmtVal(Number(v)), name]} />
                    <Legend verticalAlign="bottom" height={32} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Delta panel */}
              <div className="w-[130px] flex flex-col justify-center border-l border-slate-700/50 pl-3 gap-2.5">
                <div className="grid grid-cols-3 text-[9px] text-slate-500 font-bold uppercase pb-1 border-b border-slate-700/50">
                  <span></span>
                  <span className="text-center">1W</span>
                  <span className="text-center">4W</span>
                </div>
                {(() => {
                  const rows = side.cats.map(cat => {
                    const curr = sumRow(latest, cat.f, cat.f);
                    const d1   = prev1 ? curr - sumRow(prev1, cat.f, cat.f) : null;
                    const d4   = prev4 ? curr - sumRow(prev4, cat.f, cat.f) : null;
                    return { ...cat, d1, d4 };
                  });
                  const tot1 = prev1 ? rows.reduce((s, r) => s + (r.d1 ?? 0), 0) : null;
                  const tot4 = prev4 ? rows.reduce((s, r) => s + (r.d4 ?? 0), 0) : null;
                  return (
                    <>
                      {rows.map(row => (
                        <div key={row.name} className="grid grid-cols-3 items-center gap-1">
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: row.fill }} />
                            <span className="text-[9px] text-slate-400 font-medium">{row.name}</span>
                          </div>
                          <span className={`text-[10px] font-semibold text-center tabular-nums ${row.d1 == null ? "text-slate-600" : row.d1 > 0 ? "text-emerald-400" : row.d1 < 0 ? "text-red-400" : "text-slate-500"}`}>
                            {row.d1 == null ? "—" : fmtDelta(row.d1)}
                          </span>
                          <span className={`text-[10px] font-semibold text-center tabular-nums ${row.d4 == null ? "text-slate-600" : row.d4 > 0 ? "text-emerald-400" : row.d4 < 0 ? "text-red-400" : "text-slate-500"}`}>
                            {row.d4 == null ? "—" : fmtDelta(row.d4)}
                          </span>
                        </div>
                      ))}
                      <div className="grid grid-cols-3 items-center gap-1 pt-1.5 border-t border-slate-700/50">
                        <span className="text-[9px] text-slate-300 font-bold uppercase">Total</span>
                        <span className={`text-[10px] font-bold text-center tabular-nums ${tot1 == null ? "text-slate-600" : tot1 > 0 ? "text-emerald-300" : tot1 < 0 ? "text-red-300" : "text-slate-400"}`}>
                          {tot1 == null ? "—" : fmtDelta(tot1)}
                        </span>
                        <span className={`text-[10px] font-bold text-center tabular-nums ${tot4 == null ? "text-slate-600" : tot4 > 0 ? "text-emerald-300" : tot4 < 0 ? "text-red-300" : "text-slate-400"}`}>
                          {tot4 == null ? "—" : fmtDelta(tot4)}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })}
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

// ── Main component ─────────────────────────────────────────────────────────────

export default function CotDashboard() {
  // PDF chart refs (one per section) — names match captureAllCharts() keys
  const pdfRefGlobalFlow    = useRef<HTMLDivElement>(null);
  const pdfRefStructural    = useRef<HTMLDivElement>(null);
  const pdfRefCounterparty  = useRef<HTMLDivElement>(null);
  const pdfRefIndustryPulse = useRef<HTMLDivElement>(null);
  const pdfRefDryPowder     = useRef<HTMLDivElement>(null);
  const pdfRefObosMatrix    = useRef<HTMLDivElement>(null);
  const pdfRefMacroGross    = useRef<HTMLDivElement>(null);
  const pdfRefMacroNet      = useRef<HTMLDivElement>(null);
  const pdfRefSoftsContract = useRef<HTMLDivElement>(null);

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

  // Step 2
  const [structMarkets, setStructMarkets] = useState({ ny: true, ldn: false });
  const [structCats,    setStructCats]    = useState({ pmpu: true, mm: true, swap: true, other: true, nonrep: false });
  const [structOIMode,  setStructOIMode]  = useState<"mt" | "usd">("mt");
  const [structSide,    setStructSide]    = useState<"gross" | "long" | "short" | "spreading">("gross");

  const processedStructData = useMemo(() => data.map(d => {
    const mkts = (structMarkets.ny ? ["ny"] : []).concat(structMarkets.ldn ? ["ldn"] : []);
    const agg: Record<string, number> = {};
    (["pmpu", "mm", "swap", "other", "nonRep"] as const).forEach(cat => {
      let mt_val = 0, usd_val = 0;
      mkts.forEach(m => {
        const factor        = m === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
        const price_usd_ton = m === "ny" ? d.priceNY * CENTS_LB_TO_USD_TON : d.priceLDN;
        const mData = (d as any)[m];
        const contracts =
          structSide === "long"      ? (mData[`${cat}Long`]   ?? 0) :
          structSide === "short"     ? (mData[`${cat}Short`]  ?? 0) :
          structSide === "spreading" ? (mData[`${cat}Spread`] ?? 0) :
          (mData[`${cat}Long`] ?? 0) + (mData[`${cat}Short`] ?? 0);
        mt_val  += contracts * factor;
        usd_val += contracts * factor * price_usd_ton;
      });
      agg[cat]            = mt_val;
      agg[`${cat}_usd`]   = usd_val / 1_000_000; // $M
    });
    const price = structMarkets.ny && structMarkets.ldn ? d.avgPrice_USD_Ton
      : structMarkets.ny ? d.priceNY : d.priceLDN;
    return { ...d, ...agg, displayPrice: price };
  }), [data, structMarkets, structSide]);

  const structPriceDomain = useMemo((): [number, number] => {
    const prices = processedStructData.slice(-52)
      .map((d: any) => d.displayPrice)
      .filter((p: any) => p != null && p > 0);
    if (!prices.length) return [0, 500];
    const mn  = Math.min(...prices);
    const mx  = Math.max(...prices);
    const pad = Math.max((mx - mn) * 0.15, mn * 0.03);
    return [Math.floor(mn - pad), Math.ceil(mx + pad)];
  }, [processedStructData]);

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

  // PDF-only chart data — always computed in a fixed mode, independent of macroToggle
  const PDF_SOFT_SYMBOLS = [
    { key: "arabica",     label: "Arabica Coffee",  color: "#f59e0b" },
    { key: "robusta",     label: "Robusta Coffee",  color: "#78350f" },
    { key: "sugar11",     label: "Sugar No. 11",    color: "#a3e635" },
    { key: "white_sugar", label: "White Sugar",     color: "#d1fae5" },
    { key: "cotton",      label: "Cotton",          color: "#60a5fa" },
    { key: "cocoa_ny",    label: "Cocoa NY",        color: "#a78bfa" },
    { key: "cocoa_ldn",   label: "Cocoa London",    color: "#7c3aed" },
    { key: "oj",          label: "Orange Juice",    color: "#fb923c" },
  ] as const;

  const pdfGrossData = useMemo(() => transformMacroData(macroData, "gross"), [macroData]);
  const pdfNetData   = useMemo(() => transformMacroData(macroData, "net"),   [macroData]);

  const pdfNetSplit = useMemo(() => pdfNetData.map(row => {
    const r: Record<string, any> = { date: row.date };
    for (const s of SECTORS) {
      const v = (row as any)[s] as number;
      r[`${s}_pos`] = v > 0 ? v : 0;
      r[`${s}_neg`] = v < 0 ? v : 0;
    }
    return r;
  }), [pdfNetData]);

  const pdfNetYDomain = useMemo((): [number, number] | undefined => {
    if (!pdfNetData.length) return undefined;
    const allVals = pdfNetData.flatMap(d => SECTORS.map(s => (d as any)[s] as number));
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const pad = Math.max(Math.abs(min), Math.abs(max)) * 0.15;
    return [+(min - pad).toFixed(2), +(max + pad).toFixed(2)];
  }, [pdfNetData]);

  const pdfSoftNetBase = useMemo(() => macroData
    .map(week => {
      const row: Record<string, any> = { date: week.date };
      for (const sym of PDF_SOFT_SYMBOLS) {
        const c = week.commodities.find(c => c.symbol === sym.key);
        row[sym.key] = (c?.net_exposure_usd ?? 0) / 1e9;
      }
      return row;
    })
    .filter(row => PDF_SOFT_SYMBOLS.some(s => Math.abs(row[s.key]) > 0)),
  [macroData]);

  const pdfSoftNetSplit = useMemo(() => pdfSoftNetBase.map(row => {
    const r: Record<string, any> = { date: row.date };
    for (const s of PDF_SOFT_SYMBOLS) {
      const v = row[s.key] as number;
      r[`${s.key}_pos`] = v > 0 ? v : 0;
      r[`${s.key}_neg`] = v < 0 ? v : 0;
    }
    return r;
  }), [pdfSoftNetBase]);

  const pdfSoftNetYDomain = useMemo((): [number, number] | undefined => {
    if (!pdfSoftNetBase.length) return undefined;
    const vals = pdfSoftNetBase.flatMap(row => PDF_SOFT_SYMBOLS.map(s => row[s.key] as number));
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const pad = Math.max(Math.abs(mn), Math.abs(mx)) * 0.15;
    return [+(mn - pad).toFixed(2), +(mx + pad).toFixed(2)];
  }, [pdfSoftNetBase]);

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
    const latestWeek = macroData[macroData.length - 1];
    let grossLong = 0, grossShort = 0;
    for (const c of latestWeek.commodities) {
      const g = c.gross_exposure_usd ?? 0;
      const n = c.net_exposure_usd   ?? 0;
      grossLong  += (g + n) / 2;
      grossShort += (g - n) / 2;
    }
    return {
      totalGross: grossLong + grossShort,
      grossLong,
      grossShort,
      netExp:     grossLong - grossShort,
      date:       latestWeek.date,
    };
  }, [macroData]);

  // Step 3
  const [cpMarkets, setCpMarkets] = useState({ ny: true, ldn: true });
  const [cpUnit,    setCpUnit]    = useState<CpUnit>("contracts");

  // Step 4
  const [indView, setIndView] = useState<"ny" | "ldn" | "combined">("combined");

  // Step 5
  const [dpMarkets, setDpMarkets] = useState({ ny: true, ldn: true });
  const [dpCats,    setDpCats]    = useState({ pmpu: true, mm: true, swap: true, other: true, nonrep: true });

  // Step 6
  const [obosView, setObosView] = useState<"both" | "ny" | "ldn">("both");

  // ── PDF download ──────────────────────────────────────────────────────────
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const handleDownloadPdf = async () => {
    if (!recent52.length || !macroData.length) return;
    setPdfGenerating(true);
    try {
      const { captureAllCharts } = await import("@/lib/pdf/chartCapture");
      const capturedCharts = await captureAllCharts({
        globalFlow:    pdfRefGlobalFlow,
        structural:    pdfRefStructural,
        counterparty:  pdfRefCounterparty,
        industryPulse: pdfRefIndustryPulse,
        dryPowder:     pdfRefDryPowder,
        obosMatrix:    pdfRefObosMatrix,
        macroGross:    pdfRefMacroGross,
        macroNet:      pdfRefMacroNet,
        softsContract: pdfRefSoftsContract,
      });

      const { buildGlobalFlowMetrics, buildMarketMetrics } = await import("@/lib/pdf/dataHelpers");
      const globalFlow = buildGlobalFlowMetrics(macroData);
      if (!globalFlow) throw new Error("Insufficient macro data");

      // Pass `data` (raw /api/cot rows) — structure_ny, exch_oi_ny, t_mm_short only exist there
      const rawData = data;
      const ny  = buildMarketMetrics(recent52, rawData, "ny");
      const ldn = buildMarketMetrics(recent52, rawData, "ldn");
      if (!ny || !ldn) throw new Error("Insufficient COT data");

      const cur = recent52[recent52.length - 1];
      const cotDateObj = new Date(cur.date);
      const cotDate = cotDateObj.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const weekNum = Math.ceil(
        (cotDateObj.getTime() - new Date(cotDateObj.getFullYear(), 0, 1).getTime()) / (7 * 86400000)
      );

      const reportData = {
        weekNumber: weekNum,
        year: cotDateObj.getFullYear(),
        cotDate,
        generatedAt: new Date().toISOString(),
        globalFlow,
        coffeeOverview: {
          combinedNetLots:   (ny.mmLong - ny.mmShort) + (ldn.mmLong - ldn.mmShort),
          combinedNetMT:     (ny.mmLong - ny.mmShort) * 5.625 + (ldn.mmLong - ldn.mmShort) * 10,
          alignedDirection:  Math.sign(ny.mmLong - ny.mmShort) === Math.sign(ldn.mmLong - ldn.mmShort),
          nyCombinedOiRank:  cur.oiRank    ?? 50,
          ldnCombinedOiRank: cur.oiRankLDN ?? 50,
        },
        ny,
        ldn,
        charts: {
          globalFlow:    capturedCharts.globalFlow    ?? null,
          structural:    capturedCharts.structural    ?? null,
          counterparty:  capturedCharts.counterparty  ?? null,
          industryPulse: capturedCharts.industryPulse ?? null,
          dryPowder:     capturedCharts.dryPowder     ?? null,
          obosMatrix:    capturedCharts.obosMatrix     ?? null,
          macroGross:    capturedCharts.macroGross    ?? null,
          macroNet:      capturedCharts.macroNet      ?? null,
          softsContract: capturedCharts.softsContract ?? null,
        },
      };

      const { pdf } = await import("@react-pdf/renderer");
      const { CotPdfReport } = await import("@/lib/pdf/PdfReport");
      const blob = await pdf(<CotPdfReport d={reportData} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `COT-Report-Week${weekNum}-${cotDateObj.getFullYear()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setPdfGenerating(false);
    }
  };

  const processedDpData = useMemo(() => {
    const byTf: Record<string, { date: string; traders: number; oi: number }[]> = {
      historical: [], year: [], recent_4: [], recent_1: [], current: [],
    };
    data.forEach(d => {
      const mkts = [
        ...(dpMarkets.ny  ? [{ key: "ny",  mt: ARABICA_MT_FACTOR, tr: d.tradersNY  }] : []),
        ...(dpMarkets.ldn ? [{ key: "ldn", mt: ROBUSTA_MT_FACTOR, tr: d.tradersLDN }] : []),
      ];
      let dpLong = 0, dpShort = 0, dpTraders = 0;
      mkts.forEach(m => {
        Object.keys(dpCats).forEach(cat => {
          if ((dpCats as any)[cat]) {
            const oiKey = cat === "nonrep" ? "nonRep" : cat;
            dpLong    += ((d as any)[m.key][`${oiKey}Long`])  * m.mt;
            dpShort   += ((d as any)[m.key][`${oiKey}Short`]) * m.mt;
            dpTraders += (m.tr as any)[cat];
          }
        });
      });
      const tf = d.timeframe as string;
      if (byTf[tf]) {
        byTf[tf].push({ date: d.date, traders: dpTraders, oi: dpLong  });
        byTf[tf].push({ date: d.date, traders: dpTraders, oi: -dpShort });
      }
    });
    return byTf;
  }, [data, dpMarkets, dpCats]);

  const dpDomain = useMemo(() => {
    const all = Object.values(processedDpData).flat();
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
  }, [processedDpData]);

  const recent52 = data.slice(-52);

  return (
    <div className="space-y-4">
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
      {/* Horizontal step nav */}
      <div className="flex items-center gap-1 flex-wrap border-b border-slate-700 pb-1">
        {NAV_STEPS.map(s => (
          <button key={s.id} onClick={() => setStep(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              step === s.id ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300"
            }`}>
            <span className={step === s.id ? "text-amber-400" : "text-slate-600"}>{ICONS[s.icon]}</span>
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-slate-600 font-mono">
          NY {latest.priceNY.toFixed(2)}¢ · LDN ${latest.priceLDN.toFixed(0)}
        </span>
        <button
          onClick={handleDownloadPdf}
          disabled={pdfGenerating || !recent52.length}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {pdfGenerating ? "Generating…" : "↓ Download PDF"}
        </button>
      </div>

      {/* ── Step 1: Global Money Flow ── */}
      {step === 1 && (
        <div>
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
            const fmtB = (v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v / 1e9).toFixed(1)}B`;
            const kpis = [
              { label: "Total Gross Exposure", value: fmtB(macroKpis.totalGross),  color: "#f9fafb" },
              { label: "Gross Long Exposure",  value: fmtB(macroKpis.grossLong),   color: "#10b981" },
              { label: "Gross Short Exposure", value: fmtB(macroKpis.grossShort),  color: "#ef4444" },
              { label: "Net Exposure",         value: fmtB(macroKpis.netExp),      color: macroKpis.netExp >= 0 ? "#10b981" : "#ef4444" },
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
          <div ref={pdfRefGlobalFlow} className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom: 16 }}>
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
          </div>

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

            const softChartData = macroData
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
              .filter(row => SOFT_SYMBOLS.some(s => Math.abs(row[s.key]) > 0));

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

            const softBase = macroData
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
              .filter(row => SOFT_SYMBOLS.some(s => Math.abs(row[s.key]) > 0));

            if (softBase.length < 2) return null;

            const weeklyChangeData = softBase.slice(1).map((row, i) => {
              const prev = softBase[i];
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
      )}

      {/* ── Step 2: Structural Integrity ── */}
      {step === 2 && (() => {
        const sk = (cat: string) => structOIMode === "usd" ? `${cat}_usd` : cat;
        const oiFmt = structOIMode === "usd"
          ? (v: number) => `$${(v / 1000).toFixed(0)}B`
          : (v: number) => `${(v / 1000).toFixed(0)}k`;
        const oiLabel = structOIMode === "usd" ? "OI Value ($B)" : "OI (k MT)";
        const priceFmt = (v: number) =>
          structMarkets.ny && !structMarkets.ldn ? `${v.toFixed(0)}¢`
          : `$${v.toFixed(0)}`;
        return (
          <div>
            <SectionHeader icon="Activity" title="2. Structural Integrity (Gross OI)"
              subtitle="Select Markets and Categories to analyze Open Interest composition." />
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <MarketToggle markets={structMarkets} set={k => setStructMarkets(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} />
                <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  {(["mt", "usd"] as const).map(m => (
                    <button key={m} onClick={() => setStructOIMode(m)}
                      className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${structOIMode === m ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                      {m === "mt" ? "MT" : "USD Value"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  {(["gross", "long", "short", "spreading"] as const).map(s => (
                    <button key={s} onClick={() => setStructSide(s)}
                      className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${structSide === s ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                      {s === "gross" ? "Gross" : s === "long" ? "Long" : s === "short" ? "Short" : "Spreading"}
                    </button>
                  ))}
                </div>
              </div>
              <CatToggles cats={structCats} set={k => setStructCats(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} items={CAT_ITEMS} />
            </div>
            <div ref={pdfRefStructural} className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={processedStructData.slice(-52)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                  <YAxis yAxisId="left" stroke="#475569" fontSize={10} tickFormatter={oiFmt}
                    label={{ value: oiLabel, angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
                  <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10}
                    domain={structPriceDomain} tickFormatter={priceFmt} />
                  <Tooltip contentStyle={CHART_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {structCats.pmpu   && <Area yAxisId="left" type="monotone" stackId="1" dataKey={sk("pmpu")}   name="PMPU"               fill="#3b82f6" stroke="#3b82f6" />}
                  {structCats.mm     && <Area yAxisId="left" type="monotone" stackId="1" dataKey={sk("mm")}     name="Managed Money"      fill="#f59e0b" stroke="#f59e0b" />}
                  {structCats.swap   && <Area yAxisId="left" type="monotone" stackId="1" dataKey={sk("swap")}   name="Swap Dealers"       fill="#10b981" stroke="#10b981" />}
                  {structCats.other  && <Area yAxisId="left" type="monotone" stackId="1" dataKey={sk("other")}  name="Other Reportables"  fill="#64748b" stroke="#64748b" />}
                  {structCats.nonrep && <Area yAxisId="left" type="monotone" stackId="1" dataKey={sk("nonRep")} name="Non Reportables"    fill="#94a3b8" stroke="#94a3b8" />}
                  <Line yAxisId="right" type="monotone" dataKey="displayPrice" name="Price" stroke="#ffffff" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* ── Step 3: Counterparty ── */}
      {step === 3 && (
        <div>
          <SectionHeader icon="Users" title="3. Counterparty Mapping"
            subtitle="Liquidity Handshake: Analyzing the balance between Long and Short ownership." />
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <MarketToggle markets={cpMarkets} set={k => setCpMarkets(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} />
            <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              {(["contracts", "mt", "usd"] as const).map(u => (
                <button key={u} onClick={() => setCpUnit(u)}
                  className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${cpUnit === u ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                  {u === "contracts" ? "Lots" : u === "mt" ? "MT" : "USD Value"}
                </button>
              ))}
            </div>
          </div>
          <div ref={pdfRefCounterparty} className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <RadialCounterparty
              latest={latest}
              prev1={data.length >= 2 ? data[data.length - 2] : null}
              prev4={data.length >= 5 ? data[data.length - 5] : null}
              markets={cpMarkets}
              unit={cpUnit}
            />
          </div>
        </div>
      )}

      {/* ── Step 4: Industry Pulse ── */}
      {step === 4 && (() => {
        const longKey  = indView === "ny" ? "pmpuLongMT_NY"  : indView === "ldn" ? "pmpuLongMT_LDN"  : "pmpuLongMT";
        const shortKey = indView === "ny" ? "pmpuShortMT_NY" : indView === "ldn" ? "pmpuShortMT_LDN" : "pmpuShortMT";
        const priceKey = indView === "ny" ? "priceNY"        : indView === "ldn" ? "priceLDN"         : "avgPrice_USD_Ton";
        const mtFmt    = (v: number) => `${(v / 1000).toFixed(0)}k`;
        const prices   = recent52.map(d => (d as any)[priceKey] as number).filter(v => v > 0);
        const priceDomain: [number, number] = prices.length
          ? [Math.floor(Math.min(...prices) / 100) * 100, Math.ceil(Math.max(...prices) / 100) * 100]
          : [0, 500];
        const mtVals   = recent52.flatMap(d => [(d as any)[longKey] as number, (d as any)[shortKey] as number]).filter(v => v > 0);
        const mtDomain: [number, number] = mtVals.length
          ? [Math.floor(Math.min(...mtVals) / 1000) * 1000, Math.ceil(Math.max(...mtVals) / 1000) * 1000]
          : [0, 100000];

        const deltaData = recent52.slice(1).map((d, i) => {
          const dl = (d as any)[longKey]  - (recent52[i] as any)[longKey];
          const ds = (d as any)[shortKey] - (recent52[i] as any)[shortKey];
          const efp = (d as any).efpMT;
          return {
            date:       d.date,
            deltaLong:  dl,
            deltaShort: ds,
            efpMT:      efp,
            efpPctLong:  Math.abs(dl)  > 0 ? (efp / Math.abs(dl))  * 100 : null,
            efpPctShort: Math.abs(ds)  > 0 ? (efp / Math.abs(ds))  * 100 : null,
          };
        });

        return (
          <div>
            <SectionHeader icon="Factory" title="4. Industry Pulse (Metric Tons)"
              subtitle="PMPU Gross Long & Short vs Price. Bottom panel: weekly position changes and EFP physical delivery." />
            <div className="flex gap-1 mb-4 bg-slate-900 p-1 rounded-lg border border-slate-800 w-fit">
              {(["ny", "ldn", "combined"] as const).map(m => (
                <button key={m} onClick={() => setIndView(m)}
                  className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${indView === m ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                  {m}
                </button>
              ))}
            </div>

            {/* Panel A — Gross Long & Short vs Price */}
            <div ref={pdfRefIndustryPulse} className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[320px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={recent52}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                  <YAxis yAxisId="left" stroke="#475569" fontSize={10} tickFormatter={mtFmt} domain={mtDomain}
                    label={{ value: "MT", angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
                  <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} domain={priceDomain} />
                  <Tooltip contentStyle={CHART_STYLE} formatter={(v: any, name: string) => [
                    name === "Price" ? v.toFixed(0) : `${(Number(v) / 1000).toFixed(1)}k MT`, name
                  ]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="left" type="monotone" dataKey={longKey}
                    name="Industry Long (MT)"  stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey={shortKey}
                    name="Industry Short (MT)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey={priceKey}
                    name="Price" stroke="#ffffff" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Panel B — Weekly Change + EFP */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[280px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={deltaData} margin={{ right: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                  <YAxis stroke="#475569" fontSize={10} tickFormatter={mtFmt}
                    label={{ value: "MT", angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
                  <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
                  <Tooltip contentStyle={CHART_STYLE} formatter={(v: any, name: string) => [`${(Number(v) / 1000).toFixed(1)}k MT`, name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="deltaLong"  name="Δ Long (wk)"  fill="#10b981" opacity={0.8} barSize={6} />
                  <Bar dataKey="deltaShort" name="Δ Short (wk)" fill="#3b82f6" opacity={0.8} barSize={6} />
                  <Line type="monotone" dataKey="efpMT"
                    name="EFP Physical" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Panel C — EFP % of Delta Long & Short */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={deltaData} margin={{ right: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                  <YAxis stroke="#475569" fontSize={10} tickFormatter={v => `${v.toFixed(0)}%`}
                    label={{ value: "%", angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
                  <ReferenceLine y={100} stroke="#475569" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Tooltip contentStyle={CHART_STYLE}
                    formatter={(v: any, name: string) => [v == null ? "n/a" : `${Number(v).toFixed(1)}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="efpPctLong"  name="EFP % of Δ Long"
                    stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="efpPctShort" name="EFP % of Δ Short"
                    stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* ── Step 5: Dry Powder ── */}
      {step === 5 && (
        <div>
          <SectionHeader icon="Droplets" title="5. Dry Powder Indicator"
            subtitle="Gross Long OI (positive) and Gross Short OI (negative) vs number of traders. Color = recency." />
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <MarketToggle markets={dpMarkets} set={k => setDpMarkets(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} />
            <CatToggles cats={dpCats} set={k => setDpCats(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} items={CAT_ITEMS} />
          </div>
          <div ref={pdfRefDryPowder} className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[460px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" dataKey="traders" name="# traders" stroke="#475569" fontSize={10}
                  domain={dpDomain.x}
                  label={{ value: "# traders", position: "insideBottom", offset: -10, fill: "#475569", fontSize: 10 }} />
                <YAxis type="number" dataKey="oi" name="OI" stroke="#475569" fontSize={10}
                  domain={dpDomain.y}
                  tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                  label={{ value: "OI (k ton equivalent)", angle: -90, position: "insideLeft", offset: -10, fill: "#475569", fontSize: 10 }} />
                <ReferenceLine y={0} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE}
                  formatter={(v: any, name: string) => [`${(Number(v) / 1000).toFixed(1)}k MT`, name]} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                  content={(props: any) => {
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
                  }}
                />
                <Scatter name="Historic"   data={processedDpData.historical} fill="#bfdbfe" fillOpacity={0.18} size={12}  />
                <Scatter name="Prior Y"    data={processedDpData.year}       fill="#3b82f6" fillOpacity={0.45} size={28}  />
                <Scatter name="Prior 4W"   data={processedDpData.recent_4}   fill="#eab308" fillOpacity={0.9}  size={78}  />
                <Scatter name="Prior week" data={processedDpData.recent_1}   fill="#c2410c" fillOpacity={1.0}  size={154} />
                <Scatter name="Last CoT"   data={processedDpData.current}    fill="#ef4444" fillOpacity={1.0}  size={314} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Step 6: Cycle Location ── */}
      {step === 6 && (() => {
        const cycleColor = (d: any, market: "ny" | "ldn") => {
          if (d.timeframe === "current")  return market === "ny" ? "#ef4444" : "#3b82f6";
          if (d.timeframe === "recent_1") return market === "ny" ? "#f97316" : "#3b82f6";
          return "#64748b";
        };
        const cycleOpacity = (d: any) => {
          if (d.timeframe === "current")  return 1.0;
          if (d.timeframe === "recent_1") return 0.75;
          if (d.timeframe === "recent_4") return 0.45;
          if (d.timeframe === "year")     return 0.25;
          return 0.12;
        };
        const nyPts  = recent52.map(d => ({ x: d.oiRank,    y: d.priceRank,    timeframe: d.timeframe, date: d.date }));
        const ldnPts = recent52.map(d => ({ x: d.oiRankLDN, y: d.priceRankLDN, timeframe: d.timeframe, date: d.date }));
        return (
          <div>
            <SectionHeader icon="Scale" title="6. Cycle Location (OB/OS Matrix)"
              subtitle="Mapping the convergence of Price Rank and Net Positioning Rank. Red = NY Arabica · Blue = LDN Robusta · Orange = last week." />
            <div className="flex items-center gap-2 mb-3">
              {(["both", "ny", "ldn"] as const).map(m => (
                <button key={m} onClick={() => setObosView(m)}
                  className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${obosView === m ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                  {m === "both" ? "NY + LDN" : m === "ny" ? "NY Arabica" : "LDN Robusta"}
                </button>
              ))}
            </div>
            <div ref={pdfRefObosMatrix} className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis type="number" dataKey="x" domain={[0, 100]} stroke="#475569" fontSize={10} label={{ value: "Net Positioning Rank (%)", position: "bottom", offset: 0, fill: "#475569", fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" domain={[0, 100]} stroke="#475569" fontSize={10} label={{ value: "Price Rank (%)", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 10 }} />
                  <ReferenceArea x1={0}  x2={25}  y1={0}  y2={25}  fill="#10b981" fillOpacity={0.08} stroke="#10b981" strokeOpacity={0.25}
                    label={{ value: "OVERSOLD", position: "insideTopRight", fill: "#10b981", fontSize: 9, fontWeight: "bold" }} />
                  <ReferenceArea x1={75} x2={100} y1={75} y2={100} fill="#ef4444" fillOpacity={0.08} stroke="#ef4444" strokeOpacity={0.25}
                    label={{ value: "OVERBOUGHT", position: "insideBottomLeft", fill: "#ef4444", fontSize: 9, fontWeight: "bold" }} />
                  <ReferenceLine x={50} stroke="#475569" strokeDasharray="5 5" />
                  <ReferenceLine y={50} stroke="#475569" strokeDasharray="5 5" />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE}
                    formatter={(v: any, _: string, props: any) => [`${Number(v).toFixed(1)}%`, props.name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {obosView !== "ldn" && (
                    <Scatter name="NY Arabica" data={nyPts}>
                      {nyPts.map((d, i) => (
                        <Cell key={i} fill={cycleColor(d, "ny")} fillOpacity={cycleOpacity(d)} />
                      ))}
                    </Scatter>
                  )}
                  {obosView !== "ny" && (
                    <Scatter name="LDN Robusta" data={ldnPts}>
                      {ldnPts.map((d, i) => (
                        <Cell key={i} fill={cycleColor(d, "ldn")} fillOpacity={cycleOpacity(d)} />
                      ))}
                    </Scatter>
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* ── Hidden off-screen chart divs for PDF capture ── */}
      {/* Always rendered regardless of current step so refs are mounted at PDF export time */}
      <div style={{ position: "fixed", top: -9999, left: -9999, width: 800, pointerEvents: "none", opacity: 0 }}>
        {/* Chart 1: Total Gross Exposure by Sector */}
        <div ref={pdfRefMacroGross} style={{ background: "#0f172a", padding: 16, width: 800, height: 280 }}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={pdfGrossData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v: number) => `$${Math.abs(v).toFixed(0)}B`} width={52} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {SECTORS.map(sector => {
                const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                return (
                  <Area key={sector} type="monotone" dataKey={sector}
                    stackId="1" name={label}
                    stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
                    fillOpacity={0.6} dot={false} />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 2: Net MM Exposure by Sector */}
        <div ref={pdfRefMacroNet} style={{ background: "#0f172a", padding: 16, width: 800, height: 280 }}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={pdfNetSplit} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(0)}B`} width={52} domain={pdfNetYDomain} />
              <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
              <Legend wrapperStyle={{ fontSize: 11 }} content={(props: any) => {
                const order = ["energy", "metals", "grains", "meats", "softs", "micros"];
                const labelMap: Record<string, string> = { energy: "Energies", metals: "Metals", grains: "Grains", meats: "Meats", softs: "Softs", micros: "Micros" };
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
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 3: Net MM Exposure — Softs by Contract */}
        <div ref={pdfRefSoftsContract} style={{ background: "#0f172a", padding: 16, width: 800, height: 260 }}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={pdfSoftNetSplit.length ? pdfSoftNetSplit : pdfSoftNetBase}
              margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(2)}B`} width={58} domain={pdfSoftNetYDomain} />
              <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {PDF_SOFT_SYMBOLS.map(s => (
                <Area key={`${s.key}_pos`} type="monotone" dataKey={`${s.key}_pos`}
                  stackId="pos" name={s.label}
                  stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} />
              ))}
              {PDF_SOFT_SYMBOLS.map(s => (
                <Area key={`${s.key}_neg`} type="monotone" dataKey={`${s.key}_neg`}
                  stackId="neg" name={`${s.key}_neg`}
                  stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} legendType="none" />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
