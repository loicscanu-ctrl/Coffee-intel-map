# Phase 1: Monorepo Scaffold + Map Tab Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold the Next.js + FastAPI + PostgreSQL monorepo and migrate the existing `index.html` map into the Next.js app as the News & Intel tab, preserving all existing layers (logistics, ports, factories, country pins) and adding color-coded news pins served from the FastAPI backend.

**Architecture:** Next.js 14 App Router frontend consumes a FastAPI REST backend. PostgreSQL stores intel data. The existing `countries.json`, `factories.json`, and `global.json` are seeded into the DB on first run. Leaflet map runs client-side in a Next.js page with dynamic import (no SSR).

**Tech Stack:** Next.js 14, Tailwind CSS, Leaflet.js, FastAPI, SQLAlchemy, PostgreSQL, APScheduler, Docker Compose, httpx

---

## Task 1: Docker Compose + PostgreSQL

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/.env.example`

**Step 1: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: coffee_intel
      POSTGRES_USER: coffee
      POSTGRES_PASSWORD: coffee
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://coffee:coffee@db:5432/coffee_intel
    depends_on:
      - db
    volumes:
      - ./backend:/app
      - ./countries.json:/app/seed/countries.json
      - ./factories.json:/app/seed/factories.json
      - ./global.json:/app/seed/global.json

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    depends_on:
      - backend
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next

volumes:
  pgdata:
```

**Step 2: Create `backend/.env.example`**

```
DATABASE_URL=postgresql://coffee:coffee@localhost:5432/coffee_intel
```

**Step 3: Start only the database to verify it works**

```bash
docker compose up db -d
docker compose ps
```
Expected: `db` service shows `running`

**Step 4: Commit**

```bash
git add docker-compose.yml backend/.env.example
git commit -m "feat: add docker compose with postgres"
```

---

## Task 2: FastAPI Backend Scaffold

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/requirements.txt`
- Create: `backend/main.py`
- Create: `backend/database.py`
- Create: `backend/models.py`

**Step 1: Create `backend/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.0
sqlalchemy==2.0.36
psycopg2-binary==2.9.10
httpx==0.27.0
beautifulsoup4==4.12.3
apscheduler==3.10.4
python-dotenv==1.0.1
```

**Step 2: Create `backend/Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

**Step 3: Create `backend/database.py`**

```python
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://coffee:coffee@localhost:5432/coffee_intel")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

**Step 4: Create `backend/models.py`**

```python
from datetime import datetime
from sqlalchemy import String, Float, DateTime, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from database import Base

