"use client";
import React, { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart,
  ScatterChart, Scatter, Cell, PieChart, Pie, ReferenceLine,
} from "recharts";

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

// ── Data generation ────────────────────────────────────────────────────────────
function generateData() {
  const weeks = 104;
  const data: any[] = [];
  let priceNY = 165, priceLDN = 2450, oiNY = 210000, oiLDN = 130000;
  let cumulativeNominal = 0, cumulativeMargin = 0;

  for (let i = 0; i < weeks; i++) {
    const date = new Date(2023, 0, 1 + i * 7).toISOString().split("T")[0];
    priceNY  += (Math.random() - 0.48) * 8;
    priceLDN += (Math.random() - 0.48) * 60;
    oiNY     += (Math.random() - 0.5)  * 5000;
    oiLDN    += (Math.random() - 0.5)  * 3000;

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

    const macroMarket = cumulativeNominal * 2.5 + Math.sin(i / 10) * 500;
    const macroSofts  = cumulativeNominal * 1.5 + Math.cos(i / 8)  * 200;

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

    const isRecent = i > weeks - 2, isMonth = i > weeks - 5, isYear = i > weeks - 53;

    data.push({
      id: i, date, priceNY, priceLDN, avgPrice_USD_Ton,
      oiNY, oiLDN, totalOI,
      spreadingTotal: spreadingNY + spreadingLDN,
      outrightTotal: (oiNY + oiLDN) - (spreadingNY + spreadingLDN),
      weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
      macroMarket, macroSofts,
      ny: nyD.oi, ldn: ldnD.oi,
      tradersNY: nyD.traders, tradersLDN: ldnD.traders,
      pmpuShortMT_NY:  nyD.oi.pmpuShort  * ARABICA_MT_FACTOR,
      pmpuShortMT_LDN: ldnD.oi.pmpuShort * ROBUSTA_MT_FACTOR,
      pmpuShortMT:     (nyD.oi.pmpuShort * ARABICA_MT_FACTOR) + (ldnD.oi.pmpuShort * ROBUSTA_MT_FACTOR),
      efpMT: efp * ARABICA_MT_FACTOR,
      timeframe: isRecent ? "current" : isMonth ? "month" : isYear ? "year" : "historical",
    });
  }

  return data.map((d, i) => {
    const slice = data.slice(Math.max(0, i - 52), i + 1);
    const maxP = Math.max(...slice.map(s => s.priceNY));
    const minP = Math.min(...slice.map(s => s.priceNY));
    const net  = d.ny.mmLong - d.ny.mmShort;
    const nets = slice.map(s => s.ny.mmLong - s.ny.mmShort);
    return {
      ...d,
      priceRank: ((d.priceNY - minP) / (maxP - minP)) * 100,
      oiRank: ((net - Math.min(...nets)) / (Math.max(...nets) - Math.min(...nets))) * 100,
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

function RadialCounterparty({ data }: { data: any[] }) {
  const latest = data[data.length - 1];
  const longs = [
    { name: "Managed Money",  value: latest.ny.mmLong    + latest.ldn.mmLong,   fill: "#f59e0b" },
    { name: "Swap Dealers",   value: latest.ny.swapLong  + latest.ldn.swapLong,  fill: "#10b981" },
    { name: "Industry (PMPU)",value: latest.ny.pmpuLong  + latest.ldn.pmpuLong,  fill: "#3b82f6" },
    { name: "Other/Non-Rep",  value: latest.ny.otherLong + latest.ldn.otherLong, fill: "#64748b" },
  ];
  const shorts = [
    { name: "Industry (PMPU)",value: latest.ny.pmpuShort  + latest.ldn.pmpuShort,  fill: "#3b82f6" },
    { name: "Managed Money",  value: latest.ny.mmShort    + latest.ldn.mmShort,    fill: "#f59e0b" },
    { name: "Swap Dealers",   value: latest.ny.swapShort  + latest.ldn.swapShort,  fill: "#10b981" },
    { name: "Other/Non-Rep",  value: latest.ny.otherShort + latest.ldn.otherShort, fill: "#64748b" },
  ];
  const tooltipStyle = { backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px" };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[320px]">
      {[{ label: "LONGS (Buyers)", color: "text-emerald-400", data: longs, dir: 1 },
        { label: "SHORTS (Sellers)", color: "text-red-400",   data: shorts, dir: -1 }].map(side => (
        <div key={side.label} className="relative h-full bg-slate-800/30 rounded-xl border border-slate-800/50 flex flex-col items-center justify-center p-4">
          <h4 className={`absolute top-4 ${side.color} font-bold text-xs uppercase tracking-widest`}>{side.label}</h4>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={side.data} cx="50%" cy="50%"
                startAngle={90} endAngle={90 + side.dir * 360}
                innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                {side.data.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="rgba(0,0,0,0)" />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ fontSize: 11 }} />
              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ))}
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

// ── Main component ─────────────────────────────────────────────────────────────

export default function CotDashboard() {
  const [step, setStep] = useState<Step>(1);
  const data = useMemo(() => generateData(), []);
  const latest = data[data.length - 1];

  // Step 1
  const [flowToggles, setFlowToggles] = useState({ market: true, softs: true, coffee: true });

  // Step 2
  const [structMarkets, setStructMarkets] = useState({ ny: true, ldn: false });
  const [structCats,    setStructCats]    = useState({ pmpu: true, mm: true, swap: true, other: true, nonrep: false });

  const processedStructData = useMemo(() => data.map(d => {
    const mkts = (structMarkets.ny ? ["ny"] : []).concat(structMarkets.ldn ? ["ldn"] : []);
    const agg: Record<string, number> = {};
    ["pmpu", "mm", "swap", "other", "nonRep"].forEach(cat => {
      agg[cat] = mkts.reduce((s, m) => s + (d as any)[m][`${cat}Long`] + (d as any)[m][`${cat}Short`], 0);
    });
    const price = structMarkets.ny && structMarkets.ldn ? d.avgPrice_USD_Ton
      : structMarkets.ny ? d.priceNY : d.priceLDN;
    return { ...d, ...agg, displayPrice: price };
  }), [data, structMarkets]);

  // Step 4
  const [indView, setIndView] = useState<"ny" | "ldn" | "combined">("combined");

  // Step 5
  const [dpMarkets, setDpMarkets] = useState({ ny: true, ldn: true });
  const [dpCats,    setDpCats]    = useState({ pmpu: true, mm: true, swap: true, other: true, nonrep: true });

  const processedDpData = useMemo(() => data.map(d => {
    const mkts = [
      ...(dpMarkets.ny  ? [{ key: "ny",  mt: ARABICA_MT_FACTOR, tr: d.tradersNY  }] : []),
      ...(dpMarkets.ldn ? [{ key: "ldn", mt: ROBUSTA_MT_FACTOR, tr: d.tradersLDN }] : []),
    ];
    let dpVol = 0, dpTraders = 0;
    mkts.forEach(m => {
      Object.keys(dpCats).forEach(cat => {
        if ((dpCats as any)[cat]) {
          dpVol     += ((d as any)[m.key][`${cat}Long`] + (d as any)[m.key][`${cat}Short`]) * m.mt;
          dpTraders += (m.tr as any)[cat.toLowerCase()];
        }
      });
    });
    return { ...d, dpVol, dpTraders };
  }), [data, dpMarkets, dpCats]);

  const recent52 = data.slice(-52);

  return (
    <div className="space-y-4">
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
      </div>

      {/* ── Step 1: Global Money Flow ── */}
      {step === 1 && (
        <div>
          <SectionHeader icon="Globe" title="1. Global Money Flow"
            subtitle="Cumulative Flow Analysis: Compare broad commodity flows vs specific coffee complex flows." />
          <div className="flex flex-wrap gap-2 mb-4">
            {[{ key: "market", label: "Commodity Market", color: "#94a3b8" },
              { key: "softs",  label: "Soft Commodities", color: "#60a5fa" },
              { key: "coffee", label: "Coffee Complex",   color: "#f59e0b" }].map(item => (
              <button key={item.key}
                onClick={() => setFlowToggles(p => ({ ...p, [item.key]: !(p as any)[item.key] }))}
                className={`flex items-center gap-2 px-3 py-1 rounded border text-xs font-bold transition-all ${(flowToggles as any)[item.key] ? "bg-slate-800 border-slate-600 text-slate-100" : "bg-transparent border-slate-800 text-slate-500"}`}>
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color, opacity: (flowToggles as any)[item.key] ? 1 : 0.3 }} />
                {item.label}
              </button>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={recent52}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                <YAxis yAxisId="left"  stroke="#475569" fontSize={10} />
                <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} />
                <Tooltip contentStyle={CHART_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {flowToggles.market && <Line yAxisId="left" type="monotone" dataKey="macroMarket" name="Commodity Market" stroke="#94a3b8" strokeWidth={1} dot={false} strokeDasharray="3 3" />}
                {flowToggles.softs  && <Line yAxisId="left" type="monotone" dataKey="macroSofts"  name="Soft Commodities" stroke="#60a5fa" strokeWidth={1} dot={false} strokeDasharray="3 3" />}
                {flowToggles.coffee && <>
                  <Bar  yAxisId="right" dataKey="weeklyMarginFlow"  name="Coffee Weekly Flow"     fill="#f59e0b" opacity={0.3} barSize={6} />
                  <Line yAxisId="left"  type="monotone" dataKey="cumulativeNominal" name="Coffee Nominal (Cum)"    stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line yAxisId="left"  type="monotone" dataKey="cumulativeMargin"  name="Coffee Margin-Adj (Cum)" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                </>}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Step 2: Structural Integrity ── */}
      {step === 2 && (
        <div>
          <SectionHeader icon="Activity" title="2. Structural Integrity (Gross OI)"
            subtitle="Select Markets and Categories to analyze Open Interest composition." />
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <MarketToggle markets={structMarkets} set={k => setStructMarkets(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} />
            <CatToggles cats={structCats} set={k => setStructCats(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} items={CAT_ITEMS} />
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={processedStructData.slice(-52)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                <YAxis yAxisId="left"  stroke="#475569" fontSize={10} />
                <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} />
                <Tooltip contentStyle={CHART_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {structCats.pmpu   && <Area yAxisId="left" type="monotone" stackId="1" dataKey="pmpu"   name="PMPU"               fill="#3b82f6" stroke="#3b82f6" />}
                {structCats.mm     && <Area yAxisId="left" type="monotone" stackId="1" dataKey="mm"     name="Managed Money"      fill="#f59e0b" stroke="#f59e0b" />}
                {structCats.swap   && <Area yAxisId="left" type="monotone" stackId="1" dataKey="swap"   name="Swap Dealers"       fill="#10b981" stroke="#10b981" />}
                {structCats.other  && <Area yAxisId="left" type="monotone" stackId="1" dataKey="other"  name="Other Reportables"  fill="#64748b" stroke="#64748b" />}
                {structCats.nonrep && <Area yAxisId="left" type="monotone" stackId="1" dataKey="nonRep" name="Non Reportables"    fill="#94a3b8" stroke="#94a3b8" />}
                <Line yAxisId="right" type="monotone" dataKey="displayPrice" name="Price" stroke="#ffffff" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Step 3: Counterparty ── */}
      {step === 3 && (
        <div>
          <SectionHeader icon="Users" title="3. Counterparty Mapping"
            subtitle="Liquidity Handshake: Analyzing the balance between Long and Short ownership." />
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <RadialCounterparty data={data} />
          </div>
        </div>
      )}

      {/* ── Step 4: Industry Pulse ── */}
      {step === 4 && (
        <div>
          <SectionHeader icon="Factory" title="4. Industry Pulse (Metric Tons)"
            subtitle="PMPU Short Coverage vs Price. Toggle Markets to see physical hedging depth." />
          <div className="flex gap-1 mb-4 bg-slate-900 p-1 rounded-lg border border-slate-800 w-fit">
            {(["ny", "ldn", "combined"] as const).map(m => (
              <button key={m} onClick={() => setIndView(m)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${indView === m ? "bg-slate-800 text-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                {m}
              </button>
            ))}
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={recent52}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
                <YAxis yAxisId="left"  stroke="#475569" fontSize={10} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} />
                <Tooltip contentStyle={CHART_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Area yAxisId="left" type="monotone"
                  dataKey={indView === "ny" ? "pmpuShortMT_NY" : indView === "ldn" ? "pmpuShortMT_LDN" : "pmpuShortMT"}
                  name="Industry Short (MT)" fill="#3b82f6" fillOpacity={0.2} stroke="#3b82f6" />
                <Bar  yAxisId="left"  dataKey="efpMT" name="EFP (Physical Delivery)" fill="#10b981" barSize={8} />
                <Line yAxisId="right" type="monotone"
                  dataKey={indView === "ny" ? "priceNY" : indView === "ldn" ? "priceLDN" : "avgPrice_USD_Ton"}
                  name="Price" stroke="#ffffff" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Step 5: Dry Powder ── */}
      {step === 5 && (
        <div>
          <SectionHeader icon="Droplets" title="5. Dry Powder Indicator"
            subtitle="Visualizing min/max potential vs markets with significant participation upside." />
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <MarketToggle markets={dpMarkets} set={k => setDpMarkets(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} />
            <CatToggles cats={dpCats} set={k => setDpCats(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} items={CAT_ITEMS} />
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" dataKey="dpTraders" name="Traders" stroke="#475569" fontSize={10} label={{ value: "Trader Count", position: "bottom", offset: 0, fill: "#475569", fontSize: 10 }} />
                <YAxis type="number" dataKey="dpVol" name="Volume (MT)" stroke="#475569" fontSize={10} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE} />
                <Scatter data={processedDpData}>
                  {processedDpData.map((entry, i) => (
                    <Cell key={i} fill={
                      entry.timeframe === "current"    ? "#ef4444" :
                      entry.timeframe === "month"      ? "#f97316" :
                      entry.timeframe === "year"       ? "#3b82f6" : "#334155"
                    } fillOpacity={entry.timeframe === "historical" ? 0.2 : 0.8} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Step 6: Cycle Location ── */}
      {step === 6 && (
        <div>
          <SectionHeader icon="Scale" title="6. Cycle Location (OB/OS Matrix)"
            subtitle="Mapping the convergence of Price Rank and Net Positioning Rank." />
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px] relative">
            <div className="absolute inset-0 pointer-events-none grid grid-cols-2 grid-rows-2 opacity-10 m-10">
              <div className="border border-slate-700 bg-slate-500/20" />
              <div className="border border-slate-700 bg-red-500/40 flex items-center justify-center"><span className="text-[9px] font-bold text-red-400">OVERBOUGHT</span></div>
              <div className="border border-slate-700 bg-emerald-500/40 flex items-center justify-center"><span className="text-[9px] font-bold text-emerald-400">OVERSOLD</span></div>
              <div className="border border-slate-700 bg-slate-500/20" />
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" dataKey="oiRank"    domain={[0, 100]} stroke="#475569" fontSize={10} label={{ value: "Net Positioning Rank (%)", position: "bottom", offset: 0, fill: "#475569", fontSize: 10 }} />
                <YAxis type="number" dataKey="priceRank" domain={[0, 100]} stroke="#475569" fontSize={10} label={{ value: "Price Rank (%)", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 10 }} />
                <ReferenceLine x={50} stroke="#475569" strokeDasharray="5 5" />
                <ReferenceLine y={50} stroke="#475569" strokeDasharray="5 5" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE} />
                <Scatter data={recent52}>
                  {recent52.map((_, i) => (
                    <Cell key={i} fill={i === 51 ? "#ef4444" : "#64748b"} fillOpacity={i === 51 ? 1 : 0.4} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
