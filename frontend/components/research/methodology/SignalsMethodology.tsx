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
        <strong>Live vs. illustrative.</strong> &ldquo;Robusta forecast&rdquo; (§2) and &ldquo;News sentiment&rdquo;
        (§4) are live. &ldquo;Open price direction&rdquo; (§1) needs an intraday ICE RC feed and &ldquo;Vietnam
        differential&rdquo; (§3) needs a stocks-to-use pipeline — both currently render <em>example</em> numbers to show
        the model shape, not a tradeable call.
      </Highlight>

      <H2>1 · Open price direction — triple-barrier classifier + SHAP (illustrative)</H2>
      <P>
        The goal is a directional call on ICE Robusta in the first 30 minutes after the open. Labels come from a{" "}
        <strong>triple-barrier</strong> scheme (López de Prado): each observation gets an upper price barrier, a lower
        price barrier, and a vertical <em>time</em> barrier. The label is whichever barrier is touched first. If the
        time barrier is hit before either price barrier, the case is <strong>undefined</strong> and the model abstains
        rather than forcing a guess.
      </P>
      <P>
        A gradient-boosted classifier outputs a probability, decomposed with <strong>SHAP</strong>: starting from the
        base rate <Code>E[f(x)]</Code> (the unconditional probability), each feature&rsquo;s SHAP value{" "}
        <Code>φ&#7522;</Code> pushes the estimate up or down to the final <Code>f(x)</Code>, drawn as a waterfall.
        Features are the open&rsquo;s relationship to the prior RC settlement plus overnight FX/DXY moves after the RC
        close.
      </P>
      <P className="text-[11px] text-slate-500">
        On the illustrative sample the model abstains on the majority of cases (the time barrier is hit first ~55% of
        the time) and scores ~72% on the cases it <em>does</em> call — a reminder that the headline accuracy is
        conditional on a defined signal. Pending a live intraday feed, treat this section as a worked example of the
        method, not a forecast.
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