class NewsItem(Base):
    __tablename__ = "news_feed"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(200), nullable=True)
    category: Mapped[str] = mapped_column(String(50))  # supply, demand, macro, general
    lat: Mapped[float] = mapped_column(Float, nullable=True)
    lng: Mapped[float] = mapped_column(Float, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    pub_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class CountryIntel(Base):
    __tablename__ = "country_intel"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    type: Mapped[str] = mapped_column(String(20))  # producer / consumer
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Factory(Base):
    __tablename__ = "factories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    company: Mapped[str] = mapped_column(String(200), nullable=True)
    capacity: Mapped[str] = mapped_column(String(100), nullable=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
```

**Step 5: Create `backend/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import Base, engine

app = FastAPI(title="Coffee Intel API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 6: Start backend and verify health endpoint**

```bash
docker compose up db backend -d
# wait ~10 seconds for startup
curl http://localhost:8000/health
```
Expected: `{"status":"ok"}`

**Step 7: Commit**

```bash
git add backend/
git commit -m "feat: scaffold fastapi backend with postgres models"
```

---

## Task 3: Seed Database from Existing JSON Files

**Files:**
- Create: `backend/seed.py`
- Modify: `backend/main.py`

**Step 1: Create `backend/seed.py`**

```python
import json
import os
from datetime import datetime
from database import SessionLocal, engine, Base
from models import NewsItem, CountryIntel, Factory

SEED_DIR = os.path.join(os.path.dirname(__file__), "seed")

def seed_countries(db):
    path = os.path.join(SEED_DIR, "countries.json")
    if not os.path.exists(path):
        return
    with open(path) as f:
        data = json.load(f)
    for name, info in data.get("countries", {}).items():
        existing = db.query(CountryIntel).filter_by(name=name).first()
        if existing:
            continue
        db.add(CountryIntel(
            name=name,
            type=info.get("type", "producer"),
            lat=info["lat"],
            lng=info["lng"],
            data=info,
        ))
    db.commit()

def seed_factories(db):
    path = os.path.join(SEED_DIR, "factories.json")
    if not os.path.exists(path):
        return
    with open(path) as f:
        data = json.load(f)
    for fac in data.get("factories", []):
        existing = db.query(Factory).filter_by(name=fac.get("n", "")).first()
        if existing:
            continue
        if not fac.get("l"):
            continue
        db.add(Factory(
            name=fac.get("n", ""),
            company=fac.get("c", ""),
            capacity=fac.get("cap", ""),
            lat=fac["l"][0],
            lng=fac["l"][1],
        ))
    db.commit()

def seed_news(db):
    path = os.path.join(SEED_DIR, "global.json")
    if not os.path.exists(path):
        return
    with open(path) as f:
        data = json.load(f)
    intel = data.get("globalIntel", {})

    category_map = {
        "supply": "supply",
        "demand": "demand",
        "stocks": "general",
        "futures": "general",
    }
    pin_colors = {"supply": "red", "demand": "yellow", "general": "grey", "macro": "blue"}

    for section, category in category_map.items():
        for item in intel.get(section, []):
            existing = db.query(NewsItem).filter_by(title=item.get("t", "")).first()
            if existing:
                continue
            loc = item.get("loc")
            db.add(NewsItem(
                title=item.get("t", ""),
                body=item.get("v", ""),
                source=item.get("source", ""),
                category=category,
                lat=loc[0] if loc else None,
                lng=loc[1] if loc else None,
                tags=[section],
            ))

    for alert in intel.get("alerts", []):
        existing = db.query(NewsItem).filter_by(title=alert.get("t", "")).first()
        if existing:
            continue
        loc = alert.get("loc")
        db.add(NewsItem(
            title=alert.get("t", ""),
            body=alert.get("v", ""),
            source=alert.get("source", ""),
            category="supply",
            lat=loc[0] if loc else None,
            lng=loc[1] if loc else None,
            tags=["alert"],
        ))
    db.commit()

def run_seed():
    db = SessionLocal()
    try:
        seed_countries(db)
        seed_factories(db)
        seed_news(db)
        print("✅ Seed complete")
    finally:
        db.close()
```

**Step 2: Call seed on startup in `backend/main.py`**

Add after `Base.metadata.create_all(bind=engine)`:

```python
from seed import run_seed
run_seed()
```

**Step 3: Restart backend and verify seed ran**

```bash
docker compose restart backend
docker compose logs backend | grep "Seed"
```
Expected: `✅ Seed complete`

**Step 4: Commit**

```bash
git add backend/seed.py backend/main.py
git commit -m "feat: seed db from existing json files on startup"
```

---

## Task 4: News & Map API Routes

**Files:**
- Create: `backend/routes/news.py`
- Create: `backend/routes/map.py`
- Modify: `backend/main.py`

**Step 1: Create `backend/routes/news.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models import NewsItem

router = APIRouter(prefix="/api/news", tags=["news"])

@router.get("")
def get_news(category: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(NewsItem)
    if category:
        q = q.filter(NewsItem.category == category)
    items = q.order_by(NewsItem.pub_date.desc()).all()
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
            "pub_date": item.pub_date.isoformat() if item.pub_date else None,
        }
        for item in items
    ]
```

**Step 2: Create `backend/routes/map.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import CountryIntel, Factory

router = APIRouter(prefix="/api/map", tags=["map"])

@router.get("/countries")
def get_countries(db: Session = Depends(get_db)):
    countries = db.query(CountryIntel).all()
    return [{"name": c.name, "type": c.type, "lat": c.lat, "lng": c.lng, "data": c.data} for c in countries]

@router.get("/factories")
def get_factories(db: Session = Depends(get_db)):
    factories = db.query(Factory).all()
    return [{"name": f.name, "company": f.company, "capacity": f.capacity, "lat": f.lat, "lng": f.lng} for f in factories]
```

**Step 3: Register routes in `backend/main.py`**

Add after existing imports:

```python
from routes.news import router as news_router
from routes.map import router as map_router

app.include_router(news_router)
app.include_router(map_router)
```

**Step 4: Test the routes**

```bash
curl http://localhost:8000/api/news | python -m json.tool | head -40
curl http://localhost:8000/api/map/countries | python -m json.tool | head -20
```
Expected: JSON arrays with seeded data

**Step 5: Commit**

```bash
git add backend/routes/ backend/main.py
git commit -m "feat: add news and map api routes"
```

---

## Task 5: Next.js Frontend Scaffold

**Files:**
- Create: `frontend/` (via `create-next-app`)

**Step 1: Scaffold Next.js app**

```bash
cd "/c/Users/Loic Scanu/Coffee-intel-map"
npx create-next-app@14 frontend \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*"
```

**Step 2: Install additional dependencies**

```bash
cd frontend
npm install leaflet @types/leaflet recharts
```

**Step 3: Update `frontend/app/globals.css`** — keep only Tailwind directives, remove default Next.js styles:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  height: 100%;
  background-color: #111827;
  color: #e5e7eb;
}
```

**Step 4: Verify dev server starts**

```bash
cd frontend && npm run dev
```
Expected: `ready - started server on http://localhost:3000`

**Step 5: Commit**

```bash
cd ..
git add frontend/
git commit -m "feat: scaffold next.js 14 frontend"
```

---

## Task 6: Tab Navigation Layout

**Files:**
- Create: `frontend/app/layout.tsx`
- Create: `frontend/components/TabNav.tsx`

**Step 1: Create `frontend/components/TabNav.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/futures", label: "Futures Exchange" },
  { href: "/stocks", label: "Stocks & Spreads" },
  { href: "/supply", label: "Supply" },
  { href: "/demand", label: "Demand" },
  { href: "/macro", label: "Macro" },
  { href: "/map", label: "News & Intel" },
];

export default function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="flex border-b border-slate-700 bg-slate-900 px-4">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              active
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

**Step 2: Update `frontend/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TabNav from "@/components/TabNav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Coffee Intel Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full flex flex-col bg-gray-950`}>
        <TabNav />
        <main className="flex-1 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
```

**Step 3: Create redirect from root to `/map`**

Create `frontend/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
export default function Home() {
  redirect("/map");
}
```

**Step 4: Create stub pages for all tabs** (so nav links don't 404)

Create these files each with a single stub:

`frontend/app/futures/page.tsx`:
```tsx
export default function FuturesPage() {
  return <div className="p-8 text-slate-400">Futures Exchange — coming soon</div>;
}
```

Repeat for `stocks`, `supply`, `demand`, `macro` with matching labels.

**Step 5: Verify navigation works in browser**

```bash
cd frontend && npm run dev
```
Open `http://localhost:3000` — should redirect to `/map` (404 for now, tabs visible)

**Step 6: Commit**

```bash
git add frontend/app/ frontend/components/
git commit -m "feat: add tab navigation layout and stub pages"
```

---

## Task 7: Map Tab — Static Layers (Logistics, Ports, Countries)

**Files:**
- Create: `frontend/app/map/page.tsx`
- Create: `frontend/components/map/CoffeeMap.tsx`
- Create: `frontend/lib/mapData.ts`

**Step 1: Copy static map data to `frontend/lib/mapData.ts`**

Extract the `ports` and `routes` arrays from `index.html` (lines 118–190) into a typed constant file:

```ts
export const PORTS = [
  { n: "Santos", l: [-23.9, -46.3] as [number, number] },
  // ... (copy all ports from index.html)
];

export const ROUTES = [
  { name: "English Channel Trunk", color: "#ffffff", weight: 4, path: [[48.0, -7.0], /* ... */] as [number, number][] },
  // ... (copy all routes from index.html)
];

export const MAP_CONFIG = {
  theme: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  initView: [20, -10] as [number, number],
  initZoom: 3,
};
```

**Step 2: Create `frontend/components/map/CoffeeMap.tsx`**

Note: must use `dynamic` import in the page to avoid SSR issues with Leaflet.

```tsx
"use client";
import { useEffect, useRef } from "react";
import { PORTS, ROUTES, MAP_CONFIG } from "@/lib/mapData";

export default function CoffeeMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;

    // Dynamic import of Leaflet (client-only)
    import("leaflet").then((L) => {
      require("leaflet/dist/leaflet.css");

      const map = L.map(mapRef.current!, {
        zoomControl: false,
        fadeAnimation: true,
      }).setView(MAP_CONFIG.initView, MAP_CONFIG.initZoom);

      mapInstanceRef.current = map;

      L.tileLayer(MAP_CONFIG.theme, {
        attribution: "&copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "topright" }).addTo(map);

      // Logistics routes
      const logisticsLayer = L.layerGroup().addTo(map);
      ROUTES.forEach((r) => {
        if (r.path) {
          L.polyline(r.path as [number, number][], {
            color: r.color,
            weight: r.weight || 2,
            opacity: 0.8,
          })
            .bindTooltip(r.name)
            .addTo(logisticsLayer);
        }
      });

      // Ports
      const portsLayer = L.layerGroup().addTo(map);
      PORTS.forEach((p) => {
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:#0ea5e9;border:2px solid #fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;">⚓</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        L.marker(p.l, { icon }).bindPopup(`Port of ${p.n}`).addTo(portsLayer);
      });
    });

    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return <div ref={mapRef} className="w-full h-full" />;
}
```

**Step 3: Create `frontend/app/map/page.tsx`**

```tsx
import dynamic from "next/dynamic";

const CoffeeMap = dynamic(() => import("@/components/map/CoffeeMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-slate-500">Loading map...</div>,
});

export default function MapPage() {
  return (
    <div className="w-full h-full relative">
      <CoffeeMap />
    </div>
  );
}
```

**Step 4: Verify map renders with routes and ports**

```bash
cd frontend && npm run dev
```
Open `http://localhost:3000/map` — dark map, animated routes, port anchors visible.

**Step 5: Commit**

```bash
git add frontend/app/map/ frontend/components/map/ frontend/lib/mapData.ts
git commit -m "feat: add map tab with logistics routes and ports"
```

---

## Task 8: Map Tab — Country Pins from API

**Files:**
- Modify: `frontend/components/map/CoffeeMap.tsx`
- Create: `frontend/lib/api.ts`

**Step 1: Create `frontend/lib/api.ts`**

```ts
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

export async function fetchNews(category?: string) {
  const url = category
    ? `${API_URL}/api/news?category=${category}`
    : `${API_URL}/api/news`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch news");
  return res.json();
}
```

**Step 2: Fetch countries and factories in `CoffeeMap.tsx`**

Inside the `useEffect`, after setting up ports, add:

```ts
import { fetchMapCountries, fetchMapFactories } from "@/lib/api";

// Country pins
const countriesLayer = L.layerGroup().addTo(map);
fetchMapCountries().then((countries: any[]) => {
  countries.forEach((c) => {
    const isProducer = c.type === "producer";
    const color = isProducer ? "#10b981" : "#3b82f6";
    const icon = L.divIcon({
      className: "",
      html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:12px;height:12px;"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    const d = c.data || {};
    const statsHtml = isProducer
      ? `<div>PROD: ${d.prod || "—"}</div><div>STOCK: ${d.stock || "—"}</div>`
      : `<div>CONS: ${d.cons || "—"}</div><div>STOCK: ${d.stock || "—"}</div>`;
    L.marker([c.lat, c.lng], { icon })
      .bindPopup(`<div style="font-family:monospace;font-size:12px;background:#0f172a;color:#e2e8f0;padding:8px;border-radius:4px;min-width:160px"><b>${c.name}</b><br>${statsHtml}${d.intel ? `<br><i>${d.intel}</i>` : ""}</div>`)
      .addTo(countriesLayer);
  });
});

// Factory pins
const factoriesLayer = L.layerGroup().addTo(map);
fetchMapFactories().then((factories: any[]) => {
  factories.forEach((f) => {
    const icon = L.divIcon({
      className: "",
      html: `<div style="background:#6366f1;border:1px solid #fff;border-radius:3px;width:16px;height:16px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;">🏭</div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker([f.lat, f.lng], { icon })
      .bindPopup(`<b>${f.name}</b><br>${f.company || ""}<br>Cap: ${f.capacity || ""}`)
      .addTo(factoriesLayer);
  });
});
```

**Step 3: Verify country pins and factory pins appear on map**

Open `http://localhost:3000/map` — green producer dots, blue consumer dots, purple factory icons visible.

