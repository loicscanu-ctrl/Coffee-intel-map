"use client";
import { useMemo } from "react";
import type { ProcessedCotRow } from "@/lib/cot/types";

interface Props {
  data: ProcessedCotRow[];
  recent52: ProcessedCotRow[];
}

function pctLabel(rank: number): string {
  if (rank >= 80) return "extreme long";
  if (rank >= 65) return "elevated long";
  if (rank >= 50) return "net long";
  if (rank >= 35) return "near neutral";
  if (rank >= 20) return "net short";
  if (rank >= 5)  return "elevated short";
  return "extreme short";
}

function bias(rank: number): "bull" | "bear" | "neutral" {
  if (rank >= 60) return "bull";
  if (rank <= 40) return "bear";
  return "neutral";
}

function fmtK(n: number): string {
  return `${n >= 0 ? "+" : ""}${Math.round(n / 1000)}k`;
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider mr-1"
      style={{ background: color + "33", color, border: `1px solid ${color}55` }}
    >
      {label}
    </span>
  );
}

interface Block {
  title: string;
  body: string;
  signal: "bull" | "bear" | "neutral" | "info";
}

const SIGNAL_COLORS: Record<string, string> = {
  bull:    "#4ade80",
  bear:    "#f87171",
  neutral: "#94a3b8",
  info:    "#60a5fa",
};

