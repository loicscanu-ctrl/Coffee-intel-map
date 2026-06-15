"use client";
import { useEffect, useState } from "react";

interface HealthData {
  generated_at: string;
  scrapers: Record<string, string | null>;
}

interface ScraperConfig {
  key: string;
  label: string;
  thresholdHours: number;
}

// Thresholds reflect each feed's actual publication cadence, not generic
// "old data" timers. A monthly publication 25 days old is mid-cycle normal,
// not stale; a daily M-F feed 5 days old IS stale. See FreshnessGrid.tsx
// for the matching set on the News page.
//
// Conventions:
//   Daily M-F sources → 96h (4 days), tolerates weekend non-publication.
//   Weekly COT → 264h (11 days). COT releases Fri with Tue data (3-day
//     baseline lag); worst-case = Fri-evening-pre-next-release = 3+7 = 10d.
//   Monthly → 720h (30 days). Reflects standard month-end-to-month-end.
//   Bi-monthly / quarterly → 1440h+ (60 days+).
const SCRAPER_CONFIGS: ScraperConfig[] = [
  // Futures / market data
  { key: "futures",           label: "Barchart",   thresholdHours:  96 }, // daily M-F (weekend skip)
  { key: "cot",               label: "COT",        thresholdHours: 264 }, // 11d: Fri release of Tue data, worst-case 3+7
  { key: "macro_cot",         label: "Macro COT",  thresholdHours: 264 },
  { key: "freight",           label: "Freight",    thresholdHours: 216 }, // Fri+Sun publish, weekly index date (see check-scrapers-freshness.yml)
  // Weather / macro
  { key: "weather",           label: "Weather",    thresholdHours:  72 }, // daily 7-day cron
  { key: "enso",              label: "ENSO",       thresholdHours: 720 }, // monthly
  { key: "fx_history",        label: "FX",         thresholdHours:  96 }, // Mon-Fri quant-currency-index
  { key: "quant_currency_index", label: "CCI",     thresholdHours:  96 }, // sibling of fx_history
  { key: "us_cpi",            label: "US CPI",     thresholdHours: 840 }, // monthly BLS, 35d buffer
  { key: "retail_cpi",        label: "Retail CPI", thresholdHours: 840 }, // monthly BLS/Eurostat/BCB
  { key: "origin_prices",     label: "Origin Prices", thresholdHours: 96 }, // accumulator, runs in 1.4
  // Fertilizer
  { key: "fertilizer_wb",     label: "Fert. WB",   thresholdHours: 720 }, // monthly Pink Sheet
  { key: "fertilizer_comex",  label: "Fert. Comex",thresholdHours: 720 }, // monthly
  // Demand stocks
  { key: "ecf",               label: "ECF",        thresholdHours: 1440 }, // bi-monthly
  { key: "psd_coffee",        label: "USDA PSD",   thresholdHours: 2160 }, // ~quarterly (Jan, May, Jun, Dec)
  { key: "ajca",              label: "AJCA",       thresholdHours: 720 }, // monthly
  { key: "ice_certified_daily",       label: "ICE Cert. Daily",   thresholdHours: 144 }, // Mon-Fri T-1
  { key: "ice_arabica_ageing",        label: "ICE Arabica Age.",  thresholdHours: 912 }, // monthly, 38d buffer for missed-window
  { key: "ice_robusta_age_allowance", label: "ICE Robusta Age.",  thresholdHours: 912 },
  // Farmer economics (Brazil)
  { key: "conab_costs",       label: "CONAB Costs",thresholdHours: 720 }, // monthly
  { key: "conab_safra",       label: "CONAB Safra",thresholdHours: 720 }, // monthly safra release
  // Origin export data
  { key: "cecafe_daily",      label: "Cecafe Daily",thresholdHours: 96 }, // daily M-F + Brazilian holidays
  { key: "brazil_exports",    label: "BR Exports", thresholdHours: 720 }, // monthly (Cecafé export report ~15th)
  { key: "colombia_exports",  label: "CO Exports", thresholdHours:  96 }, // daily cumulative
  { key: "honduras_exports",  label: "HN Exports", thresholdHours:  96 },
  { key: "ethiopia_exports",  label: "ET Exports", thresholdHours:  96 },
  { key: "vietnam_exports",   label: "VN Exports", thresholdHours:  96 },
  { key: "vietnam_price",     label: "VN Price",   thresholdHours:  96 }, // daily giacaphe domestic survey
  { key: "indonesia_exports", label: "ID Exports", thresholdHours:  96 },
  { key: "uganda_exports",    label: "UG Exports", thresholdHours:  96 },
];

function fmtAge(isoTimestamp: string): string {
  const ms = Date.now() - Date.parse(isoTimestamp);
  const h = ms / 3_600_000;
  if (h < 1)   return `${Math.round(h * 60)}m`;
  if (h < 24)  return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

type Status = "ok" | "stale" | "unknown";

function dotColor(s: Status) {
  if (s === "ok")      return "bg-green-500";
  if (s === "stale")   return "bg-amber-400";
  return "bg-slate-600";
}

export function DataHealthBar({ keys }: { keys?: string[] }) {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    fetch(`/data/health.json?_=${Date.now()}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setHealth(d))
      .catch(() => {});
  }, []);

  if (!health) return null;

  const configs = keys
    ? SCRAPER_CONFIGS.filter(c => keys.includes(c.key))
    : SCRAPER_CONFIGS;

  const items = configs.map(c => {
    const ts = health.scrapers[c.key];
    let status: Status = "unknown";
    if (ts) {
      const hoursOld = (Date.now() - Date.parse(ts)) / 3_600_000;
      status = hoursOld > c.thresholdHours ? "stale" : "ok";
    }
    return { ...c, ts, status };
  });

  const hasStale = items.some(i => i.status === "stale");

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 rounded text-[10px] border ${
      hasStale
        ? "bg-amber-950/30 border-amber-800/40"
        : "bg-slate-900 border-slate-800"
    }`}>
      <span className="text-slate-500 font-medium shrink-0">Data freshness</span>
      {items.map(item => (
        <span key={item.key} className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor(item.status)}`} />
          <span className={item.status === "stale" ? "text-amber-400" : "text-slate-400"}>
            {item.label}
            {item.ts && <span className="text-slate-600 ml-0.5">{fmtAge(item.ts)}</span>}
          </span>
        </span>
      ))}
    </div>
  );
}