**Step 4: Commit**

```bash
git add frontend/components/map/CoffeeMap.tsx frontend/lib/api.ts
git commit -m "feat: load country and factory pins from api"
```

---

## Task 9: Map Tab — News/Intel Pins + Sidebar

**Files:**
- Modify: `frontend/components/map/CoffeeMap.tsx`
- Create: `frontend/components/map/NewsSidebar.tsx`
- Modify: `frontend/app/map/page.tsx`

**Step 1: Define pin colors by category**

In `CoffeeMap.tsx`, add a color map:

```ts
const CATEGORY_COLORS: Record<string, string> = {
  supply: "#ef4444",   // red
  demand: "#eab308",   // yellow
  macro: "#3b82f6",    // blue
  general: "#6b7280",  // grey
};
```

**Step 2: Fetch news and render pins with click handler**

```ts
fetchNews().then((items: any[]) => {
  items.filter((item) => item.lat && item.lng).forEach((item) => {
    const color = CATEGORY_COLORS[item.category] || "#6b7280";
    const icon = L.divIcon({
      className: "",
      html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:14px;height:14px;box-shadow:0 0 6px ${color}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    L.marker([item.lat, item.lng], { icon })
      .on("click", () => onPinClick(item))
      .addTo(newsLayer);
  });
});
```

