// One-liner pill for a classified news headline.
// Used wherever a NewsItem renders (map's NewsFeed, news tab's NewsFeedList).
// Returns null when the item carries no sentiment, so callers can drop it
// inline without an extra guard.
//
// The tooltip composes the reason chain when present:
//   "Bullish · 88%
//    OI snapshot: price up, new longs entering
//    (rule)"
// So the user can see why the verdict landed.

interface Props {
  sentiment?: "Bullish" | "Bearish" | "Neutral";
  confidence?: number;
  /** "compact" = letter + colour only (for dense lists); "label" = word + %. */
  variant?: "compact" | "label";
  /** "deterministic" | "gemini" — drives the (rule) / (LLM) suffix in the tooltip. */
  method?: "deterministic" | "gemini";
  /** Short rule-fired explanation; only present when method === "deterministic". */
  reason?: string;
}

const STYLE: Record<NonNullable<Props["sentiment"]>, { bg: string; fg: string }> = {
  Bullish: { bg: "bg-emerald-950/70 border-emerald-700/70", fg: "text-emerald-300" },
  Bearish: { bg: "bg-red-950/70 border-red-700/70",          fg: "text-red-300"     },
  Neutral: { bg: "bg-slate-800/80 border-slate-600",          fg: "text-slate-400"   },
};

const GLYPH: Record<NonNullable<Props["sentiment"]>, string> = {
  Bullish: "▲",
  Bearish: "▼",
  Neutral: "·",
};

function buildTooltip(sentiment: NonNullable<Props["sentiment"]>, confidence?: number, method?: Props["method"], reason?: string): string {
  const parts: string[] = [sentiment];
  if (confidence != null) parts.push(`${Math.round(confidence)}%`);
  let line = parts.join(" · ");
  if (reason) line += `\n${reason}`;
  if (method) line += `\n(${method === "deterministic" ? "rule" : "LLM"})`;
  return line;
}

export default function SentimentPill({ sentiment, confidence, variant = "compact", method, reason }: Props) {
  if (!sentiment) return null;
  const s = STYLE[sentiment];
  const tooltip = buildTooltip(sentiment, confidence, method, reason);
  if (variant === "compact") {
    return (
      <span
        title={tooltip}
        className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold border ${s.bg} ${s.fg}`}
      >
        {GLYPH[sentiment]}
      </span>
    );
  }
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${s.bg} ${s.fg}`}
    >
      <span>{GLYPH[sentiment]}</span>
      <span>{sentiment}</span>
      {confidence != null && <span className="opacity-70">{Math.round(confidence)}%</span>}
    </span>
  );
}
