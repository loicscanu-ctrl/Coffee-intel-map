"use client";
import { AgronomyCard, H, P, LI, Code } from "../agronomy/prose";
import { K_BASE, ceilingK, demographicFactor } from "@/lib/demandCeilings";

// Proposed saturation ceilings (K) for the 12 markets actually in the
// Consumption-tab projection. Everything is expressed in the table's native
// unit — kg per drinking-age ADULT (18+) — not the study's kg/head, so the
// numbers drop straight into GrowthMarketsPanel.
//
//   now  = current USDA consumption ÷ UN WPP 18+ population (2025)
//   K    = proposed ceiling in kg/adult  (= anchor_head ÷ adultShare × dampeners)
//   head = implied kg/head at K, for sanity vs the study's analog plateaus
//   x    = headroom multiple (K / now)
//
// Sorted by headroom so the genuine emerging upside (India, China…) is on top.
// K is sourced from @/lib/demandCeilings (shared with the live projection);
// `head` = implied kg/head = K × adultShare, `now` = 2025 USDA ÷ WPP 18+.
type Row = {
  key: string; m: string; cls: "Emerging" | "Origin" | "Mature";
  now: number; share: number; anchor: string; logic: string;
};
const ROWS: Row[] = [
  { key: "india",       m: "India",       cls: "Emerging", now: 0.08, share: 0.712, anchor: "Korea − heavy",   logic: "Coffee confined to the south; very young (med. 28) is the one tailwind, but no national coffee culture and tea-leaning. Huge multiple, tiny absolute." },
  { key: "china",       m: "China",       cls: "Emerging", now: 0.31, share: 0.814, anchor: "Korea/Japan − heavy", logic: "Tea base 0.57, median age 41, Boba/tea substitution, 85–92% lactose, O2O leapfrog weakening at-home base. All four dampeners fire → far below the East-Asian plateau." },
  { key: "egypt",       m: "Egypt",       cls: "Emerging", now: 0.81, share: 0.638, anchor: "MENA",            logic: "Strong tea culture; young (med. 24) tailwind offset by low disposable income capping premium retail." },
  { key: "indonesia",   m: "Indonesia",   cls: "Origin",   now: 1.43, share: 0.714, anchor: "self / SEA",      logic: "Origin country, young, urban café culture rising fast off a modest base." },
  { key: "turkey",      m: "Turkey",      cls: "Emerging", now: 1.60, share: 0.765, anchor: "Turkey − tea",    logic: "Tea wall (3.16 kg/head, world #1) is the binding constraint; Gen-Z espresso/chains grow but cezve tradition + tea cap K hard." },
  { key: "mexico",      m: "Mexico",      cls: "Origin",   now: 1.99, share: 0.714, anchor: "LatAm",           logic: "Producer with rising domestic demand; instant→retail shift, 75k+ outlets. Moderate ceiling." },
  { key: "russia",      m: "Russia",      cls: "Emerging", now: 2.40, share: 0.798, anchor: "E. Europe",       logic: "Entrenched tea base and an ageing population (med. 40) damp it; RTD + instant + urban chains push it up modestly." },
  { key: "ethiopia",    m: "Ethiopia",    cls: "Origin",   now: 3.00, share: 0.561, anchor: "self",            logic: "Birthplace of coffee, ceremonial daily culture, very young; ceiling set by income/urbanisation, not appetite." },
  { key: "vietnam",     m: "Vietnam",     cls: "Origin",   now: 3.98, share: 0.732, anchor: "self",            logic: "Origin with robust, distinctive domestic café culture; still climbing but approaching maturity." },
  { key: "korea",       m: "South Korea", cls: "Mature",   now: 4.53, share: 0.870, anchor: "self (plateau)",  logic: "The hyper-adopter analog itself — near its barbell-market plateau; little headroom left." },
  { key: "philippines", m: "Philippines", cls: "Mature",   now: 5.18, share: 0.675, anchor: "self / E-Asia",   logic: "Instant / 3-in-1 culture already very high per adult; young population but RTD/instant largely saturated." },
  { key: "brazil",      m: "Brazil",      cls: "Mature",   now: 8.21, share: 0.768, anchor: "self (plateau)",  logic: "Coffee is the national drink; mature consumer-producer essentially at plateau." },
];

const FACTORS = [
  { f: "Stomach share", rule: "× ~1.0 at low incumbent tea (<0.5 kg/head) → ~0.5 at a tea wall (>3 kg/head)", drivers: "Turkey, China, India, Russia, Egypt" },
  { f: "Demographic", rule: "× ~1.0 at median age ≤30 → ~0.6 at ≥42 (caffeine adoption needs a young, active population)", drivers: "China (41), Russia (40), Korea (46)" },
  { f: "Substitution / infra", rule: "× 0.85–1.0 — extra haircut where Boba/functional-tea competition is massive; small tailwind where alt-milk supply is strong", drivers: "China (Boba −), Luckin alt-milk (+)" },
];

function clsTone(c: Row["cls"]) {
  return c === "Emerging" ? "text-amber-300" : c === "Origin" ? "text-sky-300" : "text-slate-400";
}

