"use client";
import { useState } from "react";
import { LDN_PARAMS, NY_PARAMS } from "@/lib/cot/intraweekModel";
import CotBacktestReport from "@/components/futures/CotBacktestReport";

type Sub = "model" | "backtest" | "frost";
const SUBS: { id: Sub; label: string }[] = [
  { id: "model",    label: "Intraweek model" },
  { id: "backtest", label: "COT backtest report" },
  { id: "frost",    label: "Frost risk" },
];

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

function IntraweekMethodology() {
  return (
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
  );
}

function FrostRiskMethodology() {
  return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-3xl space-y-1">

        <H>Why frost is the trade that matters</H>
        <P>
          Frost is the single largest <strong>tail risk</strong> in coffee. Unlike drought, which trims a crop at the
          margin, a hard radiative frost in the southern Brazilian Arabica belt can kill leaf, scorch cherries and, in
          the worst case, set back trees for two seasons. The historical record is brutal and fast: the &ldquo;Black
          Frost&rdquo; of <strong>July 1975</strong> wiped out the bulk of Paraná&rsquo;s crop and is the reference event
          for the entire industry; <strong>June/July 1994</strong> saw two frosts that roughly doubled the price; and the
          <strong> July 2021</strong> freeze pushed Arabica from ~$1.20 to over $2.40/lb inside a few months. Each was a
          step-change, not a drift. The point of a frost monitor is therefore not precision — it is to flag, ahead of the
          news, that the <em>conditions for a step-change exist tonight</em>.
        </P>

        <H>The physics: air temperature is not the answer</H>
        <P>
          The naïve approach — &ldquo;frost when the 2 m air temperature hits 0 °C&rdquo; — systematically misses real
          frost events. Damaging frosts in the Brazilian winter are overwhelmingly <strong>radiative</strong>: on a
          clear, calm, dry night the ground and leaf surface radiate heat to space and cool <em>well below</em> the air
          temperature measured at the standard 2 m height. Plants are routinely damaged at recorded air temperatures of
          3–5 °C. So the model estimates the quantity that actually matters — the <strong>leaf-surface temperature</strong>
          — from the variables that govern radiative cooling.
        </P>

        <H>The model</H>
        <P>
          For each representative point we pull hourly forecast + recent history from Open-Meteo
          (<Code>temperature_2m, dew_point_2m, cloud_cover, wind_speed_10m</Code>), take the daily minimum-temperature
          hour, and estimate surface temperature as:
        </P>
        <P>
          <Code>T_surface = T_min − (1 − cloud/100) × max(0, 5 − 0.4 × wind_kmh) − 0.5·[dew &lt; 2°C]</Code>
        </P>
        <ul className="space-y-1">
          <LI><strong>Radiation term.</strong> <Code>(1 − cloud/100)</Code> switches the cooling off under overcast
            skies (clouds re-radiate heat back down) and on fully to a ~5 °C deficit under clear skies. The
            <Code>max(0, 5 − 0.4 × wind)</Code> factor kills the deficit once wind mixes the boundary layer — by ~12 km/h
            there is effectively no radiative drop. This is why a cold-but-windy or cold-but-cloudy night is <em>safe</em>
            while a milder, clear, dead-calm night is dangerous.</LI>
          <LI><strong>Dry-air correction.</strong> A further −0.5 °C when dew point is below 2 °C: dry air holds little
            latent heat, so there is no condensation to buffer the fall, and the surface keeps dropping.</LI>
        </ul>
        <P>Surface temperature then maps to a four-level risk code:</P>
        <ul className="space-y-1">
          <LI><span className="text-blue-300 font-semibold">H</span> — <Code>T_surface &lt; 0 °C</Code>: damaging frost likely.</LI>
          <LI><span className="text-blue-400 font-semibold">M</span> — <Code>0–3 °C</Code>: frost possible in low-lying pockets.</LI>
          <LI><span className="text-slate-300 font-semibold">L</span> — <Code>3–6 °C</Code>: cold, watch the trend.</LI>
          <LI><span className="text-slate-500 font-semibold">—</span> — <Code>≥ 6 °C</Code>: no frost concern.</LI>
        </ul>

        <H>Where we look</H>
        <P>
          Frost risk is point-sampled at the growing regions that actually freeze, not country-wide averages. In
          Brazil: <Code>Sul de Minas</Code>, <Code>Cerrado</Code>, <Code>Paraná</Code> (the southernmost and
          highest-risk belt) and <Code>Espírito Santo</Code> (Conilon/Robusta — included for completeness, rarely at
          frost risk). A secondary check runs only at Honduras&rsquo; high-altitude plots
          (<Code>Copán</Code>, <Code>Montecillos</Code>, &gt;1800 m), where frost is rare but possible. Each region shows
          a <strong>7-day worst-case badge</strong> (the most severe code in the coming week) plus a
          <strong> 14-day daily grid</strong> so an approaching cold front is visible days out.
        </P>

        <H>What was considered and deliberately left out</H>
        <ul className="space-y-1">
          <LI><strong>ENSO phase.</strong> El Niño/La Niña shift the frost window (the export carries context text like
            &ldquo;Paraná frost window +12 days&rdquo;), but the phase does <em>not</em> algorithmically move the
            temperature thresholds — it is decision context, not a model input, to keep the rule transparent.</LI>
          <LI><strong>Cold-air pooling / topography.</strong> Frost collects in valley bottoms that a single
            representative point cannot resolve. The &ldquo;M&rdquo; band (0–3 °C) is the practical hedge for this — it
            flags nights where sheltered low spots will freeze even if the point estimate does not.</LI>
          <LI><strong>Historical-recurrence probability.</strong> The 1975/1994/2021 events are background context, not
            terms in the formula. This is a <em>physical nowcast</em> of tonight&rsquo;s conditions, not a climatological
            frequency model.</LI>
        </ul>

        <H>Caveats</H>
        <ul className="space-y-1">
          <LI>It is a <strong>forecast-driven estimate</strong> and inherits the Open-Meteo forecast error; treat the
            outer days of the 14-day grid as indicative, not firm.</LI>
          <LI>Point sampling means the badge is a regional proxy — localized frost in unsampled micro-climates can occur
            without the badge lighting up.</LI>
          <LI>The rule runs year-round but is only materially informative in the austral winter (≈ May–August); in summer
            it will correctly read &ldquo;—&rdquo; every night.</LI>
        </ul>

        <H>Where it lives</H>
        <P>
          The estimate is computed in <Code>backend/scraper/sources/farmer_economics.py</Code> (<Code>_frost_risk</Code>),
          mirrored for Honduras in <Code>honduras_weather.py</Code>, published into <Code>farmer_economics.json</Code>,
          and rendered as the badges + 14-day grid in the <Code>WeatherRiskPanel</Code> on each origin&rsquo;s Farmer
          Economics tab.
        </P>
      </div>
  );
}

export default function ResearchView() {
  const [sub, setSub] = useState<Sub>("model");
  return (
    <>
      <div className="flex items-center gap-1 flex-wrap mb-4">
        {SUBS.map(s => (
          <button key={s.id} onClick={() => setSub(s.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              sub === s.id ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {sub === "model" && <IntraweekMethodology />}
      {sub === "backtest" && <CotBacktestReport />}
      {sub === "frost" && <FrostRiskMethodology />}
    </>
  );
}