The `onPinClick` prop is passed down from the page.

**Step 3: Create `frontend/components/map/NewsSidebar.tsx`**

```tsx
interface NewsItem {
  id: number;
  title: string;
  body: string;
  source: string;
  category: string;
  tags: string[];
  pub_date: string;
}

interface Props {
  item: NewsItem | null;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  supply: "Supply / Crop",
  demand: "Demand Signal",
  macro: "Macro",
  general: "General Intel",
};

const CATEGORY_COLORS: Record<string, string> = {
  supply: "border-red-500 text-red-400",
  demand: "border-yellow-500 text-yellow-400",
  macro: "border-blue-500 text-blue-400",
  general: "border-gray-500 text-gray-400",
};

export default function NewsSidebar({ item, onClose }: Props) {
  if (!item) return null;
  const colorClass = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.general;
  return (
    <div className="absolute top-0 right-0 h-full w-80 bg-slate-900/95 border-l border-slate-700 z-[1000] flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <span className={`text-xs font-bold uppercase border-l-4 pl-2 ${colorClass}`}>
          {CATEGORY_LABELS[item.category] || item.category}
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">×</button>
      </div>
      <div className="p-4 overflow-y-auto flex-1">
        <h3 className="font-bold text-white mb-3 leading-snug">{item.title}</h3>
        <p className="text-slate-300 text-sm leading-relaxed mb-4">{item.body}</p>
        <div className="text-xs text-slate-500 space-y-1">
          {item.source && <div>Source: {item.source}</div>}
          {item.pub_date && <div>{new Date(item.pub_date).toLocaleDateString()}</div>}
          {item.tags?.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-2">
              {item.tags.map((tag) => (
                <span key={tag} className="bg-slate-800 px-2 py-0.5 rounded text-slate-400">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Wire sidebar into `frontend/app/map/page.tsx`**

```tsx
"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import NewsSidebar from "@/components/map/NewsSidebar";

