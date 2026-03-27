# Performance & Loading Speed Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate perceived loading lag across all tabs by adding backend caching headers, moving fetches server-side where possible, and adding skeleton loaders.

**Architecture:** Three-layer approach — (1) Backend adds `Cache-Control` headers and row limits so responses are small and browser-cacheable; (2) Frontend pages that are currently client-side-fetching move to async server components that pre-load data before HTML reaches the browser; (3) All "Loading…" text replaced with skeleton placeholders for instant layout stability.

**Tech Stack:** FastAPI (Python), Next.js 14 App Router (TypeScript), Recharts, Tailwind CSS

---

## Chunk 1: Backend — Cache-Control headers + news row limit

### Task 1: Add `Cache-Control` response headers to all FastAPI routes

**Files:**
- Modify: `backend/routes/news.py`
- Modify: `backend/routes/map.py`
- Modify: `backend/routes/freight.py`
- Modify: `backend/routes/cot.py`
- Modify: `backend/routes/macro_cot.py`

The pattern is the same in every route: import `Response` from `fastapi`, accept it as a parameter, set `Cache-Control: public, max-age=300` (5 minutes). This tells the browser to serve the cached response for 5 minutes before re-fetching — eliminating redundant round trips on tab revisits.

- [ ] **Step 1: Update `backend/routes/news.py`**

```python
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models import NewsItem

router = APIRouter(prefix="/api/news", tags=["news"])

@router.get("")
def get_news(response: Response, category: Optional[str] = None, limit: int = 100, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    q = db.query(NewsItem)
    if category:
        q = q.filter(NewsItem.category == category)
    items = q.order_by(NewsItem.pub_date.desc()).limit(limit).all()
    return [
        {
            "id": item.id,
            "title": item.title,
            "body": item.body,
            "source": item.source,
            "category": item.category,
            "lat": item.lat,
            "lng": item.lng,
            "tags": item.tags,
            "meta": item.meta,
            "pub_date": item.pub_date.isoformat() if item.pub_date else None,
        }
        for item in items
    ]
```

- [ ] **Step 2: Update `backend/routes/map.py`**

```python
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from database import get_db
from models import CountryIntel, Factory

router = APIRouter(prefix="/api/map", tags=["map"])

@router.get("/countries")
def get_countries(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    countries = db.query(CountryIntel).all()
    return [{"name": c.name, "type": c.type, "lat": c.lat, "lng": c.lng, "data": c.data} for c in countries]

@router.get("/factories")
def get_factories(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    factories = db.query(Factory).all()
    return [{"name": f.name, "company": f.company, "capacity": f.capacity, "lat": f.lat, "lng": f.lng} for f in factories]
```

- [ ] **Step 3: Update `backend/routes/freight.py`**

Add `response: Response` as the first parameter to the route handler function and set the header at the top of the function body:
```python
@router.get("")
def get_freight(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    # ... rest of existing code unchanged
```

- [ ] **Step 4: Update `backend/routes/cot.py`**

Same pattern — add `response: Response` parameter, set header at top:
```python
@router.get("")
def get_cot(response: Response, after: Optional[str] = None, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    # ... rest of existing code unchanged
```

- [ ] **Step 5: Update `backend/routes/macro_cot.py`**

Same pattern:
```python
@router.get("")
def get_macro_cot(response: Response, after: Optional[str] = None, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    # ... rest of existing code unchanged
```

- [ ] **Step 6: Verify headers are returned**

Start backend (`uvicorn main:app --reload` in `/backend`) and run:
```bash
curl -I http://localhost:8000/api/news
```
Expected output includes: `cache-control: public, max-age=300`

- [ ] **Step 7: Commit**

```bash
git add backend/routes/news.py backend/routes/map.py backend/routes/freight.py backend/routes/cot.py backend/routes/macro_cot.py
git commit -m "perf: add Cache-Control headers and news row limit to all API routes"
```

---

## Chunk 2: Map page — server component pre-load

### Task 2: Lift Map page fetches to async server component

**Files:**
- Modify: `frontend/app/map/page.tsx` → becomes async server component
- Create: `frontend/app/map/MapPageClient.tsx` → client shell (useState for selectedPin)
- Modify: `frontend/components/map/CoffeeMap.tsx` → accept `countries` + `factories` as props
- Modify: `frontend/components/map/MarketTicker.tsx` → accept `initialNews` prop
- Modify: `frontend/components/map/NewsFeed.tsx` → accept `initialNews` prop