export default function Step7Report({ data, recent52 }: Props) {
  const blocks = useMemo((): Block[] => {
    if (!data.length || !recent52.length) return [];
    const latest = data[data.length - 1];
    const prev   = data.length >= 2 ? data[data.length - 2] : latest;

    const mmNetNY  = latest.ny.mmLong  - latest.ny.mmShort;
    const mmNetLDN = latest.ldn.mmLong - latest.ldn.mmShort;
    const mmNetNY_prev  = prev.ny.mmLong  - prev.ny.mmShort;
    const mmNetLDN_prev = prev.ldn.mmLong - prev.ldn.mmShort;
    const wowNY  = mmNetNY  - mmNetNY_prev;
    const wowLDN = mmNetLDN - mmNetLDN_prev;

    const oiRank    = latest.oiRank;
    const oiRankLDN = latest.oiRankLDN;
    const priceRank = latest.priceRank;

    // 52-week min/max net for context
    const netsNY  = recent52.map(r => r.ny.mmLong  - r.ny.mmShort);
    const netsLDN = recent52.map(r => r.ldn.mmLong - r.ldn.mmShort);
    const maxNY   = Math.max(...netsNY),  minNY  = Math.min(...netsNY);
    const maxLDN  = Math.max(...netsLDN), minLDN = Math.min(...netsLDN);

    const blocks: Block[] = [];

    // ── 1. Positioning summary ────────────────────────────────────────────────
    blocks.push({
      title: "Managed Money Positioning",
      signal: bias(oiRank),
      body: [
        `NY (Arabica): MM net ${Math.round(mmNetNY / 1000)}k lots — ${pctLabel(oiRank)} (${Math.round(oiRank)}th pctile, 5yr). ` +
        `52-week range ${Math.round(minNY / 1000)}k → ${Math.round(maxNY / 1000)}k.`,
        `London (Robusta): MM net ${Math.round(mmNetLDN / 1000)}k lots — ${pctLabel(oiRankLDN)} (${Math.round(oiRankLDN)}th pctile). ` +
        `52-week range ${Math.round(minLDN / 1000)}k → ${Math.round(maxLDN / 1000)}k.`,
      ].join(" "),
    });

    // ── 2. Week-over-week flow ────────────────────────────────────────────────
    const flowSignal: "bull" | "bear" | "neutral" =
      wowNY + wowLDN > 2000  ? "bull" :
      wowNY + wowLDN < -2000 ? "bear" : "neutral";

    blocks.push({
      title: "Week-over-Week Flow",
      signal: flowSignal,
      body: `NY: MM ${wowNY >= 0 ? "added" : "cut"} ${Math.abs(Math.round(wowNY / 1000))}k lots ` +
            `(longs ${fmtK(latest.ny.mmLong - prev.ny.mmLong)}, shorts ${fmtK(latest.ny.mmShort - prev.ny.mmShort)}). ` +
            `London: ${wowLDN >= 0 ? "added" : "cut"} ${Math.abs(Math.round(wowLDN / 1000))}k lots. ` +
            `Combined nominal flow: ${fmtK(wowNY + wowLDN)} lots.`,
    });

    // ── 3. Price vs positioning divergence ───────────────────────────────────
    const divergence = Math.abs(priceRank - oiRank);
    let divBody: string;
    let divSignal: "bull" | "bear" | "neutral" | "info";
    if (divergence < 15) {
      divBody = `Price and positioning aligned — price at ${Math.round(priceRank)}th pctile, ` +
                `MM net at ${Math.round(oiRank)}th pctile. No significant divergence.`;
      divSignal = "neutral";
    } else if (priceRank > oiRank + 15) {
      divBody = `Price (${Math.round(priceRank)}th pctile) running ahead of MM positioning ` +
                `(${Math.round(oiRank)}th pctile). Longs may be underweight vs price — ` +
                `potential catch-up flow if bull narrative holds.`;
      divSignal = "bull";
    } else {
      divBody = `MM net (${Math.round(oiRank)}th pctile) extended vs price (${Math.round(priceRank)}th pctile). ` +
                `Positioning crowded relative to price level — mean reversion risk elevated.`;
      divSignal = "bear";
    }
    blocks.push({ title: "Price vs Positioning", signal: divSignal, body: divBody });

    // ── 4. Crowd risk ─────────────────────────────────────────────────────────
    let crowdBody: string;
    let crowdSignal: "bull" | "bear" | "neutral" | "info";
    if (oiRank >= 80) {
      crowdBody = `Positioning crowded at ${Math.round(oiRank)}th pctile. Squeeze risk if fundamentals disappoint — ` +
                  `longs would need to liquidate ~${Math.round((mmNetNY - minNY) / 1000)}k lots to reach 52-week low.`;
      crowdSignal = "bear";
    } else if (oiRank <= 20) {
      crowdBody = `Positioning washed out at ${Math.round(oiRank)}th pctile. Low long exposure — ` +
                  `rally would force short covering of ~${Math.round((maxNY - mmNetNY) / 1000)}k lots to reach 52-week high.`;
      crowdSignal = "bull";
    } else {
      crowdBody = `Positioning mid-range (${Math.round(oiRank)}th pctile). No extreme crowd risk on either side. ` +
                  `Room to add ~${Math.round((maxNY - mmNetNY) / 1000)}k lots long or cut ${Math.round((mmNetNY - minNY) / 1000)}k lots short before reaching extremes.`;
      crowdSignal = "neutral";
    }
    blocks.push({ title: "Crowd Risk", signal: crowdSignal, body: crowdBody });

    // ── 5. Commercial / PMPU hedging ─────────────────────────────────────────
    const pmpuNet = latest.pmpuLongMT - latest.pmpuShortMT;
    const hedgeNote = pmpuNet < 0
      ? `Commercials/producers net short ${Math.abs(Math.round(pmpuNet / 1000))}k MT — elevated hedge cover consistent with producers locking in current prices.`
      : `Commercials/PMPU net long ${Math.round(pmpuNet / 1000)}k MT — light hedge cover, producers may expect higher prices ahead.`;
    blocks.push({
      title: "Commercial / PMPU Positioning",
      signal: pmpuNet < 0 ? "info" : "bull",
      body: hedgeNote,
    });

    // ── 6. Market bias summary ────────────────────────────────────────────────
    const bullSignals = blocks.filter(b => b.signal === "bull").length;
    const bearSignals = blocks.filter(b => b.signal === "bear").length;
    const overallBias = bullSignals > bearSignals ? "Bullish" : bearSignals > bullSignals ? "Bearish" : "Neutral";
    const biasColor   = overallBias === "Bullish" ? "bull" : overallBias === "Bearish" ? "bear" : "neutral";

    blocks.push({
      title: "Overall COT Bias",
      signal: biasColor as "bull" | "bear" | "neutral",
      body: `${overallBias} — ${bullSignals} bull / ${bearSignals} bear / ${5 - bullSignals - bearSignals} neutral signals from positioning, flow, divergence, and crowd risk analysis above. ` +
            `COT data as of ${latest.date}. Note: COT lags by ~3 trading days.`,
    });

    return blocks;
  }, [data, recent52]);

  if (!blocks.length) {
    return (
      <div className="py-8 text-center text-slate-500 text-sm italic">
        Loading COT data…
      </div>
    );
  }

  return (
    <div id="cot-section-7" className="space-y-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold px-1">
        COT Report — Automated Positioning Analysis
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {blocks.map((block, i) => {
          const color = SIGNAL_COLORS[block.signal];
          return (
            <div
              key={i}
              className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-1.5"
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}
            >
              <div className="flex items-center gap-2">
                <Tag label={block.signal} color={color} />
                <span className="text-[11px] font-semibold text-slate-200">{block.title}</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">{block.body}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-slate-600 px-1 italic">
        Percentiles computed from 5-year (260-week) rolling window. Signals are systematic — not discretionary advice.
      </p>
    </div>
  );
}
