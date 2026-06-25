"use client";
import { useEffect, useState } from "react";
import { fetchNews, type NewsItem } from "@/lib/api";
import SentimentPill from "@/components/news/SentimentPill";

const CATEGORIES = ["all", "supply", "demand", "macro", "general"];
// Sentiment filter exposes the Gemini classification surface. "any" = no
// filter; "classified" = anything Gemini scored (vs. older items still
// awaiting classification); the three verdicts narrow further.
const SENT_FILTERS = ["any", "classified", "Bullish", "Bearish", "Neutral"] as const;
type SentFilter = typeof SENT_FILTERS[number];

const BORDER_COLORS: Record<string, string> = {
  supply: "border-red-500",
  demand: "border-yellow-500",
  macro: "border-blue-500",
  general: "border-gray-500",
};

/**
 * Source-specific extractors. Each one knows the exact body format produced
 * by its scraper and returns the headline data label for that source. The
 * dispatcher below tries the source's extractor first, then falls back to
 * the generic regex chain.
 *
 * Adding a new source: pin the body format the scraper writes, add an entry
 * here keyed by NewsItem.source, return a short label string (we keep the
 * "X UNIT" / "X UNIT / per" shape so the rendered chip stays compact).
 *
 * If you change a scraper's body format, update its extractor here AND in
 * backend/scraper/morning_brief.py — the Telegram brief uses a Python mirror.
 */
const SOURCE_EXTRACTORS: Record<string, (body: string) => string | null> = {
  // UCDA — "Uganda Fine Robusta Screen 15 price: 166.97 USD/cwt"
  "UCDA": (body) => {
    const m = body.match(/([\d.,]+)\s*USD\s*\/\s*cwt/i);
    return m ? `${m[1]} USD / cwt` : null;
  },
  // Giacaphe — "Vietnam Robusta price: 87.100 VND/kg"
  "Giacaphe": (body) => {
    const m = body.match(/([\d.,]+)\s*VND\s*\/\s*kg/i);
    return m ? `${m[1]} VND / kg` : null;
  },
  // B3 — "B3 Arabica 4/5 settlement: 360.30 USD/sac | OI: 12345 ..."
  "B3": (body) => {
    const m = body.match(/([\d.,]+)\s*USD\s*\/\s*sac/i);
    return m ? `${m[1]} USD / sac` : null;
  },
  // Cooabriel — "Conilon Tipo 7 price: R$ 900,00/saca"
  "Cooabriel": (body) => {
    const m = body.match(/R\$\s*([\d.,]+)\s*\/\s*saca/i);
    return m ? `${m[1]} BRL / saca` : null;
  },
  // CEPEA/ESALQ — "CEPEA Arabica price: R$ 1.234,50/sack (DD/MM/YYYY)"
  "CEPEA/ESALQ": (body) => {
    const m = body.match(/R\$\s*([\d.,]+)\s*\/\s*sack/i);
    return m ? `${m[1]} BRL / sack` : null;
  },
  // AJCA — "AJCA Japan 2024: imports=359382 MT, consumption=397272 MT"
  "AJCA": (body) => {
    const imp = body.match(/imports\s*=\s*([\d.,]+)\s*MT/i);
    const con = body.match(/consumption\s*=\s*([\d.,]+)\s*MT/i);
    if (imp && con) return `imp ${imp[1]} / cons ${con[1]} MT`;
    if (imp) return `imports ${imp[1]} MT`;
    if (con) return `consumption ${con[1]} MT`;
    return null;
  },
  // Retail CPI — body is updated by retail_cpi.py to include the YoY numbers
  "Retail CPI": (body) => {
    const m = body.match(/US:\s*([+-]?[\d.,]+%)[^E]*EU:\s*([+-]?[\d.,]+%)[^B]*Brazil:\s*([+-]?[\d.,]+%)/i);
    if (m) return `US ${m[1]} · EU ${m[2]} · BR ${m[3]}`;
    return null;
  },
  // UCDA monthly report — "Uganda coffee exports 2026-04: 12345 bags"
  "UCDA_REPORT": (body) => {
    const m = body.match(/([\d.,]+)\s*bags/i);
    return m ? `${m[1]} bags` : null;
  },
};

/**
 * Generic fallback for sources without a specialist extractor.
 * Tries (in order):
 *   - "R$ 1.234,50 / saca" → "1.234,50 BRL / saca"
 *   - "USD 250 / lb"       → "250 USD / lb"
 *   - "$1.50"              → "1.50 USD"
 *   - Numeric magnitudes with units ("123.4 kt", "5.2 mln bags")
 */
