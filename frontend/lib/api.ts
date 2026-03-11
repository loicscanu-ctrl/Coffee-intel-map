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