const CoffeeMap = dynamic(() => import("@/components/map/CoffeeMap"), { ssr: false });

export default function MapPage() {
  const [selectedPin, setSelectedPin] = useState<any>(null);
  return (
    <div className="w-full h-full relative">
      <CoffeeMap onPinClick={setSelectedPin} />
      <NewsSidebar item={selectedPin} onClose={() => setSelectedPin(null)} />
    </div>
  );
}
```

**Step 5: Add `onPinClick` prop to `CoffeeMap.tsx`**

```tsx
interface Props {
  onPinClick?: (item: any) => void;
}
export default function CoffeeMap({ onPinClick }: Props) { ... }
```

**Step 6: Verify full map tab**

Open `http://localhost:3000/map`. Expect:
- Logistics routes + ports visible
- Country pins (green/blue)
- News pins (colored by category) at geolocated items
- Clicking a pin opens the sidebar with headline, body, source, tags

**Step 7: Commit**

```bash
git add frontend/app/map/ frontend/components/map/
git commit -m "feat: add geocoded news pins and sidebar to map tab"
```

---

## Task 10: News Feed Below Map + Ticker

**Files:**
- Create: `frontend/components/map/NewsFeed.tsx`
- Create: `frontend/components/map/Ticker.tsx`
- Modify: `frontend/app/map/page.tsx`