**Goal:** All 4 Map page API calls move to the server. The browser receives fully-populated HTML/props — no client-side fetches on page load. MarketTicker keeps its 5-min polling but starts with server-loaded data (no blank flash).

- [ ] **Step 1: Update `CoffeeMap.tsx` to accept props instead of fetching**

Remove the `fetchMapCountries`, `fetchMapFactories`, `fetchNews` imports and internal fetch calls. Accept them as props:

```tsx
"use client";
import { useEffect, useRef } from "react";
import { PORTS, ROUTES, MAP_CONFIG } from "@/lib/mapData";

interface CoffeeMapProps {
  onPinClick?: (item: any) => void;
  countries: any[];
  factories: any[];
  news: any[];
}

export default function CoffeeMap({ onPinClick, countries, factories, news }: CoffeeMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;
    let cancelled = false;

    import("leaflet").then(async (L) => {
      if (cancelled || !mapRef.current || (mapRef.current as any)._leaflet_id) return;
      // @ts-ignore
      import("leaflet/dist/leaflet.css");

      let map;
      try {
        map = (L as any).default
          ? (L as any).default.map(mapRef.current!, { zoomControl: false, fadeAnimation: true }).setView(MAP_CONFIG.initView, MAP_CONFIG.initZoom)
          : (L as any).map(mapRef.current!, { zoomControl: false, fadeAnimation: true }).setView(MAP_CONFIG.initView, MAP_CONFIG.initZoom);
      } catch { return; }

      mapInstanceRef.current = map;
      const Leaflet = (L as any).default || L;

      Leaflet.tileLayer(MAP_CONFIG.theme, {
        attribution: "&copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      Leaflet.control.zoom({ position: "topright" }).addTo(map);

      // Inject flow-dash animation CSS once
      if (!document.getElementById("coffee-flow-anim")) {
        const s = document.createElement("style");
        s.id = "coffee-flow-anim";
        s.textContent = `
          @keyframes flowDash { to { stroke-dashoffset: -20; } }
          .flow-route { stroke-dasharray: 12 8; animation: flowDash 1.4s linear infinite; }
          .flow-route-trunk { stroke-dasharray: 16 8; animation: flowDash 1.8s linear infinite; }
        `;
        document.head.appendChild(s);
      }

      // Logistics routes
      const logisticsLayer = Leaflet.layerGroup().addTo(map);
      ROUTES.forEach((r) => {
        if (r.path && r.path.length > 0) {
          const line = Leaflet.polyline(r.path, { color: r.color, weight: r.weight || 2, opacity: 0.85 })
            .bindTooltip(r.name).addTo(logisticsLayer);
          const el = (line as any)._path;
          if (el) el.classList.add(r.weight && r.weight >= 4 ? "flow-route-trunk" : "flow-route");
        }
      });

      // Ports
      const portsLayer = Leaflet.layerGroup().addTo(map);
      PORTS.forEach((p) => {
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:#0ea5e9;border:2px solid #fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;">⚓</div>`,
          iconSize: [24, 24], iconAnchor: [12, 12],
        });
        Leaflet.marker(p.l, { icon }).bindPopup(`Port of ${p.n}`).addTo(portsLayer);
      });

      // Country pins (use prop data)
      const countriesLayer = Leaflet.layerGroup().addTo(map);
      countries.forEach((c: any) => {
        const isProducer = c.type === "producer";
        const color = isProducer ? "#10b981" : "#3b82f6";
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:12px;height:12px;"></div>`,
          iconSize: [12, 12], iconAnchor: [6, 6],
        });
        const d = c.data || {};
        const statsHtml = isProducer
          ? `<div>PROD: ${d.prod || "—"}</div><div>STOCK: ${d.stock || "—"}</div>`
          : `<div>CONS: ${d.cons || "—"}</div><div>STOCK: ${d.stock || "—"}</div>`;
        Leaflet.marker([c.lat, c.lng], { icon })
          .bindPopup(
            `<div style="font-family:monospace;font-size:12px;background:#0f172a;color:#e2e8f0;padding:8px;border-radius:4px;min-width:160px">` +
            `<b>${c.name}</b><br>${statsHtml}` +
            (d.intel ? `<br><i style="color:#94a3b8">${d.intel}</i>` : "") +
            `</div>`
          ).addTo(countriesLayer);
      });

      // Factory pins (use prop data)
      const factoriesLayer = Leaflet.layerGroup().addTo(map);
      factories.forEach((f: any) => {
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:#6366f1;border:1px solid #fff;border-radius:3px;width:16px;height:16px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;">F</div>`,
          iconSize: [16, 16], iconAnchor: [8, 8],
        });
        Leaflet.marker([f.lat, f.lng], { icon })
          .bindPopup(`<b>${f.name}</b><br>${f.company}<br>${f.capacity ? f.capacity + " MT/yr" : ""}`)
          .addTo(factoriesLayer);
      });

      // News pins (use prop data)
      if (onPinClick) {
        const newsLayer = Leaflet.layerGroup().addTo(map);
        news.filter((item: any) => item.lat && item.lng).forEach((item: any) => {
          const color = { supply: "#ef4444", demand: "#eab308", macro: "#3b82f6", general: "#6b7280" }[item.category as string] || "#6b7280";
          const icon = Leaflet.divIcon({
            className: "",
            html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:10px;height:10px;cursor:pointer;"></div>`,
            iconSize: [10, 10], iconAnchor: [5, 5],
          });
          Leaflet.marker([item.lat, item.lng], { icon })
            .on("click", () => onPinClick(item))
            .addTo(newsLayer);
        });
      }

      if (cancelled) map.remove();
    });

    return () => { cancelled = true; };
  }, [countries, factories, news]);  // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}
