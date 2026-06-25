// One-liner pill for a Gemini-classified news headline.
// Used wherever a NewsItem renders (map's NewsFeed, news tab's NewsFeedList).
// Returns null when the item carries no sentiment, so callers can drop it
// inline without an extra guard.

interface Props {
  sentiment?: "Bullish" | "Bearish" | "Neutral";
  confidence?: number;
  /** "compact" = letter + colour only (for dense lists); "label" = word + %. */
  variant?: "compact" | "label";
}

const STYLE: Record<NonNullable<Props["sentiment"]>, { bg: string; fg: string; letter: string }> = {
  Bullish: { bg: "bg-emerald-950/70 border-emerald-700/70", fg: "text-emerald-300", letter: "B" },
  Bearish: { bg: "bg-red-950/70 border-red-700/70",          fg: "text-red-300",     letter: "B" },
  Neutral: { bg: "bg-slate-800/80 border-slate-600",          fg: "text-slate-400",   letter: "N" },
};

// Bear vs Bull share a starting letter — distinguish by arrow glyph instead.
const GLYPH: Record<NonNullable<Props["sentiment"]>, string> = {
  Bullish: "▲",
  Bearish: "▼",
  Neutral: "·",
};

export default function SentimentPill({ sentiment, confidence, variant = "compact" }: Props) {
  if (!sentiment) return null;
  const s = STYLE[sentiment];
  if (variant === "compact") {
    return (
      <span
        title={`${sentiment}${confidence != null ? ` · ${Math.round(confidence)}%` : ""}`}
        className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold border ${s.bg} ${s.fg}`}
      >
        {GLYPH[sentiment]}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${s.bg} ${s.fg}`}
    >
      <span>{GLYPH[sentiment]}</span>
      <span>{sentiment}</span>
      {confidence != null && <span className="opacity-70">{Math.round(confidence)}%</span>}
    </span>
  );
}
