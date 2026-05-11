"use client";

// ── Layout helpers (shared with CotBacktestReport style) ─────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h2 className="text-sm font-bold uppercase tracking-widest text-amber-400 border-b border-slate-700 pb-1 mb-5">{title}</h2>
      {children}
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded mr-1 ${color}`}>
      {children}
    </span>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

const SUPPLEMENTAL = [
  {
    name: "Non-Commercial",
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-900/10",
    actors: "Hedge funds, CTAs, macro funds, commodity pools",
    note: "Pure speculators — no commercial exposure in the physical market. Net position is the primary sentiment gauge.",
    maps_to: ["Money Managers", "Other Reportables (partial)"],
  },
  {
    name: "Index Traders",
    color: "text-violet-400",
    border: "border-violet-500/30",
    bg: "bg-violet-900/10",
    actors: "Commodity index funds (GSCI, BCOM), pension funds with commodity allocations, ETFs (via authorized participants)",
    note: "Passive, mechanical buyers. Roll positions forward every month (roll crush window). Net position is always very long — they never go short.",
    maps_to: ["Swap Dealers (index portion)"],
  },
  {
    name: "Commercial",
    color: "text-blue-400",
    border: "border-blue-500/30",
    bg: "bg-blue-900/10",
    actors: "Exporters, importers, roasters, physical traders, merchant houses, origin cooperatives",
    note: "Genuine commercial exposure. Includes both hedgers (PMPU) and some swap dealer flow. The CFTC mixed these — disaggregated untangles them.",
    maps_to: ["Prod./Merchant/User", "Swap Dealers (commercial)", "Other Reportables (partial)"],
  },
  {
    name: "Non-Reportable",
    color: "text-slate-400",
    border: "border-slate-600/40",
    bg: "bg-slate-800/30",
    actors: "Small retail traders, prop desks below reporting threshold",
    note: "Residual: total OI minus reportable positions. Noisy — includes everything too small to classify. Weak sentiment signal at best.",
    maps_to: ["Non-Reportables"],
  },
];

const DISAGGREGATED = [
  {
    name: "Money Managers",
    abbr: "MM",
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-900/10",
    actors: [
      { type: "Hedge funds", detail: "Macro, discretionary commodity specialists" },
      { type: "CTAs", detail: "Trend followers — size with momentum, cut with volatility" },
      { type: "Commodity pools", detail: "Registered funds with commodity mandate" },
    ],
    signal: "The primary spec sentiment gauge. When MM net turns from long to short (or vice versa), it marks major positioning reversals. Watch gross long vs gross short separately — crowded gross longs are vulnerable to washouts.",
    cftc_def: "Any natural person or organization registered as a CTA, CPO, or a fund that trades under a CTA's advice. Must trade futures/options for speculative purposes.",
  },
  {
    name: "Swap Dealers",
    abbr: "Swap",
    color: "text-violet-400",
    border: "border-violet-500/30",
    bg: "bg-violet-900/10",
    actors: [
      { type: "Index replicators", detail: "Banks offsetting long TRS sold to pension/index funds — always short futures to hedge" },
      { type: "OTC swap books", detail: "Banks with bilateral commodity swap desks" },
      { type: "ETF authorized participants", detail: "Route commodity ETF flows via total return swaps" },
    ],
    signal: "Dominated by index replication. Their net short = index fund money on the long side of the OTC swap. When Swap net short increases, more index/passive money entered the market. The roll pattern (monthly crush) is mechanical — not a market signal.",
    cftc_def: "Entities primarily dealing in swaps and using futures to hedge or manage risk from their swap book. Includes major banks with commodity divisions.",
  },
  {
    name: "Prod./Merchant/Processor/User",
    abbr: "PMPU",
    color: "text-blue-400",
    border: "border-blue-500/30",
    bg: "bg-blue-900/10",
    actors: [
      { type: "Exporters & origin traders", detail: "Vietnam cooperatives, Brazilian exporters, ABCDs (Olam, Neumann, Volcafe, ED&F)" },
      { type: "Roasters & importers", detail: "Nestlé, JDE, IAM — locking cost of green coffee" },
      { type: "Port warehouses", detail: "Hedging certified inventory held against delivery obligations" },
    ],
    signal: "The clearest hedger signal. PMPU net short = physical producers/merchants have sold futures forward. When PMPU net short compresses (they buy back), it often signals producer selling exhaustion — a bullish precursor. Track the ratio of PMPU net short to total OI.",
    cftc_def: "Entities that produce, process, or handle physical commodities and use futures to hedge their commercial exposure. Must have physical market presence.",
  },
  {
    name: "Other Reportables",
    abbr: "Other",
    color: "text-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-900/10",
    actors: [
      { type: "Prop trading firms", detail: "Market makers and stat arb not registered as CTAs" },
      { type: "Family offices & endowments", detail: "Large non-CTA commodity allocators" },
      { type: "Non-commercial speculators", detail: "Trading their own account, large enough to report" },
    ],
    signal: "Heterogeneous catch-all. Usually small relative to MM. Can occasionally signal crowding when it moves sharply in the same direction as MM — suggests a broad speculative consensus forming.",
    cftc_def: "All reportable traders not classifiable as MM, Swap, or PMPU. Includes proprietary traders, non-CTA large speculators, and others above the reporting threshold.",
  },
  {
    name: "Non-Reportables",
    abbr: "NR",
    color: "text-slate-400",
    border: "border-slate-600/40",
    bg: "bg-slate-800/30",
    actors: [
      { type: "Small speculators", detail: "Retail traders and small funds below reporting threshold" },
      { type: "Small hedgers", detail: "Small physical players below the CFTC reporting level" },
    ],
    signal: "Residual by construction. Net position is typically small and noisy. Historically, extreme NR positioning has mild contrarian value — they tend to be systematically wrong at market extremes.",
    cftc_def: "Derived by subtracting all reportable positions from total open interest. These traders fall below CFTC large-trader reporting thresholds.",
  },
];

const MAPPING_ROWS = [
  {
    supplemental: "Non-Commercial",
    scol: "text-amber-400 bg-amber-900/20",
    disaggregated: ["Money Managers", "Other Reportables (part)"],
    dcols: ["text-amber-400 bg-amber-900/20", "text-emerald-400 bg-emerald-900/20"],
    note: "MM is the clean subset — registered speculators only. Other Reportables picks up the large non-registered spec accounts that used to sit in Non-Commercial.",
  },
  {
    supplemental: "Index Traders",
    scol: "text-violet-400 bg-violet-900/20",
    disaggregated: ["Swap Dealers (index portion)"],
    dcols: ["text-violet-400 bg-violet-900/20"],
    note: "Index funds don't hold futures directly — they buy total return swaps from banks. Those banks (Swap Dealers) then short futures to hedge. This is why Index Traders disappear in disaggregated — they become the short side of the Swap Dealer book.",
  },
  {
    supplemental: "Commercial",
    scol: "text-blue-400 bg-blue-900/20",
    disaggregated: ["Prod./Merchant/User", "Swap Dealers (OTC book)", "Other Reportables (part)"],
    dcols: ["text-blue-400 bg-blue-900/20", "text-violet-400 bg-violet-900/20", "text-emerald-400 bg-emerald-900/20"],
    note: "This is where disaggregated adds the most value. 'Commercial' in supplemental lumped genuine physical hedgers (PMPU) with bank swap desks. Separating them reveals very different signals — PMPU is a harvest/basis hedger, Swap is a passive-flow counterparty.",
  },
  {
    supplemental: "Non-Reportable",
    scol: "text-slate-400 bg-slate-700/30",
    disaggregated: ["Non-Reportables"],
    dcols: ["text-slate-400 bg-slate-700/30"],
    note: "Same definition: residual below reporting threshold. Unchanged across both reports.",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function CotCategoryBreakdown() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 text-slate-200">

      {/* Header */}
      <div className="mb-8 border-l-4 border-amber-500 pl-4">
        <div className="text-[10px] uppercase tracking-widest text-amber-500 mb-1">Research Note · CFTC Data Guide</div>
        <h1 className="text-xl font-bold text-white mb-2">
          Who Is in the COT? — Breaking Down the Market Participants
        </h1>
        <div className="text-xs text-slate-400 mb-1">
          Arabica (NY) · CFTC Supplemental vs. Disaggregated COT · Actor mapping and signal interpretation
        </div>
        <div className="text-xs text-slate-500 italic">
          Reference: CFTC Disaggregated Explanatory Notes (cftc.gov) · Peak Trading Research FAQs (peaktradingresearch.com/research-faqs)
        </div>
      </div>

      {/* 1. Why two reports */}
      <Section title="1 · Two Reports, Two Levels of Detail">
        <p className="text-sm text-slate-300 leading-relaxed mb-4">
          The CFTC publishes two COT reports for coffee futures. Both are released every Friday at 15:30 ET
          covering positions as of the previous Tuesday. They use different classification schemes:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="bg-slate-800/50 border border-amber-500/20 rounded p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-2">Supplemental COT</div>
            <div className="text-xs font-semibold text-white mb-2">4 categories · Available since 2006</div>
            <ul className="text-xs text-slate-400 space-y-1">
              <li className="flex gap-2"><span className="text-amber-400 font-mono w-28 flex-shrink-0">Non-Commercial</span>Pure speculators</li>
              <li className="flex gap-2"><span className="text-violet-400 font-mono w-28 flex-shrink-0">Index Traders</span>Passive commodity indexes</li>
              <li className="flex gap-2"><span className="text-blue-400 font-mono w-28 flex-shrink-0">Commercial</span>Hedgers + swap books (mixed)</li>
              <li className="flex gap-2"><span className="text-slate-400 font-mono w-28 flex-shrink-0">Non-Reportable</span>Small traders (residual)</li>
            </ul>
            <div className="mt-3 text-[10px] text-slate-500">
              Simpler but coarser — &quot;Commercial&quot; mixes physical hedgers with bank swap desks.
            </div>
          </div>
          <div className="bg-slate-800/50 border border-emerald-500/20 rounded p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-2">Disaggregated COT</div>
            <div className="text-xs font-semibold text-white mb-2">5 categories · Available since Sep 2009</div>
            <ul className="text-xs text-slate-400 space-y-1">
              <li className="flex gap-2"><span className="text-amber-400 font-mono w-28 flex-shrink-0">Money Managers</span>Registered spec funds, CTAs</li>
              <li className="flex gap-2"><span className="text-violet-400 font-mono w-28 flex-shrink-0">Swap Dealers</span>Banks with swap books + index</li>
              <li className="flex gap-2"><span className="text-blue-400 font-mono w-28 flex-shrink-0">Prod./Merch./User</span>Physical hedgers only</li>
              <li className="flex gap-2"><span className="text-emerald-400 font-mono w-28 flex-shrink-0">Other Reportable</span>Large non-MM speculators</li>
              <li className="flex gap-2"><span className="text-slate-400 font-mono w-28 flex-shrink-0">Non-Reportable</span>Small traders (residual)</li>
            </ul>
            <div className="mt-3 text-[10px] text-slate-500">
              Separates physical hedgers from financial intermediaries — more actionable for analysis.
            </div>
          </div>
        </div>
        <div className="bg-slate-800/40 border border-amber-800/30 rounded p-3 text-xs text-slate-400">
          <span className="text-amber-400 font-semibold">Recommendation:</span> Use Disaggregated for analysis. Supplemental is useful for longer history (pre-2009) but mixes signals that Disaggregated separates. The dashboard COT panel uses the Disaggregated report.
        </div>
      </Section>

      {/* 2. Mapping table */}
      <Section title="2 · How the Categories Map to Each Other">
        <p className="text-sm text-slate-300 leading-relaxed mb-4">
          The two reports classify the same traders differently. Understanding the mapping reveals
          why certain signals look different depending on which report you read:
        </p>
        <div className="space-y-3">
          {MAPPING_ROWS.map(row => (
            <div key={row.supplemental} className="bg-slate-800/40 border border-slate-700 rounded p-4">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Tag color={row.scol}>{row.supplemental}</Tag>
                  <span className="text-slate-500 text-sm">→</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {row.disaggregated.map((d, i) => (
                    <Tag key={i} color={row.dcols[i]}>{d}</Tag>
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{row.note}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 3. Supplemental detail */}
      <Section title="3 · Supplemental COT — Category Deep Dive">
        <div className="space-y-4">
          {SUPPLEMENTAL.map(cat => (
            <div key={cat.name} className={`rounded p-4 border ${cat.border} ${cat.bg}`}>
              <div className={`text-sm font-bold mb-1 ${cat.color}`}>{cat.name}</div>
              <div className="text-xs text-slate-300 mb-2"><span className="text-slate-500">Who:</span> {cat.actors}</div>
              <div className="text-xs text-slate-400 mb-2 leading-relaxed">{cat.note}</div>
              <div className="flex flex-wrap gap-1">
                <span className="text-[10px] text-slate-500">Maps to:</span>
                {cat.maps_to.map(m => (
                  <span key={m} className="text-[10px] bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded">{m}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 4. Disaggregated detail */}
      <Section title="4 · Disaggregated COT — Category Deep Dive">
        <div className="space-y-4">
          {DISAGGREGATED.map(cat => (
            <div key={cat.name} className={`rounded p-4 border ${cat.border} ${cat.bg}`}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-sm font-bold ${cat.color}`}>{cat.name}</span>
                <span className="text-[10px] font-mono text-slate-500">({cat.abbr})</span>
              </div>
              <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wide">CFTC definition</div>
              <p className="text-xs text-slate-400 leading-relaxed mb-3 italic">{cat.cftc_def}</p>
              <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wide">Who they are</div>
              <div className="space-y-1 mb-3">
                {cat.actors.map(a => (
                  <div key={a.type} className="flex gap-2 text-xs">
                    <span className={`font-semibold flex-shrink-0 w-36 ${cat.color}`}>{a.type}</span>
                    <span className="text-slate-400">{a.detail}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Trading signal</div>
              <p className="text-xs text-slate-300 leading-relaxed">{cat.signal}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 5. Practical use */}
      <Section title="5 · Practical Checklist — What to Look at and Why">
        <div className="space-y-3">
          {[
            {
              priority: "1",
              pcol: "bg-amber-500/20 text-amber-400",
              label: "MM net position & direction of change",
              detail: "Primary sentiment gauge. Extreme net longs (top 20% of historic range) = crowded long, vulnerable to washout. Extreme net short = capitulation, look for reversal catalyst. Watch the rate of change — sustained weekly increases into a price rally confirm momentum; divergence warns of trend exhaustion.",
            },
            {
              priority: "2",
              pcol: "bg-blue-500/20 text-blue-400",
              label: "PMPU net short vs. OI ratio",
              detail: "Measures producer hedging pressure. PMPU net short / total OI gives a normalized read. When this ratio compresses (producers buying back hedges), it often precedes a supply-side squeeze — they are covering because they believe prices will go higher, or their origination is done. Lowest reading near harvest; highest during off-season.",
            },
            {
              priority: "3",
              pcol: "bg-violet-500/20 text-violet-400",
              label: "Swap Dealer net position (index flow)",
              detail: "Swap net short ≈ index/passive money parked long via OTC swaps. When Swap net short increases significantly, new index money entered — this is bearish for basis (more passive sellers on the futures roll). Watch for the monthly roll window (typically 5th–9th business day) when Swap dealers mechanically roll their short hedge forward.",
            },
            {
              priority: "4",
              pcol: "bg-emerald-500/20 text-emerald-400",
              label: "Gross MM longs vs. gross shorts separately",
              detail: "Net position masks what's happening inside. A flat MM net with rising gross longs AND gross shorts means both bulls and bears adding — high conviction on both sides, expect volatility. A flat net with shrinking gross positions means both sides clearing out — low conviction, directional break incoming.",
            },
            {
              priority: "5",
              pcol: "bg-slate-500/20 text-slate-300",
              label: "NR as contrarian check",
              detail: "Non-Reportables tend to be wrong at extremes. At historically extreme NR net long, fade the direction. Signal is weak and should never be primary — use only as a secondary confirmation or contrarian flag when everything else is also at extremes.",
            },
          ].map(item => (
            <div key={item.priority} className="flex gap-3">
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${item.pcol}`}>
                {item.priority}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-100 mb-0.5">{item.label}</div>
                <p className="text-xs text-slate-400 leading-relaxed">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 6. The index trader detail */}
      <Section title="6 · The Index Trader Mechanism — Why It Matters">
        <p className="text-sm text-slate-300 leading-relaxed mb-4">
          The routing of commodity index money through swap dealers is the single most misunderstood
          structure in COT analysis. Here is how it works step by step:
        </p>
        <div className="space-y-2 mb-4">
          {[
            { step: "1", text: "A pension fund decides to allocate 2% of its portfolio to commodities via a Goldman Sachs Commodity Index (GSCI) total return swap." },
            { step: "2", text: "Goldman sells the TRS to the pension fund. Goldman is now long the commodity index (economically exposed to rising commodity prices) via the OTC swap." },
            { step: "3", text: "Goldman hedges its OTC exposure by shorting coffee futures (and other commodity futures) on ICE. Goldman = Swap Dealer = net short futures." },
            { step: "4", text: "In the Supplemental COT, this pension fund shows up as an \"Index Trader\" — a long-only passive buyer. In Disaggregated, Goldman (not the pension) is visible as a Swap Dealer with a short position — the pension is invisible." },
            { step: "5", text: "Every month, Goldman must roll the short hedge (the pension fund's index stays invested). This creates a mechanical roll pattern: Goldman buys nearby contracts and sells back-month contracts. This roll is predictable and creates temporary nearby backwardation during the roll window." },
          ].map(s => (
            <div key={s.step} className="flex gap-3 text-xs">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-900/40 text-violet-400 flex items-center justify-center font-bold text-[10px]">{s.step}</div>
              <p className="text-slate-400 leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="bg-slate-800/40 border border-violet-800/30 rounded p-3 text-xs text-slate-400">
          <span className="text-violet-400 font-semibold">Key implication:</span> A large Swap Dealer net short does NOT mean bears are in control. It means more passive index money is parked long OTC. The futures market sees only the hedge, not the underlying long position. Misreading this is a common error in COT analysis.
        </div>
      </Section>

      {/* Footer */}
      <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-4 mt-4">
        Sources: CFTC Disaggregated COT Explanatory Notes (cftc.gov/MarketReports/CommitmentsofTraders) ·
        Peak Trading Research FAQs (peaktradingresearch.com/research-faqs) ·
        ICE Futures U.S. KC Arabica contract specifications ·
        Internal use only.
      </div>
    </div>
  );
}
