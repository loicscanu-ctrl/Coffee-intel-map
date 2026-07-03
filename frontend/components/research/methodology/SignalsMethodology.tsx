"use client";
import { Paper, H2, P, Code, Fml, Highlight } from "./prose";

export default function SignalsMethodology() {
  return (
    <Paper
      kicker="Signals · Methodology"
      title="Signals & forecasts — the four models behind the tab"
      subtitle="Two live statistical/LLM models and two illustrative ML scaffolds"
    >
      <P>
        The Signals tab blends four different model types. Two are <strong>live</strong> and compute from real data on
        every run; two are <strong>illustrative scaffolds</strong> whose architecture is built but whose data feed
        isn&rsquo;t wired yet — the figures shown there are placeholders, labelled as such in the UI. This paper
        explains all four so the reasoning is legible either way.
      </P>

      <Highlight>
        <strong>Live vs. illustrative.</strong> &ldquo;Open price direction&rdquo; (§1), &ldquo;Robusta forecast&rdquo;
        (§2) and &ldquo;News sentiment&rdquo; (§4) are live. &ldquo;Vietnam differential&rdquo; (§3) still needs a
        stocks-to-use pipeline and renders <em>example</em> numbers to show the model shape, not a tradeable call.
      </Highlight>

      <H2>1 · Open price direction — pre-open overnight-gap classifier + exact SHAP (live)</H2>
      <P>
        A <strong>pre-open</strong> call on ICE Robusta&rsquo;s <strong>overnight gap</strong>: will today&rsquo;s
        first print open above or below yesterday&rsquo;s 17:30-London close? The model fires at{" "}
        <Code>03:07 UTC</Code> — hours before the London open — using only information that exists at that moment,
        and feeds the Telegram morning brief. Roll days (front-contract change) are excluded: the two prices would be
        different delivery months, so the calendar spread would masquerade as a gap. When the probability sits inside
        the <Code>±10pp</Code> band around 50% the call is <strong>&ldquo;Undefined&rdquo;</strong> — the model only
        speaks when it means it (band tuned on the 899-session walk-forward: acted hit-rate 63.6% at 36% coverage vs
        57.2% acting on everything). A companion <strong>magnitude head</strong> (ridge on the same features) sizes
        each call as an expected gap in <Code>$/t</Code>; its honest out-of-sample MAE vs the zero-prediction baseline
        is published in the model block so the size estimate is never over-trusted.
      </P>
      <P>
        The feature set is deliberately small — every candidate had to earn its place in a walk-forward ablation
        (expanding window, standardise-on-past, scored vs the rolling majority-class baseline), and most failed it.
        Survivors: <Code>kc_after_rc_diff</Code> — New York arabica&rsquo;s move in the hour <em>after</em> London
        robusta closes (<Code>KC 18:30 ÷ KC 17:30 London − 1</Code>, same contract → roll-immune; the core lead
        signal), and <Code>days_since_roll</Code> — position in the bi-monthly contract cycle (gaps historically tilt
        down mid-cycle, up late-cycle; confirmed on an untouched holdout). A third,{" "}
        <Code>cci_overnight</Code> — the Coffee Currency Index&rsquo;s move from 17:30 London to 03:00 UTC — has no
        backtestable intraday FX history, so it ships live and is graded forward-only, activating once ~40 snapshot
        days accumulate. Tested and <em>dropped</em>: the prior day&rsquo;s RC return, the KC−RC arbitrage gap (level
        and change), harvest/frost seasonality, term structure, daily BRL, calendar dummies, volatility-regime
        features and their interactions — and, most instructively, <Code>brent_overnight</Code>: on a truncated
        sample it looked like a keeper (+1.2pp marginal), but the complete ~5y backfill exposed a{" "}
        <strong>2022-oil-shock-only signal</strong> (+6.1pp that year, negative marginal every calm year), so it was
        demoted to context rather than a coefficient. Every factor also reports its <strong>z-score</strong> against
        its own history, and each prediction carries <strong>regime tags</strong> — decision support, not model
        inputs: <Code>⚡ NY-shock</Code> (|KC after-close| ≥0.8%, historically 88% hit-rate over 42 occurrences),
        volatility regime (confidence is trustworthy in calm tape: 63.7% vs 54.1% in high-vol), the robusta harvest
        window, and <Code>🛢 oil-shock</Code> (Brent overnight ≥1.5%).
      </P>
      <P>
        A <strong>logistic regression</strong> outputs the probability, decomposed with <strong>SHAP</strong> drawn as
        a waterfall from the base rate <Code>E[f(x)]</Code> to the final <Code>f(x)</Code>. For a logistic model the
        SHAP value is <em>closed-form exact</em> in log-odds space — <Code>φ&#7522; = β&#7522;·z&#7522;</Code> and{" "}
        <Code>Σφ&#7522; = margin(x) − base_margin</Code> with zero residual — so the chart is mathematically exact, not
        a sampled approximation, and we carry no <Code>shap</Code> dependency. Bars are in log-odds (where they&rsquo;re
        additive); endpoints are labelled with the implied probability.
      </P>
      <P className="text-[11px] text-slate-500">
        Accuracy is out-of-sample (expanding walk-forward, no shuffling → no look-ahead) vs the rolling majority-class
        baseline; &ldquo;acted&rdquo; accuracy restricts to calls outside the Undefined band. Every pre-open
        prediction is appended to <Code>open_direction_history.json</Code> <em>before</em> the open — with its
        per-feature SHAP φ — and graded after it: the calendar on the Macro tab is that record, and the model
        monitors its own live hit-rate, flagging a &ldquo;cold streak&rdquo; in the brief when ≥20 graded calls run
        below 50%. Full write-up + ablation evidence:{" "}
        <Code>docs/research/open-price-direction-findings.md</Code>.
      </P>

      <H2>2 · Robusta futures forecast — multi-factor OLS (live)</H2>
      <P>
        This is the live statistical model. Five drivers are each <strong>z-scored against a 52-week rolling
        window</strong>, then combined by an ordinary-least-squares regression fitted on the realised next-4-week RC
        price change. The output is a point estimate of the move over the coming four weeks:
      </P>
      <Fml>{`ΔP(4-week, USD/MT) = Intercept + Σ ( Z_i × β_i )

factors (each z-scored, 52-week window):
  mm_net_z        Managed-Money net (long − short), ICE Robusta COT
  dxy_z           US Dollar Index (Stooq weekly, resampled to COT Tuesdays)
  rc_mom_4w_z     4-week RC momentum  (rate of change ×100)
  rc_mom_13w_z    13-week RC momentum
  kc_rc_spread_z  KC − RC arbitrage  (KC ¢/lb → USD/MT via ×22.046)`}</Fml>
      <P>
        Each factor&rsquo;s contribution is <Code>Z&#7522; × β&#7522;</Code>; the fit reports R² (floored at 0) and the
        residual standard deviation. Confidence is a simple signal-to-noise read:
      </P>
      <Fml>{`confidence = min( 0.95 , |ΔP| / residual_σ )   — how many residual σ the call sits from zero`}</Fml>
      <P>
        It needs ≥30 weeks of COT history and ≥20 clean rows to fit; otherwise the section reports itself unavailable
        rather than showing a thin estimate. Caveat: the live DXY pull can fail silently (Stooq replaced Yahoo after
        GitHub-Actions IP blocks), and the R²-floor hides a negative fit — read the factor table, not just the headline.
      </P>

      <H2>3 · Vietnam differential forecast — multi-factor SHAP (illustrative)</H2>
      <P>
        Same SHAP architecture as §1 but targeting the <strong>Vietnam physical differential</strong> versus RC — a
        deliberately high-variance regime. Nine factors fan out from a base value to a final via additive contributions
        <Code>value × β</Code>, ordered by magnitude in the waterfall. On the example data the{" "}
        <strong>VN stocks-to-use</strong> factor and a differential-seasonality term dominate (together roughly two
        thirds of the prediction). The stocks-to-use pipeline isn&rsquo;t wired yet, so this too is a shape-of-model
        illustration.
      </P>

      <H2>4 · News sentiment — LLM headline classifier (live)</H2>
      <P>
        The live NLP model. Recent coffee-relevant headlines (last 7 days, filtered to coffee/origin/COT/supply/weather
        tags, capped at ~25, acaphe excluded) are sent in one structured prompt to a large language model (Google
        Gemini Flash, JSON-mode), which returns a <Code>{`{sentiment, confidence}`}</Code> per headline. The overall
        signal is a <strong>confidence-weighted vote</strong>, not a simple count:
      </P>
      <Fml>{`for each headline: sentiment ∈ {Bullish, Bearish, Neutral}, confidence ∈ [0,100]
score[s]          = Σ confidence over headlines classed s
overall           = argmax_s score[s]
overall_confidence = score[overall] / Σ score`}</Fml>
      <P className="text-[11px] text-slate-500">
        Caveats: the self-reported confidences aren&rsquo;t calibrated; a quota/network failure degrades the section to
        &ldquo;unavailable&rdquo; rather than stale output. (The on-screen model label is cosmetic and may lag the
        actual provider.)
      </P>

      <H2>Where it lives & cadence</H2>
      <P>
        Live models are produced by the quant runner into <Code>quant_report.json</Code> (the{" "}
        <Code>robusta_factors</Code> and <Code>sentiment</Code> keys), refreshed weekday evenings after the NY close.
        The OLS lives in <Code>backend/scraper/quant_model/robusta_factors.py</Code>; the sentiment classifier in{" "}
        <Code>quant_model/sentiment.py</Code>. The two illustrative sections (<Code>PriceDirectionSection.tsx</Code>,
        <Code>VietnamDiffSection.tsx</Code>) carry hard-coded example values until their feeds are connected.
      </P>
    </Paper>
  );
}