function _genericExtract(body: string): string | null {
  // Brazilian real with optional "/unit" — "R$ 900/saca" or "R$ 1.234,50 / sack"
  const brl = body.match(/R\$\s*([\d.,]+)\s*(?:\/\s*([A-Za-zçãáéõ]+))?/);
  if (brl) {
    const unit = brl[2] ? ` / ${brl[2]}` : "";
    return `${brl[1]} BRL${unit}`;
  }

  // USD prefix — "USD 250.5/lb"
  const usd = body.match(/USD\s*([\d.,]+)\s*(?:\/\s*([A-Za-z]+))?/);
  if (usd) {
    const unit = usd[2] ? ` / ${usd[2]}` : "";
    return `${usd[1]} USD${unit}`;
  }

  // Bare dollar sign — "$1.50"
  const usdSign = body.match(/\$\s*([\d.,]+)\s*(?:\/\s*([A-Za-z]+))?/);
  if (usdSign) {
    const unit = usdSign[2] ? ` / ${usdSign[2]}` : "";
    return `${usdSign[1]} USD${unit}`;
  }

  // Volume-style magnitudes — "123.4 kt", "5.2 mln bags", "4.5 million tonnes"
  const vol = body.match(/(\d[\d.,]*)\s*(kt|mln|million|thousand|bags|tonnes|t|k_bags)/i);
  if (vol) {
    return `${vol[1]} ${vol[2]}`;
  }

  return null;
}

/**
 * Extract the most informative data label from a news item.
 * Tries a source-specific extractor first (matches NewsItem.source), then
 * falls back to a generic regex chain. Returns null if no label can be
 * extracted — caller falls back to title-only rendering.
 */
function extractDataLabel(item: { body?: string | null; source?: string | null }): string | null {
  const body = item.body;
  if (!body) return null;
  const source = item.source;
  if (source && SOURCE_EXTRACTORS[source]) {
    const sourceLabel = SOURCE_EXTRACTORS[source](body);
    if (sourceLabel) return sourceLabel;
  }
  return _genericExtract(body);
}

interface NewsFeedProps {
  initialNews?: NewsItem[];
}

export default function NewsFeed({ initialNews = [] }: NewsFeedProps) {
  const [items, setItems] = useState<NewsItem[]>(initialNews);
  const [filter, setFilter] = useState("all");
  const [sentFilter, setSentFilter] = useState<SentFilter>("any");

  useEffect(() => {
    if (initialNews.length === 0) {
      fetchNews().then(setItems).catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function itemDate(item: NewsItem): number {
    const m = item.title?.match(/[–-]\s*(\d{4}-\d{2}-\d{2})\s*$/);
    if (m) return new Date(m[1]).getTime();
    return new Date(item.pub_date ?? 0).getTime();
  }

  const filtered = items
    .filter((i) => filter === "all" || i.category === filter)
    .filter((i) => {
      if (sentFilter === "any")        return true;
      if (sentFilter === "classified") return i.sentiment != null;
      return i.sentiment === sentFilter;
    })
    .slice()
    .sort((a, b) => itemDate(b) - itemDate(a));

  return (
    <div className="h-48 border-t border-slate-700 bg-slate-900/90 flex flex-col shrink-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 shrink-0 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-xs px-2 py-1 rounded capitalize transition-colors ${
              filter === cat
                ? "bg-slate-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
        <span className="w-px h-4 bg-slate-700 mx-1" />
        {SENT_FILTERS.map((sf) => (
          <button
            key={sf}
            onClick={() => setSentFilter(sf)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              sentFilter === sf
                ? "bg-amber-700/80 text-amber-100"
                : "text-slate-400 hover:text-amber-300"
            }`}
            title={sf === "classified" ? "Show only items the Gemini classifier scored" : undefined}
          >
            {sf}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto flex-1 px-4 py-2 space-y-2">
        {filtered.length === 0 && (
          <div className="text-slate-500 text-xs italic text-center mt-4">No items</div>
        )}
        {filtered.map((item) => {
          const pubDate = item.pub_date
            ? new Date(item.pub_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : null;
          const hashtag = item.category === "general" && item.source
            ? "#" + item.source.toLowerCase().replace(/\s+/g, "")
            : null;
          const dataLabel = extractDataLabel(item);

          return (
            <div
              key={item.id}
              className={`border-l-2 pl-3 text-xs ${BORDER_COLORS[item.category] || "border-gray-500"}`}
            >
              {item.sentiment && (
                <span className="mr-1.5 align-middle">
                  <SentimentPill sentiment={item.sentiment} confidence={item.sentiment_confidence} />
                </span>
              )}
              <span className="font-bold text-white">{item.title}</span>
              {dataLabel && (
                <span className="text-amber-400 ml-1.5 font-mono">: {dataLabel}</span>
              )}
              {pubDate && (
                <span className="text-slate-500 ml-2">{pubDate}</span>
              )}
              {hashtag && (
                <span className="text-slate-600 ml-2">{hashtag}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
