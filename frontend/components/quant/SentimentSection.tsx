"use client";

interface SentimentItem {
  id: number;
  headline: string;
  body: string;
  source: string;
  sentiment: "Bullish" | "Bearish" | "Neutral";
  confidence: number;
  tags: string[];
}

const ITEMS: SentimentItem[] = [
  {
    id: 1,
    headline: "Brazil 2025/26 crop estimate revised lower on dry weather",
    body: "CONAB revised its Brazil arabica estimate to 38.4 million bags, below its prior forecast of 40.1 million bags, citing persistent drought conditions in Minas Gerais during the flowering period.",
    source: "Reuters",
    sentiment: "Bullish",
    confidence: 82.4,
    tags: ["supply", "brazil", "arabica"],
  },
  {
    id: 2,
    headline: "Vietnam robusta exports decline 18% YoY in March",
    body: "Vietnamese robusta exports fell to 145,000 tonnes in March, down 18% year-on-year, as domestic stocks remain critically low ahead of the April-May harvest. Premiums in the local market widened to record levels.",
    source: "ICO",
    sentiment: "Bullish",
    confidence: 91.3,
    tags: ["supply", "vietnam", "robusta"],
  },
  {
    id: 3,
    headline: "Starbucks Q2 same-store sales miss estimates by 3%",
    body: "Starbucks reported global comparable store sales declined 1% in Q2, missing analyst consensus of +2.1%, driven by softness in the US market. Management guided cautiously for Q3 on consumer spending headwinds.",
    source: "Bloomberg",
    sentiment: "Bearish",
    confidence: 74.8,
    tags: ["demand", "earnings", "sbux"],
  },
  {
    id: 4,
    headline: "USD rally pressures commodity prices broadly",
    body: "The DXY Index touched a two-month high at 105.8, putting broad pressure on dollar-denominated commodities. Coffee joined the selloff with arabica futures declining 1.2% on the session.",
    source: "FT",
    sentiment: "Bearish",
    confidence: 68.2,
    tags: ["macro", "fx", "arabica"],
  },
  {
    id: 5,
    headline: "ICO composite indicator remains range-bound near 230 cents/lb",
    body: "The ICO composite price indicator has traded within a 220-240 cents/lb range for the third consecutive week, reflecting balanced supply and demand signals. Market participants await USDA WASDE revision.",
    source: "ICO",
    sentiment: "Neutral",
    confidence: 55.6,
    tags: ["prices", "ico"],
  },
  {
    id: 6,
    headline: "Managed money net long positions trimmed for second week",
    body: "CFTC data shows managed money trimmed net long positions in arabica by 3,400 contracts to 48,200, reflecting cautious sentiment amid macro uncertainty. Commercial hedging activity increased.",
    source: "CFTC",
    sentiment: "Bearish",
    confidence: 61.5,
    tags: ["cot", "positioning", "arabica"],
  },
];

const OVERALL_SENTIMENT: "Bullish" | "Bearish" | "Neutral" = "Bearish";
const OVERALL_CONFIDENCE = 60.71;

const SENT_COLOR = {
  Bullish: "text-emerald-400 bg-emerald-950/60 border-emerald-700",
  Bearish: "text-red-400 bg-red-950/60 border-red-700",
  Neutral: "text-slate-400 bg-slate-800/60 border-slate-600",
};
const SENT_BAR = {
  Bullish: "bg-emerald-600",
  Bearish: "bg-red-600",
  Neutral: "bg-slate-600",
};

const bullCount = ITEMS.filter(i => i.sentiment === "Bullish").length;
const bearCount = ITEMS.filter(i => i.sentiment === "Bearish").length;
const neutCount = ITEMS.filter(i => i.sentiment === "Neutral").length;
const total = ITEMS.length;

export default function SentimentSection() {
  return (
    <section className="px-6 py-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded">Section 5</span>
          <h2 className="text-base font-bold text-white">Coffee News Sentiment Analysis</h2>
          <span className="text-[10px] text-slate-500">NLP · Probabilistic classification · Confidence scoring</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          AI categorizes qualitative text into discrete sentiment vectors:{" "}
          <span className="text-emerald-400">Bullish</span>,{" "}
          <span className="text-red-400">Bearish</span>, or{" "}
          <span className="text-slate-400">Neutral</span>.
          Each classification carries a pseudo-probability confidence score from the model&apos;s output distribution.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Aggregate panel */}
        <div className="xl:col-span-1 space-y-3">
          {/* Overall verdict */}
          <div className="bg-slate-900 rounded-lg p-4 text-center space-y-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Overall Sentiment</div>
            <div className={`text-2xl font-bold ${SENT_COLOR[OVERALL_SENTIMENT].split(" ")[0]}`}>
              {OVERALL_SENTIMENT}
            </div>
            <div className="text-xs text-slate-400">Confidence</div>
            <div className="text-3xl font-bold font-mono text-white">{OVERALL_CONFIDENCE.toFixed(2)}%</div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-2 rounded-full ${SENT_BAR[OVERALL_SENTIMENT]}`}
                style={{ width: `${OVERALL_CONFIDENCE}%` }}
              />
            </div>
          </div>

          {/* Distribution */}
          <div className="bg-slate-900 rounded-lg p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Distribution</div>
            {(["Bullish", "Bearish", "Neutral"] as const).map(s => {
              const count = s === "Bullish" ? bullCount : s === "Bearish" ? bearCount : neutCount;
              const pct = (count / total) * 100;
              return (
                <div key={s} className="space-y-0.5">
                  <div className="flex justify-between">
                    <span className={`text-[11px] ${SENT_COLOR[s].split(" ")[0]}`}>{s}</span>
                    <span className="text-[11px] font-mono text-slate-400">{count}/{total}</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full">
                    <div className={`h-1.5 rounded-full ${SENT_BAR[s]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Methodology note */}
          <div className="bg-slate-900 rounded-lg p-4 space-y-1.5">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Methodology</div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Each news item is vectorized into a sentiment embedding. The model outputs a softmax probability
              distribution across the three classes. The reported confidence is the maximum class probability,
              representing the model&apos;s certainty in the dominant sentiment.
            </p>
            <div className="pt-1 space-y-1 font-mono text-[10px] text-slate-500">
              <div>P(Bullish | text)</div>
              <div>P(Bearish | text)</div>
              <div>P(Neutral | text)</div>
              <div className="text-slate-600">Σ = 1.0</div>
            </div>
          </div>
        </div>

        {/* News items */}
        <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {ITEMS.map((item) => (
            <div key={item.id} className="bg-slate-900 rounded-lg p-3 space-y-2 border border-slate-800 hover:border-slate-700 transition-colors">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-200 leading-tight">{item.headline}</span>
                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-bold ${SENT_COLOR[item.sentiment]}`}>
                  {item.sentiment}
                </span>
              </div>

              {/* Body */}
              <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">{item.body}</p>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {item.tags.map(tag => (
                    <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">{tag}</span>
                  ))}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] text-slate-500">{item.source}</div>
                  <div className="text-[10px] font-mono font-bold text-white">{item.confidence.toFixed(1)}%</div>
                  <div className="w-16 h-1 bg-slate-700 rounded-full mt-0.5 ml-auto">
                    <div
                      className={`h-1 rounded-full ${SENT_BAR[item.sentiment]}`}
                      style={{ width: `${item.confidence}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
