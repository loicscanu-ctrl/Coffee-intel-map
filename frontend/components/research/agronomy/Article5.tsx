"use client";
import { AgronomyCard, H, P, LI } from "./prose";

// ── Article 5: NPK → carrier conversion ──────────────────────────────────────

function CarrierConversionTable() {
  const TARGET_N = 235, TARGET_P = 130, TARGET_K = 220;
  const mapKg    = Math.round(TARGET_P / 0.52 * 10) / 10;        // 250
  const mapN     = Math.round(mapKg * 0.11 * 10) / 10;           // 27.5
  const remainN  = Math.round((TARGET_N - mapN) * 10) / 10;      // 207.5
  const ureaKg   = Math.round(remainN / 0.46 * 10) / 10;         // 451.1
  const kclKg    = Math.round(TARGET_K / 0.60 * 10) / 10;        // 366.7
  const totalKg  = Math.round((ureaKg + mapKg + kclKg) * 10) / 10;
  const urea_N   = Math.round(ureaKg * 0.46 * 10) / 10;

  return (
    <div className="mt-3 space-y-3">
      <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700 text-xs">
        <p className="text-amber-400 font-bold text-[10px] uppercase tracking-wider mb-3">
          Step-by-step · IPHM 3 t/ha baseline · N:{TARGET_N} P₂O₅:{TARGET_P} K₂O:{TARGET_K} kg/ha
        </p>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-slate-500 shrink-0 font-mono">①</span>
            <div>
              <span className="text-sky-400 font-semibold">MAP first</span>
              <span className="text-slate-400"> — fixes P₂O₅ requirement and its bonus N</span>
              <div className="mt-1 font-mono text-[11px] text-slate-300">
                {TARGET_P} kg P₂O₅ ÷ 0.52 = <span className="text-sky-300 font-bold">{mapKg} kg MAP</span>
                <span className="text-slate-500 ml-3">bonus N: {mapKg} × 0.11 = {mapN} kg N</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-slate-500 shrink-0 font-mono">②</span>
            <div>
              <span className="text-green-400 font-semibold">Urea</span>
              <span className="text-slate-400"> — covers remaining N after MAP contribution</span>
              <div className="mt-1 font-mono text-[11px] text-slate-300">
                ({TARGET_N} − {mapN}) ÷ 0.46 = <span className="text-green-300 font-bold">{ureaKg} kg Urea</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-slate-500 shrink-0 font-mono">③</span>
            <div>
              <span className="text-orange-400 font-semibold">KCl</span>
              <span className="text-slate-400"> — covers K₂O independently</span>
              <div className="mt-1 font-mono text-[11px] text-slate-300">
                {TARGET_K} kg K₂O ÷ 0.60 = <span className="text-orange-300 font-bold">{kclKg} kg KCl</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Product</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Grade (N-P₂O₅-K₂O)</th>
              <th className="text-right text-slate-400 font-medium pb-1.5 pr-4">kg/ha</th>
              <th className="text-right text-green-400 font-medium pb-1.5 pr-4">N kg</th>
              <th className="text-right text-sky-400 font-medium pb-1.5 pr-4">P₂O₅ kg</th>
              <th className="text-right text-orange-400 font-medium pb-1.5">K₂O kg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            <tr>
              <td className="py-1.5 pr-4 text-green-300 font-medium">Urea</td>
              <td className="py-1.5 pr-4 font-mono text-slate-500">46-0-0</td>
              <td className="py-1.5 pr-4 text-right">{ureaKg}</td>
              <td className="py-1.5 pr-4 text-right text-green-400">{urea_N}</td>
              <td className="py-1.5 pr-4 text-right text-slate-600">—</td>
              <td className="py-1.5 text-right text-slate-600">—</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 text-sky-300 font-medium">MAP</td>
              <td className="py-1.5 pr-4 font-mono text-slate-500">11-52-0</td>
              <td className="py-1.5 pr-4 text-right">{mapKg}</td>
              <td className="py-1.5 pr-4 text-right text-green-400">{mapN}</td>
              <td className="py-1.5 pr-4 text-right text-sky-400">{TARGET_P}</td>
              <td className="py-1.5 text-right text-slate-600">—</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 text-orange-300 font-medium">KCl</td>
              <td className="py-1.5 pr-4 font-mono text-slate-500">0-0-60</td>
              <td className="py-1.5 pr-4 text-right">{kclKg}</td>
              <td className="py-1.5 pr-4 text-right text-slate-600">—</td>
              <td className="py-1.5 pr-4 text-right text-slate-600">—</td>
              <td className="py-1.5 text-right text-orange-400">{TARGET_K}</td>
            </tr>
            <tr className="border-t border-slate-600">
              <td className="pt-2 pr-4 text-slate-200 font-semibold">Total</td>
              <td className="pt-2 pr-4 text-slate-500 text-[10px]">pure fertilizer applied</td>
              <td className="pt-2 pr-4 text-right text-slate-200 font-semibold">{totalKg}</td>
              <td className="pt-2 pr-4 text-right text-green-300 font-semibold">{TARGET_N} ✓</td>
              <td className="pt-2 pr-4 text-right text-sky-300 font-semibold">{TARGET_P} ✓</td>
              <td className="pt-2 text-right text-orange-300 font-semibold">{TARGET_K} ✓</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Article5() {
  return (
    <AgronomyCard
      kicker="Agronomy · Fertilizer Fundamentals"
      title="NPK, Urea and MAP: why agronomists and traders speak different languages"
      subtitle="Translating fertilizer market tickers into field application reality"
      briefing={
        <span>
          Agronomists prescribe fertilizer in NPK — the three plant-available nutrients.
          Commodity desks price Urea, MAP and KCl — the carrier products that deliver
          those nutrients. The gap between these two vocabularies is where cost analysis
          breaks down if you conflate them.
        </span>
      }
    >
      <H>N, P, K — nutrients, not products</H>
      <P>
        Plants need three macro-nutrients: Nitrogen (N), Phosphorus (P) and Potassium (K).
        But none can simply be poured on a field. Nitrogen gas (N₂) makes up 78% of the
        atmosphere yet plants cannot absorb it — it is chemically inert. Phosphorus and
        potassium must arrive in water-soluble ionic form. The fertilizer industry packages
        these nutrients into stable, storable, transportable <em>carrier molecules</em>.
      </P>

      <H>Why &ldquo;K&rdquo; — not &ldquo;Po&rdquo; for potassium, and why P₂O₅ not P?</H>
      <P>
        Element symbols follow Latin and Germanic roots, not English names. Potassium
        derives from <em>Kalium</em> (medieval Latin, from Arabic <em>al-qaly</em> — ash of
        burnt plants), hence the symbol K. Phosphorus measurements use P₂O₅ (phosphorus
        pentoxide) rather than elemental P — a 19th-century analytical convention that
        overstates actual P content by ~2.3×, yet remains the global industry standard.
        Potassium is likewise expressed as K₂O. This is why an NPK label reads &ldquo;14-8-16&rdquo;
        even though the product contains no literal oxides.
      </P>

      <H>The three dominant carrier products</H>
      <ul className="space-y-2 mb-3">
        <LI>
          <strong className="text-green-400">Urea CO(NH₂)₂ — grade 46-0-0.</strong>{" "}
          The most concentrated solid nitrogen fertilizer: 46% N by weight. Produced via
          the Haber-Bosch process (N₂ + H₂ → NH₃, then reacted with CO₂ → urea). Natural
          gas is both feedstock and energy, so Urea prices track European and Asian gas
          benchmarks closely. Contains no phosphorus or potassium.
        </LI>
        <LI>
          <strong className="text-sky-400">MAP — Monoammonium Phosphate, grade 11-52-0.</strong>{" "}
          A dual-nutrient carrier: 52% P₂O₅ and 11% N, produced by reacting phosphoric acid
          with ammonia. Because MAP delivers both P and N simultaneously, conversion from an
          NPK prescription always resolves MAP first — it fixes the phosphorus requirement and
          reduces the Urea needed for nitrogen in the same step.
        </LI>
        <LI>
          <strong className="text-orange-400">KCl — Muriate of Potash (MOP), grade 0-0-60.</strong>{" "}
          60% K₂O, mined directly from underground potash deposits (sylvinite, carnallite) in
          Canada, Russia and Belarus. Unlike Urea and MAP — manufactured via chemical synthesis —
          KCl is a mined and refined mineral. Its price is driven by mining economics and
          geopolitics rather than energy costs.
        </LI>
      </ul>

      <H>Why you cannot buy &ldquo;nitrogen&rdquo; at a commodity desk</H>
      <P>
        Atmospheric N₂ is abundant but agronomically useless. The economically relevant
        product is <em>fixed nitrogen</em> — converted into reactive NH₃, NH₄⁺ or NO₃⁻ that
        roots can absorb. The Haber-Bosch process, which reacts N₂ with hydrogen from natural
        gas at 150–300 bar and 400–500°C, is the only scalable industrial path. It consumes
        roughly 1–2% of global energy. Urea is the most efficient solid form to ship and store
        this fixed nitrogen. When commodity markets quote &ldquo;Urea FOB Black Sea,&rdquo; they are
        effectively pricing the cost of extracting atmospheric nitrogen, concentrating it, and
        shipping it in pelletised form.
      </P>

      <H>Why &ldquo;NPK&rdquo; — not &ldquo;UMK&rdquo;?</H>
      <P>
        NPK describes <em>what the plant needs</em>. &ldquo;UMK&rdquo; would describe one particular set
        of carrier products — but the same N, P, K targets can be met with dozens of
        substitutes: DAP (18-46-0) instead of MAP, Ammonium Nitrate (34-0-0) instead of Urea,
        SOP (0-0-50) instead of KCl. The NPK framework is carrier-agnostic by design, allowing
        agronomists to write a single nutrient prescription that farmers fill with locally
        available or economically optimal products. A bag labelled &ldquo;15-8-14&rdquo; could contain
        Urea+MAP+KCl, or DAP+AN+SOP, or a factory-blended compound. The nutrient targets are
        universal; the carrier choice is regional and economic.
      </P>

      <H>Converting a nutrient prescription to carrier quantities</H>
      <P>
        Resolve MAP first (dual-nutrient carrier), subtract its N contribution from the total
        N target, then cover residual N with Urea, and K₂O with KCl independently.
        IPHM prescription for mature Robusta at 3 t/ha (N: 235, P₂O₅: 130, K₂O: 220 kg/ha):
      </P>
      <CarrierConversionTable />

      <H>Scaling to other yield targets</H>
      <P>
        The IPHM baseline is calibrated at 3 t/ha. Each tonne of green beans extracts
        approximately <strong>78 kg N</strong>, <strong>43 kg P₂O₅</strong> and{" "}
        <strong>73 kg K₂O</strong> from the soil. Scale the nutrient targets proportionally
        and apply the same MAP-first conversion to get the carrier quantities for any yield target.
      </P>

      <H>Fertilizer SnD: who controls supply by carrier</H>
      <div className="overflow-x-auto mt-2 mb-3">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4 w-16">Carrier</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Key exporters</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Benchmark price</th>
              <th className="text-left text-slate-400 font-medium pb-1.5">Primary swing factor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            <tr>
              <td className="py-2 pr-4 text-green-300 font-medium">Urea</td>
              <td className="py-2 pr-4 text-slate-300">China (≈30% world), Russia, Saudi Arabia, Qatar, Egypt</td>
              <td className="py-2 pr-4 font-mono text-slate-400">FOB Yuzhny (Black Sea)<br/>FOB Arab Gulf</td>
              <td className="py-2 text-slate-300">
                Chinese export quotas (announced quarterly); European gas prices drive Middle East cost floor.
                India tenders signal global price floor 3–4×/year.
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-sky-300 font-medium">MAP</td>
              <td className="py-2 pr-4 text-slate-300">Morocco OCP (~35% exports), Saudi MFIL, Russia, China</td>
              <td className="py-2 pr-4 font-mono text-slate-400">FOB Jorf Lasfar<br/>FOB Tampa (US)</td>
              <td className="py-2 text-slate-300">
                OCP holds ~70% of world economically viable phosphate rock reserves.
                Annual OCP–India contract sets reference price for Asian MAP.
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-orange-300 font-medium">KCl</td>
              <td className="py-2 pr-4 text-slate-300">Canada (Nutrien, Mosaic ≈35%), Russia (Uralkali), Belarus (Belaruskali)</td>
              <td className="py-2 pr-4 font-mono text-slate-400">CFR Brazil<br/>CFR SE Asia</td>
              <td className="py-2 text-slate-300">
                Belarus + Russia = ~40% pre-2022 global exports. Sanctions removed
                them abruptly; Canadian capacity absorbed partially over 18 months.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H>Origin-to-farm pipeline: how fast does a price shock reach Vietnam?</H>
      <P>
        A price move at origin must traverse multiple stages before changing what a
        farmer pays at the field gate. The total lag from FOB price spike to application
        rate change is <strong>6–14 weeks</strong>. The lag from application rate change
        to crop supply effect is a further <strong>6–9 months</strong>.
      </P>

      {/* Pipeline SVG */}
      <div className="mt-3 mb-3">
        <svg viewBox="0 0 600 130" className="w-full rounded overflow-hidden">
          <rect width="600" height="130" fill="#0f172a" />
          {/* Stage boxes */}
          {[
            { x: 10,  w: 70,  label: "Price spike",    sub: "FOB benchmark",   color: "#f59e0b" },
            { x: 100, w: 70,  label: "Production",     sub: "0–2 wks",         color: "#64748b" },
            { x: 190, w: 70,  label: "Ocean sailing",  sub: "15–35 days",      color: "#3b82f6" },
            { x: 280, w: 70,  label: "VN port",        sub: "1–2 wks customs", color: "#64748b" },
            { x: 370, w: 70,  label: "Distributor",    sub: "2–3 wks",         color: "#64748b" },
            { x: 460, w: 70,  label: "Farm stock",     sub: "0–4 wks buffer",  color: "#64748b" },
            { x: 540, w: 52,  label: "Applied",        sub: "seasonal lock-in",color: "#22c55e" },
          ].map(({ x, w, label, sub, color }) => (
            <g key={x}>
              <rect x={x} y={28} width={w} height={34} rx={3} fill="#1e293b" stroke={color} strokeWidth={1} />
              <text x={x + w/2} y={42} textAnchor="middle" fontSize={8}   fill={color} fontWeight="600">{label}</text>
              <text x={x + w/2} y={54} textAnchor="middle" fontSize={6.5} fill="#64748b">{sub}</text>
            </g>
          ))}
          {/* Arrows between boxes */}
          {[90, 180, 270, 360, 450, 540].map((ax) => (
            <text key={ax} x={ax + 5} y={49} fontSize={10} fill="#475569">›</text>
          ))}
          {/* Total lag label */}
          <line x1={10} y1={76} x2={592} y2={76} stroke="#334155" strokeWidth={1} strokeDasharray="3 2" />
          <text x={300} y={89} textAnchor="middle" fontSize={8} fill="#94a3b8">≈ 6–14 weeks: price shock → farm application</text>
          {/* Crop effect arrow */}
          <line x1={565} y1={62} x2={565} y2={100} stroke="#22c55e" strokeWidth={1} strokeDasharray="3 2" />
          <text x={565} y={110} textAnchor="middle" fontSize={7} fill="#22c55e">+6–9 months</text>
          <text x={565} y={120} textAnchor="middle" fontSize={7} fill="#22c55e">→ harvest effect</text>
          {/* Route duration notes */}
          <text x={225} y={18} textAnchor="middle" fontSize={6.5} fill="#3b82f6">Arab Gulf→VN: 15–18d · Morocco→VN: 25–28d · Canada→VN: 18–22d</text>
        </svg>
      </div>

      <H>Vietnam procurement calendar — when price signals matter</H>
      <div className="overflow-x-auto mt-2 mb-3">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Window</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Months</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Application</th>
              <th className="text-left text-slate-400 font-medium pb-1.5">Procurement locked by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            <tr>
              <td className="py-1.5 pr-4 text-amber-300">Dry S2</td>
              <td className="py-1.5 pr-4 font-mono text-slate-400">Feb–Mar</td>
              <td className="py-1.5 pr-4">200 kg/ha — floral trigger</td>
              <td className="py-1.5">Nov–Dec orders; Oct price signal is last open window</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 text-sky-300">Rainy S1</td>
              <td className="py-1.5 pr-4 font-mono text-slate-400">May</td>
              <td className="py-1.5 pr-4">500 kg/ha — largest dose, fruit set</td>
              <td className="py-1.5">Feb–Mar imports arrive; Jan price signal is last open window</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 text-sky-300">Rainy S2</td>
              <td className="py-1.5 pr-4 font-mono text-slate-400">July</td>
              <td className="py-1.5 pr-4">400 kg/ha — bean expansion</td>
              <td className="py-1.5">Apr–May procurement; Mar–Apr price signal relevant</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 text-sky-300">Rainy S3</td>
              <td className="py-1.5 pr-4 font-mono text-slate-400">September</td>
              <td className="py-1.5 pr-4">500 kg/ha — maturation flush</td>
              <td className="py-1.5">Jun–Jul procurement; Jun price signal is last open window</td>
            </tr>
          </tbody>
        </table>
      </div>

      <H>Key metrics traders monitor</H>
      <ul className="space-y-1.5 mb-3">
        <LI>
          <strong className="text-green-400">India Urea tender price (FIST/RCF)</strong> — India is the world&rsquo;s
          largest Urea importer. Government tenders run 3–4×/year and set the effective price
          floor for Asian Urea. A successful tender below $280/t usually signals global oversupply;
          above $350/t signals tightness.
        </LI>
        <LI>
          <strong className="text-green-400">China Urea export policy</strong> — China announces export
          quotas (or restrictions) seasonally. Restrictions in Q4 2021 and Q3 2023 each drove
          a 40–60% global price spike within 6 weeks. Spring lifting of quotas is a predictable
          relief valve.
        </LI>
        <LI>
          <strong className="text-sky-400">OCP–India annual MAP contract</strong> — Morocco&rsquo;s
          OCP and India&rsquo;s importers negotiate a reference price each spring. This price anchors
          MAP spot markets across Asia for the following 12 months.
        </LI>
        <LI>
          <strong className="text-orange-400">Belarusian potash export volumes</strong> — Post-2022
          sanctions, Belarus routes potash via Russian ports and China, partially restoring volumes.
          Monitoring Kaliningrad/Ust-Luga rail + ship data reveals actual Belarus supply reaching
          the market vs. the official &ldquo;sanctioned&rdquo; picture.
        </LI>
        <LI>
          <strong className="text-slate-300">Fertilizer-to-coffee price ratio</strong> — When the
          total fertilizer bill exceeds ~15% of expected green bean revenue, smallholders begin
          skipping applications. At current prices (~$305/t fertilizer cost vs ~$2,500/t FOB
          Robusta), the ratio is ~12% — below the stress threshold but rising since 2023.
        </LI>
      </ul>

      <div className="bg-slate-800/50 border border-amber-500/20 rounded-lg p-3 mt-2">
        <p className="text-[11px] text-amber-400/80 font-semibold mb-2">Trader take-away — lag structure</p>
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-300 leading-relaxed">
            <span className="text-green-400 font-semibold">Urea shocks</span> hit fastest:
            Arab Gulf → Vietnam sailing is only 15–18 days, so a Black Sea/Arab Gulf price
            spike is reflected in Vietnamese import costs within 6–8 weeks. Because Urea
            is the largest-volume carrier (451 kg/ha vs 250 MAP + 367 KCl), it drives the
            largest absolute cost change. Monitor Henry Hub, TTF gas benchmarks as 4–8 week
            leading indicators.
          </p>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            <span className="text-sky-400 font-semibold">MAP shocks</span> propagate within
            one season: Morocco sailing is 25–28 days, but the OCP contract structure means
            price resets happen annually rather than spot. A sharp post-harvest OCP contract
            repricing (spring) hits the May rainy-season application directly.
          </p>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            <span className="text-orange-400 font-semibold">KCl shocks</span> take 12–18 months
            to reduce application rates: farmers hold field-level buffer stocks (2–4 weeks),
            distributors carry 1–2 months inventory, and potash is the nutrient farmers cut
            last (nitrogen loss is visible immediately; potassium deficiency is slower and less
            obvious). The 2022 Belarus shock was not fully priced into Vietnamese farm budgets
            until the 2023 rainy season.
          </p>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            <span className="text-slate-200 font-semibold">From application cut to harvest impact:</span>{" "}
            reduced fertilizer doses applied in May–September show up as lower cherry weight and
            yield the following October–January harvest — a 6–9 month transmission. For supply
            forecasting, a fertilizer affordability squeeze in Q2 is a leading indicator of
            a tight Vietnamese crop by Q4 of the same year.
          </p>
        </div>
      </div>
    </AgronomyCard>
  );
}

