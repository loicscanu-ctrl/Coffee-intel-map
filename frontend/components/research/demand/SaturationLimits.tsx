"use client";
import { AgronomyCard, H, P, LI } from "../agronomy/prose";

const DEMO = [
  { ind: "Median age", cn: "41.1 yrs", in: "29.8 yrs", jp: "28.9 yrs", kr: "26.7 yrs" },
  { ind: "Youth (0–14)", cn: "15.4%", in: "24.2%", jp: "24.0%", kr: "~25.6%" },
  { ind: "Working (15–64)", cn: "69.7%", in: "68.4%", jp: "68.9%", kr: "~69.3%" },
  { ind: "Elderly (65+)", cn: "14.9%", in: "7.4%", jp: "7.1%", kr: "5.1%" },
];

const BACKTEST = [
  { mkt: "Japan", period: "1981–2001", r: "−0.9961", r2: "0.9922", elast: "n/a (inverse)", ok: false },
  { mkt: "South Korea", period: "2000–2022", r: "+0.9633", r2: "0.9279", elast: "0.1797", ok: true },
];

export default function SaturationLimits() {
  return (
    <AgronomyCard
      tone="rose"
      kicker="Demand · Saturation & Risk"
      title="The ceiling (K), the retail multiplier, and where the analogy breaks"
      subtitle="What bounds K — culture, demographics, price — and how it can shift"
      briefing={
        <span>
          The S-curve is only as good as its ceiling. The big modelling trap is assuming Asian and African
          markets converge on Nordic/US levels (Finland ~12 kg, US ~4.17 kg). Instead K must be discounted
          locally for three forces — <strong>stomach share</strong>, <strong>dairy/lactose infrastructure</strong>,
          and <strong>median age</strong>. A statistical back-test then shows when bottom-up &ldquo;count the cafés&rdquo;
          forecasting is valid — and three failure modes the UI must flag.
        </span>
      }
    >
      <H>Why K is local, not Nordic</H>
      <P>
        Liquid intake is biologically finite. In tea cultures coffee does not create demand from nothing — it must
        <em> cannibalise</em> existing &ldquo;stomach share&rdquo;. The UK shows the transfer cleanly: tea fell 2.11 → ~1.5 kg
        while coffee rose to ~4.99 kg. Turkey shows the wall: despite aggressive coffee growth (1.82 kg), tea stays
        an immovable 3.16 kg/head. China (tea 0.57 kg) and India (0.33 kg) both face entrenched habits that
        mathematically lower the logistic asymptote versus the West.
      </P>

      <H>1 · Stomach share — liquid competition</H>
      <P>
        Pre-existing dominant hot drinks cap K. The denser the incumbent tea culture, the lower the achievable
        coffee ceiling.
      </P>

      <H>2 · Dairy, lactose &amp; alt-milk infrastructure</H>
      <P>
        Modern emerging-market adoption is milk-based (latte, RTD), not black filter — milk masks Robusta
        bitterness. Yet 85–92% of East-Asian adults are lactose-intolerant, which should cap milky-coffee demand.
        History shows <strong>infrastructure beats genetics</strong>: UHT processing, fermentation, and above all the
        explosion of plant milks lift K directly — Luckin&rsquo;s Coconut Latte alone passed 2.1 billion cups. The state
        of the alt-milk supply chain literally sets the slope of the curve.
      </P>

      <H>3 · Demographic elasticity (median age)</H>
      <P>
        Caffeine adoption needs a young, urban, capital-building population. Japan&rsquo;s take-off (1970) and Korea&rsquo;s
        (1990) happened at median ages ~27–29. India fits that profile today (29.8); China is forcing adoption
        <em> while</em> ageing fast (41.1, 211 M people over 65). Older populations metabolise caffeine slower and
        resist new habits — so China&rsquo;s K must take a heavy demographic discount or the model overstates the final
        market by tens of millions of bags.
      </P>
      <div className="overflow-x-auto mt-2">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left py-1.5 pr-2">Indicator (2025)</th>
              <th className="text-right py-1.5 pr-2">China</th>
              <th className="text-right py-1.5 pr-2">India</th>
              <th className="text-right py-1.5 pr-2">Japan &rsquo;70</th>
              <th className="text-right py-1.5">Korea &rsquo;90</th>
            </tr>
          </thead>
          <tbody>
            {DEMO.map(d => (
              <tr key={d.ind} className="border-b border-slate-800">
                <td className="py-1 pr-2 text-slate-400">{d.ind}</td>
                <td className="py-1 pr-2 text-right font-mono text-red-300">{d.cn}</td>
                <td className="py-1 pr-2 text-right font-mono text-emerald-300">{d.in}</td>
                <td className="py-1 pr-2 text-right font-mono text-slate-400">{d.jp}</td>
                <td className="py-1 text-right font-mono text-slate-400">{d.kr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H>The retail multiplier — back-tested</H>
      <P>
        A popular bottom-up shortcut projects the number of physical cafés × cups/day to infer green-bean imports.
        Back-testing it against history is decisive. In <strong>Japan</strong>, café counts <em>collapsed</em>
        (154,630 kissaten in 1981 → 89,000 by 2001) while imports kept <em>rising</em> — volume was captured by
        vending machines and at-home soluble, giving a strongly <em>negative</em> correlation. In
        <strong> South Korea</strong>, retail-led growth made cafés and imports move in lock-step.
      </P>
      <div className="overflow-x-auto mt-2">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left py-1.5 pr-2">Market</th>
              <th className="text-left py-1.5 pr-2">Period</th>
              <th className="text-right py-1.5 pr-2">Pearson r</th>
              <th className="text-right py-1.5 pr-2">R²</th>
              <th className="text-right py-1.5">Log-log elast.</th>
            </tr>
          </thead>
          <tbody>
            {BACKTEST.map(b => (
              <tr key={b.mkt} className="border-b border-slate-800">
                <td className={`py-1 pr-2 font-medium ${b.ok ? "text-emerald-300" : "text-red-300"}`}>{b.mkt}</td>
                <td className="py-1 pr-2 text-slate-400">{b.period}</td>
                <td className="py-1 pr-2 text-right font-mono">{b.r}</td>
                <td className="py-1 pr-2 text-right font-mono">{b.r2}</td>
                <td className="py-1 text-right font-mono">{b.elast}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>
        <strong>Verdict:</strong> the café multiplier is valid only where growth is physically retail-density-led
        (Korea); it is invalidated by alternative channels (Japan&rsquo;s vending). For China/India, hyper-fast delivery
        apps dematerialise the storefront — use it with heavy caution.
      </P>

      <H>Three failure modes the UI must flag</H>
      <ul className="space-y-1 mb-2">
        <LI>
          <strong>Substitution / the Boba effect</strong> — China&rsquo;s fresh-tea &amp; bubble-tea market (~¥140 bn,
          ~500k shops, &lt;$1.50/cup) fights coffee for the <em>same</em> stomach share. Absent in the Japan/Korea
          analogs ⇒ the model may <em>overestimate</em> saturation K.
        </LI>
        <LI>
          <strong>Tech leapfrog (O2O delivery)</strong> — app-led kiosks (Luckin 35k+ stores) accelerate the early
          S-curve faster than history, but skip at-home brewing. With ~70% of global volume brewed at home, a missing
          at-home base <em>amputates</em> the long-run permanent level.
        </LI>
        <LI>
          <strong>Demographic mismatch</strong> — using Korea (~26.7) to model China (~41.1) overstates the adoption
          slope in the final third of the curve. India&rsquo;s demographic dividend keeps its analogue sound.
        </LI>
      </ul>

      <p className="text-[9px] text-slate-500 italic mt-4">
        Source: deep-research report &ldquo;Predictive Modelling of Coffee Adoption in Emerging Markets&rdquo; (2026).
        These dampeners feed directly into the Consumption-tab demand projection.
      </p>
    </AgronomyCard>
  );
}
