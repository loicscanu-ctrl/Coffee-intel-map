"use client";
import { useEffect, useMemo, useState } from "react";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { buildMarketMetrics } from "@/lib/pdf/dataHelpers";
import type { MarketMetrics } from "@/lib/pdf/types";
import SectionHeader from "./SectionHeader";

// ── number formatting (mirrors the COT weekly PDF) ────────────────────────────
const lotsSigned = (v: number) => `${v >= 0 ? "+" : ""}${(v / 1000).toFixed(1)} k lots`;
const pctSigned  = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const pct1       = (v: number) => `${v.toFixed(1)}%`;
const kTons      = (mt: number) => `${(mt / 1000).toFixed(1)} k tons`;
const num        = (x: unknown) => (typeof x === "number" ? x : 0);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => { const [, m, d] = iso.split("-"); return `${MONTHS[+m - 1]} ${+d}`; };

const priceAbsNY  = (v: number, signed = false) => `${signed && v >= 0 ? "+" : ""}${Math.round(v)} cents/lb`;
const priceAbsLDN = (v: number, signed = false) =>
  signed ? `${v >= 0 ? "+" : "-"}$${Math.abs(Math.round(v))} per ton` : `$${Math.round(v)} per ton`;

const OI_HISTORY_URL = "/data/oi_history.json";
type OiContract = { symbol: string; oi: number; last_price: number };
type OiDay = { date: string; contracts: OiContract[] };
type OiHistory = { arabica?: OiDay[]; robusta?: OiDay[] };

/** Nearest-two active contract letters, e.g. "N and U". days[] is newest-first. */
function nearestLetters(days: OiDay[] | undefined): string | null {
  const latest = days?.[0];
  if (!latest?.contracts?.length) return null;
  const letters = latest.contracts.filter(c => num(c.oi) > 0).slice(0, 2).map(c => c.symbol.charAt(2));
  return letters.length === 2 ? `${letters[0]} and ${letters[1]}` : letters[0] ?? null;
}

// ── post-COT intraweek snapshot, computed from daily per-contract OI/price ─────
type PostCot = {
  cotDate: string; latestDate: string;
  oiChange: number; nearbyChange: number; forwardChange: number;
  priceChangeAbs: number; priceChangePct: number;
  invertedNow: number; inCarry: boolean; movingToward: "backwardation" | "carry";
  mmLongDelta: number; mmShortDelta: number;
  producerLotsDelta: number; roasterLotsDelta: number; counterpartyOther: boolean;
};

const PRICE_DEADBAND_PCT = 0.1; // ignore sub-0.1% daily moves as directionless

function buildPostCot(days: OiDay[] | undefined, cotDate: string, mmLong: number, mmShort: number): PostCot | null {
  if (!days?.length) return null;
  const latest = days[0];                              // newest-first
  const anchor = days.find(d => d.date <= cotDate);    // COT day (or last trading day ≤ it)
  if (!anchor || latest.date <= cotDate) return null;

  const tot    = (d: OiDay) => d.contracts.reduce((s, c) => s + num(c.oi), 0);
  const nearby = (d: OiDay) => d.contracts.slice(0, 2).reduce((s, c) => s + num(c.oi), 0);
  const oiL = tot(latest), oiA = tot(anchor);
  const oiChange = oiL - oiA;
  const nearbyChange = nearby(latest) - nearby(anchor);

  // Price: most-liquid (max-OI) contract on the latest day, same symbol on the anchor day.
  const front = latest.contracts.reduce((a, c) => (num(c.oi) > num(a.oi) ? c : a), latest.contracts[0]);
  const pL = num(front?.last_price);
  const pA = num(anchor.contracts.find(c => c.symbol === front?.symbol)?.last_price) || num(anchor.contracts[0]?.last_price);
  const priceChangeAbs = pL - pA;
  const priceChangePct = pA ? (priceChangeAbs / pA) * 100 : 0;

  // Front structure (M2 − M1) by expiry → inversion %, and the direction it moved.
  const struct = (d: OiDay) => num(d.contracts[1]?.last_price) - num(d.contracts[0]?.last_price);
  const fpx    = (d: OiDay) => num(d.contracts[0]?.last_price) || 1;
  const sL = struct(latest), sA = struct(anchor);
  const invL = (-sL / fpx(latest)) * 100, invA = (-sA / fpx(anchor)) * 100;

  const ratio = oiA > 0 ? oiL / oiA : 1; // proportional-OI MM nowcast (matches OIHistoryTable)
  const mmLongDelta  = mmLong  * (ratio - 1);
  const mmShortDelta = mmShort * (ratio - 1);

  // Industry-as-counterparty model. MM's estimated NET flow needs an opposite side.
  // Commercials take it when the price move fits their hedging incentive, capped by
  // the new OI created; otherwise the flow is assumed to sit with swaps / other rept.
  const mmNetDelta = mmLongDelta - mmShortDelta;
  const newOI = Math.max(oiChange, 0);
  const priceDir = priceChangePct > PRICE_DEADBAND_PCT ? 1 : priceChangePct < -PRICE_DEADBAND_PCT ? -1 : 0;
  let producerLotsDelta = 0, roasterLotsDelta = 0;
  if (mmNetDelta > 0 && priceDir > 0)      producerLotsDelta = Math.min(mmNetDelta, newOI);   // funds buy into ↑ → producers sell
  else if (mmNetDelta < 0 && priceDir < 0) roasterLotsDelta  = Math.min(-mmNetDelta, newOI);  // funds sell into ↓ → roasters buy
  const counterpartyOther = newOI > 0 && producerLotsDelta === 0 && roasterLotsDelta === 0;

  return {
    cotDate: anchor.date, latestDate: latest.date,
    oiChange, nearbyChange, forwardChange: oiChange - nearbyChange,
    priceChangeAbs, priceChangePct,
    invertedNow: Math.abs(invL), inCarry: sL > 0,
    movingToward: invL > invA ? "backwardation" : "carry",
    mmLongDelta, mmShortDelta,
    producerLotsDelta, roasterLotsDelta, counterpartyOther,
  };
}