```

> **Note:** Read the full current `CoffeeMap.tsx` before editing — the snippet above covers the key structural change (props instead of fetches). Keep any existing sections not shown here (e.g. news pin rendering at lines 130+) and adapt them to use the `news` prop instead of a fetch.

- [ ] **Step 2: Update `MarketTicker.tsx` to accept `initialNews` prop**

Add an `initialNews?: any[]` prop. Use it as the initial state so the ticker renders immediately on first paint, then continues polling:

```tsx
interface MarketTickerProps {
  initialNews?: any[];
}

export default function MarketTicker({ initialNews = [] }: MarketTickerProps) {
  const [tickers, setTickers] = useState<TickerItem[]>(() => parseTickerItems(initialNews));

  const load = () => {
    fetchNews()
      .then((items) => setTickers(parseTickerItems(items)))
      .catch(console.error);
  };

  useEffect(() => {
    // Don't fetch immediately if we already have initial data
    if (initialNews.length === 0) load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ... rest of component unchanged
```

- [ ] **Step 3: Update `NewsFeed.tsx` to accept `initialNews` prop**

```tsx
interface NewsFeedProps {
  initialNews?: any[];
}

export default function NewsFeed({ initialNews = [] }: NewsFeedProps) {
  const [items, setItems] = useState<any[]>(initialNews);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (initialNews.length === 0) {
      fetchNews().then(setItems).catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ... rest of component unchanged
```

- [ ] **Step 4: Create `frontend/app/map/MapPageClient.tsx`**

Extract the client logic (useState for selectedPin, dynamic CoffeeMap import) out of page.tsx:

```tsx
"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import NewsSidebar from "@/components/map/NewsSidebar";
import NewsFeed from "@/components/map/NewsFeed";
import MarketTicker from "@/components/map/MarketTicker";

const CoffeeMap = dynamic(() => import("@/components/map/CoffeeMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
      Loading map...
    </div>
  ),
});

interface MapPageClientProps {
  news: any[];
  countries: any[];
  factories: any[];
}

export default function MapPageClient({ news, countries, factories }: MapPageClientProps) {
  const [selectedPin, setSelectedPin] = useState<any>(null);
  return (
    <div className="w-full h-full flex flex-col">
      <MarketTicker initialNews={news} />
      <div className="flex-1 relative min-h-0">
        <CoffeeMap onPinClick={setSelectedPin} countries={countries} factories={factories} news={news} />
        <NewsSidebar item={selectedPin} onClose={() => setSelectedPin(null)} />
      </div>
      <NewsFeed initialNews={news} />
    </div>
  );
}
```

- [ ] **Step 5: Replace `frontend/app/map/page.tsx` with async server component**

```tsx
import { fetchNews, fetchMapCountries, fetchMapFactories } from "@/lib/api";
import MapPageClient from "./MapPageClient";

export default async function MapPage() {
  const [news, countries, factories] = await Promise.all([
    fetchNews(),
    fetchMapCountries(),
    fetchMapFactories(),
  ]);
  return <MapPageClient news={news} countries={countries} factories={factories} />;
}
```

> **Important:** Remove the `"use client"` directive — this file must be a server component.

- [ ] **Step 6: Verify Map page loads without blank flash**

Navigate to `/map` in the browser. The ticker and news feed should be populated immediately on first paint, with no "Loading…" blank state.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/map/page.tsx frontend/app/map/MapPageClient.tsx frontend/components/map/CoffeeMap.tsx frontend/components/map/MarketTicker.tsx frontend/components/map/NewsFeed.tsx
git commit -m "perf: move Map page fetches to server component, pass data as props"
```

---

## Chunk 3: Stocks and Freight pages — server component pre-load

### Task 3: Stocks page → async server component

**Files:**
- Modify: `frontend/app/stocks/page.tsx` → async server component
- Create: `frontend/app/stocks/StocksClient.tsx` → client chart component
- Modify: `frontend/components/NewsFeedList.tsx` → accept `initialItems` prop

- [ ] **Step 1: Update `NewsFeedList.tsx` to accept `initialItems` prop**

```tsx
interface Props {
  category?: string;
  filterFn?: (item: NewsItem) => boolean;
  emptyMessage?: string;
  title: string;
  initialItems?: NewsItem[];
}

export default function NewsFeedList({ category, filterFn, emptyMessage, title, initialItems }: Props) {
  const [items, setItems] = useState<NewsItem[]>(() =>
    initialItems ? (filterFn ? initialItems.filter(filterFn) : initialItems) : []
  );
  const [loading, setLoading] = useState(!initialItems);

  useEffect(() => {
    if (initialItems) return; // already have server-loaded data
    fetchNews(category)
      .then((data) => setItems(filterFn ? data.filter(filterFn) : data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  // ... rest of component unchanged
```

- [ ] **Step 2: Create `frontend/app/stocks/StocksClient.tsx`**

Move all the chart + NewsFeedList JSX from the current `page.tsx` into this client component:

```tsx
"use client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import NewsFeedList from "@/components/NewsFeedList";

interface StockData { date: string; value: number; }
interface NewsItem { id: number; title: string; body: string; source: string; category: string; tags: string[]; pub_date: string; }
interface Props { stocks: StockData[]; news: NewsItem[]; }

export default function StocksClient({ stocks, news }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="h-1/2 p-4 border-b border-slate-700 bg-slate-900/50">
        <h2 className="text-lg font-bold mb-4 text-slate-200">ICE Certified Stocks</h2>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={stocks}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: "#1e293b", borderColor: "#475569" }} itemStyle={{ color: "#e2e8f0" }} />
            <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Bags" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 overflow-hidden">
        <NewsFeedList
          title="Market News & Intel"
          initialItems={news}
          filterFn={(item: any) => {
            const tags = item.tags?.map((t: string) => t.toLowerCase()) || [];
            return tags.includes("stocks") && !tags.includes("demand") && !tags.includes("general");
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace `frontend/app/stocks/page.tsx` with async server component**

```tsx
import { fetchStocks, fetchNews } from "@/lib/api";
import StocksClient from "./StocksClient";

const MOCK_DATA = [
  { date: "2023-08", value: 550230 },
  { date: "2023-09", value: 480120 },
  { date: "2023-10", value: 440500 },
  { date: "2023-11", value: 390000 },
  { date: "2023-12", value: 250100 },
  { date: "2024-01", value: 245000 },
  { date: "2024-02", value: 290000 },
];

export default async function StocksPage() {
  const [stocksRaw, news] = await Promise.all([
    fetchStocks().catch(() => []),
    fetchNews().catch(() => []),
  ]);
  const stocks = stocksRaw.length > 0 ? stocksRaw : MOCK_DATA;
  return <StocksClient stocks={stocks} news={news} />;
}
```

### Task 4: Freight page → async server component

**Files:**
- Modify: `frontend/app/freight/page.tsx` → async server component
- Create: `frontend/app/freight/FreightClient.tsx` → client component

- [ ] **Step 4: Create `frontend/app/freight/FreightClient.tsx`**

Move all the JSX from the current `freight/page.tsx` into this client component. Accept `initialData` as a prop — no `useEffect` or `useState` needed since data is already loaded:

```tsx
"use client";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// Copy the FreightRoute, FreightData types and CHART_LINES from current page.tsx

interface Props { data: FreightData | null; }

export default function FreightClient({ data }: Props) {
  // Replace all `loading` checks with `!data` checks.
  // Remove all useState / useEffect.
  // Keep the chart and table JSX exactly as-is.
  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      <h1 className="text-lg font-bold text-white">Freight</h1>
      {/* ... same JSX as current page.tsx, replacing {loading} with {!data} */}
    </div>
  );
}
```

- [ ] **Step 5: Replace `frontend/app/freight/page.tsx` with async server component**

```tsx
import { fetchFreight } from "@/lib/api";
import FreightClient from "./FreightClient";

export default async function FreightPage() {
  const data = await fetchFreight().catch(() => null);
  return <FreightClient data={data} />;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/app/stocks/page.tsx frontend/app/stocks/StocksClient.tsx frontend/app/freight/page.tsx frontend/app/freight/FreightClient.tsx frontend/components/NewsFeedList.tsx
git commit -m "perf: move Stocks and Freight fetches to server components"
```

---

## Chunk 4: Skeleton loaders

### Task 5: Replace all "Loading…" text with skeleton placeholders

**Files:**
- Modify: `frontend/app/freight/FreightClient.tsx`
- Modify: `frontend/components/NewsFeedList.tsx`
- Modify: `frontend/app/futures/page.tsx`

A skeleton is a grey animated box that matches the shape of the content it's replacing. Use this reusable pattern:
```tsx
<div className="animate-pulse space-y-3">
  <div className="h-4 bg-slate-700 rounded w-3/4" />
  <div className="h-4 bg-slate-700 rounded w-1/2" />
  <div className="h-4 bg-slate-700 rounded w-2/3" />
</div>
```

- [ ] **Step 1: Skeleton for `NewsFeedList.tsx` (used in Stocks, Supply, Demand, Macro tabs)**

Replace `{loading && <p className="text-slate-500 text-sm">Loading…</p>}` with:

```tsx
{loading && (
  <div className="animate-pulse space-y-3">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="border border-slate-800 rounded-lg p-4 space-y-2">
        <div className="h-4 bg-slate-700 rounded w-3/4" />
        <div className="h-3 bg-slate-800 rounded w-full" />
        <div className="h-3 bg-slate-800 rounded w-2/3" />
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 2: Skeleton for `FreightClient.tsx` chart area**

Replace the `{loading && <div className="h-[260px] flex items-center justify-center ...">Loading…</div>}` block with:

```tsx
{!data && (
  <div className="h-[260px] animate-pulse flex flex-col justify-end gap-2 px-4 pb-4">
    {[40, 70, 55, 90, 65, 80, 50, 75].map((h, i) => (
      <div key={i} className="bg-slate-700 rounded" style={{ height: `${h}%`, width: `${100 / 9}%`, display: "inline-block", marginRight: 4 }} />
    ))}
  </div>
)}
```

- [ ] **Step 3: Skeleton for `futures/page.tsx` loading state**

Replace `{loading && <p className="text-slate-500 text-sm">Loading…</p>}` with:

```tsx
{loading && (
  <div className="animate-pulse space-y-3 mt-4">
    {[...Array(3)].map((_, i) => (
      <div key={i} className="h-24 bg-slate-800 rounded-lg" />
    ))}
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/freight/FreightClient.tsx frontend/components/NewsFeedList.tsx frontend/app/futures/page.tsx
git commit -m "ux: replace Loading text with skeleton placeholders across tabs"
```

---

## Chunk 5: In-memory fetch cache for remaining client fetches

### Task 6: Add simple module-level cache to `lib/api.ts`

**Files:**
- Modify: `frontend/lib/api.ts`

The COT dashboard (`/cot`) is a fully interactive client component that cannot be a server component. Its two fetches (`fetchCot`, `fetchMacroCot`) are called once on mount and never change. We add a simple module-level TTL cache in `lib/api.ts` — no new dependencies, no SWR to install.

When the user switches tabs and comes back, the cached response is returned instantly (within the 5-min TTL) instead of re-fetching.

- [ ] **Step 1: Add cache wrapper to `frontend/lib/api.ts`**

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Simple in-memory TTL cache (5 minutes) for client-side fetches.
// Avoids re-fetching on tab switch for slow endpoints.
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
```

- [ ] **Step 2: Verify COT tab returns instantly on second visit**

1. Navigate to `/cot` — wait for full load
2. Switch to another tab
3. Switch back to `/cot`
4. Data should appear immediately (no loading spinner)

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "perf: add module-level TTL cache to api.ts for instant tab revisits"
```

---

## Chunk 6: Split CotDashboard into lazy-loaded step components

### Task 7: Split CotDashboard's 6 steps into separate files

**Files:**
- Create: `frontend/components/futures/cot/StepFlow.tsx`
- Create: `frontend/components/futures/cot/StepStructure.tsx`
- Create: `frontend/components/futures/cot/StepPlayers.tsx`
- Create: `frontend/components/futures/cot/StepIndustry.tsx`
- Create: `frontend/components/futures/cot/StepDryPowder.tsx`
- Create: `frontend/components/futures/cot/StepCycle.tsx`
- Modify: `frontend/components/futures/CotDashboard.tsx`

**Goal:** Each step component receives data and state as props. `CotDashboard.tsx` stays as the data-fetching orchestrator and renders only the active step via `dynamic()` import. Steps 2–6 are not parsed until first visited.

- [ ] **Step 1: Read the full `CotDashboard.tsx` before starting**

The file is ~2,000 lines. Identify the exact JSX block for each step (the `{step === N && (...)}` sections). Each block becomes its own file.

- [ ] **Step 2: Create `StepFlow.tsx` (Step 1 — Global Money Flow)**

Copy the `{step === 1 && (...)}` JSX block into a new component. It receives the props it needs (macroData, data, pdfRefs, etc.):

```tsx
"use client";
// All imports needed by step 1 charts only
interface StepFlowProps {
  macroData: any[];
  macroError: string | null;
  pdfRefMacroGross: React.RefObject<HTMLDivElement>;
  pdfRefMacroNet: React.RefObject<HTMLDivElement>;
  pdfRefSoftsContract: React.RefObject<HTMLDivElement>;
}
export default function StepFlow({ ... }: StepFlowProps) {
  return <>{ /* paste step 1 JSX here */ }</>;
}
```

Repeat for steps 2–6. Each file has only the imports that step actually needs.

- [ ] **Step 3: Replace step blocks in `CotDashboard.tsx` with dynamic imports**

At the top of `CotDashboard.tsx`:

```tsx
import dynamic from "next/dynamic";

const StepFlow      = dynamic(() => import("./cot/StepFlow"));
const StepStructure = dynamic(() => import("./cot/StepStructure"));
const StepPlayers   = dynamic(() => import("./cot/StepPlayers"));
const StepIndustry  = dynamic(() => import("./cot/StepIndustry"));
const StepDryPowder = dynamic(() => import("./cot/StepDryPowder"));
const StepCycle     = dynamic(() => import("./cot/StepCycle"));
```

In the render section, replace the inline JSX blocks:

```tsx
{step === 1 && <StepFlow macroData={macroData} macroError={macroError} pdfRefMacroGross={pdfRefMacroGross} pdfRefMacroNet={pdfRefMacroNet} pdfRefSoftsContract={pdfRefSoftsContract} />}
{step === 2 && <StepStructure data={data} recent52={recent52} />}
{step === 3 && <StepPlayers data={data} recent52={recent52} />}
{step === 4 && <StepIndustry data={data} recent52={recent52} pdfRefIndNY={pdfRefIndNY} pdfRefIndLDN={pdfRefIndLDN} />}
{step === 5 && <StepDryPowder data={data} recent52={recent52} dpMarkets={dpMarkets} setDpMarkets={setDpMarkets} dpCats={dpCats} setDpCats={setDpCats} pdfRefDpNY={pdfRefDpNY} pdfRefDpLDN={pdfRefDpLDN} />}
{step === 6 && <StepCycle data={data} recent52={recent52} obosView={obosView} setObosView={setObosView} />}
```

> **Note:** Prop signatures depend on exactly what each step block uses — read the current code carefully for each step before extracting.

- [ ] **Step 4: Verify each step still renders correctly**

Navigate to `/cot` and click through all 6 steps. Each should render identically to before.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/futures/CotDashboard.tsx frontend/components/futures/cot/
git commit -m "perf: split CotDashboard into 6 lazy-loaded step components"
```

---

## Final verification

- [ ] Open browser DevTools → Network tab
- [ ] Hard refresh on `/map` — confirm 0 `fetchNews` calls from client (data arrives in HTML)
- [ ] Navigate to `/cot` — confirm 2 API calls (cot + macro-cot), data loads
- [ ] Switch to `/futures` then back to `/cot` — confirm 0 API calls (cache hit)
- [ ] Check `curl -I http://localhost:8000/api/news` returns `cache-control: public, max-age=300`
- [ ] All 6 COT steps render correctly

```bash
git log --oneline -8
```
