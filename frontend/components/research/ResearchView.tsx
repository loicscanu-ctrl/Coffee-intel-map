"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LDN_PARAMS, NY_PARAMS } from "@/lib/cot/intraweekModel";
import CotBacktestReport from "@/components/futures/CotBacktestReport";
import AgronomyArticles from "./AgronomyArticles";

type Cat = "cot" | "weather" | "fertilizer" | "contracts" | "agronomy" | "logistics";
const CATS: { id: Cat; label: string }[] = [
  { id: "cot",        label: "COT & positioning" },
  { id: "weather",    label: "Weather" },
  { id: "fertilizer", label: "Fertilizer" },
  { id: "contracts",  label: "Contract rules" },
  { id: "agronomy",   label: "Agronomy" },
  { id: "logistics",  label: "Origin Logistics" },
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

// Newspaper-style article card — bold headline over a double rule, justified
// body. Used for the side-by-side contract-rule columns.
function Article({ kicker, title, dateline, children }: {
  kicker?: string; title: string; dateline?: string; children: React.ReactNode;
}) {
  return (
    <article className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      {kicker && (
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-2">{kicker}</div>
      )}
      <h3 className="text-xl font-bold text-slate-100 leading-tight mb-1 pb-2 border-b-2 border-double border-slate-600">
        {title}
      </h3>
      {dateline && (
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-3 mt-2">{dateline}</div>
      )}
      <div className="text-xs text-slate-300 leading-relaxed text-justify space-y-2 mt-3">
        {children}
      </div>
    </article>
  );
}

function Spec({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <p className="mb-1.5">
      <span className="font-semibold text-slate-200">{k}: </span>
      <span className="text-slate-300">{children}</span>
    </p>
  );
}

function PdfLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded bg-amber-900/40 border border-amber-700/50 text-amber-300 text-[11px] font-sans font-semibold hover:bg-amber-900/60 transition-colors">
      <span aria-hidden>📄</span> {children}
    </a>
  );
}

