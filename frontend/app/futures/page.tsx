"use client";
import React, { useEffect, useMemo, useState } from "react";
import OIHistoryTable from "@/components/futures/OIHistoryTable";
import OIFndChart from "@/components/futures/OIFndChart";
import CotBacktestReport from "@/components/futures/CotBacktestReport";
import AcapheLiveQuotes from "@/components/futures/AcapheLiveQuotes";

interface Contract {
  contract: string;
  expiry: string;
  last: number;
  chg: number;
  oi: number;
  volume: number;
  symbol: string;
}

function fmt(n: number) { return n?.toLocaleString() ?? "—"; }
function fmtChg(n: number) {
  if (n == null) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

// ─── First Notice Day ─────────────────────────────────────────────────────────

const LETTER_TO_MONTH: Record<string, number> = {
  F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12,
};
const MONTH_ABB = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function prevBizDay(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

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
  const days = product.toUpperCase() === "KC" ? 7 : 4;
  const fbdm = firstBusinessDay(year, monthNum);
  const fnd  = subtractBusinessDays(fbdm, days);
  return `${fnd.getDate()}/${fnd.getMonth() + 1}`;
}

// ─── Futures Chain Table ──────────────────────────────────────────────────────

interface ChainData { pub_date: string; contracts: Contract[]; }

function ChainTable({ market, data }: { market: "arabica" | "robusta"; data: ChainData }) {
  if (!data?.contracts?.length) return null;

  const isArabica = market === "arabica";
  const unit   = isArabica ? "¢/lb" : "$/t";
  const sublabel = isArabica ? "ICE NY · Arabica (KC)" : "ICE London · Robusta (RC)";
  const accent = isArabica ? "text-amber-400" : "text-emerald-400";

  function fmtExpiry(raw: string): string {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return `${d.getDate()}/${d.getMonth() + 1}`;
    return raw;
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between min-h-[40px]">
        <div>
          <span className="font-semibold text-sm text-white">Daily Quotes</span>
          <span className={`text-xs ml-2 ${accent}`}>{sublabel}</span>
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap ml-2">Barchart · {data.pub_date ?? ""}</span>
      </div>
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="text-left  px-1.5 py-1 w-10 whitespace-nowrap">Ct.</th>
            <th className="text-center px-1.5 py-1 w-14 whitespace-nowrap">FND</th>
            <th className="text-center px-1.5 py-1 w-11 whitespace-nowrap">Exp.</th>
            <th className="text-right px-1.5 py-1 whitespace-nowrap">Last ({unit})</th>
            <th className="text-right px-1.5 py-1 whitespace-nowrap">Chg</th>
            <th className="text-right px-1.5 py-1 whitespace-nowrap">Sprd</th>
            <th className="text-right px-1.5 py-1 whitespace-nowrap">Sprd Chg</th>
            <th className="text-right px-1.5 py-1 whitespace-nowrap">OI</th>
            <th className="text-right px-1.5 py-1 whitespace-nowrap">Vol</th>
          </tr>
        </thead>
        <tbody>
          {data!.contracts.map((c, i) => {
            const chgColor  = (c.chg ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";
            const next      = data!.contracts[i + 1];
            const spread    = c.last != null && next?.last != null ? c.last - next.last : null;
            const spreadChg = c.chg != null && next?.chg != null ? c.chg - next.chg : null;
            const shortSym  = c.symbol.replace(/^(KC|RC|RM)/, "$1").slice(0, 5);
            const dec       = isArabica ? 2 : 0;
            return (
              <tr key={c.symbol} className={`border-t border-slate-700 ${i === 0 ? "text-white bg-slate-800/60" : "text-slate-300"}`}>
                <td className="px-1.5 py-1.5 font-bold whitespace-nowrap">{shortSym}</td>
                <td className="px-1.5 py-1.5 text-center text-amber-400/80 whitespace-nowrap">{firstNoticeDay(c.symbol)}</td>
                <td className="px-1.5 py-1.5 text-center text-slate-500 whitespace-nowrap">{fmtExpiry(c.expiry)}</td>
                <td className={`px-1.5 py-1.5 text-right font-bold ${i === 0 ? accent : ""}`}>{c.last?.toFixed(dec)}</td>
                <td className={`px-1.5 py-1.5 text-right ${chgColor}`}>{c.chg == null ? "—" : (c.chg >= 0 ? "+" : "") + c.chg.toFixed(dec)}</td>
                <td className={`px-1.5 py-1.5 text-right ${spread === null ? "text-slate-600" : spread >= 0 ? "text-sky-400" : "text-orange-400"}`}>
                  {spread !== null ? (spread >= 0 ? "+" : "") + spread.toFixed(dec) : "—"}
                </td>
                <td className={`px-1.5 py-1.5 text-right ${spreadChg === null ? "text-slate-600" : spreadChg >= 0 ? "text-sky-400" : "text-orange-400"}`}>
                  {spreadChg !== null ? (spreadChg >= 0 ? "+" : "") + spreadChg.toFixed(dec) : "—"}
                </td>
                <td className="px-1.5 py-1.5 text-right">{fmt(c.oi)}</td>
                <td className="px-1.5 py-1.5 text-right text-slate-400">{fmt(c.volume)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── KC/RC ¢/lb middle panel ──────────────────────────────────────────────────

const KC_TO_RC_LETTER: Record<string, string> = { H:"H", K:"K", N:"N", U:"X", Z:"F" };

function KcRcCentsPanel({ arabica, robusta }: { arabica: Contract[]; robusta: Contract[] }) {
  // Key: letter+2-digit-year e.g. "K26", "F27"
  const rcByKey = new Map<string, number>();
  robusta.forEach(c => {
    const m = c.symbol.match(/^R[CM]([FGHJKMNQUVXZ])(\d{2})$/i);
    if (m) {
      const key = m[1].toUpperCase() + m[2];
      if (!rcByKey.has(key)) rcByKey.set(key, c.last);
    }
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden self-start hidden lg:block">
      <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 text-center min-h-[40px] flex items-center justify-center">
        <span className="text-[9px] font-semibold text-slate-300 uppercase tracking-widest whitespace-nowrap">Arbitrage</span>
      </div>
      <table className="text-[11px] font-mono w-full">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="px-1.5 py-1 text-left whitespace-nowrap">Pair</th>
            <th className="px-1.5 py-1 text-right whitespace-nowrap">¢/lb (×)</th>
          </tr>
        </thead>
        <tbody>
          {arabica.map((c, i) => {
            const km = c.symbol.match(/^KC([FGHJKMNQUVXZ])(\d{2})$/i);
            if (!km) return null;
            const kcLetter = km[1].toUpperCase();
            const kcYr     = km[2];
            const rcLetter = KC_TO_RC_LETTER[kcLetter] ?? kcLetter;
            const rcYr     = kcLetter === "Z" ? String(parseInt(kcYr) + 1).slice(-2) : kcYr;
            const rc       = rcByKey.get(rcLetter + rcYr);
            const kcCents  = c.last;
            const rcCents  = rc != null ? rc / 22.046 : null;
            const spread   = rcCents != null ? kcCents - rcCents : null;
            const ratio    = rc != null ? (c.last * 22.046 / rc).toFixed(2) : null;
            const rcSym    = `RC${rcLetter}${rcYr}`;
            const isFront  = i === 0;
            return (
              <tr key={c.symbol} className={`border-t border-slate-700 ${isFront ? "bg-slate-800/60" : ""}`}>
                <td className={`px-1.5 py-1.5 whitespace-nowrap ${isFront ? "text-slate-200" : "text-slate-500"}`}>
                  {c.symbol}-{rcSym}
                </td>
                <td className={`px-1.5 py-1.5 text-right whitespace-nowrap ${isFront ? "text-sky-300" : "text-slate-500"}`}>
                  {spread != null ? `${spread.toFixed(1)} (×${ratio})` : "—"}
                </td>
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
  { key:"s16c",  section:"GRADE 1  ·  SCREEN 16", label:"Clean",     desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:130            },
  { key:"s16wp", section:"GRADE 1  ·  SCREEN 16", label:"WP",        desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:190            },
  { key:"s18s",  section:"GRADE 1  ·  SCREEN 18", label:"Standard",  desc:"BB 2%, FM 0.5%, MC 12.5%",          diff:80             },
  { key:"s18c",  section:"GRADE 1  ·  SCREEN 18", label:"Clean",     desc:"Black 0.1%, Broken 0.3%, FM 0.1%",  diff:140            },
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

function QuotationTab({ contracts = [], vnFaqUsdMt }: { contracts?: Contract[]; vnFaqUsdMt?: number | null }) {
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
    const offset = today.getDate() >= 20 ? 1 : 0;
    return Array.from({ length: 8 }, (_, i) => {
      const d  = new Date(today.getFullYear(), today.getMonth() + offset + i, 1);
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

  // Default basis: VN FAQ USD/MT − front RC price
  const basisDefault = useMemo(() => {
    const frontLetter = monthsBase[0]?.letter;
    const frontPrice  = frontLetter ? rcPrices[frontLetter] : null;
    if (vnFaqUsdMt && frontPrice) return Math.round(vnFaqUsdMt - frontPrice);
    return 150;
  }, [vnFaqUsdMt, rcPrices, monthsBase]);

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

interface FuturesChainJson {
  arabica: ChainData | null;
  robusta: ChainData | null;
}

export default function FuturesPage() {
  const [chainJson, setChainJson]   = useState<FuturesChainJson | null>(null);
  const [vnFaqUsdMt, setVnFaqUsdMt] = useState<number | null>(null);
  const [tab, setTab]               = useState<"exchange" | "quotation" | "research">("exchange");

  // Chain data: instant from static JSON, no backend needed
  useEffect(() => {
    fetch("/data/futures_chain.json")
      .then(r => r.json())
      .then(setChainJson)
      .catch(() => setChainJson({ arabica: null, robusta: null }));
  }, []);

  useEffect(() => {
    fetch("/data/vn_physical_prices.json")
      .then(r => r.json())
      .then((d: any) => { if (d?.vn_faq?.usd_per_mt) setVnFaqUsdMt(d.vn_faq.usd_per_mt); })
      .catch(() => {});
  }, []);

  const arabicaChain = chainJson?.arabica ?? null;
  const robustaChain = chainJson?.robusta ?? null;
  const loading      = chainJson === null;

  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-slate-700">
        <h1 className="text-lg font-bold text-white mr-4">Futures</h1>
        {(["exchange", "quotation"] as const).map(t => (
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
        <button
          onClick={() => setTab("research")}
          className={`px-4 py-2 text-sm font-medium rounded-t transition-colors flex items-center gap-1.5 ${
            tab === "research"
              ? "bg-slate-800 text-amber-400 border border-b-transparent border-slate-700 -mb-px"
              : "text-slate-600 hover:text-slate-400"
          }`}
        >
          <span className="text-[10px] bg-amber-900/60 text-amber-400 px-1 py-0.5 rounded font-bold tracking-wide">DRAFT</span>
          Research
        </button>
      </div>

      {/* Exchange tab */}
      {tab === "exchange" && (
        <>
          {/* Live quotes — acaphe.com (run acaphe_poller.py locally for real-time updates) */}
          <AcapheLiveQuotes />

          {/* Daily quotes separator */}
          <div className="border-t border-slate-800 pt-4">
            <h2 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3">
              Daily Quotes · Barchart
            </h2>
          </div>

          {loading && (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 bg-slate-800 rounded-lg" />
              ))}
            </div>
          )}

          {!loading && !robustaChain && !arabicaChain && (
            <p className="text-slate-500 text-sm italic">
              No futures data yet — check back after the next scrape run.
            </p>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
            {arabicaChain && <ChainTable market="arabica" data={arabicaChain} />}
            {arabicaChain && robustaChain && (
              <KcRcCentsPanel
                arabica={arabicaChain.contracts}
                robusta={robustaChain.contracts}
              />
            )}
            {robustaChain && <ChainTable market="robusta" data={robustaChain} />}
          </div>
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                NY OI — 7-day tracking
              </h3>
              <OIHistoryTable market="arabica" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                LDN OI — 7-day tracking
              </h3>
              <OIHistoryTable market="robusta" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <OIFndChart market="arabica" />
            <OIFndChart market="robusta" />
          </div>
        </>
      )}

      {/* Quotation tab */}
      {tab === "quotation" && (
        <QuotationTab
          contracts={robustaChain?.contracts ?? []}
          vnFaqUsdMt={vnFaqUsdMt}
        />
      )}

      {/* Research tab — draft COT backtest report */}
      {tab === "research" && <CotBacktestReport />}

    </div>
  );
}
