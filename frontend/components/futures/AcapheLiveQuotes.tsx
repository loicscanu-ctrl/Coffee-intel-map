"use client";
import React, { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AcapheContract {
  month: string;
  change: number;
  change_pct: number | null;
  last: number;
  vol: number;
  oi: number | null;
  oi_chg: number | null;
}

interface VietnamPrices {
  local_time: string | null;
  bmt_bid: string | null;
  bmt_offer: string | null;
  hcm_bid: string | null;
  hcm_offer: string | null;
  r2_fob_bid: string | null;
  r2_fob_offer: string | null;
  pepper_faq: string | null;
  usd_vnd: number | null;
}

interface AcapheLiveData {
  fetched_at: string;
  now_time: string;
  robusta: AcapheContract[];
  arabica: AcapheContract[];
  vietnam?: VietnamPrices;
  spreads?: { robusta: string; arabica: string };
  arb_ratio?: string;
  equities?: string;
}

// ── Date helpers (same rules as Daily Quotes) ─────────────────────────────────

const LETTER_TO_MONTH: Record<string, number> = {
  F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12,
};
const MONTH_ABB = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function firstBusinessDay(year: number, month: number): Date {
  const d = new Date(year, month - 1, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function subtractBusinessDays(date: Date, n: number): Date {
  const d = new Date(date);
  let rem = n;
  while (rem > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) rem--;
  }
  return d;
}

function fmtDate(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// "RK 05/26" → "RCK26", "AK 05/26" → "KCK26"
function acapheToSymbol(month: string, isArabica: boolean): string {
  const letter = month[1];
  const yr     = month.slice(-2);
  return isArabica ? `KC${letter}${yr}` : `RC${letter}${yr}`;
}

// First Notice Day: KC = 7 biz days before 1st biz day of delivery month; RC = 4 biz days
function calcFndDate(symbol: string): Date | null {
  const m = symbol.match(/^(KC|RC|RM)([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return null;
  const [, product, letter, yr] = m;
  const monthNum = LETTER_TO_MONTH[letter.toUpperCase()];
  if (!monthNum) return null;
  const year = 2000 + parseInt(yr);
  const days = product.toUpperCase() === "KC" ? 7 : 4;
  return subtractBusinessDays(firstBusinessDay(year, monthNum), days);
}

function calcFnd(symbol: string): string {
  const d = calcFndDate(symbol);
  return d ? fmtDate(d) : "—";
}

// Options LTD = FND − 8 biz days (verified against acaphe front-month data for both RC and KC)
function calcOptLtd(symbol: string): string {
  const fnd = calcFndDate(symbol);
  if (!fnd) return "—";
  return fmtDate(subtractBusinessDays(fnd, 8));
}

// Implied annualised carry between two consecutive contracts
// carry = (back − front) / front × (365 / calendar days between FNDs) × 100
function impliedCarry(front: AcapheContract, back: AcapheContract, isArabica: boolean): string {
  if (front.last == null || back.last == null || front.last === 0) return "—";
  const symF = acapheToSymbol(front.month, isArabica);
  const symB = acapheToSymbol(back.month, isArabica);
  const dF   = calcFndDate(symF);
  const dB   = calcFndDate(symB);
  if (!dF || !dB) return "—";
  const days = (dB.getTime() - dF.getTime()) / 86_400_000;
  if (days <= 0) return "—";
  const rate = ((back.last - front.last) / front.last) * (365 / days) * 100;
  return (rate >= 0 ? "+" : "") + rate.toFixed(1) + "%/yr";
}

// Month letter label: "RK 05/26" → "K", used for spread labels
function spreadLabel(a: AcapheContract, b: AcapheContract): string {
  return `${a.month[1]}/${b.month[1]}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function secsAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 1000);
}

// ── KC/RC ratio column (one row per arabica contract, matched by month letter) ─

function RatioColumn({ arabica, robusta }: { arabica: AcapheContract[]; robusta: AcapheContract[] }) {
  const rcByLetter = new Map<string, number>();
  robusta.forEach(c => rcByLetter.set(c.month[1], c.last));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden self-start hidden lg:block">
      <div className="px-2 py-2 bg-slate-800 border-b border-slate-700 text-center min-h-[40px] flex items-center justify-center">
        <span className="text-[9px] text-slate-400 whitespace-nowrap">¢/lb</span>
      </div>
      <table className="text-[10px] font-mono w-full">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="px-2 py-1 text-center whitespace-nowrap text-amber-500/60">KC</th>
            <th className="px-2 py-1 text-center whitespace-nowrap text-emerald-500/60">RC</th>
            <th className="px-2 py-1 text-center whitespace-nowrap">×</th>
          </tr>
        </thead>
        <tbody>
          {arabica.map((c, i) => {
            const rc = rcByLetter.get(c.month[1]);
            const kcCents = c.last;                      // KC already in ¢/lb
            const rcCents = rc ? rc / 22.046 : null;     // RC: $/MT → ¢/lb
            const kcUsdMt = c.last * 22.046;
            const ratio   = rc ? (kcUsdMt / rc).toFixed(2) : null;
            const isFront = i === 0;
            return (
              <tr key={c.month} className={`border-t border-slate-700 ${isFront ? "bg-slate-800/60" : ""}`}>
                <td className={`px-2 py-1.5 text-center ${isFront ? "text-amber-400" : "text-amber-400/50"}`}>
                  {kcCents.toFixed(1)}
                </td>
                <td className={`px-2 py-1.5 text-center ${isFront ? "text-emerald-400" : "text-emerald-400/50"}`}>
                  {rcCents ? rcCents.toFixed(1) : "—"}
                </td>
                <td className={`px-2 py-1.5 text-center ${isFront ? "text-sky-300" : "text-slate-500"}`}>
                  {ratio ? `×${ratio}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Chain table (matches Daily Quotes columns exactly) ────────────────────────

function ChainTable({
  title, contracts, unit, accent, isArabica,
}: {
  title: string;
  contracts: AcapheContract[];
  unit: string;
  accent: string;
  isArabica: boolean;
}) {
  if (!contracts.length) return null;
  const dec = isArabica ? 2 : 0;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between min-h-[40px]">
        <div>
          <span className="font-semibold text-sm text-white">Live Quotes</span>
          <span className={`text-xs ml-2 ${accent}`}>{title}</span>
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap ml-2">acaphe.com</span>
      </div>

      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-slate-500 bg-slate-800/40">
            <th className="text-left   px-1.5 py-1 w-10  whitespace-nowrap">Ct.</th>
            <th className="text-center px-1.5 py-1 w-14  whitespace-nowrap">FND</th>
            <th className="text-center px-1.5 py-1 w-11  whitespace-nowrap">Exp.</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap">Last ({unit})</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap">Chg</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap">Sprd</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap">Sprd Chg</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap">OI</th>
            <th className="text-right  px-1.5 py-1        whitespace-nowrap">Vol</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c, i) => {
            const sym      = acapheToSymbol(c.month, isArabica);
            const fnd      = calcFnd(sym);
            const expiry   = calcOptLtd(sym);
            const chgColor = (c.change ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

            const next      = contracts[i + 1];
            const spread    = c.last != null && next?.last != null ? c.last - next.last : null;
            const spreadChg = c.change != null && next?.change != null ? c.change - next.change : null;
            const sprdColor = (n: number | null) =>
              n == null ? "text-slate-600" : n >= 0 ? "text-sky-400" : "text-orange-400";

            const isFront = i === 0;

            return (
              <tr
                key={c.month}
                className={`border-t border-slate-700 ${isFront ? "text-white bg-slate-800/60" : "text-slate-300"}`}
              >
                <td className="px-1.5 py-1.5 font-bold whitespace-nowrap">{sym}</td>
                <td className="px-1.5 py-1.5 text-center text-amber-400/80 whitespace-nowrap">{fnd}</td>
                <td className="px-1.5 py-1.5 text-center text-slate-500 whitespace-nowrap">{expiry}</td>
                <td className={`px-1.5 py-1.5 text-right font-bold ${isFront ? accent : ""}`}>
                  {fmt(c.last, dec)}
                </td>
                <td className={`px-1.5 py-1.5 text-right ${chgColor}`}>
                  {(c.change >= 0 ? "+" : "")}{c.change.toFixed(dec)}
                </td>
                <td className={`px-1.5 py-1.5 text-right ${sprdColor(spread)}`}>
                  {spread != null ? (spread >= 0 ? "+" : "") + spread.toFixed(dec) : "—"}
                </td>
                <td className={`px-1.5 py-1.5 text-right ${sprdColor(spreadChg)}`}>
                  {spreadChg != null ? (spreadChg >= 0 ? "+" : "") + spreadChg.toFixed(dec) : "—"}
                </td>
                <td className="px-1.5 py-1.5 text-right">{fmt(c.oi)}</td>
                <td className="px-1.5 py-1.5 text-right text-slate-400">{fmt(c.vol)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Vietnam local prices ───────────────────────────────────────────────────────

interface VietnamPricesWithMeta extends VietnamPrices {
  saved_at?: string;
}

function VietnamPanel({ data }: { data: VietnamPrices }) {
  const [last, setLast] = React.useState<VietnamPricesWithMeta | null>(null);

  const isLive = !!(data.bmt_bid || data.hcm_bid);

  React.useEffect(() => {
    if (!isLive) {
      fetch("/data/vietnam_last.json")
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setLast(d))
        .catch(() => {});
    }
  }, [isLive]);

  const display: VietnamPricesWithMeta = isLive ? data : (last ?? data);
  const isStale = !isLive && !!last;

  const items = [
    { label: "BMT Bid",      val: display.bmt_bid,                          unit: "VND/kg",     color: "text-white"       },
    { label: "BMT Offer",    val: display.bmt_offer,                        unit: "VND/kg",     color: "text-amber-400"   },
    { label: "HCM Bid",      val: display.hcm_bid,                          unit: "VND/kg",     color: "text-white"       },
    { label: "HCM Offer",    val: display.hcm_offer,                        unit: "VND/kg",     color: "text-amber-400"   },
    { label: "R2 FOB Bid",   val: display.r2_fob_bid,                       unit: "vs ICE LDN", color: "text-emerald-400" },
    { label: "R2 FOB Offer", val: display.r2_fob_offer,                     unit: "vs ICE LDN", color: "text-emerald-400" },
    { label: "USD/VND",      val: display.usd_vnd?.toLocaleString() ?? null, unit: "VCB rate",  color: "text-sky-400"     },
    ...(display.pepper_faq ? [{ label: "Pepper FAQ", val: display.pepper_faq, unit: "VND/kg", color: "text-slate-300" }] : []),
  ];

  const savedAt = last?.saved_at
    ? new Date(last.saved_at).toLocaleString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })
    : null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
        Vietnam Local Prices
        {display.local_time && <span className="text-slate-600 normal-case font-normal">{display.local_time}</span>}
        {isStale && savedAt && (
          <span className="text-amber-600 normal-case font-normal">· last seen {savedAt}</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-x-4 gap-y-3 text-xs font-mono">
        {items.map(({ label, val, unit, color }) => (
          <div key={label}>
            <div className="text-slate-500 mb-0.5">{label}</div>
            <div className={`font-bold ${isStale ? "opacity-60" : ""} ${color}`}>{val ?? "—"}</div>
            <div className="text-[10px] text-slate-600">{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export default function AcapheLiveQuotes() {
  const [data,  setData]  = useState<AcapheLiveData | null>(null);
  const [ago,   setAgo]   = useState<number | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    // Try live Redis-backed endpoint first; fall back to static snapshot
    fetch("/api/live")
      .then((r) => { if (!r.ok) throw new Error("live"); return r.json(); })
      .then((d: AcapheLiveData) => {
        if ((d as any).error) throw new Error("live");
        setData(d); setAgo(secsAgo(d.fetched_at)); setError(false);
      })
      .catch(() =>
        fetch(`/data/acaphe_live.json?_=${Date.now()}`)
          .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
          .then((d: AcapheLiveData) => { setData(d); setAgo(secsAgo(d.fetched_at)); setError(false); })
          .catch(() => setError(true))
      );
  };

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000);
    const tick = setInterval(() => setAgo((p) => (p != null ? p + 10 : p)), 10_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  if (error && !data) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-center">
        <p className="text-slate-400 text-sm mb-2">Live acaphe.com quotes not available.</p>
        <p className="text-slate-600 text-xs font-mono">python backend/scraper/acaphe_poller.py</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-800 rounded w-72" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-44 bg-slate-800 rounded-lg" />
          <div className="h-44 bg-slate-800 rounded-lg" />
        </div>
        <div className="h-24 bg-slate-800 rounded-lg" />
      </div>
    );
  }

  const isStale = ago != null && ago > 120;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className={`font-bold ${isStale ? "text-yellow-500" : "text-emerald-400"}`}>●</span>
          <span className="text-slate-400">acaphe.com</span>
          <span className="text-slate-600">{data.now_time}</span>
        </div>
        <div className="text-slate-600">
          {ago != null ? (
            <span className={isStale ? "text-yellow-500" : ""}>
              {ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`}
              {isStale && " · run acaphe_poller.py"}
            </span>
          ) : "—"}
        </div>
      </div>

      {/* Chain tables + KC/RC ratio column */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
        <ChainTable title="ICE NY · Arabica (KC)"     contracts={data.arabica} unit="¢/lb" accent="text-amber-400"   isArabica={true}  />
        <RatioColumn arabica={data.arabica} robusta={data.robusta} />
        <ChainTable title="ICE London · Robusta (RC)" contracts={data.robusta} unit="$/t"  accent="text-emerald-400" isArabica={false} />
      </div>

      {/* Vietnam local prices */}
      {data.vietnam && <VietnamPanel data={data.vietnam} />}
    </div>
  );
}
