"use client";
import { Paper, H2, P, Code, Fml, Highlight } from "./prose";

export default function EnsoModelMethodology() {
  return (
    <Paper
      tone="cyan"
      updated="2026-07-14"
      kicker="Weather · ENSO model"
      title="The ENSO risk model — from ONI to per-origin coffee risk"
      subtitle="How the app quantifies the cycle the explainer above describes"
    >
      <P>
        The explainer above is the physics; this is the <strong>app&rsquo;s quantitative pipeline</strong>. It turns one
        public number — NOAA&rsquo;s Oceanic Niño Index (ONI) — into a phase call, a forecast, historical analogs, and a
        per-origin coffee-risk map, through four distinct sub-methods.
      </P>

      <H2>1 · State, phase & intensity</H2>
      <P>
        The ONI (the Niño 3.4 SST anomaly) is read from NOAA CPC and turned into a single phase call with a deliberate
        persistence rule, so a one-off spike doesn&rsquo;t flip the regime:
      </P>
      <Fml>{`current ONI = latest season value
phase  = El Niño / La Niña only after 5 consecutive seasons past ±0.5 °C  (else Neutral)
intensity (on |ONI|):  Extreme ≥2.0 · Strong ≥1.5 · Moderate ≥1.0 · else Weak
dots = 4 / 3 / 2 / 1   ·   forecast_direction = trend over last 5 points (±0.15 threshold)`}</Fml>
      <P className="text-[11px] text-slate-500">
        The five-consecutive-season test is a simplification of NOAA&rsquo;s overlapping-season definition, and the last
        few ONI points are preliminary — so the very latest phase read can revise.
      </P>

      <H2>2 · The forecast plume</H2>
      <P>
        Despite the name, this is <strong>not</strong> a dynamical multi-member plume. It is the official{" "}
        <strong>categorical probability table</strong> — P(La Niña) / P(Neutral) / P(El Niño) for each upcoming
        three-month season — scraped with a fallback chain (IRI first, then the NOAA CPC discussion grid) and drawn as a
        100%-stacked area. When both sources are empty the panel shows an empty state rather than inventing a curve.
      </P>

      <H2>3 · Analog years</H2>
      <P>
        To answer &ldquo;what has a cycle like this one done before?&rdquo; the model matches the <em>shape</em> of the
        current trajectory against history:
      </P>
      <Fml>{`query   = last 6 monthly ONI points
candidate = any 6-point window since 1980 ending in the same calendar month, no gaps
similarity = MSE = mean( (window − query)² )      ← lowest MSE wins
pick top 3, align −5 … +6 months, project the analog-mean continuation forward`}</Fml>
      <P className="text-[11px] text-slate-500">
        The match is equal-weighted MSE with no detrending or amplitude normalisation, so it keys on the recent path
        rather than absolute level. The forward projection is the simple mean of the chosen analogs.
      </P>

      <H2>4 · Per-origin risk pins</H2>
      <P>
        The translation from &ldquo;global phase&rdquo; to &ldquo;coffee risk&rdquo; is a <strong>curated lookup</strong>,
        not a continuous formula — because the relevant impact is regional and direction-specific (an El Niño that dries
        Indonesia can wet East Africa):
      </P>
      <Fml>{`effect[origin][region][phase] → (driver, severity)
   severity: 2 = major (drought-at-flowering, frost)  · 1 = moderate · 0 = benign
intensity bump: severity + 1  only if intensity is Strong/Extreme   (benign stays benign)
level: high ≥2 · moderate = 1 · low`}</Fml>
      <Highlight>
        The ONI magnitude enters the per-origin score <strong>only through that intensity bump</strong> — there is no
        per-origin sensitivity coefficient on the continuous ONI value. The table covers seven origins and ~34 growing
        regions; when the phase is Neutral (as now) every pin reads <Code>low</Code> by construction.
      </Highlight>

      <H2>Where it lives</H2>
      <P>
        Pipeline: <Code>backend/scraper/enso.py</Code> (phase/intensity), <Code>enso_forecast.py</Code> (plume),
        <Code>enso_analogs.py</Code> (MSE analogs), <Code>enso_risk.py</Code> (risk pins), consolidated by
        <Code>build_enso_intel.py</Code> → <Code>enso.json</Code> + <Code>enso_risk_pins.json</Code>. Rendered by{" "}
        <Code>components/enso/*</Code> (<Code>EnsoForecastPlume</Code>, <Code>EnsoAnalogChart</Code>,
        <Code>EnsoRiskMap</Code>, <Code>EnsoRiskTable</Code>) on the ENSO tab; the analog continuation and pin radii are
        computed client-side.
      </P>
    </Paper>
  );
}