function Bullet({ children, sub }: { children: React.ReactNode; sub?: boolean }) {
  return (
    <li className={`flex gap-2 ${sub ? "ml-4 text-slate-400" : "text-slate-300"}`}>
      <span className={sub ? "text-slate-600" : "text-amber-500/70"}>{sub ? "◦" : "•"}</span>
      <span>{children}</span>
    </li>
  );
}

function MarketColumn({ m, prevPrice, letters, label, post }: {
  m: MarketMetrics; prevPrice: number; letters: string | null; label: string; post: PostCot | null;
}) {
  const isNY = m.market === "NY Arabica";
  const priceAbs = isNY ? priceAbsNY(m.priceChangeAbs) : priceAbsLDN(m.priceChangeAbs);

  let structureClause: React.ReactNode = null;
  if (m.structureValue !== null) {
    const invNow  = (-m.structureValue / m.price) * 100;
    const invPrev = m.structurePrevValue !== null && prevPrice > 0 ? (-m.structurePrevValue / prevPrice) * 100 : null;
    const backwardated = m.structureValue <= 0;
    const movingToward = invPrev === null ? null : invNow > invPrev ? "backwardation" : "carry";
    structureClause = (
      <> with a structure{movingToward ? ` moving toward ${movingToward}` : ""}, now{" "}
        {backwardated ? "inverted" : "in carry"} at {pct1(Math.abs(invNow))}
        {invPrev !== null ? ` (${pct1(Math.abs(invPrev))} last week)` : ""}</>
    );
  }

  const covVar = (mtWoW: number, mt: number) => { const prev = mt - mtWoW; return prev !== 0 ? (mtWoW / Math.abs(prev)) * 100 : 0; };
  const longVerb  = m.mmLongChangeLots  < 0 ? "liquidating" : m.mmLongChangeLots  > 0 ? "adding to" : "holding";
  const shortVerb = m.mmShortChangeLots > 0 ? "increasing"  : m.mmShortChangeLots < 0 ? "covering"  : "holding";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">{label} Overview</div>
      <ul className="space-y-1.5 text-xs leading-relaxed">
        <Bullet>Total OI change of {lotsSigned(m.oiChangeLots)} since last COT</Bullet>
        {m.oiChangeNearby !== null && (
          <Bullet sub>{lotsSigned(m.oiChangeNearby)} in nearby contracts{letters ? ` (${letters})` : ""}</Bullet>
        )}
        {m.oiChangeForward !== null && (
          <Bullet sub>{lotsSigned(m.oiChangeForward)} in forward contracts</Bullet>
        )}
        <Bullet>Price change of {pct1(m.priceChangePct)} ({priceAbs}){structureClause}.</Bullet>
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

      {post && (
        <div className="mt-4 pt-3 border-t border-slate-800">
          <div className="text-[11px] font-semibold text-sky-300/90 mb-2">
            {label.split(" ")[0]} post COT
            <span className="text-slate-500 font-normal"> · from {md(post.cotDate)} until {md(post.latestDate)}</span>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed">
            <Bullet>OI change of {lotsSigned(post.oiChange)} since COT day, of which:</Bullet>
            <Bullet sub>{lotsSigned(post.nearbyChange)} in nearby contracts</Bullet>
            <Bullet sub>{lotsSigned(post.forwardChange)} in forward contracts</Bullet>
            <Bullet>
              Price changed of {pctSigned(post.priceChangePct)} ({isNY ? priceAbsNY(post.priceChangeAbs, true) : priceAbsLDN(post.priceChangeAbs, true)})
              {" "}with a structure moving toward {post.movingToward}, now {post.inCarry ? "in carry" : "inverted"} at {pct1(post.invertedNow)}.
            </Bullet>
            <Bullet>
              Roasters&rsquo; coverage probably {post.roasterLotsDelta > 0
                ? <>increasing ~{lotsSigned(post.roasterLotsDelta)} long — buying into the price dip, counterparty to MM</>
                : <>stable{post.priceChangePct > PRICE_DEADBAND_PCT ? " — reluctant to chase price higher" : ""}</>}.
            </Bullet>
            <Bullet>
              Producers&rsquo; coverage probably {post.producerLotsDelta > 0
                ? <>increasing ~{lotsSigned(post.producerLotsDelta)} short — selling into the price rise, counterparty to MM</>
                : <>stable{post.priceChangePct < -PRICE_DEADBAND_PCT ? " — reluctant to sell into weakness" : ""}</>}.
            </Bullet>
            <Bullet>
              MM probably {post.mmLongDelta < 0 ? "liquidating" : post.mmLongDelta > 0 ? "building" : "holding"} longs ({lotsSigned(post.mmLongDelta)})
              {" "}and {post.mmShortDelta > 0 ? "increasing" : post.mmShortDelta < 0 ? "covering" : "holding"} shorts ({lotsSigned(post.mmShortDelta)}){" "}
              <span className="text-slate-600">(est. &prop;OI)</span>.
            </Bullet>
            {post.counterpartyOther && (
              <Bullet sub>counterparty to MM likely via swaps / other reportables (price move not aligned with commercial hedging)</Bullet>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Overview({ data }: { data: ProcessedCotRow[] }) {
  const [oi, setOi] = useState<OiHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(OI_HISTORY_URL)
      .then(r => (r.ok ? r.json() : null))
      .then((d: OiHistory | null) => { if (!cancelled && d) setOi(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const recent52 = data.slice(-52);
  const ny  = buildMarketMetrics(recent52, data, "ny");
  const ldn = buildMarketMetrics(recent52, data, "ldn");

  const { lettersNy, lettersLdn, postNy, postLdn } = useMemo(() => {
    const last = data[data.length - 1];
    const cotDate = last?.date ?? "";
    return {
      lettersNy:  nearestLetters(oi?.arabica),
      lettersLdn: nearestLetters(oi?.robusta),
      postNy:  last ? buildPostCot(oi?.arabica, cotDate, num(last.ny?.mmLong),  num(last.ny?.mmShort))  : null,
      postLdn: last ? buildPostCot(oi?.robusta, cotDate, num(last.ldn?.mmLong), num(last.ldn?.mmShort)) : null,
    };
  }, [oi, data]);

  const prevPriceNY  = data.length >= 2 ? data[data.length - 2].priceNY  : 0;
  const prevPriceLDN = data.length >= 2 ? data[data.length - 2].priceLDN : 0;

  return (
    <>
      <SectionHeader icon="Eye" title="1. Overview"
        subtitle="Weekly positioning summary per market — OI, price/structure, industry coverage and managed-money flow vs. the prior COT week, plus an intraweek update from the COT day to the latest data." />
      {ny && ldn ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MarketColumn m={ny}  prevPrice={prevPriceNY}  letters={lettersNy}  label="Arabica · NY"  post={postNy} />
          <MarketColumn m={ldn} prevPrice={prevPriceLDN} letters={lettersLdn} label="Robusta · LDN" post={postLdn} />
        </div>
      ) : (
        <div className="text-xs text-slate-500 px-1">Insufficient history to build the overview.</div>
      )}
    </>
  );
}
