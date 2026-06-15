"use client";
import React, { Suspense, useMemo, useState } from "react";
import AcapheLiveQuotes from "@/components/futures/AcapheLiveQuotes";
import OIFndChart from "@/components/futures/OIFndChart";
import OriginPricesPanel from "@/components/macro/OriginPricesPanel";
import PageHeader from "@/components/PageHeader";
import { fmtNum as fmt } from "@/lib/formatters";
import { useFetchJson } from "@/lib/useFetchJson";
import { useUrlState } from "@/lib/useUrlState";

type FuturesTab = "price" | "quotation";
const FUTURES_TABS: FuturesTab[] = ["price", "quotation"];

interface Contract {
  contract: string;
  expiry: string;
  last: number;
  chg: number;
  oi: number;
  volume: number;
  symbol: string;
}

// ─── First Notice Day ─────────────────────────────────────────────────────────

const LETTER_TO_MONTH: Record<string, number> = {
  F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12,
};
const MONTH_ABB = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;

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

const KC_TO_RC_LETTER: Record<string, string> = { H:"H", K:"K", N:"N", U:"U", Z:"F" };

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
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-x-auto self-start">
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

interface ShippingMonth {
  label:       string;
  mo:          number;
  yr:          number;
  letter:      string;
  contractSym: string;
  // Letter + 2-digit contract year (e.g. "U26", "F27"). Uniquely identifies the
  // underlying futures contract so spreads stay correct even when the strip
  // spans more than one crop year and a letter (N, U, X, F…) recurs.
  priceKey:    string;
}

interface MonthWithBasis extends ShippingMonth {
  contractLetter: string;
  basisForMonth:  number;
}

// Robusta crop year identifier: the calendar year of the X (Nov delivery)
// contract that closes a crop year. Shipments in Dec belong to NEXT year's
// crop — so Dec 2026 belongs to crop year 2027 (which ends Nov 2027). This
// is the boundary the user wants explicit: current crop ends Nov X; new crop
// starts Dec, even though both ship against the same F (Jan delivery)
// contract.
function cropYearEndYear(yr: number, mo: number): number {
  return mo === 12 ? yr + 1 : yr;
}

// First shipping month whose underlying contract differs from the front. Keyed
// by priceKey (letter+year), not bare letter, so e.g. a new-crop strip running
// F27 → … → F28 still finds the genuine next contract (H27) rather than treating
// the two F's as one.
function getNextContract(months: ShippingMonth[]): ShippingMonth | null {
  const frontKey = months[0]?.priceKey;
  if (!frontKey) return null;
  return months.find(m => m.priceKey !== frontKey) ?? null;
}

// Unique contract transitions in the strip, identified by priceKey so a letter
// recurring in a later crop year (e.g. N26 vs N27) is treated as a real roll.
function getTransitions(months: ShippingMonth[]): { from: string; to: string; key: string }[] {
  const result: { from: string; to: string; key: string }[] = [];
  let prevKey = months[0]?.priceKey ?? "";
  months.slice(1).forEach(m => {
    if (m.priceKey !== prevKey) {
      const key = `${prevKey}-${m.priceKey}`;
      if (!result.find(t => t.key === key)) result.push({ from: prevKey, to: m.priceKey, key });
      prevKey = m.priceKey;
    }
  });
  return result;
}

// Walks the months array applying basisDiff to the front contract, basis2Diff
// to the next contract (the editable one), and auto-rolling the market spread
// for any 3rd+ contract transition. Within a single contract, applies +30
// USD/MT per shipment month carry. Spreads are read from priceByKey using each
// month's priceKey (letter+year), so every contract switch incorporates the
// price difference between the two real contracts.
function computeMonthsBasis(
  months:     ShippingMonth[],
  basisDiff:  number,
  basis2Diff: number,
  priceByKey: Record<string, number>,
): MonthWithBasis[] {
  let activeBasis    = basisDiff;
  let activeStartIdx = 0;
  let contractIdx    = 0;
  let lastKey        = months[0]?.priceKey ?? "";
  return months.map((m, i) => {
    if (m.priceKey !== lastKey) {
      contractIdx += 1;
      activeStartIdx = i;
      if (contractIdx === 1) {
        activeBasis = basis2Diff;
      } else {
        const fromPrice = priceByKey[lastKey];
        const toPrice   = priceByKey[m.priceKey];
        if (fromPrice != null && toPrice != null) {
          activeBasis += Math.round(fromPrice - toPrice);
        }
      }
      lastKey = m.priceKey;
    }
    const monthOffset = (i - activeStartIdx) * 30;
    return { ...m, contractLetter: m.letter, basisForMonth: activeBasis + monthOffset };
  });
}