function ContractRules() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

      <Article kicker="ICE Futures U.S." title={"Coffee “C” Futures (Arabica · KC)"} dateline="Chapter 8 · Coffee “C” Rules">
        <p className="mb-3">
          The Coffee &ldquo;C&rdquo; contract is the world benchmark for <strong>washed Arabica</strong>. The rulebook
          opens with a notice that ICE is <em>phasing it out</em>: a new Arabica contract was slated to list in fall 2025,
          no Coffee &ldquo;C&rdquo; futures are listed beyond the <strong>March 2028</strong> month, and only options on
          March-2028-and-earlier futures will continue.
        </p>
        <Spec k="Lot size">37,500 lb of washed Arabica (one growth).</Spec>
        <Spec k="Deliverable growths">Brazil, Colombia, Costa Rica, Guatemala, Honduras, Mexico, Peru, Uganda and ~12
          others; <strong>Vietnam added from the May 2027 month</strong>.</Spec>
        <Spec k="Grade standard">Sound, free of unwashed/aged cup flavours, good roasting quality; no more than
          <strong> 15 full imperfections</strong> below the growth basis (Colombian: max 10).</Spec>
        <Spec k="Delivery months">March, May, July, September, December; listed up to 60 months out.</Spec>
        <Spec k="Price / tick">Quoted in cents per pound; minimum fluctuation <strong>0.05¢/lb</strong> — i.e.
          <strong> $18.75 per contract</strong>.</Spec>
        <Spec k="Price basis">A basket of basis growths (Mexico, Nicaragua, Panama, PNG, El Salvador, Tanzania, Peru,
          Honduras, Uganda from the Mar 2026 month) with Board-set differentials for other growths and grades.</Spec>
        <Spec k="Delivery mechanism">Electronic warehouse receipts (EWRs) via <Code>eCOPS</Code>; Date of Delivery is
          7 business days after the Delivery Notice.</Spec>
        <Spec k="Key dates">Last Notice Day = 7th business day before the last business day of the delivery month;
          Last Trading Day = the business day before Last Notice Day.</Spec>
        <Spec k="Delivery points">Licensed warehouses at the Port of New York District, New Orleans, Miami, Houston,
          Virginia, Antwerp, Hamburg/Bremen and Barcelona.</Spec>
        <Spec k="Packaging">Max 5 chops per lot; sisal/jute/burlap bags ≥700 g; ≤15 slack bags. Customs-status and EU
          deforestation (EUDR) appendices apply.</Spec>
        <PdfLink href="https://www.ice.com/publicdocs/rulebooks/futures_us/8_Coffee.pdf">Full rulebook on ICE (PDF)</PdfLink>
      </Article>

      <Article kicker="ICE Futures Europe" title={"Robusta Coffee Futures (RC · Section GGGG)"} dateline="Section GGGG · Contract Rules">
        <p className="mb-3">
          The London Robusta contract — rulebook <strong>Section GGGG</strong> — is the global benchmark for
          <strong> Robusta</strong> (<em>Coffea canephora</em>). It is sized and priced per <strong>tonne</strong> and
          settles into European/UK/US warehouse delivery, with a tiered quality-class allowance schedule rather than a
          single deliverable grade.
        </p>
        <Spec k="Lot size">Nominal <strong>10 tonnes</strong> net, one Origin and shipment period, from no more than two
          parcels.</Spec>
        <Spec k="Origin">Any country freely available for export.</Spec>
        <Spec k="Quality classes (per 300 g)">Premium (≤0.5% defects, 90% over Screen 15) <strong>+$30/t</strong>;
          Class 1 (≤3% defects, Screen 14) <strong>at par</strong>; Class 2 <strong>−$30/t</strong>; Class 3
          <strong> −$60/t</strong>; Class 4 (≤8% defects, Screen 12) <strong>−$90/t</strong>.</Spec>
        <Spec k="Not tenderable">&gt;8% defects, &lt;90% over Screen 12 round, &gt;1% foreign matter, foreign odour, or
          not sound Robusta.</Spec>
        <Spec k="Price / tick">Quoted in US$ per tonne; minimum fluctuation <strong>$1/tonne = $10 per lot</strong>.</Spec>
        <Spec k="Age allowance">−$5/tonne per month for grading age 13–48 months; −$10/tonne per month from 49 months.</Spec>
        <Spec k="Packaging">Bags ≤80 kg gross; bulk in FIBCs of 900–1,100 kg.</Spec>
        <Spec k="Delivery areas">Amsterdam, Antwerp, Barcelona, Bremen, Felixstowe, Genoa-Savona, Hamburg, Le Havre,
          London (Tilbury), New Orleans, New York, Rotterdam, Trieste.</Spec>
        <Spec k="Customs">EU delivery is into a Customs Warehouse retaining <strong>non-Union status</strong>;
          UK / New Orleans / New York lots must be cleared into free circulation.</Spec>
        <Spec k="Key dates">Last Trading Day = 4th business day before the last business day of the delivery month;
          First Notice Day = 4th business day before its first business day.</Spec>
        <Spec k="Invoicing">EDSP × Net Weight, less Age, Class, Weight, Rent, Import-Duty and Transition-Stock
          allowances. EU/UK lots require validated deforestation (DDI) data.</Spec>
        <PdfLink href="https://www.ice.com/publicdocs/contractregs/105_SECTION_GGGG.pdf">Full rulebook on ICE (PDF)</PdfLink>
      </Article>

    </div>
  );
}

