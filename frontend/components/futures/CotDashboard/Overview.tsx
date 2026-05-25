"use client";
import { useEffect, useState } from "react";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { buildMarketMetrics } from "@/lib/pdf/dataHelpers";
import type { MarketMetrics } from "@/lib/pdf/types";
import SectionHeader from "./SectionHeader";

// ── number formatting (mirrors the COT weekly PDF) ────────────────────────────
const lotsBare   = (v: number) => `${(v / 1000).toFixed(1)} k lots`;          // negative keeps its "−"
const lotsSigned = (v: number) => `${v >= 0 ? "+" : ""}${(v / 1000).toFixed(1)} k lots`;
const pctSigned  = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const pct1       = (v: number) => `${v.toFixed(1)}%`;
const kTons      = (mt: number) => `${(mt / 1000).toFixed(1)} k tons`;

const OI_HISTORY_URL = "/data/oi_history.json";
type OiDay = { date: string; contracts: { symbol: string; oi: number }[] };

/** Nearest-two active contract letters, e.g. "N and U" (front-first array). */
function nearestLetters(days: OiDay[] | undefined): string | null {
  const last = days?.[days.length - 1];
  if (!last?.contracts?.length) return null;
  const letters = last.contracts
    .filter(c => (c.oi ?? 0) > 0)
    .slice(0, 2)
    .map(c => c.symbol.charAt(2)); // KCN26 → N, RMU26 → U
  return letters.length === 2 ? `${letters[0]} and ${letters[1]}` : letters[0] ?? null;
}

function Bullet({ children, sub }: { children: React.ReactNode; sub?: boolean }) {
  return (
    <li className={`flex gap-2 ${sub ? "ml-4 text-slate-400" : "text-slate-300"}`}>
      <span className={sub ? "text-slate-600" : "text-amber-500/70"}>{sub ? "◦" : "•"}</span>
      <span>{children}</span>
    </li>
  );
}

function MarketColumn({ m, prevPrice, letters, title }: {
  m: MarketMetrics; prevPrice: number; letters: string | null; title: string;
}) {
  const isNY = m.market === "NY Arabica";
  const priceAbs = isNY
    ? `${Math.round(m.priceChangeAbs)} cents/lb`
    : `$${Math.round(m.priceChangeAbs)} per ton`;

  // Front-structure inversion: structure = M2 − M1; backwardation (≤0) → "inverted".
  let structureClause: React.ReactNode = null;
  if (m.structureValue !== null) {
    const invNow  = (-m.structureValue / m.price) * 100;
    const invPrev = m.structurePrevValue !== null && prevPrice > 0
      ? (-m.structurePrevValue / prevPrice) * 100 : null;
    const backwardated = m.structureValue <= 0;
    const movingToward = invPrev === null ? null : (invNow > invPrev ? "backwardation" : "carry");
    structureClause = (
      <> with a structure{movingToward ? ` moving toward ${movingToward}` : ""}, now{" "}
        {backwardated ? "inverted" : "in carry"} at {pct1(Math.abs(invNow))}
        {invPrev !== null ? ` (${pct1(Math.abs(invPrev))} last week)` : ""}</>
    );
  }

  const covVar = (mtWoW: number, mt: number) => {
    const prev = mt - mtWoW;
    return prev !== 0 ? (mtWoW / Math.abs(prev)) * 100 : 0;
  };
  const longVerb  = m.mmLongChangeLots  < 0 ? "liquidating" : m.mmLongChangeLots  > 0 ? "adding to" : "holding";
  const shortVerb = m.mmShortChangeLots > 0 ? "increasing"  : m.mmShortChangeLots < 0 ? "covering"  : "holding";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">{title}</div>
      <ul className="space-y-1.5 text-xs leading-relaxed">
        <Bullet>Total OI change of {lotsBare(m.oiChangeLots)} since last COT</Bullet>
        {m.oiChangeNearby !== null && (
          <Bullet sub>{lotsBare(m.oiChangeNearby)} in nearby contracts{letters ? ` (${letters})` : ""}</Bullet>
        )}
        {m.oiChangeForward !== null && (
          <Bullet sub>{lotsBare(m.oiChangeForward)} in forward contracts</Bullet>
        )}
        <Bullet>
          Price change of {pct1(m.priceChangePct)} ({priceAbs}){structureClause}.
        </Bullet>
        <Bullet>
          Roasters&rsquo; coverage variation of {pct1(covVar(m.roasterMTWoW, m.roasterMT))}, reaching{" "}
          {pct1(m.roasterCovPct)} of range, now at {kTons(m.roasterMT)} equivalent.
        </Bullet>
        <Bullet>
          Producers&rsquo; coverage variation of {pct1(covVar(m.producerMTWoW, m.producerMT))}, reaching{" "}
          {pct1(m.producerCovPct)} of range, now at {kTons(m.producerMT)} equivalent.
        </Bullet>
        <Bullet>
          MM {longVerb} longs ({lotsSigned(m.mmLongChangeLots)} / {pctSigned(m.mmLongChangePct)} of their position)
          {" "}and {shortVerb} shorts ({lotsSigned(m.mmShortChangeLots)} / {pctSigned(m.mmShortChangePct)}).
        </Bullet>
      </ul>
    </div>
  );
}

export default function Overview({ data }: { data: ProcessedCotRow[] }) {
  const [letters, setLetters] = useState<{ ny: string | null; ldn: string | null }>({ ny: null, ldn: null });

  useEffect(() => {
    let cancelled = false;
    fetch(OI_HISTORY_URL)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { arabica?: OiDay[]; robusta?: OiDay[] } | null) => {
        if (cancelled || !d) return;
        setLetters({ ny: nearestLetters(d.arabica), ldn: nearestLetters(d.robusta) });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const recent52 = data.slice(-52);
  const ny  = buildMarketMetrics(recent52, data, "ny");
  const ldn = buildMarketMetrics(recent52, data, "ldn");
  const prevPriceNY  = data.length >= 2 ? data[data.length - 2].priceNY  : 0;
  const prevPriceLDN = data.length >= 2 ? data[data.length - 2].priceLDN : 0;

  return (
    <>
      <SectionHeader icon="Eye" title="1. Overview"
        subtitle="Weekly positioning summary per market — OI, price/structure, industry coverage and managed-money flow vs. the prior COT week." />
      {ny && ldn ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MarketColumn m={ny}  prevPrice={prevPriceNY}  letters={letters.ny}  title="Arabica · NY Overview" />
          <MarketColumn m={ldn} prevPrice={prevPriceLDN} letters={letters.ldn} title="Robusta · LDN Overview" />
        </div>
      ) : (
        <div className="text-xs text-slate-500 px-1">Insufficient history to build the overview.</div>
      )}
    </>
  );
}