function QuotationTab({ contracts = [], vnFaqUsdMt }: { contracts?: Contract[]; vnFaqUsdMt?: number | null }) {
  // Basis state: separate inputs per crop year. The user can override the
  // front + next-contract basis independently for current crop (ending Nov
  // of todayCropEndYear) and new crop (next crop year, starting Dec). 3rd+
  // contract transitions within each crop year auto-roll via the market
  // spread.
  const [currentBasisOverride,  setCurrentBasisOverride]  = useState<number | null>(null);
  const [currentBasis2Override, setCurrentBasis2Override] = useState<number | null>(null);
  const [newBasisOverride,      setNewBasisOverride]      = useState<number | null>(null);
  const [newBasis2Override,     setNewBasis2Override]     = useState<number | null>(null);
  const [freight,               setFreight]               = useState(0);
  const [financing,             setFinancing]             = useState(0);
  const [selectedOptions,       setSelectedOptions]       = useState<Set<string>>(new Set());

  const toggleOption = (key: string) =>
    setSelectedOptions(prev => { const s = new Set(prev); if (s.has(key)) { s.delete(key); } else { s.add(key); } return s; });

  const optionsAddon = [...PACKING_OPTIONS, ...CERT_OPTIONS]
    .filter(o => selectedOptions.has(o.key))
    .reduce((sum, o) => sum + o.val, 0);

  // Price lookup keyed by contract (letter + 2-digit year), e.g. "U26", "F27".
  // Keeps the nearest expiry per contract. Keying by the full contract — not the
  // bare letter — is what lets a multi-crop-year strip read the correct price for
  // each roll (N26 ≠ N27, F27 ≠ F28).
  const priceByKey = useMemo(() => {
    const p: Record<string, number> = {};
    contracts.forEach(c => {
      const m = c.symbol.match(/^R[CM]([FGHJKMNQUVXZ])(\d{2})$/i);
      if (m) {
        const k = `${m[1].toUpperCase()}${m[2]}`;
        if (!(k in p)) p[k] = c.last;
      }
    });
    return p;
  }, [contracts]);

  // Shipping months from the front (skips current month after the 14th to roll
  // off near-FND contracts) through November of the NEXT crop year, so the
  // new-crop table can run all the way to its Nov close.
  const monthsBase = useMemo<ShippingMonth[]>(() => {
    const today  = new Date();
    const offset = today.getDate() >= 14 ? 1 : 0;
    const start  = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const startCropEnd = cropYearEndYear(start.getFullYear(), start.getMonth() + 1);
    // Last shipping month we need = Nov of the next crop year (month index 10).
    const end    = new Date(startCropEnd + 1, 10, 1);
    const count  = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    return Array.from({ length: count }, (_, i) => {
      const d  = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const mo = d.getMonth() + 1;
      const yr = d.getFullYear();
      const letter = SHIPMENT_TO_CONTRACT[mo];
      const cYear  = letter === "F" && mo >= 11 ? yr + 1 : yr;
      const yy     = String(cYear).slice(2);
      return { label: `${MONTH_ABB[mo]}-${String(yr).slice(2)}`, mo, yr, letter, contractSym: `RC${letter}${yy}`, priceKey: `${letter}${yy}` };
    });
  }, []);

  // Today's crop year (Nov-ending calendar year).
  const todayCropEndYear = useMemo(() => {
    const today = new Date();
    return cropYearEndYear(today.getFullYear(), today.getMonth() + 1);
  }, []);

  // Split monthsBase at the Nov/Dec crop year boundary.
  const { currentCropMonths, newCropMonths } = useMemo(() => {
    const cur:  ShippingMonth[] = [];
    const next: ShippingMonth[] = [];
    monthsBase.forEach(m => {
      if (cropYearEndYear(m.yr, m.mo) === todayCropEndYear) cur.push(m);
      else                                                  next.push(m);
    });
    return { currentCropMonths: cur, newCropMonths: next };
  }, [monthsBase, todayCropEndYear]);

  // ── Current crop computed state ────────────────────────────────────────
  const currentNext        = useMemo(() => getNextContract(currentCropMonths), [currentCropMonths]);
  const currentTransitions = useMemo(() => getTransitions(currentCropMonths),  [currentCropMonths]);
  // Default basis: VN FAQ USD/MT + FOB cost − current-crop's front RC price.
  // The +100 mirrors FOB_COST_USD["VN FAQ"] in components/map/MarketTicker.tsx.
  const currentBasisDefault = useMemo(() => {
    const fk = currentCropMonths[0]?.priceKey;
    const fp = fk ? priceByKey[fk] : null;
    if (vnFaqUsdMt && fp) return Math.round(vnFaqUsdMt + 100 - fp);
    return 150;
  }, [vnFaqUsdMt, priceByKey, currentCropMonths]);
  const currentBasisDiff = currentBasisOverride ?? currentBasisDefault;
  // Default 2nd-contract basis: front-basis + (frontPrice − nextPrice) of the
  // within-current-crop next contract. Keeps at-port level across the roll.
  const currentBasis2Default = useMemo(() => {
    const fk = currentCropMonths[0]?.priceKey;
    const fp = fk ? priceByKey[fk] : null;
    const np = currentNext ? priceByKey[currentNext.priceKey] : null;
    if (fp != null && np != null) return currentBasisDiff + Math.round(fp - np);
    return currentBasisDiff + 30;
  }, [currentBasisDiff, currentCropMonths, priceByKey, currentNext]);
  const currentBasis2Diff = currentBasis2Override ?? currentBasis2Default;
  const currentMonths = useMemo(
    () => computeMonthsBasis(currentCropMonths, currentBasisDiff, currentBasis2Diff, priceByKey),
    [currentCropMonths, currentBasisDiff, currentBasis2Diff, priceByKey],
  );

  // ── New crop computed state ────────────────────────────────────────────
  const newNext        = useMemo(() => getNextContract(newCropMonths), [newCropMonths]);
  const newTransitions = useMemo(() => getTransitions(newCropMonths),  [newCropMonths]);
  const newBasisDefault = useMemo(() => {
    const fk = newCropMonths[0]?.priceKey;
    const fp = fk ? priceByKey[fk] : null;
    if (vnFaqUsdMt && fp) return Math.round(vnFaqUsdMt + 100 - fp);
    return 150;
  }, [vnFaqUsdMt, priceByKey, newCropMonths]);
  const newBasisDiff = newBasisOverride ?? newBasisDefault;
  const newBasis2Default = useMemo(() => {
    const fk = newCropMonths[0]?.priceKey;
    const fp = fk ? priceByKey[fk] : null;
    const np = newNext ? priceByKey[newNext.priceKey] : null;
    if (fp != null && np != null) return newBasisDiff + Math.round(fp - np);
    return newBasisDiff + 30;
  }, [newBasisDiff, newCropMonths, priceByKey, newNext]);
  const newBasis2Diff = newBasis2Override ?? newBasis2Default;
  const newMonths = useMemo(
    () => computeMonthsBasis(newCropMonths, newBasisDiff, newBasis2Diff, priceByKey),
    [newCropMonths, newBasisDiff, newBasis2Diff, priceByKey],
  );

  // Market spread between current crop's last and new crop's first contract.
  // Renders as the inter-table badge so the roll the new-crop basisDefault
  // implicitly bakes in is also visible to the eye.
  const cropYearRoll = useMemo(() => {
    const lastCur  = currentCropMonths[currentCropMonths.length - 1];
    const firstNew = newCropMonths[0];
    if (!lastCur || !firstNew) return null;
    const lp = priceByKey[lastCur.priceKey];
    const fp = priceByKey[firstNew.priceKey];
    if (lp == null || fp == null) return null;
    return { from: lastCur.priceKey, to: firstNew.priceKey, value: Math.round(lp - fp) };
  }, [currentCropMonths, newCropMonths, priceByKey]);

  const sections: string[] = [];
  QUALITIES.forEach(q => { if (!sections.includes(q.section)) sections.push(q.section); });

  // ── Render one crop year's controls + table ─────────────────────────────
  function renderCropPanel(opts: {
    title:          string;
    subtitle:       string;
    months:         MonthWithBasis[];
    transitions:    { from: string; to: string; key: string }[];
    nextLabel:      string | null;
    basisDiff:      number;
    basis2Diff:     number;
    onBasisChange:  (n: number) => void;
    onBasis2Change: (n: number) => void;
  }) {
    if (opts.months.length === 0) return null;
    const frontLabel = opts.months[0].priceKey;
    return (
      <div className="space-y-3">
        {/* Per-crop controls */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-wrap items-center gap-6">
          <div className="flex-shrink-0">
            <div className="text-[11px] text-amber-300 uppercase font-bold tracking-widest">{opts.title}</div>
            <div className="text-[9px] text-slate-500 mt-0.5">{opts.subtitle}</div>
          </div>
          <div className="border-l border-slate-700 pl-6">
            <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
              Basis — Grade 2 S13 — {frontLabel} contract
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={opts.basisDiff}
                onChange={e => opts.onBasisChange(Number(e.target.value))}
                className="w-24 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white font-mono text-sm text-right focus:outline-none focus:border-indigo-500"
              />
              <span className="text-slate-400 text-sm">USD / MT</span>
            </div>
          </div>
          {opts.nextLabel && (
            <div className="border-l border-slate-700 pl-6">
              <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
                Basis — Grade 2 S13 — {opts.nextLabel} contract
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={opts.basis2Diff}
                  onChange={e => opts.onBasis2Change(Number(e.target.value))}
                  className="w-24 bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white font-mono text-sm text-right focus:outline-none focus:border-indigo-500"
                />
                <span className="text-slate-400 text-sm">USD / MT</span>
              </div>
            </div>
          )}
          {opts.transitions.length > 0 && (
            <div className="border-l border-slate-700 pl-6">
              <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">
                Calendar Spreads — USD/MT
              </div>
              <div className="flex flex-wrap gap-4">
                {opts.transitions.map(({ key, from, to }) => {
                  const val = (priceByKey[from] != null && priceByKey[to] != null)
                    ? Math.round(priceByKey[from] - priceByKey[to])
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
        </div>

        {/* Per-crop table */}
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
                  {opts.months.map((m, i) => (
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
                          colSpan={3 + opts.months.length}
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
                          {opts.months.map((m, i) => {
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
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Shared controls: freight + financing apply across both crops */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 flex flex-wrap items-center gap-6">
        {(["Freight", "Financing"] as const).map(label => {
          const val   = label === "Freight" ? freight   : financing;
          const setVal = label === "Freight" ? setFreight : setFinancing;
          return (
            <div key={label}>
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
        <div className="text-xs text-slate-500 leading-relaxed border-l border-slate-700 pl-6">
          Monthly carry <span className="text-slate-300 font-medium">+30 USD/MT</span> per shipment month<br />
          RC bimonthly cycle: K (May) · N (Jul) · U (Sep) · X (Nov) · F (Jan)<br />
          <span className="text-slate-600">FOB · Bulk · CAD 1st · ESCC NSW 0.5% · All subject to confirmation</span>
        </div>
      </div>

      {/* Current crop */}
      {renderCropPanel({
        title:          `Current Crop · ending Nov ${String(todayCropEndYear).slice(2)}`,
        subtitle:       "Physical shipments in the current crop year",
        months:         currentMonths,
        transitions:    currentTransitions,
        nextLabel:      currentNext?.priceKey ?? null,
        basisDiff:      currentBasisDiff,
        basis2Diff:     currentBasis2Diff,
        onBasisChange:  setCurrentBasisOverride,
        onBasis2Change: setCurrentBasis2Override,
      })}

      {/* Crop year roll indicator (only when both tables render) */}
      {cropYearRoll && currentCropMonths.length > 0 && newCropMonths.length > 0 && (
        <div className="flex justify-center">
          <div className="bg-slate-900 border border-amber-600/40 rounded-full px-5 py-1.5 flex items-center gap-3 text-[10px]">
            <span className="text-amber-300 uppercase font-bold tracking-widest">Crop Year Roll</span>
            <span className="text-slate-400 font-mono">RC {cropYearRoll.from}→{cropYearRoll.to}</span>
            <span className="text-amber-300 font-mono font-bold">
              {cropYearRoll.value >= 0 ? `+${cropYearRoll.value}` : cropYearRoll.value} USD/MT
            </span>
          </div>
        </div>
      )}

      {/* New crop */}
      {renderCropPanel({
        title:          `New Crop · starting Dec ${String(todayCropEndYear).slice(2)}`,
        subtitle:       "Physical shipments in next crop year",
        months:         newMonths,
        transitions:    newTransitions,
        nextLabel:      newNext?.priceKey ?? null,
        basisDiff:      newBasisDiff,
        basis2Diff:     newBasis2Diff,
        onBasisChange:  setNewBasisOverride,
        onBasis2Change: setNewBasis2Override,
      })}

      {/* Footer note */}
      <div className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-[10px] text-slate-500">
        * Diffs quoted vs ICE London (RC) bimonthly contracts. Basis = Grade 2 S13 Standard.
        Screen 18 = Screen 16 + 10. Grade 3 = Basis − 250. Prices indicative, subject to availability and confirmation.
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
  return (
    <Suspense fallback={<div className="h-full bg-slate-950" />}>
      <FuturesPageInner />
    </Suspense>
  );
}

function FuturesPageInner() {
  const [tab, setTab] = useUrlState<FuturesTab>("tab", "price", (raw) =>
    (FUTURES_TABS as string[]).includes(raw) ? (raw as FuturesTab) : "price"
  );

  // Static JSON, no backend needed. useFetchJson handles AbortController +
  // error states; on fetch failure we fall back to an empty chain so the
  // page still renders.
  const { data: chainData, error: chainError } =
    useFetchJson<FuturesChainJson>("/data/futures_chain.json");
  const chainJson: FuturesChainJson | null =
    chainError ? { arabica: null, robusta: null } : chainData;

  const { data: vnFaqData } =
    useFetchJson<{ vn_faq?: { usd_per_mt?: number } }>("/data/vn_physical_prices.json");
  const vnFaqUsdMt = vnFaqData?.vn_faq?.usd_per_mt ?? null;

  const arabicaChain = chainJson?.arabica ?? null;
  const robustaChain = chainJson?.robusta ?? null;
  const loading      = chainJson === null;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Futures"
        subtitle="ICE Arabica (KC) · ICE Robusta (RC) — chain, quotation, arbitrage & origin farmgate prices"
        healthKeys={["futures", "cot", "macro_cot", "origin_prices"]}
      />
      <div className="p-6 space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-slate-700 flex-wrap">
        {(["price", "quotation"] as const).map(t => (
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

      {/* Price tab — live + daily exchange quotes, OI rollover, and the
          origin farmgate-price overlay moved here from the Macro tab so
          futures and physical pricing sit on the same page. */}
      {tab === "price" && (
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
          {/* OI Evolution to FND — NY + LDN side-by-side; each chart shows
              OI buildup over the trading days leading into First Notice Day
              (operational view for roll timing) overlaid with the front
              calendar spread. */}
          <div className="border-t border-slate-800 pt-4 mt-4">
            <h2 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3">
              OI Evolution to FND
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <OIFndChart market="arabica" />
              <OIFndChart market="robusta" />
            </div>
          </div>

          {/* Origin Farmgate Prices — moved from /macro so the physical
              side of the price story sits next to the futures chain. */}
          <div className="border-t border-slate-800 pt-4 mt-4">
            <OriginPricesPanel />
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

      </div>
    </div>
  );
}