function FertilizerMethodology() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-3xl space-y-1">
      <H>Why fertilizer is a coffee signal</H>
      <P>
        Fertilizer is the largest cash input on a coffee farm and the one that swings most violently with the global
        energy and macro cycle. It matters on two clocks. <strong>Short term</strong> it is a cost-push lever: when urea
        or potash spike, the farm-gate break-even rises and marginal growers come under margin pressure.{" "}
        <strong>Medium term</strong> it is a yield lever &mdash; when fertilizer turns expensive relative to the coffee
        price, growers cut application rates, and coffee, a perennial, pays that back as weaker bean fill and lighter
        crops one to two seasons <em>later</em>. The fertilizer page is therefore a leading read on future supply, not
        just a current cost line.
      </P>

      <H>The three nutrients we track</H>
      <ul className="space-y-1">
        <LI><strong>Nitrogen &mdash; Urea (N).</strong> Drives vegetative growth and is the single biggest nutrient
          demand for coffee; its price is tied to natural gas, so it moves with the energy complex.</LI>
        <LI><strong>Phosphate &mdash; MAP/DAP (P).</strong> Root and cherry development; priced off ammonia, sulphur and
          phosphate rock.</LI>
        <LI><strong>Potassium &mdash; KCl / potash (K).</strong> Coffee is a notably heavy potassium feeder &mdash; K
          governs bean filling in the cherry-development window. Potash supply is concentrated in a handful of producers
          (Canada, Russia, Belarus), so it carries supply-shock and sanction risk.</LI>
      </ul>

      <H>Data sources</H>
      <ul className="space-y-1">
        <LI><strong>Benchmark prices</strong> &mdash; the World Bank <em>Commodity Markets &ldquo;Pink Sheet&rdquo;</em>{" "}
          monthly series for Urea, DAP and KCl (<Code>urea_monthly</Code>, <Code>dap_monthly</Code>,{" "}
          <Code>kcl_monthly</Code> plus full history). The source Excel&rsquo;s document ID rotates on every update, so
          the scraper discovers the current URL dynamically rather than hard-coding it.</LI>
        <LI><strong>Import volumes &amp; origins</strong> &mdash; Comex-Stat (Brazil) and Vietnam customs data for monthly
          fertilizer imports and the country-of-origin mix, surfacing import dependence and origin concentration.</LI>
        <LI><strong>Application calendar</strong> &mdash; the agronomic window that flags when the next major fertilizer
          pass falls in the crop cycle, so a price spike can be read against whether buying is imminent or months off.</LI>
      </ul>

      <H>How it transmits to the crop</H>
      <P>
        Brazil and Vietnam &mdash; the two largest origins &mdash; import the large majority of their fertilizer, so the
        delivered cost is the World Bank benchmark <em>plus</em> ocean freight <em>plus</em> the local-currency move
        (BRL, VND). The farm-gate input cost is thus a three-way function of nutrient price, freight and FX &mdash; which
        is why a flat dollar urea price can still squeeze a Brazilian grower if the real weakens.
      </P>
      <P>
        The reference shock is <strong>2021&ndash;22</strong>: natural-gas prices drove urea up while the Russia/Belarus
        disruption tightened potash, lifting all three nutrients to multi-year highs. Growers responded by trimming
        application &mdash; the kind of move that surfaces in yields with a lag, which is why the panel pairs current
        prices with the longer history.
      </P>

      <H>Where it shows up in the app</H>
      <ul className="space-y-1">
        <LI><strong>Macro tab</strong> &mdash; the fertilizer-inputs panel plots the World Bank price history for the
          three nutrients.</LI>
        <LI><strong>Supply &rarr; Farmer Economics</strong> &mdash; current nutrient prices, the Brazil/Vietnam import
          mix and the application calendar, feeding the production-cost / break-even view.</LI>
      </ul>

      <H>Caveats</H>
      <ul className="space-y-1">
        <LI>The Pink Sheet is a <strong>global benchmark</strong>, not a farm-gate price: real delivered cost adds
          freight, FX, blending and retail margin, and varies by region.</LI>
        <LI>The price&rarr;yield link is <strong>real but lagged and noisy</strong> &mdash; weather usually dominates any
          single season, so read fertilizer as slow background pressure, not a timing signal.</LI>
        <LI>Benchmark prices are <strong>monthly</strong> and import data lags by weeks; treat the read as a trend, not a
          daily mark.</LI>
      </ul>
    </div>
  );
}

