"use client";
import { Paper, H2, P, UL, LI, Code, Fml, Highlight, RefTable } from "./prose";

export default function MacroMethodology() {
  return (
    <Paper
      kicker="Macro · Methodology"
      title="Macro & FX — the currency index and cross-commodity positioning"
      subtitle="The Coffee Currency Index, FX framing, and the macro-COT exposure & attribution model"
    >
      <P>
        The Macro tab answers two questions: what is the <strong>FX backdrop</strong> doing to coffee in USD terms, and
        where is <strong>speculative capital</strong> positioned across the whole commodity complex relative to coffee?
        This paper documents the indices and the cross-commodity positioning math behind both.
      </P>

      <H2>1 · Coffee Currency Index (CCI)</H2>
      <P>
        A DXY-style daily index of the FX pairs that matter to coffee, built from a <strong>trade-weighted basket</strong>
        of producer (exporter) and consumer (importer) currencies. Weights are fixed from USDA PSD 2023/24 trade volumes,
        normalised to 1.0 within each group:
      </P>
      <RefTable
        head={["Exporters", "wt", "Importers", "wt"]}
        rows={[
          ["BRL 0.513 · VND 0.262", "", "EUR 0.673 · JPY 0.095", ""],
          ["COP 0.128 · IDR 0.051", "", "CHF 0.052 · CNY 0.052", ""],
          ["PEN 0.047", "", "CAD 0.046 · KRW 0.045 · GBP 0.038", ""],
        ]}
      />
      <Fml>{`ΔI(day) = Σ ( daily_return_i × weight_i )        over all exporters + importers
index   = (1 + ΔI).cumprod() × 100               base 100, re-anchored over a rolling 365-day window
Z       = (index − μ) / σ                          μ,σ over a trailing 252-day window of the level`}</Fml>
      <Highlight>
        <strong>Read the sign with care.</strong> The narrative is &ldquo;exporter currency stronger → index up.&rdquo;
        But in the code every pair is summed with the same sign and the tickers are quoted <em>local-per-USD</em> (only
        EUR is inverted to USD-per-EUR). The mechanical effect is the reverse for the dollar-quoted majors: a{" "}
        <em>stronger</em> BRL (fewer BRL per USD) actually pushes the index <em>down</em>, while a stronger EUR pushes it
        up. Treat the CCI as a consistent daily aggregate of the basket and lean on the <strong>z-score</strong> (rich/
        cheap vs its own 252-day history) rather than over-reading the level&rsquo;s direction. The Guatemalan quetzal
        sits in the FX feed at weight 0 — a reference rate for converting ANACAFE café-oro prices, not a basket member.
      </Highlight>

      <H2>2 · FX time series — the exporter / importer framing</H2>
      <P>
        Each pair is rebased to 100 at the start of the chosen window (1M/3M/6M/1Y) so cross-pair % moves are visually
        comparable. The reading split: <strong>exporter currencies strengthening = bullish</strong> coffee in USD terms
        (origin costs rise, FOB floor lifts); <strong>importer currencies weakening = bearish</strong> for that consuming
        market&rsquo;s purchasing power. Window % move per pair is the simple endpoint change.
      </P>

      <H2>3 · Macro-COT — cross-commodity positioning in dollars</H2>
      <P>
        Rather than abstract &ldquo;commodity&rdquo; lines, the dashboard expresses Managed-Money positioning across ~27
        futures markets as real <strong>USD notional</strong>, so coffee can be sized against the whole complex:
      </P>
      <Fml>{`gross_exposure = (mm_long + mm_short) × close_price × contract_unit
net_exposure   = (mm_long − mm_short) × close_price × contract_unit
initial_margin = (mm_long + mm_short)·margin_outright + mm_spread·margin_spread
coffee share   = (arabica_gross + robusta_gross) / total_gross × 100   (gross-based)`}</Fml>
      <P>
        Markets aggregate into six display sectors (energy, metals, grains, meats, softs, micros). Two positioning-extreme
        views add context for coffee specifically:
      </P>
      <UL>
        <LI><strong>Gauges</strong> — each cohort&rsquo;s long/short/spread placed on a 52-week percentile:
          <Code>pct = (value − min)/(max − min) × 100</Code>; ≥80 or ≤20 flags an extreme.</LI>
        <LI><strong>Cycle location (overbought/oversold)</strong> — a matrix of MM-net rank % (x) vs price rank % (y),
          both ranked over a trailing 260-week (5-year) window; the <Code>[0–25]²</Code> corner is oversold, the{" "}
          <Code>[75–100]²</Code> corner overbought.</LI>
        <LI><strong>Dry powder</strong> — number of traders vs gross long/short OI (in MT), recency-weighted, to see how
          crowded a position is.</LI>
      </UL>

      <H2>4 · Exposure attribution — OI effect vs price effect</H2>
      <P>
        When a market&rsquo;s notional exposure changes week-over-week, was it traders <em>adding/cutting lots</em> or
        the <em>price moving</em>? The decomposition is exhaustive — the two pieces sum exactly to the WoW change:
      </P>
      <Fml>{`OI effect    = (Q_t − Q_t−1) × Price_t−1 × unit      ← position change, valued at last week's price
Price effect = Q_t × (Price_t − Price_t−1) × unit     ← price move, on this week's lots
OI effect + Price effect ≡ exposure_t − exposure_t−1   (zero residual)
Q = mm_long ± mm_short  (gross or net)`}</Fml>
      <P className="text-[11px] text-slate-500">
        The price effect uses the <em>current</em> lot count and the OI effect uses the <em>previous</em> price, which
        folds the small interaction term into the price effect by design. It&rsquo;s a single-week decomposition (no
        historical attribution series), computed entirely in the frontend over the weekly macro-COT data.
      </P>

      <H2>Where it lives</H2>
      <P>
        CCI &amp; FX: <Code>scraper/quant_model/fetch_currency_index.py</Code> → <Code>quant_report.json</Code> /
        <Code>fx_history.json</Code>, rendered by <Code>CurrencyIndexSection.tsx</Code> and
        <Code>FxTimeSeriesPanel.tsx</Code>. Macro-COT exposure: <Code>scraper/exporters/cot.py</Code> +
        <Code>sources/macro_cot.py</Code> (<Code>COMMODITY_SPECS</Code>) → <Code>macro_cot.json</Code>, transformed in{" "}
        <Code>CotDashboard/transformMacroData.ts</Code> and shown in the COT tab. Attribution math:
        <Code>lib/pdf/dataHelpers.ts</Code>, surfaced in <Code>AttributionTable.tsx</Code>.
      </P>
    </Paper>
  );
}
