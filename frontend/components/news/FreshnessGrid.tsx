"use client";
/**
 * "What changed since yesterday" — every scraper key from health.json
 * grouped into editorial categories, each a coloured chip showing the
 * latest update timestamp. Today's refreshes pulse softly so the eye
 * lands on them first.
 *
 * Reuses the same colour ramp the CertifiedStocksFreshness component
 * already uses: green ≤ 1d · amber ≤ 3d · orange ≤ 7d · rose > 35d · grey
 * if missing. Per-scraper labels + thresholds mirror DataHealthBar's
 * SCRAPER_CONFIGS dictionary so adding a new scraper key only needs
 * adding it to the SCRAPER_META table below — no editor change needed.
 */
import { useEffect, useState } from "react";

interface HealthData {
  generated_at?: string | null;
  scrapers?: Record<string, string | null>;
}

// Editorial categories the news desk groups feeds under. Order = display order.
const CATEGORY_ORDER = [
  "Futures",
  "COT",
  "Weather",
  "Supply (origins)",
  "Demand & stocks",
  "ENSO",
  "Freight",
  "Fertilizer",
  "Macro",
  "Other",
] as const;
type Category = (typeof CATEGORY_ORDER)[number];

// scraper key → {label, category, thresholdDays}. Labels mirror DataHealthBar;
// thresholds are normalised to days for the chip tooltip. Unknown keys fall
// through to "Other" with a 30-day threshold (lets a new scraper never
// silently disappear from the daily-newspaper view).
const SCRAPER_META: Record<string, { label: string; category: Category; thresholdDays: number }> = {
  futures:              { label: "Barchart futures",      category: "Futures",          thresholdDays:  2  },
  cot:                  { label: "CFTC COT",              category: "COT",              thresholdDays:  8  },
  macro_cot:            { label: "Macro COT",             category: "COT",              thresholdDays:  8  },
  freight:              { label: "Freight rates",         category: "Freight",          thresholdDays:  2  },
  weather:              { label: "Origin weather",        category: "Weather",          thresholdDays:  2  },
  enso:                 { label: "NOAA ENSO ONI",         category: "ENSO",             thresholdDays: 35  },
  fertilizer_wb:        { label: "World Bank fert.",      category: "Fertilizer",       thresholdDays: 35  },
  fertilizer_comex:     { label: "Comex fert.",           category: "Fertilizer",       thresholdDays: 35  },
  ecf:                  { label: "ECF stocks",            category: "Demand & stocks",  thresholdDays: 70  },
  psd_coffee:           { label: "USDA PSD",              category: "Demand & stocks",  thresholdDays: 70  },
  ajca:                 { label: "AJCA Japan stocks",     category: "Demand & stocks",  thresholdDays: 35  },
  conab_costs:          { label: "CONAB costs",           category: "Supply (origins)", thresholdDays: 35  },
  conab_safra:          { label: "CONAB safra",           category: "Supply (origins)", thresholdDays: 35  },
  cecafe_daily:         { label: "Cecafé daily",          category: "Supply (origins)", thresholdDays:  2  },
  brazil_exports:       { label: "BR exports",            category: "Supply (origins)", thresholdDays: 35  },
  colombia_exports:     { label: "CO exports",            category: "Supply (origins)", thresholdDays:  3  },
  honduras_exports:     { label: "HN exports",            category: "Supply (origins)", thresholdDays:  3  },
  ethiopia_exports:     { label: "ET exports",            category: "Supply (origins)", thresholdDays:  3  },
  vietnam_exports:      { label: "VN exports",            category: "Supply (origins)", thresholdDays:  3  },
  indonesia_exports:    { label: "ID exports",            category: "Supply (origins)", thresholdDays:  3  },
  uganda_exports:       { label: "UG exports",            category: "Supply (origins)", thresholdDays:  3  },
  vietnam_price:        { label: "VN domestic price",     category: "Supply (origins)", thresholdDays:  3  },
  origin_prices:        { label: "Origin price hub",      category: "Supply (origins)", thresholdDays:  3  },
  quant_currency_index: { label: "Currency index",        category: "Macro",            thresholdDays:  3  },
  retail_cpi:           { label: "Retail CPI",            category: "Macro",            thresholdDays: 35  },
  fx_history:           { label: "FX history",            category: "Macro",            thresholdDays:  3  },
};

