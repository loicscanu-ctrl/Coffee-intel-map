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

const SCRAPER_CONFIGS: ScraperConfig[] = [
  { key: "futures",           label: "Futures",    thresholdHours: 36   },
  { key: "cot",               label: "COT",        thresholdHours: 192  }, // 8 days (weekly)
  { key: "macro_cot",         label: "Macro COT",  thresholdHours: 192  },
  { key: "freight",           label: "Freight",    thresholdHours: 48   },
  { key: "weather",           label: "Weather",    thresholdHours: 48   },
  { key: "enso",              label: "ENSO",       thresholdHours: 720  }, // monthly
  { key: "fertilizer_wb",     label: "Fert. WB",   thresholdHours: 720  },
  { key: "fertilizer_comex",  label: "Fert. Comex",thresholdHours: 720  },
  { key: "ice_certified",     label: "ICE Stocks", thresholdHours: 48   },
  { key: "ecf",               label: "ECF",        thresholdHours: 1440 }, // 60 days (monthly publish)
  { key: "psd_japan",         label: "PSD Japan",  thresholdHours: 2160 }, // 90 days (annual publish)
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