**Step 1: Create `frontend/components/map/NewsFeed.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { fetchNews } from "@/lib/api";

const CATEGORIES = ["all", "supply", "demand", "macro", "general"];
const COLORS: Record<string, string> = {
  supply: "border-red-500",
  demand: "border-yellow-500",
  macro: "border-blue-500",
  general: "border-gray-500",
};

export default function NewsFeed() {
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchNews().then(setItems);
  }, []);

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

  return (
    <div className="h-48 border-t border-slate-700 bg-slate-900/90 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-xs px-2 py-1 rounded capitalize ${filter === cat ? "bg-slate-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto flex-1 px-4 py-2 space-y-2">
        {filtered.map((item) => (
          <div key={item.id} className={`border-l-2 pl-3 text-xs ${COLORS[item.category] || "border-gray-500"}`}>
            <span className="font-bold text-white">{item.title}</span>
            <span className="text-slate-400 ml-2">{item.body?.slice(0, 100)}…</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Update `frontend/app/map/page.tsx`** to stack map + news feed vertically:

```tsx
return (
  <div className="w-full h-full flex flex-col relative">
    <div className="flex-1 relative min-h-0">
      <CoffeeMap onPinClick={setSelectedPin} />
      <NewsSidebar item={selectedPin} onClose={() => setSelectedPin(null)} />
    </div>
    <NewsFeed />
  </div>
);
```

**Step 3: Verify layout**

Open `http://localhost:3000/map` — map takes upper portion, news feed with category filter below.

**Step 4: Commit**

```bash
git add frontend/components/map/NewsFeed.tsx frontend/app/map/page.tsx
git commit -m "feat: add filterable news feed below map"
```

---

## Task 11: Docker Compose Full Stack + Frontend Dockerfile

**Files:**
- Create: `frontend/Dockerfile`

**Step 1: Create `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

**Step 2: Bring up full stack**

```bash
docker compose up --build -d
```
Expected: all three services running (`db`, `backend`, `frontend`)

**Step 3: Verify via browser**

Open `http://localhost:3000` — full map tab loads with data from the running backend.

**Step 4: Commit**

```bash
git add frontend/Dockerfile
git commit -m "feat: add frontend dockerfile for docker compose"
```

---

## Phase 1 Complete

At this point you have:
- Full monorepo with Docker Compose (PostgreSQL + FastAPI + Next.js)
- FastAPI seeded from existing JSON files on startup
- Next.js app with tab navigation (5 stubs + 1 live map tab)
- Map tab with: logistics routes, ports, country pins, factory pins, geocoded news pins (color-coded), click-to-sidebar, filtered news feed below

Next step: **Phase 2 — Futures Exchange tab** (KC/RC price chart + COT net positioning from CFTC CSV).