export default function MarketCeilings() {
  return (
    <AgronomyCard
      tone="rose"
      kicker="Demand · Proposed Saturation Ceilings (K)"
      title="K table for our 12 markets — proposed ceilings & the logic behind each"
      subtitle="Per-market saturation ceilings with the reasoning behind every K"
      briefing={
        <span>
          Translating the study into numbers for the markets actually in our projection. Each ceiling
          <strong> K</strong> is expressed in <strong>kg per drinking-age adult</strong> (our table&rsquo;s unit, not the
          study&rsquo;s kg/head) so it drops straight into the demand model. K replaces the uncapped CAGR: intensity
          grows toward K and flattens, instead of exploding. These are <em>judgement anchors</em> meant to be
          reviewed and tuned — the reasoning for every value is shown below.
        </span>
      }
    >
      <H>How K is built</H>
      <P>
        K starts from an analog plateau and is discounted by the study&rsquo;s three dampeners, then converted from
        per-head to per-adult using each country&rsquo;s 18+ share:
      </P>
      <p className="text-center text-sm text-slate-100 font-mono my-3">
        K<sub>adult</sub> = anchor<sub>head</sub> ÷ adultShare × ∏ dampeners
      </p>
      <div className="overflow-x-auto mb-2">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left py-1.5 pr-2">Dampener</th>
              <th className="text-left py-1.5 pr-2">Rule of thumb</th>
              <th className="text-left py-1.5">Binds hardest on</th>
            </tr>
          </thead>
          <tbody>
            {FACTORS.map(f => (
              <tr key={f.f} className="border-b border-slate-800">
                <td className="py-1 pr-2 text-slate-100 font-medium whitespace-nowrap">{f.f}</td>
                <td className="py-1 pr-2">{f.rule}</td>
                <td className="py-1 text-slate-400">{f.drivers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>
        The <strong>demographic</strong> dampener is computed live from the UN WPP age data we already carry; the
        <strong> stomach-share</strong> and <strong>infra</strong> factors are per-country constants (that data isn&rsquo;t
        in the app). Mature/origin markets (Brazil, Korea) sit near plateau, so their K is just modestly above
        today; the dampeners do their real work on the low-base tea cultures (China, India, Turkey).
      </P>

      <H>Proposed ceilings — all 12 markets</H>
      <div className="overflow-x-auto mt-2">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700">
              <th className="text-left py-1.5 pr-2">Market</th>
              <th className="text-left py-1.5 pr-2">Class</th>
              <th className="text-right py-1.5 pr-2">Now</th>
              <th className="text-right py-1.5 pr-2">Base</th>
              <th className="text-right py-1.5 pr-2">Med.age</th>
              <th className="text-right py-1.5 pr-2">Demo ×</th>
              <th className="text-right py-1.5 pr-2">K</th>
              <th className="text-right py-1.5 pr-3">Headroom</th>
              <th className="text-left py-1.5">Anchor &amp; reasoning</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => {
              const c = K_BASE[r.key];
              const analog = c.anchor === "analog";
              const demo = analog ? demographicFactor(c.medianAge) : 1;
              const K = ceilingK(r.key);
              return (
              <tr key={r.key} className="border-b border-slate-800 align-top">
                <td className="py-1.5 pr-2 text-slate-100 font-medium whitespace-nowrap">{r.m}</td>
                <td className={`py-1.5 pr-2 ${clsTone(r.cls)} whitespace-nowrap`}>{r.cls}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-400">{r.now.toFixed(2)}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-400">{c.base.toFixed(1)}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-500">{c.medianAge}</td>
                <td className={`py-1.5 pr-2 text-right font-mono ${analog && demo < 1 ? "text-red-300" : "text-slate-600"}`}>
                  {analog ? `×${demo.toFixed(2)}` : "—"}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono text-amber-300">{K.toFixed(1)}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-emerald-300">{(K / r.now).toFixed(1)}×</td>
                <td className="py-1.5 text-slate-400 leading-relaxed">
                  <span className="text-slate-300">{r.anchor}.</span> {r.logic}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[9px] text-slate-500 mt-2">
        Units: <Code>Now</Code>, <Code>Base</Code> &amp; <Code>K</Code> in kg/adult/yr. <Code>Base</Code> is the
        demographically-neutral ceiling (analog plateau × stomach-share × infra); <Code>Demo ×</Code> is the live
        median-age discount applied only to analog-anchored markets (self/plateau markets already embed their
        demographics, shown &ldquo;—&rdquo;). <Code>K = Base × Demo</Code>. <Code>Headroom</Code> = K ÷ now. Median age
        is the UN WPP whole-population figure, recomputed from the age data each refresh.
      </p>

      <H>What this does to the projection</H>
      <ul className="space-y-1 mb-2">
        <LI>The runaway cases are tamed: China bends to ~1.8 kg/adult (≈5× today, not the uncapped CAGR&rsquo;s order-of-magnitude blow-up); India keeps a big <em>multiple</em> but a tiny absolute ceiling (0.6).</LI>
        <LI>Mature/origin markets barely move — K just caps the noise (Brazil 8.2 → 9.0, Korea 4.5 → 5.0).</LI>
        <LI>Mechanically: replace <Code>i(t)=i₀(1+g)^t</Code> with the logistic <Code>i(t)=K/(1+((K−i₀)/i₀)·e^(−r·t))</Code>, or the discrete equivalent <Code>g_eff = g·(1−i/K)</Code>. Same early slope, bounded tail.</LI>
      </ul>

      <p className="text-[9px] text-slate-500 italic mt-3">
        Source logic: deep-research report &ldquo;Predictive Modelling of Coffee Adoption in Emerging Markets&rdquo; (2026).
        K values are review anchors for the Consumption-tab projection — adjust here as evidence sharpens.
      </p>
    </AgronomyCard>
  );
}
