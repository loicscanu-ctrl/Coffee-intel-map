"use client";
import { useEffect, useState } from "react";

type TickerCategory = "futures" | "physical" | "fx";

interface TickerItem {
  label: string;
  value: string;
  category: TickerCategory;
}

interface AcapheContract {
  month: string;
  last: number | null;
  change: number;
  vol: number | null;
  oi: number | null;
}

interface AcapheData {
  fetched_at: string;
  robusta: AcapheContract[];
  arabica: AcapheContract[];
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function stalenessColor(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "text-emerald-500";
  if (hours < 24) return "text-yellow-500";
  return "text-red-500";
}

// Pick the active front month: highest open interest (persists outside trading hours)
function frontByOI(contracts: AcapheContract[]): AcapheContract | null {
  if (!contracts.length) return null;
  return contracts.reduce((best, c) =>
    (c.oi ?? 0) > (best.oi ?? 0) ? c : best, contracts[0]);
}

// "AN 07/26" → "KCN26", "RN 07/26" → "RMN26"
function acapheLabel(month: string, prefix: "KC" | "RM"): string {
  const parts = month.trim().split(/\s+/);
  if (parts.length < 2) return prefix;
  const letter = parts[0].slice(-1);   // last char of "AN" / "RN"
  const year   = parts[1].slice(-2);   // last 2 chars of "07/26" → "26"
  return `${prefix}${letter}${year}`;
}

async function fetchAcaphe(): Promise<AcapheData | null> {
  try {
    const r = await fetch("/api/live");
    if (r.ok) {
      const d = await r.json();
      if (!d.error && d.robusta && d.arabica) return d as AcapheData;
    }
  } catch { /* fall through */ }
  try {
    const r = await fetch(`/data/acaphe_live.json?_=${Date.now()}`);
    if (r.ok) return await r.json() as AcapheData;
  } catch { /* ignore */ }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarketTicker() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [acaphe, setAcaphe] = useState<AcapheData | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () => Promise.all([
      fetch("/data/latest_prices.json").then(r => r.json()).catch(() => null),
      fetchAcaphe(),
    ]).then(([prices, live]) => {
      setTickers(prices?.tickers ?? []);
      setGeneratedAt(prices?.generated_at ?? null);
      if (live?.arabica && live?.robusta) setAcaphe(live);
    });
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    const tick = setInterval(() => setTick(n => n + 1), 60_000);
    return () => { clearInterval(interval); clearInterval(tick); };
  }, []);

  // Futures tickers: live Acaphe when available, else fall back to static
  const futureTickers: TickerItem[] = (() => {
    if (!acaphe) return tickers.filter(t => t.category === "futures");

    const kc = frontByOI(acaphe.arabica);
    const rc = frontByOI(acaphe.robusta);
    const out: TickerItem[] = [];

    if (kc?.last != null) {
      const sign = kc.change >= 0 ? "+" : "";
      out.push({
        label: acapheLabel(kc.month, "KC"),
        value: `${kc.last.toFixed(2)} (${sign}${kc.change.toFixed(2)})`,
        category: "futures",
      });
    }
    if (rc?.last != null) {
      const sign = rc.change >= 0 ? "+" : "";
      out.push({
        label: acapheLabel(rc.month, "RM"),
        value: `${Math.round(rc.last).toLocaleString()} (${sign}${Math.round(rc.change)})`,
        category: "futures",
      });
    }

    return out.length ? out : tickers.filter(t => t.category === "futures");
  })();

  const otherTickers = tickers.filter(t => t.category !== "futures");
  const allTickers = [...futureTickers, ...otherTickers];

  // Show most-recent timestamp between Acaphe and static file
  const displayTs = (() => {
    if (!acaphe) return generatedAt;
    if (!generatedAt) return acaphe.fetched_at;
    return new Date(acaphe.fetched_at) > new Date(generatedAt)
      ? acaphe.fetched_at
      : generatedAt;
  })();

  if (allTickers.length === 0) return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 flex items-center shrink-0 px-3">
      <span className="text-indigo-400 text-xs font-bold border-r border-slate-700 pr-3 mr-3 shrink-0">MARKETS</span>
      <span className="text-slate-600 text-xs italic">No market data — waiting for scraper</span>
    </div>
  );

  const COLOR: Record<TickerCategory, string> = {
    futures:  "text-yellow-400",
    physical: "text-yellow-600",
    fx:       "text-sky-400",
  };

  const ORDER: TickerCategory[] = ["futures", "physical", "fx"];
  const groups = ORDER
    .map(cat => allTickers.filter(t => t.category === cat))
    .filter(g => g.length > 0);

  const tickerContent = groups.flatMap((group, gi) => {
    const items = group.map((t, i) => (
      <span key={`${t.label}-${i}`} className={`${COLOR[t.category]} font-mono`}>
        {t.label}: {t.value}
        {i < group.length - 1 && <span className="text-slate-500">{"   ·   "}</span>}
      </span>
    ));
    if (gi < groups.length - 1) {
      items.push(<span key={`sep-${gi}`} className="text-slate-500 mx-3">|</span>);
    }
    return items;
  });

  return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 overflow-hidden flex items-center shrink-0">
      <span className="flex flex-col justify-center px-3 shrink-0 border-r border-slate-700 mr-2 leading-none gap-0.5"
        title={displayTs ? `Data as of: ${displayTs}` : undefined}>
        <span className="text-indigo-400 text-xs font-bold">MARKETS</span>
        {displayTs && (
          <span className={`text-[9px] font-mono ${stalenessColor(displayTs)}`}>
            {timeAgo(displayTs)}
          </span>
        )}
      </span>
      <div
        className="overflow-hidden flex-1 relative"
        style={{ cursor: "default" }}
        onMouseEnter={(e) => {
          const track = e.currentTarget.querySelector<HTMLElement>(".ticker-track");
          if (track) track.style.animationPlayState = "paused";
        }}
        onMouseLeave={(e) => {
          const track = e.currentTarget.querySelector<HTMLElement>(".ticker-track");
          if (track) track.style.animationPlayState = "running";
        }}
      >
        <span className="ticker-track text-xs whitespace-nowrap">
          {tickerContent}
        </span>
      </div>
    </div>
  );
}
