const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchMapCountries() {
  const res = await fetch(`${API_URL}/api/map/countries`);
  if (!res.ok) throw new Error("Failed to fetch countries");
  return res.json();
}

export async function fetchMapFactories() {
  const res = await fetch(`${API_URL}/api/map/factories`);
  if (!res.ok) throw new Error("Failed to fetch factories");
  return res.json();
}

export async function fetchStocks(): Promise<{ date: string; value: number }[]> {
  const res = await fetch(`${API_URL}/api/stocks`);
  if (!res.ok) throw new Error("Failed to fetch certified stocks");
  return res.json();
}

export async function fetchNews(category?: string) {
  const url = category
    ? `${API_URL}/api/news?category=${category}`
    : `${API_URL}/api/news`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch news");
  return res.json();
}

export async function fetchFreight() {
  const res = await fetch(`${API_URL}/api/freight`);
  if (!res.ok) throw new Error("Failed to fetch freight rates");
  return res.json();
}

export async function fetchCot(after?: string): Promise<any[]> {
  const url = after
    ? `${API_URL}/api/cot?after=${encodeURIComponent(after)}`
    : `${API_URL}/api/cot`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch CoT data");
  return res.json();
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`macro-cot fetch failed: ${res.status}`);
  return res.json();
}
