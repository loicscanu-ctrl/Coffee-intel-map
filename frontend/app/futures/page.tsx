"use client";
import React, { useEffect, useMemo, useState } from "react";
import { fetchNews } from "@/lib/api";
import CotDashboard from "@/components/futures/CotDashboard";

interface Contract {
  contract: string;
  expiry: string;
  last: number;
  chg: number;
  oi: number;
  volume: number;
  symbol: string;
}

interface CotGroup {
  long: number;
  short: number;
  spread?: number;
  d_long: number;
  d_short: number;
  d_spread?: number;
}

interface CotData {
  report_date: string;
  open_interest: number;
  pmpu: CotGroup;
  swap: CotGroup;
  mm: CotGroup;
  other: CotGroup;
  nr: CotGroup;
}

interface NewsItem {
  id: number;
  title: string;
  body: string;
  source: string;
  tags: string[];
  meta?: string | null;
  pub_date: string;
}

function fmt(n: number) { return n?.toLocaleString() ?? "—"; }
function parseBodyPrice(body: string): number | null {
  const m = body.match(/price:\s*([\d.,]+)/i);
  if (!m) return null;
  const raw = m[1];
  // Vietnamese thousands: "94.000" (2-3 digits + dot + exactly 3 digits) → 94000
  const n = /^\d{2,3}\.\d{3}$/.test(raw)
    ? parseInt(raw.replace(/\./g, ""), 10)
    : parseFloat(raw.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}
function fmtChg(n: number) {
  if (n == null) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}
function fmtChgInt(n: number) {
  if (n == null) return "—";
  return (n >= 0 ? "+" : "") + n.toLocaleString();
}

// ─── First Notice Day ─────────────────────────────────────────────────────────

const LETTER_TO_MONTH: Record<string, number> = {
  F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12,
};
const MONTH_ABB = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function firstBusinessDay(year: number, month: number): Date {
  // month is 1-indexed; returns first business day of that month
  const d = new Date(year, month - 1, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function subtractBusinessDays(date: Date, n: number): Date {
  const d = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining--;
  }
  return d;
}

function firstNoticeDay(symbol: string): string {
  const m = symbol.match(/^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return "—";
  const [, product, letter, yr] = m;
  const monthNum = LETTER_TO_MONTH[letter.toUpperCase()];
  if (!monthNum) return "—";
  const year = 2000 + parseInt(yr);

  // FND = N business days before the first business day of the delivery month
  // KC (Coffee C / Arabica): 7 business days prior
  // RC/RM (Robusta): 4 business days prior
  const days = product.toUpperCase() === "KC" ? 7 : 4;
  const fbdm = firstBusinessDay(year, monthNum);
  const fnd  = subtractBusinessDays(fbdm, days);
  return `${fnd.getDate()} ${MONTH_ABB[fnd.getMonth() + 1]}`;
}

// ─── Futures Chain Table ──────────────────────────────────────────────────────

function ChainTable({ item }: { item: NewsItem }) {
  let data: { contracts: Contract[] } | null = null;
  try { data = item.meta ? JSON.parse(item.meta) : null; } catch { return null; }
  if (!data?.contracts?.length) return null;

  const isArabica = item.tags.includes("arabica");
  const unit   = isArabica ? "¢/lb" : "$/t";
  const label  = isArabica ? "ICE NY  —  Arabica (KC)" : "ICE London  —  Robusta (RC)";
  const accent = isArabica ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <span className={`font-semibold text-sm ${accent}`}>{label}</span>
        <span className="text-xs text-slate-500">Barchart · {item.pub_date?.slice(0, 10)}</span>
      </div>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="text-left  px-3 py-2 w-28">Contract</th>
            <th className="text-center px-2 py-2 w-20">FND</th>
            <th className="text-left  px-2 py-2 w-24">Expiry</th>
            <th className="text-right px-3 py-2">Last ({unit})</th>
            <th className="text-right px-2 py-2">Chg</th>
            <th className="text-right px-2 py-2">OI</th>
            <th className="text-right px-2 py-2">Vol</th>
          </tr>
        </thead>
        <tbody>
          {data.contracts.map((c, i) => {
            const chgColor = (c.chg ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";
            return (
              <tr key={c.symbol} className={`border-t border-slate-800 ${i === 0 ? "text-white" : "text-slate-300"}`}>
                <td className="px-3 py-2 font-bold">{c.symbol}</td>
                <td className="px-2 py-2 text-center text-amber-400/80">{firstNoticeDay(c.symbol)}</td>
                <td className="px-2 py-2 text-slate-400">{c.expiry}</td>
                <td className={`px-3 py-2 text-right font-bold ${i === 0 ? accent : ""}`}>{c.last?.toFixed(2)}</td>
                <td className={`px-2 py-2 text-right ${chgColor}`}>{fmtChg(c.chg)}</td>
                <td className="px-2 py-2 text-right">{fmt(c.oi)}</td>
                <td className="px-2 py-2 text-right text-slate-400">{fmt(c.volume)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── COT Table ────────────────────────────────────────────────────────────────

function CotTable({ item }: { item: NewsItem }) {
  let cot: CotData | null = null;
  try { cot = item.meta ? JSON.parse(item.meta) : null; } catch { return null; }
  if (!cot) return null;

  const isArabica = item.tags.includes("arabica");
  const cotLabel  = isArabica
    ? "CFTC Disaggregated COT — Coffee C (NY Arabica)"
    : "ICE Disaggregated COT — Robusta Coffee (London)";
  const accent = isArabica ? "text-blue-400" : "text-emerald-400";

  const rows: { label: string; key: keyof CotData }[] = [
    { label: "Producer / Merchant (PMPU)", key: "pmpu"  },
    { label: "Swap Dealers",               key: "swap"  },
    { label: "Managed Money (MM)",         key: "mm"    },
    { label: "Other Reportables",          key: "other" },
    { label: "Non-Reportables",            key: "nr"    },
  ];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden mb-4">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <span className={`font-semibold text-sm ${accent}`}>{cotLabel}</span>
        <span className="text-xs text-slate-500">
          Report: {cot.report_date} · OI: {fmt(cot.open_interest)}
        </span>
      </div>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="text-left  px-3 py-2 w-52">Category</th>
            <th className="text-right px-3 py-2">Long</th>
            <th className="text-right px-3 py-2">ΔLong</th>
            <th className="text-right px-3 py-2">Short</th>
            <th className="text-right px-3 py-2">ΔShort</th>
            <th className="text-right px-3 py-2">Spreading</th>
            <th className="text-right px-3 py-2">ΔSpread</th>
            <th className="text-right px-3 py-2">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, key }) => {
            const g = cot![key] as CotGroup;
            if (!g) return null;
            const net      = g.long - g.short;
            const netColor = net >= 0 ? "text-emerald-400" : "text-red-400";
            const dlColor  = (g.d_long  ?? 0) >= 0 ? "text-emerald-400/70" : "text-red-400/70";
            const dsColor  = (g.d_short ?? 0) >= 0 ? "text-emerald-400/70" : "text-red-400/70";
            return (
              <tr key={key} className="border-t border-slate-800 text-slate-300">
                <td className="px-3 py-2 text-slate-400">{label}</td>
                <td className="px-3 py-2 text-right">{fmt(g.long)}</td>
                <td className={`px-3 py-2 text-right ${dlColor}`}>{fmtChgInt(g.d_long)}</td>
                <td className="px-3 py-2 text-right">{fmt(g.short)}</td>
                <td className={`px-3 py-2 text-right ${dsColor}`}>{fmtChgInt(g.d_short)}</td>
                <td className="px-3 py-2 text-right text-slate-500">{g.spread != null ? fmt(g.spread) : "—"}</td>
                <td className="px-3 py-2 text-right text-slate-500">{g.d_spread != null ? fmtChgInt(g.d_spread) : "—"}</td>
                <td className={`px-3 py-2 text-right font-bold ${netColor}`}>{fmtChgInt(net)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Quotation Tab ────────────────────────────────────────────────────────────

// Shipping month → next available RC contract letter
const SHIPMENT_TO_CONTRACT: Record<number, string> = {
  1:"H", 2:"H",   // Jan/Feb  → RCH (Mar)
  3:"K", 4:"K",   // Mar/Apr  → RCK (May)
  5:"N", 6:"N",   // May/Jun  → RCN (Jul)
  7:"U", 8:"U",   // Jul/Aug  → RCU (Sep)
  9:"X", 10:"X",  // Sep/Oct  → RCX (Nov)
  11:"F", 12:"F", // Nov/Dec  → RCF (Jan next year)
};

interface Quality {
  key: string;
  section: string;
  label: string;
  desc: string;
  diff: number;
  isBasis?: boolean;
}

const QUALITIES: Quality[] = [
  { key:"g3",    section:"GRADE 3  ·  SCREEN 12", label:"Standard",  desc:"FM 5%, 20-25%BB, MC 13%",           diff:-250           },
  { key:"g2",    section:"GRADE 2  ·  SCREEN 13", label:"★  Basis",  desc:"Standard, BB 5%, FM 1%, MC 13%",    diff:0,  isBasis:true },
  { key:"s16s",  section:"GRADE 1  ·  SCREEN 16", label:"Standard",  desc:"BB 2%, FM 0.5%, MC 12.5%",          diff:70             },
  { key:"s16c",  section:"GRADE 1  ·  SCREEN 16", label:"Clean",     desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:120            },
  { key:"s16wp", section:"GRADE 1  ·  SCREEN 16", label:"WP",        desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:190            },
  { key:"s18s",  section:"GRADE 1  ·  SCREEN 18", label:"Standard",  desc:"BB 2%, FM 0.5%, MC 12.5%",          diff:80             },
  { key:"s18c",  section:"GRADE 1  ·  SCREEN 18", label:"Clean",     desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:130            },
  { key:"s18wp", section:"GRADE 1  ·  SCREEN 18", label:"WP",        desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:200            },
];

function fmtDiff(letter: string, diff: number): string {
  return diff >= 0 ? `${letter}+${diff}` : `${letter}${diff}`;
}

const PACKING_OPTIONS = [
  { key: "jute",   label: "Food-grade jute bags  60 kg each", display: "+25 USD/MT", val: 25 },
  { key: "bigbag", label: "Big bags  1 MT per bag",           display: "+15 USD/MT", val: 15 },
];
const CERT_OPTIONS = [
  { key: "eudr", label: "EUDR",                                        display: "+50 USD/MT",                        val: 50 },
  { key: "4c",   label: "4C",                                          display: "+15 USD/MT",                        val: 15 },
  { key: "rfa",  label: "RFA  (excl. 1.75 cts/lb buyer royalty fee)",  display: "+5 cts/lb · +60 USD/MT (Robusta)",  val: 60 },
];

function QuotationTab({ contracts = [], vndPrice, usdvnd }: { contracts?: Contract[]; vndPrice?: number | null; usdvnd?: number | null }) {
  const [basisOverride, setBasisOverride]     = useState<number | null>(null);
  const [freight, setFreight]                 = useState(0);
  const [financing, setFinancing]             = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());

  const toggleOption = (key: string) =>
    setSelectedOptions(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });

  const optionsAddon = [...PACKING_OPTIONS, ...CERT_OPTIONS]
    .filter(o => selectedOptions.has(o.key))
    .reduce((sum, o) => sum + o.val, 0);

  // Build RC price lookup from fetched chain data
  const rcPrices = useMemo(() => {
    const p: Record<string, number> = {};
    contracts.forEach(c => {
      const m = c.symbol.match(/^R[CM]([FGHJKMNQUVXZ])\d{2}$/i);
      if (m && !(m[1].toUpperCase() in p)) p[m[1].toUpperCase()] = c.last; // first = nearest expiry
    });
    return p;
  }, [contracts]);

  // 8 shipping months base (stable, only depends on today)
  const monthsBase = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 8 }, (_, i) => {
      const d  = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const mo = d.getMonth() + 1;
      const yr = d.getFullYear();
      const letter = SHIPMENT_TO_CONTRACT[mo];
      const cYear  = letter === "F" && mo >= 11 ? yr + 1 : yr;
      return { label: `${MONTH_ABB[mo]}-${String(yr).slice(2)}`, mo, yr, letter, contractSym: `RC${letter}${String(cYear).slice(2)}` };
    });
  }, []);

  // Detect unique contract transitions in the 8-month window
  const transitions = useMemo(() => {
    const result: { from: string; to: string; key: string }[] = [];
    let prev = monthsBase[0]?.letter ?? "";
    monthsBase.slice(1).forEach(m => {
      if (m.letter !== prev) {
        const key = `${prev}-${m.letter}`;
        if (!result.find(t => t.key === key)) result.push({ from: prev, to: m.letter, key });
        prev = m.letter;
      }
    });
    return result;
  }, [monthsBase]);

  // Default basis: (VND price / USDVND * 1000) − front RC price
  const basisDefault = useMemo(() => {
    const frontLetter = monthsBase[0]?.letter;
    const frontPrice  = frontLetter ? rcPrices[frontLetter] : null;
    if (vndPrice && usdvnd && frontPrice) return Math.round(vndPrice / usdvnd * 1000 - frontPrice);
    return 150;
  }, [vndPrice, usdvnd, rcPrices, monthsBase]);

  // basisOverride = null means use the computed default; non-null = user's manual value
  const basisDiff = basisOverride ?? basisDefault;

  // Months with cumulative inter-contract spread (auto from market prices)
  const months = useMemo(() => {
    let cumSpread = 0;
    let lastLetter = monthsBase[0]?.letter ?? "";
    return monthsBase.map((m, i) => {
      if (m.letter !== lastLetter) {
        const fromPrice = rcPrices[lastLetter];
        const toPrice   = rcPrices[m.letter];
        if (fromPrice != null && toPrice != null) cumSpread += Math.round(fromPrice - toPrice);
        lastLetter = m.letter;
      }
      return { ...m, contractLetter: m.letter, basisForMonth: basisDiff + i * 30 + cumSpread };
    });
  }, [monthsBase, rcPrices, basisDiff]);

  const sections: string[] = [];
  QUALITIES.forEach(q => { if (!sections.includes(q.section)) sections.push(q.section); });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
            Basis — Grade 2 S13 — 1st Shipment Month
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={basisDiff}
              onChange={e => setBasisOverride(Number(e.target.value))}
              className="w-24 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white font-mono text-sm text-right focus:outline-none focus:border-indigo-500"
            />
            <span className="text-slate-400 text-sm">USD / MT</span>
          </div>
        </div>
        {(["Freight", "Financing"] as const).map(label => {
          const val   = label === "Freight" ? freight   : financing;
          const setVal = label === "Freight" ? setFreight : setFinancing;
          return (
            <div key={label} className="border-l border-slate-700 pl-6">
              <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">{label} — USD/MT</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={val}
                  onChange={e => setVal(Number(e.target.value))}
                  className="w-24 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sky-300 font-mono text-sm text-right focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          );
        })}
        {transitions.length > 0 && (
          <div className="border-l border-slate-700 pl-6">
            <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
              Calendar Spreads — USD/MT
            </div>
            <div className="flex flex-wrap gap-4">
              {transitions.map(({ key, from, to }) => {
                const val = (rcPrices[from] != null && rcPrices[to] != null)
                  ? Math.round(rcPrices[from] - rcPrices[to])
                  : null;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-mono">RC {from}→{to}</span>
                    <span className="text-amber-300 font-mono text-sm font-bold">
                      {val != null ? (val >= 0 ? `+${val}` : `${val}`) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="text-xs text-slate-500 leading-relaxed border-l border-slate-700 pl-6">
          Monthly carry <span className="text-slate-300 font-medium">+30 USD/MT</span> per shipment month<br />
          RC bimonthly cycle: K (May) · N (Jul) · U (Sep) · X (Nov) · F (Jan)<br />
          <span className="text-slate-600">FOB · Bulk · CAD 1st · ESCC NSW 0.5% · All subject to confirmation</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-xs font-mono min-w-full">
            <thead>
              <tr className="bg-slate-800 border-b border-slate-600">
                <th className="text-left px-4 py-2.5 text-slate-400 font-bold uppercase text-[10px] min-w-[110px] border-r border-slate-700">
                  Grade
                </th>
                <th className="text-left px-3 py-2.5 text-slate-400 font-bold uppercase text-[10px] min-w-[230px] border-r border-slate-700">
                  Specification
                </th>
                <th className="text-center px-2 py-2.5 text-slate-400 text-[10px] w-16 border-r border-slate-700">
                  Unit
                </th>
                {months.map((m, i) => (
                  <th key={i} className="px-3 py-2.5 text-center min-w-[84px] border-l border-slate-700">
                    <div className="text-white font-bold">{m.label}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{m.contractSym}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map(section => {
                const sectionQuals = QUALITIES.filter(q => q.section === section);
                return (
                  <React.Fragment key={section}>
                    <tr className="bg-slate-800/50 border-t border-slate-600">
                      <td
                        colSpan={3 + months.length}
                        className="px-4 py-1.5 text-[10px] text-slate-400 uppercase font-bold tracking-widest"
                      >
                        {section}
                      </td>
                    </tr>
                    {sectionQuals.map(q => (
                      <tr
                        key={q.key}
                        className={`border-t border-slate-800/60 transition-colors ${
                          q.isBasis ? "bg-indigo-950/30" : "hover:bg-slate-800/20"
                        }`}
                      >
                        <td className={`px-4 py-2 border-r border-slate-800 font-medium ${
                          q.isBasis ? "text-indigo-300" : "text-slate-200"
                        }`}>
                          {q.label}
                        </td>
                        <td className="px-3 py-2 text-slate-500 text-[10px] border-r border-slate-800">
                          {q.desc}
                        </td>
                        <td className="px-2 py-2 text-center text-slate-500 border-r border-slate-800">
                          USD/MT
                        </td>
                        {months.map((m, i) => {
                          const totalDiff = Math.round((m.basisForMonth + q.diff + optionsAddon + freight + financing) / 5) * 5;
                          const display   = fmtDiff(m.contractLetter, totalDiff);
                          const color = q.isBasis
                            ? "text-indigo-300"
                            : totalDiff >= 0 ? "text-emerald-400" : "text-red-400";
                          return (
                            <td key={i} className={`px-3 py-2 text-center font-bold border-l border-slate-800/50 ${color}`}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-slate-700 text-[10px] text-slate-500">
          * Diffs quoted vs ICE London (RC) bimonthly contracts. Basis = Grade 2 S13 Standard.
          Screen 18 = Screen 16 + 10. Grade 3 = Basis − 250. Prices indicative, subject to availability and confirmation.
        </div>
      </div>

      {/* Packing & Compliance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-3">
            Packing Options
          </div>
          <div className="space-y-2">
            {PACKING_OPTIONS.map(o => {
              const on = selectedOptions.has(o.key);
              return (
                <button
                  key={o.key}
                  onClick={() => toggleOption(o.key)}
                  className={`w-full flex justify-between items-center text-xs px-3 py-2 rounded border transition-colors cursor-pointer ${
                    on ? "bg-emerald-900/40 border-emerald-600 text-emerald-300" : "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-sm border flex-shrink-0 ${on ? "bg-emerald-500 border-emerald-400" : "border-slate-500"}`} />
                    {o.label}
                  </span>
                  <span className={`font-bold font-mono whitespace-nowrap ml-4 ${on ? "text-emerald-300" : "text-emerald-500"}`}>{o.display}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-3">
            Certificate &amp; Compliance{" "}
            <span className="text-slate-600 normal-case font-normal">(subject to availability)</span>
          </div>
          <div className="space-y-2">
            {CERT_OPTIONS.map(o => {
              const on = selectedOptions.has(o.key);
              return (
                <button
                  key={o.key}
                  onClick={() => toggleOption(o.key)}
                  className={`w-full flex justify-between items-center text-xs px-3 py-2 rounded border transition-colors cursor-pointer ${
                    on ? "bg-amber-900/30 border-amber-600 text-amber-300" : "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-sm border flex-shrink-0 ${on ? "bg-amber-500 border-amber-400" : "border-slate-500"}`} />
                    {o.label}
                  </span>
                  <span className={`font-bold font-mono whitespace-nowrap ml-4 ${on ? "text-amber-300" : "text-amber-500"}`}>{o.display}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FuturesPage() {
  const [allItems, setAllItems] = useState<NewsItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<"exchange" | "quotation" | "cot">("exchange");

  useEffect(() => {
    fetchNews()
      .then((data: NewsItem[]) => setAllItems(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const items        = allItems.filter(i => i.tags?.includes("futures"));
  const chains       = items.filter(i => i.tags.includes("price") && i.meta);
  const cots         = items.filter(i => i.tags.includes("cot")   && i.meta);
  const robustaChain = chains.find(i => i.tags.includes("robusta"));
  const arabicaChain = chains.find(i => i.tags.includes("arabica"));

  const vndItem  = allItems.find(i => i.tags?.includes("vietnam") && i.tags?.includes("price") && i.tags?.includes("robusta") && !i.tags?.includes("futures"));
  const fxVndItem = allItems.find(i => i.tags?.includes("fx") && i.tags?.includes("vietnam"));
  const vndPrice = vndItem   ? parseBodyPrice(vndItem.body)   : null;
  const usdvnd   = fxVndItem ? parseBodyPrice(fxVndItem.body) : null;

  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-slate-700">
        <h1 className="text-lg font-bold text-white mr-4">Futures</h1>
        {(["exchange", "quotation", "cot"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t capitalize transition-colors ${
              tab === t
                ? "bg-slate-800 text-white border border-b-transparent border-slate-700 -mb-px"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <p className="text-slate-500 text-sm">Loading…</p>}

      {/* Exchange tab */}
      {tab === "exchange" && (
        <>
          {!loading && !robustaChain && !arabicaChain && (
            <p className="text-slate-500 text-sm italic">
              No futures data yet — check back after the next scrape run.
            </p>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {robustaChain && <ChainTable item={robustaChain} />}
            {arabicaChain && <ChainTable item={arabicaChain} />}
          </div>
          <div className="space-y-0 mt-4">
            {cots.map(item => <CotTable key={item.id} item={item} />)}
          </div>
        </>
      )}

      {/* Quotation tab */}
      {tab === "quotation" && (
        <QuotationTab
          contracts={robustaChain?.meta ? (() => { try { return JSON.parse(robustaChain.meta!).contracts ?? []; } catch { return []; } })() : []}
          vndPrice={vndPrice}
          usdvnd={usdvnd}
        />
      )}

      {/* CoT tab */}
      {tab === "cot" && <CotDashboard />}
    </div>
  );
}
