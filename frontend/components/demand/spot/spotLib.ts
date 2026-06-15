// Shared helpers + types for the Spot tab visualizations.
// Source data: frontend/public/data/spot_coffee.json (offers),
// spot_coffee_history.json (weekly snapshots), ecf_history.json (ECF stocks).

export type Unit = "mt" | "bags";
export const KG_PER_BAG = 60;

export interface SpotRow {
  Type: string; Bags: string; Tons: string; Origin: string;
  Quality: string; "Quality cont.": string; Crop: string;
  Certification: string; "add. Information": string; Port: string;
  Warehouse: string; Terms: string; Price: string;
  [k: string]: string;
}
export interface SpotData {
  as_of: string; generated_at: string; source_url: string;
  by_type: Record<string, number>; headers: string[];
  rows: SpotRow[]; row_count: number;
}
export interface Wow {
  prev_date: string; in_offers: number; out_offers: number;
  in_tons: number; out_tons: number; net_tons: number;
  in_tons_by_type: Record<string, number>; out_tons_by_type: Record<string, number>;
}
export interface Snapshot {
  date: string; n_offers: number;
  offers_by_type: Record<string, number>;
  tons_by_type: Record<string, number>; tons_total: number;
  bags_by_type: Record<string, number>; bags_total: number;
  wow: Wow | null;
}
export interface History { snapshots: Snapshot[] }

// "1.234,50" / "92,00" / "700" → number. European decimal comma.
export function parseEuro(s: string): number {
  const t = (s || "").trim();
  if (!t) return 0;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : 0;
}

// Offer volume in metric tonnes (Tons col, else Bags × 60 kg).
export function offerTons(r: SpotRow): number {
  const t = parseEuro(r.Tons);
  if (t) return t;
  return parseEuro(r.Bags) * KG_PER_BAG / 1000;
}
export function offerVol(r: SpotRow, unit: Unit): number {
  const t = offerTons(r);
  return unit === "mt" ? t : (t * 1000) / KG_PER_BAG;
}
export const unitLabel = (u: Unit) => (u === "mt" ? "t" : "bags");
export function fmtVol(n: number, u: Unit): string {
  if (u === "bags") return Math.round(n).toLocaleString();
  return n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1);
}

// Stable origin colour — keyed list first, hash fallback.
const ORIGIN_COLORS: Record<string, string> = {
  BRAZIL: "#16a34a", VIETNAM: "#ca8a04", COLOMBIA: "#dc2626", INDONESIA: "#7c3aed",
  ETHIOPIA: "#ea580c", HONDURAS: "#f59e0b", GUATEMALA: "#0891b2", BURUNDI: "#14b8a6",
  CONGO: "#a855f7", CHINA: "#ef4444", "COSTA RICA": "#eab308", "DOM REP": "#f43f5e",
  PERU: "#84cc16", UGANDA: "#22c55e", KENYA: "#06b6d4", INDIA: "#8b5cf6",
  TANZANIA: "#10b981", NICARAGUA: "#fb7185", MEXICO: "#38bdf8", PNG: "#4ade80",
  RWANDA: "#2dd4bf", SALVADOR: "#fbbf24", LAOS: "#c084fc", TIMOR: "#facc15",
  VENEZUELA: "#f97316", ZAMBIA: "#a3e635",
};
const PALETTE = ["#64748b", "#0ea5e9", "#f472b6", "#a3e635", "#e879f9", "#2dd4bf", "#fbbf24", "#fb923c"];
export function originColor(o: string): string {
  const k = (o || "").trim().toUpperCase();
  if (ORIGIN_COLORS[k]) return ORIGIN_COLORS[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Price: "minus 35"/"plus 37" → differential; "€/kg 5,71" etc → outright.
const ABS_UNITS = ["€/kg", "USD/mt", "cts/lb", "lvl"];
export interface PriceInfo { kind: "diff" | "abs"; diff: number | null; text: string; cls: string }
export function parsePrice(raw: string): PriceInfo {
  const s = (raw || "").trim();
  const low = s.toLowerCase();
  if (low.startsWith("minus ")) {
    const v = parseEuro(s.slice(6));
    return { kind: "diff", diff: -v, text: `−${s.slice(6).trim()}`, cls: "text-rose-300" };
  }
  if (low.startsWith("plus ")) {
    const v = parseEuro(s.slice(5));
    return { kind: "diff", diff: v, text: `+${s.slice(5).trim()}`, cls: "text-emerald-300" };
  }
  for (const u of ABS_UNITS) {
    if (low.startsWith(u.toLowerCase())) {
      return { kind: "abs", diff: null, text: `${s.slice(u.length).trim()} ${u}`, cls: "text-sky-300" };
    }
  }
  return { kind: "abs", diff: null, text: s, cls: "text-slate-300" };
}

// Crop-year freshness tier from the Crop column ("2025/26", "2026", "past", "").
export interface CropTier { year: number | null; label: string; color: string }
export function cropTier(crop: string): CropTier {
  const m = (crop || "").match(/(20\d{2})/);
  if (!m) return { year: null, label: "n/a", color: "#475569" };
  const y = parseInt(m[1], 10);
  if (y >= 2025) return { year: y, label: "fresh", color: "#34d399" };
  if (y === 2024) return { year: y, label: "recent", color: "#a3e635" };
  if (y === 2023) return { year: y, label: "older", color: "#fbbf24" };
  return { year: y, label: "old", color: "#fb7185" };
}

export function uniq(xs: string[]): string[] {
  const out: string[] = [];
  for (const x of xs) if (!out.includes(x)) out.push(x);
  return out;
}