function CostRow({ label, cost, note }: { label: string; cost: string; note?: string }) {
  return (
    <tr className="border-b border-slate-800">
      <td className="py-1.5 pr-4 text-slate-300">{label}</td>
      <td className="py-1.5 pr-4 text-right font-mono text-amber-300 whitespace-nowrap">{cost}</td>
      <td className="py-1.5 text-slate-500 text-[11px]">{note}</td>
    </tr>
  );
}

function CostTable({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full text-xs mt-3 mb-4">
      <thead>
        <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
          <th className="pb-1.5 pr-4">Component</th>
          <th className="pb-1.5 pr-4 text-right">USD/t</th>
          <th className="pb-1.5">Notes</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function OriginLogistics() {
  return (
    <div className="space-y-5 max-w-4xl">

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <H>What is a FOBbing cost?</H>
        <P>
          The physical prices on the ticker — VN FAQ, CON T7, UGA S15 — are quoted at the <strong>origin
          warehouse</strong> or farmgate level, not at a ship&#39;s rail. The ICE Robusta contract (RC) settles at
          European port warehouses. To make origin prices comparable with RC futures, you add the <strong>FOBbing
          cost</strong>: the full chain of expenses that moves coffee from farm to vessel, ready for loading.
        </P>
        <P>
          The ticker differential already incorporates this:
        </P>
        <div className="font-mono text-xs bg-slate-800 rounded px-3 py-2 text-amber-300 mb-2">
          N±diff = physical_USD + FOBbing_cost − RC_nearby
        </div>
        <P>
          A negative N-diff means origin-adjusted coffee is <em>cheaper</em> than futures parity — origin is offering
          a discount. A positive N-diff means origin is commanding a premium.
        </P>
      </div>

      {/* Vietnam */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Vietnam · Dak Lak / Central Highlands</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          VN FAQ Robusta — FOBbing cost ~$100/t
        </h3>
        <P>
          Vietnam runs the tightest logistics chain of the three origins. The port of Cat Lai (Ho Chi Minh City) is
          efficient, and the domestic trucking corridor from Dak Lak is well-established. The single largest line is
          the L1 inland collection, which aggregates smallholder coffee from cooperative warehouses spread across the
          plateau.
        </P>
        <CostTable>
          <CostRow label="L1 — Inland collection" cost="25.00" note="Farm → Dak Lak co-op warehouse; covers aggregation + local haulage" />
          <CostRow label="L2 — Trucking to port" cost="6.54" note="Dak Lak → Ho Chi Minh City / Cat Lai (~290 km)" />
          <CostRow label="Cargo insurance" cost="0.61" note="In-transit policy" />
          <CostRow label="LoLo (port handling)" cost="2.43" note="Load on / Load off at berth" />
          <CostRow label="Dunnage & securing" cost="0.71" note="Container stuffing materials" />
          <CostRow label="Fumigation" cost="1.25" note="MARD-mandated phytosanitary fumigation" />
          <CostRow label="Quality inspection" cost="1.23" note="Weight + quality certificate" />
          <CostRow label="Forwarder service fee" cost="0.50" note="Freight-forwarding agent" />
          <CostRow label="Customs declaration" cost="0.38" note="Customs brokerage" />
          <CostRow label="Bill of Lading" cost="0.18" note="Shipping document issuance" />
          <CostRow label="Phytosanitary certificate" cost="0.07" note="MARD phytosanitary cert" />
          <CostRow label="THC (terminal handling)" cost="5.87" note="Cat Lai terminal handling charge" />
          <CostRow label="Port infrastructure fee" cost="0.48" note="Vietnam port authority" />
          <CostRow label="Container seal" cost="0.38" note="Security seal" />
          <CostRow label="Financing" cost="10.00" note="~0.37% on $2,700 price × 3-week float" />
          <CostRow label="Exporter margin" cost="~35" note="~1% of FOB value on ~$3,500 reference price" />
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">~100</td>
            <td className="pt-2 text-slate-500 text-[11px]">~2.9% of $3,500 reference price</td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> Vietnam&#39;s FOBbing cost is the most stable of the three — no quality
          transformation required, and the trucking corridor is well-supplied. The exporter margin (~1% of FOB) is the
          largest variable line: it compresses when origin is long and exporters compete, and firms when supply is tight.
        </P>
      </div>

      {/* Brazil */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Brazil · Espírito Santo / Rondônia</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          CON T7 Conilon — FOBbing cost ~$200/t
        </h3>
        <P>
          Brazil&#39;s larger figure reflects a structural cost that Vietnam doesn&#39;t face: <strong>quality
          preparation</strong>. Raw Conilon from the farm often arrives at the dry mill at Screen 13–14 with a
          natural cup. To tender into the ICE RC contract at Class 1 or better — or to sell into European roaster
          specifications — the coffee needs mechanical sorting, hulling, and polishing. That processing step is
          semi-fixed and accounts for the largest single block of the FOBbing cost.
        </P>
        <CostTable>
          <CostRow label="Quality preparation" cost="55–65" note="Mechanical sorting, hulling, polishing to Class 1+ spec" />
          <CostRow label="L1 — Farm to dry mill" cost="10–15" note="Smallholder aggregation; distance varies across ES/RO" />
          <CostRow label="L2 — Mill to port (Santos/Vitória)" cost="20–25" note="Road haulage; Santos ~900 km from Rondônia" />
          <CostRow label="MAPA inspection & fumigation" cost="8–12" note="Brazilian agriculture ministry mandatory checks" />
          <CostRow label="THC + port docs + B/L" cost="17–18" note="Terminal handling, export documentation, bill of lading" />
          <CostRow label="Financing" cost="15" note="~0.5% on $3,000 price × 3-week float" />
          <CostRow label="Exporter margin" cost="~30" note="~1% of FOB price; the competitive floor for origin traders" />
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">~200</td>
            <td className="pt-2 text-slate-500 text-[11px]">~6.5% of $3,000 reference price</td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> The quality-preparation cost is the decisive variable. When Brazilian Conilon
          is already clean (cooperative members with processing equipment), the chain is efficient. When it comes in
          as naturals from smallholders, processing costs climb. The $200 figure is the blended reference used in the
          ticker differential.
        </P>
      </div>

      {/* Uganda */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1">Uganda · Western / Central Region</div>
        <h3 className="text-lg font-bold text-slate-100 mb-1 pb-2 border-b-2 border-double border-slate-600">
          UGA S15 Robusta — FOBbing cost ~$265/t
        </h3>
        <P>
          Uganda&#39;s logistics cost is dominated by one line: the <strong>Northern Corridor</strong>. As a
          landlocked country, all export coffee must travel 1,150 km by road to the port of Mombasa, Kenya. That
          transit adds a cost and a time premium that no policy change can eliminate short of a rail upgrade. On top
          of the transit, UCDA imposes a 1% export cess (the Uganda Coffee Development Authority levy), and
          sun-drying shrinkage is a material physical cost that doesn&#39;t appear in freight quotes.
        </P>
        <CostTable>
          <CostRow label="Shrinkage (drying weight loss)" cost="30–45" note="Moisture loss in sun-drying from 12.5% to ~10% export moisture" />
          <CostRow label="L1 — Farm to Kampala mill" cost="15–20" note="Collection from Western / Mt. Elgon growing areas" />
          <CostRow label="L2 — Northern Corridor (Kampala → Mombasa)" cost="75–80" note="1,150 km road transit; rate set by EA road-freight market" />
          <CostRow label="UCDA export cess" cost="~30" note="1% of FOB value on ~$3,000/t reference price" />
          <CostRow label="Mombasa port (THC + handling + B/L)" cost="35" note="Kenya Ports Authority terminal + shipping docs" />
          <CostRow label="Inspection + fumigation" cost="10–12" note="UCDA quality grading + container fumigation" />
          <CostRow label="Financing (longer transit)" cost="16–20" note="~0.5% on $3,000 × 4-week float (longer than VN/Brazil)" />
          <CostRow label="Exporter margin" cost="~37" note="~1% of FOB value on ~$3,700 reference price (UGA S15)" />
          <tr className="border-t border-slate-600 font-semibold">
            <td className="pt-2 text-slate-200">Total</td>
            <td className="pt-2 text-right font-mono text-amber-300">~265</td>
            <td className="pt-2 text-slate-500 text-[11px]">~7% of $3,700 reference price</td>
          </tr>
        </CostTable>
        <P>
          <strong>Trader note:</strong> The Northern Corridor rate is the most volatile element across the three
          origins. East African road-freight tightens during harvest season (Oct–Jan), when trucks are competing with
          tea, grain and maize exports from Kenya and Tanzania. A $10–15/t swing in the corridor rate shows up
          directly in Uganda&#39;s effective FOB cost within weeks. UCDA cess is the other watch item: it scales
          with price, so every $300/t rally in RC adds ~$3/t to the cess line.
        </P>
      </div>

      {/* Summary comparison */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <H>Cross-origin comparison</H>
        <table className="w-full text-xs mt-2">
          <thead>
            <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-1.5 pr-4">Origin</th>
              <th className="pb-1.5 pr-4 text-right">FOBbing cost</th>
              <th className="pb-1.5 pr-4 text-right">As % of price</th>
              <th className="pb-1.5">Key swing factor</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-800">
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">VN FAQ</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">$100/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">~2.9%</td>
              <td className="py-1.5 text-slate-400">Exporter margin compression vs. trucking (stable)</td>
            </tr>
            <tr className="border-b border-slate-800">
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">CON T7</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">$200/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">~6.5%</td>
              <td className="py-1.5 text-slate-400">Quality-prep cost (varies by lot cleanliness)</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 text-slate-200 font-semibold">UGA S15</td>
              <td className="py-1.5 pr-4 text-right font-mono text-amber-300">$265/t</td>
              <td className="py-1.5 pr-4 text-right text-slate-400">~7%</td>
              <td className="py-1.5 text-slate-400">Northern Corridor freight rate (most volatile)</td>
            </tr>
          </tbody>
        </table>
        <P>
          These figures are structural: they set the <em>floor</em> of what origin must offer relative to RC futures
          for an export trade to work. When the ticker N-diff is <strong>close to zero</strong>, origin is priced at
          futures parity and export is marginally viable. When it is <strong>deeply negative</strong> (e.g. N-200),
          origin is offering a substantial discount — either oversupply at origin, logistics disruption, or currency
          effects. When it is <strong>positive</strong>, origin is at a premium to futures, which typically signals
          tight prompt supply or a quality bid.
        </P>
      </div>

    </div>
  );
}

export default function ResearchView({ initialTab }: { initialTab?: Cat }) {
  const router = useRouter();
  const [cat, setCat] = useState<Cat>(initialTab ?? "cot");

  useEffect(() => {
    if (initialTab && initialTab !== cat) setCat(initialTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  function handleCat(id: Cat) {
    setCat(id);
    router.push(`/research/${id}`, { scroll: false });
  }

  return (
    <>
      <div className="flex items-center gap-1 flex-wrap mb-4">
        {CATS.map(c => (
          <button key={c.id} onClick={() => handleCat(c.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              cat === c.id ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300 border border-transparent"
            }`}>
            {c.label}
          </button>
        ))}
      </div>

      {cat === "cot" && (
        <div className="space-y-4">
          <IntraweekMethodology />
          <CotBacktestReport />
        </div>
      )}
      {cat === "weather" && <FrostRiskMethodology />}
      {cat === "fertilizer" && <FertilizerMethodology />}
      {cat === "contracts" && <ContractRules />}
      {cat === "agronomy"  && <AgronomyArticles />}
      {cat === "logistics" && <OriginLogistics />}
    </>
  );
}
