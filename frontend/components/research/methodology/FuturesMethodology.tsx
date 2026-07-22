"use client";
import { Paper, H2, P, Code, Fml, Highlight } from "./prose";

export default function FuturesMethodology() {
  return (
    <Paper
      tone="violet"
      updated="2026-07-14"
      kicker="Futures · Methodology"
      title="Futures analytics — contract math, roll dynamics & the pricelist engine"
      subtitle="The calendar, OI-to-FND, live arbitrage and the Quotation flat-price model"
    >
      <P>
        Beyond the COT positioning model (documented under <strong>COT &amp; positioning</strong>), the Futures tab runs
        several deterministic pieces of contract math and one customer-facing pricing engine. This paper covers the
        calendar rules, the open-interest roll view, the live chain &amp; arbitrage, and the Quotation pricelist.
      </P>

      <H2>1 · Contract calendar — FND, options expiry & days-to-FND</H2>
      <P>
        Almost everything keys off <strong>First Notice Day (FND)</strong>, computed identically in the backend and
        frontend so the two never disagree:
      </P>
      <Fml>{`FND = N business days before the first business day of the delivery month
      N = 7  for Arabica (KC)
      N = 4  for Robusta (RC / RM)
Options last trading day  = FND − 8 business days   (empirically fitted)
trading_days_to(d, FND)   = signed Mon–Fri count (negative before FND, 0 on/after)`}</Fml>
      <P>
        Exchange <strong>holidays are deliberately not subtracted</strong> — the rule is kept purely as business-day
        arithmetic so the frontend and backend produce byte-identical dates (the small cost is that FND can be off by
        any holidays falling in the window). The signed <Code>trading_days_to</Code> count is the x-axis of the OI chart
        below. Month-codes follow the standard F=Jan … Z=Dec map.
      </P>

      <H2>2 · OI evolution to FND + the front calendar spread</H2>
      <P>
        To see how positioning rolls, every contract&rsquo;s open interest is re-indexed onto a common{" "}
        <strong>days-to-its-own-FND</strong> axis over the last 45 trading days (<Code>[−45, 0]</Code>). Overlaying
        contracts this way shows how fast OI liquidates into delivery. OI is sourced with a three-tier priority — the
        daily futures scraper (authoritative), then Barchart OI snapshots, then a five-year price/OI archive (deepest,
        guarantees a full −45…0 window).
      </P>
      <Highlight>
        <strong>Why the spread is pre-computed in the backend.</strong> The front calendar spread (front-FND price −
        next-cycle price) <em>looks</em> like a trivial frontend join, but when the front is near rollover the next
        contract often sits more than 45 trading days from <em>its own</em> FND — outside the window — so a naive join
        renders all-null. So the backend derives the next contract from the contract-month <em>cycle</em> (not from the
        plotted candidates), computes <Code>spread = front_price − next_price</Code> on each shared calendar date, then
        re-indexes it onto the front&rsquo;s days-to-FND axis. Units: <Code>$/t</Code> for Robusta, <Code>¢/lb</Code>{" "}
        for Arabica; holiday gaps are bridged visually.
      </Highlight>

      <H2>3 · OI history table — crop-year grouping & the positioning sanity check</H2>
      <P>
        A 14-day day-by-day matrix merges per-contract OI with the weekly COT. Arabica is split by crop year — the
        2025/26 crop ends September 2026, so KC contracts expiring <strong>before Oct 2026</strong> are &ldquo;old
        crop&rdquo; and the rest are &ldquo;new/other.&rdquo; The displayed &ldquo;All&rdquo; is rebuilt as Old + Other
        by hand because the raw aggregate carries a known swap-field bug. Each row carries a positioning identity check:
      </P>
      <Fml>{`Longs + Spreading  ==  Shorts + Spreading      (total OI per crop class)`}</Fml>
      <P className="text-[11px] text-slate-500">
        Green when the identity holds, red when it doesn&rsquo;t — a live data-integrity tell. The hard-coded crop-year
        boundary (Oct 2026) is annual maintenance.
      </P>

      <H2>4 · Live chain & the KC/RC arbitrage ratio</H2>
      <P>
        Real-time RC/KC quotes are polled from acaphe.com every ~15 minutes (weekdays), with a static fallback and a{" "}
        <strong>stale flag past 120 s</strong>. The arbitrage panel pairs each KC month with its RC counterpart
        (H→H, K→K, N→N, U→U, and KC <strong>Z→RC F of the next year</strong>) and expresses the arabica premium on a
        common ¢/lb basis:
      </P>
      <Fml>{`RC $/MT → ¢/lb :  rc_cents = rc_usd_mt / 22.0462     (22.0462 = lb per 100 kg... = 2204.62/100)
spread          = kc_cents − rc_cents
arabica ratio   = kc_cents × 22.0462 / rc_usd        (premium of arabica over robusta)`}</Fml>
      <P className="text-[11px] text-slate-500">
        The conversion constant appears as both <Code>÷22.046</Code> and <Code>×22.0462</Code> across files — the exact
        value is <Code>2204.62/100 = 22.0462</Code> lb per 100 kg; the difference is rounding only.
      </P>

      <H2>5 · Quotation — the flat-price / at-port differential engine</H2>
      <P>
        The Quotation tab builds a customer-ready Robusta pricelist: per shipment month, per quality, an at-port
        differential in <Code>N±diff</Code> form. It works from a continuous flat-price carry model anchored on the
        Vietnam FAQ spot:
      </P>
      <Fml>{`flat(front month) = VN_FAQ_spot(USD/MT) + FOBbing(VN FAQ ≈ $100)
flat(month+1)     = flat(month) + monthly_carry ($30)      ← ramps continuously,
                                                              does NOT reset at contract rolls
basis(month)      = round( flat(month) − RC_price(that month's own contract) )
cell diff         = round( (basis + quality_diff + options + freight + financing) / 5 ) × 5`}</Fml>
      <P>
        Because each month&rsquo;s differential is struck against <em>its own</em> contract price, the calendar spread is
        baked in automatically — no manual spread roll. Shipment months map to the RC bimonthly cycle
        (Jan/Feb→H, Mar/Apr→K, May/Jun→N, Jul/Aug→U, Sep/Oct→X, Nov/Dec→F), the crop year ends with the X contract
        (December shipments belong to the next crop year), and prices are keyed by letter+year so multi-crop strips read
        the right contract per roll. Quality steps (Grade 2 S13 = basis, Grade 3 S12 = −250, screen 16/18 premiums) and
        packing/certification add-ons layer on; the final number is rounded to the nearest <strong>$5/MT</strong>.
      </P>

      <H2>6 · Origin farmgate — per-day FX normalisation</H2>
      <P>
        To compare farmgate prices across origins on one chart, every local quote is converted to USD/MT using{" "}
        <em>that day&rsquo;s own</em> FX rate (forward-filled), via fixed unit factors:
      </P>
      <Fml>{`USD/MT = (local_price / fx_rate_on_date) × unit_factor
unit factors:  per-kg ×1000 · 60-kg saca ×1000/60 · cwt ×1000/45.359 · ¢/lb ×2204.62/100`}</Fml>
      <P>
        The front-month futures (highest-OI contract) overlays as a reference; an index mode rebases each series to 100
        at the window start. Using the contemporaneous FX rate (not today&rsquo;s) keeps each historical point honest.
      </P>

      <H2>Where it lives</H2>
      <P>
        Calendar math: <Code>backend/contract_dates.py</Code> mirrored in <Code>app/futures/page.tsx</Code> /
        <Code>AcapheLiveQuotes.tsx</Code>. OI-to-FND: <Code>scraper/exporters/futures.py</Code> →
        <Code>oi_fnd_chart.json</Code>, rendered by <Code>OIFndChart.tsx</Code>. Live chain:
        <Code>AcapheLiveQuotes.tsx</Code> ← <Code>/api/live</Code> (Redis). Quotation engine + farmgate panel live in{" "}
        <Code>app/futures/page.tsx</Code> and <Code>components/macro/OriginPricesPanel.tsx</Code>; the FOBbing and carry
        constants are in <Code>lib/originCosts.ts</Code>.
      </P>
    </Paper>
  );
}
