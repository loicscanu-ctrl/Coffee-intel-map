"use client";
import { useEffect, useMemo, useState } from "react";
import type { CotMarketPositions, ProcessedCotRow } from "@/lib/cot/types";
import { buildMarketMetrics } from "@/lib/pdf/dataHelpers";
import type { MarketMetrics } from "@/lib/pdf/types";
import SectionHeader from "./SectionHeader";

// ── number formatting (mirrors the COT weekly PDF) ────────────────────────────
const lotsSigned = (v: number) => `${v >= 0 ? "+" : ""}${(v / 1000).toFixed(1)} k lots`;
const lotsAbs    = (v: number) => `${(Math.abs(v) / 1000).toFixed(1)} k lots`;
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
  producerLotsDelta: number; roasterLotsDelta: number; othersDelta: number;
};

const PRICE_DEADBAND_PCT = 0.1;  // ignore sub-0.1% daily moves as directionless
const PRICE_REF_PCT      = 1.0;  // a 1% day = unit conviction
const PRICE_SCALE_MIN    = 0.25; // floor / cap on the price-magnitude scaler (#4)
const PRICE_SCALE_MAX    = 2.0;
const FLOW_THRESHOLD     = 50;   // lots below which a leg reads "stable/holding"
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function buildPostCot(days: OiDay[] | undefined, cotDate: string, pos: CotMarketPositions): PostCot | null {
  if (!days?.length) return null;
  const latest = days[0];                              // newest-first
  const anchorIdx = days.findIndex(d => d.date <= cotDate);
  if (anchorIdx < 0 || latest.date <= cotDate) return null;
  const anchor = days[anchorIdx];

  const tot    = (d: OiDay) => d.contracts.reduce((s, c) => s + num(c.oi), 0);
  const nearby = (d: OiDay) => d.contracts.slice(0, 2).reduce((s, c) => s + num(c.oi), 0);
  const maxOI  = (d: OiDay) => d.contracts.reduce((a, c) => (num(c.oi) > num(a.oi) ? c : a), d.contracts[0]);
  const samePx = (d: OiDay, sym: string) => num(d.contracts.find(c => c.symbol === sym)?.last_price) || num(d.contracts[0]?.last_price);

  // ── Endpoint facts (COT day → latest) for the displayed OI / price / structure
  const oiL = tot(latest), oiA = tot(anchor);
  const oiChange = oiL - oiA;
  const nearbyChange = nearby(latest) - nearby(anchor);
  const front = maxOI(latest);
  const pL = num(front?.last_price), pA = samePx(anchor, front?.symbol ?? "");
  const priceChangeAbs = pL - pA;
  const struct = (d: OiDay) => num(d.contracts[1]?.last_price) - num(d.contracts[0]?.last_price);
  const fpx    = (d: OiDay) => num(d.contracts[0]?.last_price) || 1;
  const invL = (-struct(latest) / fpx(latest)) * 100, invA = (-struct(anchor) / fpx(anchor)) * 100;

  // ── Positioning estimate, accumulated day-by-day (#3) over the post-COT window.
  // Per day, the OI×price regime (#1) decides which leg moves and its sign:
  //   price↑/OI↑ fresh longs · price↓/OI↑ fresh shorts · price↑/OI↓ short-cover · price↓/OI↓ long-liq
  // MM is credited its share of that day's |ΔOI|, scaled by the price move (#4).
  // The opposite side is the counterparty (#2 — both legs handled across regimes),
  // split between industry and swaps/other reportables by their COT share (#5).
  const mmShareOI    = clamp((pos.mmLong + pos.mmShort) / (2 * (oiA || 1)), 0, 0.5);
  const shortNonMM   = pos.pmpuShort + pos.swapShort + pos.otherShort + pos.nonRepShort;
  const longNonMM    = pos.pmpuLong  + pos.swapLong  + pos.otherLong  + pos.nonRepLong;
  const prodShare    = shortNonMM > 0 ? clamp(pos.pmpuShort / shortNonMM, 0, 1) : 0;
  const roastShare   = longNonMM  > 0 ? clamp(pos.pmpuLong  / longNonMM,  0, 1) : 0;

  const win = days.slice(0, anchorIdx + 1).reverse(); // chronological: anchor → latest
  let mmLongDelta = 0, mmShortDelta = 0, producerLotsDelta = 0, roasterLotsDelta = 0, othersDelta = 0;
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1], cur = win[i];
    const d = tot(cur) - tot(prev);
    const fc = maxOI(cur);
    const pc = num(fc?.last_price), pp = samePx(prev, fc?.symbol ?? "");
    if (!pp) continue;
    const pct = ((pc - pp) / pp) * 100;
    if (Math.abs(pct) < PRICE_DEADBAND_PCT) continue;          // directionless day
    const up = pct > 0;
    const amt = mmShareOI * clamp(Math.abs(pct) / PRICE_REF_PCT, PRICE_SCALE_MIN, PRICE_SCALE_MAX) * d;
    if (d >= 0) {
      if (up) { mmLongDelta  += amt; producerLotsDelta += amt * prodShare;  othersDelta += amt * (1 - prodShare); }
      else    { mmShortDelta += amt; roasterLotsDelta  += amt * roastShare; othersDelta += amt * (1 - roastShare); }
    } else {
      if (up) { mmShortDelta += amt; roasterLotsDelta  += amt * roastShare; othersDelta += amt * (1 - roastShare); }
      else    { mmLongDelta  += amt; producerLotsDelta += amt * prodShare;  othersDelta += amt * (1 - prodShare); }
    }
  }

  return {
    cotDate: anchor.date, latestDate: latest.date,
    oiChange, nearbyChange, forwardChange: oiChange - nearbyChange,
    priceChangeAbs, priceChangePct: pA ? (priceChangeAbs / pA) * 100 : 0,
    invertedNow: Math.abs(invL), inCarry: struct(latest) > 0,
    movingToward: invL > invA ? "backwardation" : "carry",
    mmLongDelta, mmShortDelta, producerLotsDelta, roasterLotsDelta, othersDelta,
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
              Roasters&rsquo; coverage probably {post.roasterLotsDelta > FLOW_THRESHOLD
                ? <>increasing ~{lotsAbs(post.roasterLotsDelta)} long — buying into weakness, counterparty to MM</>
                : post.roasterLotsDelta < -FLOW_THRESHOLD
                ? <>reducing ~{lotsAbs(post.roasterLotsDelta)} long — trimming into strength</>
                : "stable"}.
            </Bullet>
            <Bullet>
              Producers&rsquo; coverage probably {post.producerLotsDelta > FLOW_THRESHOLD
                ? <>increasing ~{lotsAbs(post.producerLotsDelta)} short — selling into strength, counterparty to MM</>
                : post.producerLotsDelta < -FLOW_THRESHOLD
                ? <>reducing ~{lotsAbs(post.producerLotsDelta)} short — covering into weakness</>
                : "stable"}.
            </Bullet>
            <Bullet>
              MM probably {post.mmLongDelta < -FLOW_THRESHOLD ? "liquidating" : post.mmLongDelta > FLOW_THRESHOLD ? "building" : "holding"} longs ({lotsSigned(post.mmLongDelta)})
              {" "}and {post.mmShortDelta > FLOW_THRESHOLD ? "increasing" : post.mmShortDelta < -FLOW_THRESHOLD ? "covering" : "holding"} shorts ({lotsSigned(post.mmShortDelta)}){" "}
              <span className="text-slate-600">(est. OI&times;price regime)</span>.
            </Bullet>
            {Math.abs(post.othersDelta) > FLOW_THRESHOLD && (
              <Bullet sub>swaps / other reportables absorbing ~{lotsAbs(post.othersDelta)} of the counterparty flow</Bullet>
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
      postNy:  last ? buildPostCot(oi?.arabica, cotDate, last.ny)  : null,
      postLdn: last ? buildPostCot(oi?.robusta, cotDate, last.ldn) : null,
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
