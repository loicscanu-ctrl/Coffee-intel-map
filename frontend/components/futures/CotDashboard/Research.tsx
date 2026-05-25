"use client";
import { LDN_PARAMS, NY_PARAMS } from "@/lib/cot/intraweekModel";
import SectionHeader from "./SectionHeader";

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-300 leading-relaxed mb-2">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-slate-300 leading-relaxed">
      <span className="text-amber-500/70">•</span><span>{children}</span>
    </li>
  );
}
const Code = ({ children }: { children: React.ReactNode }) =>
  <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">{children}</code>;

export default function Research() {
  return (
    <>
      <SectionHeader icon="Book" title="11. Research — Methodology"
        subtitle="How the Overview's 'post COT' intraweek estimate is built, what it can and can't do, and how it was validated." />

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-3xl space-y-1">

        <H>What problem it solves</H>
        <P>
          The CFTC/ICE Commitments of Traders (COT) report is <strong>weekly</strong> — it tells you where each
          trader cohort stood on the report Tuesday. Between prints we are blind. The <em>post-COT</em> block in the
          Overview is a <strong>nowcast</strong>: it estimates how positioning has probably shifted from the COT day
          up to the most recent daily data, so the read isn&rsquo;t stale by the time you act on it.
        </P>

        <H>Data sources</H>
        <ul className="space-y-1">
          <LI><strong>Weekly truth</strong> — <Code>cot.json</Code>: each cohort&rsquo;s long/short (managed money, PMPU,
            swaps, other reportables, non-reportables) on every COT Tuesday.</LI>
          <LI><strong>Daily detail</strong> — a per-contract archive of daily open interest <em>and</em> settlement
            price for every Arabica (KC) and Robusta (RM/RC) contract, ~5 years deep. This is what lets us see
            intraweek OI build/liquidation, the front price, and the curve structure day by day.</LI>
        </ul>

        <H>The model, step by step</H>
        <P>For each trading day in the window (COT day → latest), we read that day&rsquo;s change in total open
          interest and the front-contract price move, then:</P>
        <ul className="space-y-1">
          <LI><strong>Regime (which leg moved).</strong> The classic OI×price reading sets the dominant flow:
            price↑ &amp; OI↑ = fresh longs; price↓ &amp; OI↑ = fresh shorts; price↑ &amp; OI↓ = short-covering;
            price↓ &amp; OI↓ = long-liquidation.</LI>
          <LI><strong>Managed money share.</strong> MM is credited its share of that day&rsquo;s open-interest change
            (its share of total OI from the last COT), scaled by the size of the price move versus a 1% reference —
            a bigger move implies higher conviction. Moves under 0.1% are treated as directionless and skipped.</LI>
          <LI><strong>Counterparty.</strong> Every contract has two sides, so the opposite of MM&rsquo;s flow is the
            counterparty. <span className="text-slate-400">Producers</span> (short hedgers) sell into strength;
            <span className="text-slate-400"> roasters</span> (long hedgers) buy into weakness. That counterparty
            flow is split between industry (PMPU) and swaps/other reportables by their COT share of the relevant side.</LI>
          <LI><strong>Accumulate.</strong> The daily attributions are summed across the whole window, so a week with a
            down-day then an up-day is captured correctly rather than collapsed into a single endpoint comparison.</LI>
        </ul>

        <H>Direction is the signal; magnitude is rough</H>
        <P>
          Validated on the 5-year archive (~250 COT weeks per market), the model&rsquo;s <strong>directional</strong>
          accuracy is real — managed-money net, producers and roasters all land <strong>~66–70%</strong> sign-correct,
          versus a ~51–53% base rate (commercials do <em>not</em> simply add coverage every week). The <strong>size</strong>
          of the move is far less predictable: only ~0–5% better than assuming no change. So the lot figures shown are
          deliberately framed as approximate — read the arrow, not the decimal.
        </P>

        <H>Confidence tiers</H>
        <P>
          The one lever that genuinely improves reliability is signal strength. Binning industry calls by the size of
          the estimated flow, accuracy climbs sharply — so each producer/roaster line carries a confidence chip
          calibrated on the backtest:
        </P>
        <ul className="space-y-1">
          <LI><span className="text-emerald-400 font-semibold">high</span> — ~82–86% directional hit-rate.</LI>
          <LI><span className="text-amber-400 font-semibold">med</span> — ~67–69%.</LI>
          <LI><span className="text-slate-400 font-semibold">low</span> — ~60%, near the base rate; treat as tentative.</LI>
        </ul>
        <P>
          The tier cut-offs (33rd/67th percentiles of historical signal magnitude, in lots) are market-specific:
          Arabica <Code>{`low<${NY_PARAMS.confLow} · high>${NY_PARAMS.confHigh}`}</Code>,
          Robusta <Code>{`low<${LDN_PARAMS.confLow} · high>${LDN_PARAMS.confHigh}`}</Code>.
          Because the live window is often a <em>partial</em> week, early-week reads are small and will usually show
          &ldquo;low&rdquo; — by design: there isn&rsquo;t much information yet.
        </P>

        <H>Per-market calibration</H>
        <P>
          The two markets behave differently. On the backtest the magnitude-error curve is monotonic in opposite
          directions, so Arabica is given a higher MM-share multiplier ({NY_PARAMS.mmShareMult}×) and Robusta a lower
          one ({LDN_PARAMS.mmShareMult}×). Direction is unaffected by this lever; it only sizes the lot estimates.
        </P>

        <H>What was tried and rejected</H>
        <ul className="space-y-1">
          <LI><strong>Price-level z-score</strong> (the idea that commercials are contrarian on absolute price):
            scored ~46–51% for industry direction — worse than a coin flip — so it was not added.</LI>
          <LI><strong>Raw weekly price direction</strong> as the predictor: the day-by-day, OI-gated regime model
            beats it (e.g. roasters ~70% vs ~57–63%).</LI>
        </ul>

        <H>Caveats</H>
        <ul className="space-y-1">
          <LI>It is a <strong>nowcast, not a forecast</strong> — it explains the move that has already happened in OI and
            price, it does not predict next week.</LI>
          <LI>Magnitudes are approximate; lean on the direction and the confidence tier.</LI>
          <LI>The daily archive carries a ~1-day internal lag (price settles a day before OI is reported); immaterial
            at weekly cadence but worth knowing.</LI>
          <LI>The post-COT block only appears once daily data exists <em>after</em> the COT date; if the feed lags the
            release it hides rather than showing stale numbers.</LI>
        </ul>

        <H>Reproducing the numbers</H>
        <P>
          Everything here is regenerated by <Code>scripts/backtest-intraweek.mjs</Code> (run with
          <Code>node --import tsx scripts/backtest-intraweek.mjs</Code>), which replays every COT→COT interval covered
          by the archive, scores predicted vs. realized cohort deltas against zero- and proportional-OI baselines, and
          prints the per-market multiplier and confidence-tier calibration. The model itself lives in
          <Code>lib/cot/intraweekModel.ts</Code>.
        </P>
      </div>
    </>
  );
}