function _ageDays(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const padded = iso.length === 7 ? `${iso}-28` : iso;
  const t = new Date(padded).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

function _tone(days: number | null, threshold: number): string {
  if (days == null) return "text-slate-700 border-slate-800 bg-slate-900";
  if (days <= 1)              return "text-emerald-300 border-emerald-800/60 bg-emerald-950/40";
  if (days <= 3)              return "text-amber-300   border-amber-800/60   bg-amber-950/40";
  if (days <= 7)              return "text-orange-300  border-orange-800/60  bg-orange-950/40";
  if (days <= threshold)      return "text-slate-300   border-slate-700      bg-slate-900";
  return                             "text-rose-300    border-rose-800/60    bg-rose-950/40";
}

function _ageStr(days: number | null): string {
  if (days == null) return "—";
  if (days === 0)   return "today";
  if (days === 1)   return "1d ago";
  if (days <= 60)   return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

interface ChipProps { skey: string; iso: string | null; now: Date; }

function FeedChip({ skey, iso, now }: ChipProps) {
  const meta = SCRAPER_META[skey] ?? { label: skey, category: "Other" as Category, thresholdDays: 30 };
  const days = _ageDays(iso, now);
  const pulse = days === 0 ? "animate-pulse-soft" : "";
  return (
    <span
      title={iso
        ? `${meta.label} · latest = ${iso} · ${_ageStr(days)}\nThreshold: ${meta.thresholdDays}d`
        : `${meta.label} · no data`}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-mono ${_tone(days, meta.thresholdDays)} ${pulse}`}
    >
      <span className="opacity-75 uppercase tracking-wider truncate max-w-[10rem]">{meta.label}</span>
      <span>{iso ? _ageStr(days) : "—"}</span>
    </span>
  );
}

export default function FreshnessGrid() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    fetch(`/data/health.json?_=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error("health 404"); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (!now) return null;
  if (error) {
    return <div className="text-xs text-slate-500 italic">Freshness signal unavailable — health.json missing.</div>;
  }
  if (!data) return <div className="text-xs text-slate-500 animate-pulse">Reading freshness…</div>;

  const scrapers = data.scrapers ?? {};

  // Group keys by editorial category. Unknown keys land in "Other" so a new
  // scraper never silently disappears.
  const byCategory = new Map<Category, [string, string | null][]>();
  for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
  for (const [key, iso] of Object.entries(scrapers)) {
    const cat = (SCRAPER_META[key]?.category ?? "Other") as Category;
    byCategory.get(cat)!.push([key, iso]);
  }
  // Sort within each category by most-recent first.
  for (const list of Array.from(byCategory.values())) {
    list.sort((a: [string, string | null], b: [string, string | null]) =>
      (b[1] ?? "").localeCompare(a[1] ?? ""),
    );
  }

  // Summary line: count refreshed today / stale (> threshold) / missing.
  let nToday = 0, nStale = 0, nMissing = 0;
  for (const [k, iso] of Object.entries(scrapers)) {
    const meta = SCRAPER_META[k] ?? { thresholdDays: 30 };
    const d = _ageDays(iso, now);
    if (d == null) nMissing++;
    else if (d === 0) nToday++;
    else if (d > meta.thresholdDays) nStale++;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Hot off the press
          <span className="ml-2 font-normal normal-case text-[10px] text-slate-500">
            data freshness across every feed
          </span>
        </h2>
        <div className="text-[10px] text-slate-400 font-mono">
          <span className="text-emerald-300">{nToday}</span> today ·{" "}
          <span className="text-rose-300">{nStale}</span> stale ·{" "}
          <span className="text-slate-500">{nMissing}</span> missing
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CATEGORY_ORDER.map((cat) => {
          const list = byCategory.get(cat) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={cat} className="bg-slate-900 border border-slate-700 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{cat}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map(([key, iso]) => (
                  <FeedChip key={key} skey={key} iso={iso} now={now} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* tiny CSS for a calmer pulse than tailwind's default */}
      <style jsx>{`
        :global(.animate-pulse-soft) {
          animation: pulseSoft 2.4s ease-in-out infinite;
        }
        @keyframes pulseSoft {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
          50%      { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
        }
      `}</style>
    </section>
  );
}
