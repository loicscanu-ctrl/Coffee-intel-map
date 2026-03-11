"use client";
import { useEffect, useState } from "react";
import { fetchNews } from "@/lib/api";

interface TickerItem {
  label: string;
  value: string;
}

const MONTH_CODES: Record<string, string> = {
  Jan: "F", Feb: "G", Mar: "H", Apr: "J", May: "K",
  Jun: "M", Jul: "N", Aug: "Q", Sep: "U", Oct: "V", Nov: "X", Dec: "Z",
};

function contractCode(body: string, prefix: string): string {
  const m = body?.match(/Front\s*\([^)]*\((\w{3})\s+'(\d{2})\)\)/);
  if (m) return `${prefix}${MONTH_CODES[m[1]] ?? "?"}${m[2]}`;
  return prefix;
}

function tickerLabel(item: any): string {
  const tags: string[] = item.tags ?? [];
  const title: string = item.title ?? "";
  const body: string = item.body ?? "";

  if (tags.includes("futures") && tags.includes("arabica")) return contractCode(body, "KC");
  if (tags.includes("futures") && tags.includes("robusta")) return contractCode(body, "RC");
  if (title.includes("Vietnam Robusta"))  return "VN FAQ";
  if (title.includes("Conilon Tipo 7"))   return "CON T7";
  if (title.includes("Uganda Screen 15")) return "UGA S15";
  const fx = title.match(/^(USD\/[A-Z]{3})\s+FX/);
  if (fx) return fx[1];
  return title.replace(/\s*[–\-]\s*(seed|\d{4}-\d{2}-\d{2})$/i, "").replace(/\s*\(Cooabriel\)/, "");
}

// ── Price parsers ─────────────────────────────────────────────────────────────

// FX rate from body "USD/XXX FX Rate price: 25,380" or "USD/XXX FX Rate price: 5.81"
function parseFxRate(body: string): number | null {
  const m = body?.match(/price:\s*([\d.,]+)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// VND price from body "Vietnam Robusta price: 94.000 VND/kg"
// "94.000" = Vietnamese thousands → 94,000
function parseVndPrice(body: string): number | null {
  const m = body?.match(/price:\s*([\d.]+)\s*VND\/kg/i);
  if (!m) return null;
  const raw = m[1];
  const n = /^\d{2,3}\.\d{3}$/.test(raw)
    ? parseInt(raw.replace(/\./g, ""), 10)
    : parseFloat(raw);
  return isNaN(n) ? null : n;
}

// BRL price from body "Conilon Tipo 7 price: R$ 1.280,50/saca"
// Brazilian format: dot = thousands, comma = decimal
function parseBrlSaca(body: string): number | null {
  const m = body?.match(/R\$\s*([\d.,]+)\/saca/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

// Uganda price from body "Uganda Fine Robusta Screen 15 price: 175.76 USD/cwt"
function parseUgandaPrice(body: string): number | null {
  const m = body?.match(/price:\s*([\d.]+)\s*USD\/cwt/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isNaN(n) ? null : n;
}

// ── Ticker builder ────────────────────────────────────────────────────────────

function parseTickerItems(items: any[]): TickerItem[] {
  // Build FX rate lookup from all items before filtering
  const vndItem = items.find(i => i.tags?.includes("fx") && i.tags?.includes("vietnam"));
  const brlItem = items.find(i => i.tags?.includes("fx") && i.tags?.includes("brazil"));
  const usdvnd  = vndItem ? parseFxRate(vndItem.body) : null;
  const usdbrl  = brlItem ? parseFxRate(brlItem.body) : null;

  // Deduplicate by label — items are already sorted newest-first by the API,
  // so the first occurrence of each label is the most recent value.
  const seen = new Set<string>();
  const deduped = items
    .filter((item) => item.tags?.includes("price") || item.tags?.includes("fx"))
    .filter((item) => {
      const lbl = tickerLabel(item);
      if (seen.has(lbl)) return false;
      seen.add(lbl);
      return true;
    });

  return deduped.map((item) => {
      const label = tickerLabel(item);
      const match = item.body?.match(/:\s*[^\d]*([0-9.,]+(?:\s+[A-Z][A-Z/a-z]+)?)/);
      let value = match ? match[1] : "—";

      // VN FAQ: "94.000 VND ($3,704)"
      if (label === "VN FAQ" && usdvnd) {
        const vndPrice = parseVndPrice(item.body);
        if (vndPrice) {
          const usdMt = Math.round(vndPrice / usdvnd * 1000);
          // Extract only the leading number (value may be "94.000 VND/kg")
          const rawNum = value.match(/^([\d.,]+)/)?.[1] ?? value;
          value = `${rawNum} VND ($${usdMt.toLocaleString()})`;
        }
      }

      // CON T7: "1.280,50 BRL ($3,673)"
      if (label === "CON T7" && usdbrl) {
        const brlPrice = parseBrlSaca(item.body);
        if (brlPrice) {
          const usdMt = Math.round(brlPrice / usdbrl / 60 * 1000);
          value = `${value} BRL ($${usdMt.toLocaleString()})`;
        }
      }

      // UGA S15: "175.76 ($3,875)"  — formula: price * 22.046
      if (label === "UGA S15") {
        const ugaPrice = parseUgandaPrice(item.body);
        if (ugaPrice) {
          const usdMt = Math.round(ugaPrice * 22.046);
          value = `${ugaPrice.toFixed(2)} ($${usdMt.toLocaleString()})`;
        }
      }

      return { label, value };
    });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarketTicker() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);

  const load = () => {
    fetchNews()
      .then((items) => setTickers(parseTickerItems(items)))
      .catch(console.error);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (tickers.length === 0) return null;

  const tickerText = tickers
    .map((t) => `${t.label}: ${t.value}`)
    .join("   ·   ");

  return (
    <div className="h-8 bg-slate-950 border-b border-slate-800 overflow-hidden flex items-center shrink-0">
      <span className="text-indigo-400 text-xs font-bold px-3 shrink-0 border-r border-slate-700 mr-2">
        MARKETS
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
        <span className="ticker-track text-xs text-slate-300 font-mono">
          {tickerText}
        </span>
      </div>
    </div>
  );
}
