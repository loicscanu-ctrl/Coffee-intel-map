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
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const data = await apiGet(path);
  _cache.set(url, { data, ts: Date.now() });
  return data;
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

export async function fetchCot(after?: string): Promise<any[]> {
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
