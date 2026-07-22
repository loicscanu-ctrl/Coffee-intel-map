"use client";
import { Paper, H2, P, UL, LI, Code, Fml } from "./prose";

export default function DemandDataMethodology() {
  return (
    <Paper
      tone="rose"
      updated="2026-07-14"
      kicker="Demand · Data methods"
      title="Demand data & indices — the reconciliation and concentration math"
      subtitle="The smaller indices behind the import, consumption and spot panels"
    >
      <P>
        Beyond the long-run saturation/ceiling models (documented in the articles above), the Demand tab carries a set
        of smaller indices that keep noisy trade data honest and readable. They&rsquo;re documented here so the numbers
        on those panels are traceable.
      </P>

      <H2>1 · Kaffeesteuer — trailing-average consumption proxy</H2>
      <P>
        Germany taxes roasted coffee at a fixed rate, so its <em>Kaffeesteuer</em> receipts are a clean monthly proxy
        for German consumption volume. Monthly receipts are noisy, so the panel smooths them and compares like-for-like:
      </P>
      <Fml>{`smoothed     = 12-month trailing average
YoY          = (MA[m] − MA[m−12]) / MA[m−12] × 100     (date-matched by month)`}</Fml>

      <H2>2 · Origin concentration — the HHI</H2>
      <P>
        How dependent is an importer on a few origins? The import-origin mix is scored with a Herfindahl-Hirschman index
        — the sum of squared percentage shares — so a market sourcing from many origins scores low (diversified) and one
        leaning on a single origin scores high (concentrated, exposed):
      </P>
      <Fml>{`HHI = Σ ( origin_share_% )²        (higher = more concentrated)`}</Fml>

      <H2>3 · Cross-source reconciliation</H2>
      <P>
        National customs and UN Comtrade rarely agree to the bag. Rather than pick one, the panel measures the
        disagreement and grades it, so a user knows how much to trust a given year:
      </P>
      <Fml>{`gap = mean over years of |national − comtrade| / comtrade × 100
tone:  good < 2%  ·  caution 2–8%  ·  divergent > 8%`}</Fml>

      <H2>4 · Spot vs ECF coverage</H2>
      <P>
        For the physical spot panel, the key read is <strong>coverage</strong> — how much certified/available stock backs
        near-term demand — with everything normalised to a common basis and tiered by crop freshness:
      </P>
      <UL>
        <LI>Bags ↔ MT via the standard <Code>60 kg</Code> per bag.</LI>
        <LI>Quotes parsed as differential-vs-futures or outright, so both pricing conventions reconcile.</LI>
        <LI>A crop-freshness tier (current vs prior crop) flags age, which drives the certified-stock age allowances.</LI>
      </UL>

      <H2>5 · Refinements to the ceiling model</H2>
      <P>
        Two sub-models sharpen the documented logistic/saturation demand ceilings. A <strong>demographic discount</strong>
        scales a market&rsquo;s ceiling by its median age (full weight at a young median ≤30, tapering toward ~0.6 at
        ≥42, since ageing populations drink less incremental coffee), and growth markets are projected with a{" "}
        <strong>CAGR-seeded logistic</strong> — the recent compound growth rate seeds the early slope of the S-curve, so
        near-term momentum and the long-run ceiling are reconciled in one path.
      </P>

      <H2>Where it lives</H2>
      <P>
        <Code>components/demand/KaffeesteuerChart.tsx</Code>, <Code>imports-lab/OriginExplorer.tsx</Code> (HHI),
        <Code>SourceReconciliation.tsx</Code>, <Code>SpotPanel.tsx</Code> + <Code>spot/spotLib.ts</Code>; the ceiling
        refinements in <Code>lib/demandCeilings.ts</Code> and <Code>GrowthMarketsPanel.tsx</Code>.
      </P>
    </Paper>
  );
}
