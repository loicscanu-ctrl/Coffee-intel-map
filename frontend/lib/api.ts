const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Simple in-memory TTL cache (5 minutes) for client-side fetches.
// Avoids re-fetching on tab switch for slow endpoints like /api/cot and /api/macro-cot.
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map<string, { data: any; ts: number }>();

async function cachedFetch(url: string): Promise<any> {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  const data = await res.json();
  _cache.set(url, { data, ts: Date.now() });
  return data;
}

export async function fetchMapCountries() {
  return cachedFetch(`${API_URL}/api/map/countries`);
}

export async function fetchMapFactories() {
  return cachedFetch(`${API_URL}/api/map/factories`);
}

export async function fetchStocks(): Promise<{ date: string; value: number }[]> {
  return cachedFetch(`${API_URL}/api/stocks`);
}

export async function fetchNews(category?: string) {
  const url = category
    ? `${API_URL}/api/news?category=${category}`
    : `${API_URL}/api/news`;
  return cachedFetch(url);
}

export async function fetchFreight() {
  return cachedFetch(`${API_URL}/api/freight`);
}

export async function fetchCot(after?: string): Promise<any[]> {
  const url = after
    ? `${API_URL}/api/cot?after=${encodeURIComponent(after)}`
    : `${API_URL}/api/cot`;
  return cachedFetch(url);
}

export interface MacroCotEntry {
  symbol: string;
  sector: "hard" | "grains" | "meats" | "softs" | "micros";
  name: string;
  mm_long: number;
  mm_short: number;
  mm_spread: number;
  oi_total: number;
  close_price: number | null;
  gross_exposure_usd: number | null;
  net_exposure_usd: number | null;
}

export interface MacroCotWeek {
  date: string;
  commodities: MacroCotEntry[];
}

export async function fetchMacroCot(after?: string): Promise<MacroCotWeek[]> {
  const url = after
    ? `${API_URL}/api/macro-cot?after=${encodeURIComponent(after)}`
    : `${API_URL}/api/macro-cot`;
  return cachedFetch(url);
}
