const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL;
export const API_URL = RAW_API_URL || "http://localhost:8000";

// Browser-side guard: if NEXT_PUBLIC_API_URL was not baked into the build, the
// app will silently try to talk to localhost from the user's machine. Surface
// it loudly in DevTools so misconfigured deploys are obvious.
if (typeof window !== "undefined" && !RAW_API_URL && window.location.hostname !== "localhost") {
  // eslint-disable-next-line no-console
  console.error(
    "[api] NEXT_PUBLIC_API_URL is not set — falling back to http://localhost:8000. " +
    "Set it in your hosting provider's environment variables and redeploy."
  );
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
// Map preserves insertion order — re-inserting a key on hit makes it the most
// recent, so eviction below targets the oldest entry. Bounded so the cache
// can't grow indefinitely on a long-lived tab.
const _cache = new Map<string, { data: any; ts: number }>();

async function apiGet(path: string, init?: RequestInit): Promise<any> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fetch failed: ${res.status} ${url} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function cachedFetch(path: string): Promise<any> {
  const url = `${API_URL}${path}`;
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    _cache.delete(url);
    _cache.set(url, hit);
    return hit.data;
  }
  const data = await apiGet(path);
  _cache.set(url, { data, ts: Date.now() });
  if (_cache.size > CACHE_MAX_ENTRIES) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  return data;
}

export function clearApiCache(): void {
  _cache.clear();
}

export async function fetchMapCountries() {
  return apiGet("/api/map/countries", { cache: "no-store" });
}

export async function fetchMapFactories() {
  return apiGet("/api/map/factories", { cache: "no-store" });
}

export async function fetchStocks(): Promise<{ date: string; value: number }[]> {
  return cachedFetch("/api/stocks");
}

export async function fetchNews(category?: string) {
  const path = category ? `/api/news?category=${encodeURIComponent(category)}` : "/api/news";
  // no-store: bypass Next.js Data Cache so SSR always gets fresh news
  return apiGet(path, { cache: "no-store" });
}

export async function fetchFreight() {
  return cachedFetch("/api/freight");
}

export interface CotMarketRow {
  pmpu_long: number | null;   pmpu_short: number | null;
  swap_long: number | null;   swap_short: number | null;   swap_spread: number | null;
  mm_long: number | null;     mm_short: number | null;     mm_spread: number | null;
  other_long: number | null;  other_short: number | null;  other_spread: number | null;
  nr_long: number | null;     nr_short: number | null;
  oi_total?: number | null;
}

export interface CotWeekly {
  date: string;
  ny:  CotMarketRow | null;
  ldn: CotMarketRow | null;
}

export async function fetchCot(after?: string): Promise<CotWeekly[]> {
  const path = after ? `/api/cot?after=${encodeURIComponent(after)}` : "/api/cot";
  return cachedFetch(path);
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
  const path = after ? `/api/macro-cot?after=${encodeURIComponent(after)}` : "/api/macro-cot";
  return cachedFetch(path);
}
