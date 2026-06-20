"use client";
import { useEffect, useRef, useState } from "react";
import type { LayerGroup as LeafletLayerGroup, Map as LeafletMap, Marker as LeafletMarker, TileLayer } from "leaflet";
import { PORTS, HUB_PORTS, ROUTES, BASEMAPS } from "@/lib/mapData";
import { cachedFetchStatic } from "@/lib/api";
import type { CountryPin, FactoryPin, NewsItem } from "@/lib/api";
import { computeOriginPrices, type OriginPrice } from "@/lib/originPrices";
import { centroidFor, DEST } from "@/components/demand/imports-lab/centroids";
import { useUrlState } from "@/lib/useUrlState";

// Curved arc (quadratic bezier sampled to a polyline) between two [lat,lng]
// points, so import-flow lines fan out instead of overlapping.
function flowArc(a: [number, number], b: [number, number], bend = 0.18): [number, number][] {
  const [la, loa] = a, [lb, lob] = b;
  const mx = (la + lb) / 2, my = (loa + lob) / 2;
  const dx = lb - la, dy = lob - loa;
  const cx = mx - dy * bend, cy = my + dx * bend;
  const pts: [number, number][] = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    pts.push([
      (1 - t) ** 2 * la + 2 * (1 - t) * t * cx + t * t * lb,
      (1 - t) ** 2 * loa + 2 * (1 - t) * t * cy + t * t * lob,
    ]);
  }
  return pts;
}

const VALID_BASEMAP_IDS = BASEMAPS.map(b => b.id);

// ── Hub → Portuguese country list (Cecafe) ────────────────────────────────────
const HUB_COUNTRIES: Record<string, string[]> = {
  "Nordics":            ["DINAMARCA","FINLANDIA","ISLANDIA","NORUEGA","SUECIA"],
  "Central Europe":     ["ALEMANHA","BELGICA","FRANCA","IRLANDA","LUXEMBURGO","PAISES BAIXOS (HOLANDA)","REINO UNIDO","REPUBL. TCHECA","ESLOVAQUIA","SUICA"],
  "South Europe":       ["ALBANIA","BOSNIA-HERZEGOVINA","CHIPRE","CROACIA","ESPANHA","ESLOVENIA","GRECIA","ITALIA","MALTA","MONTENEGRO","PORTUGAL","SERVIA"],
  "Eastern Europe":     ["BULGARIA","ESTONIA","LETONIA (LATVIA)","LITUANIA","POLONIA","ROMENIA","UCRANIA"],
  "North America":      ["CANADA","E.U.A.","MEXICO"],
  "Latin America":      ["ARGENTINA","BOLIVIA","CHILE","COLOMBIA","COSTA RICA","CUBA","EQUADOR","EL SALVADOR","GUATEMALA","GUIANA","JAMAICA","NICARAGUA","PANAMA","PARAGUAI","PERU","REP. DOMINICANA","SURINAME","URUGUAI","VENEZUELA","ANTILHAS HOLANDESAS"],
  "East Asia":          ["CHINA","COREIA DO SUL (REPUBL.)","HONG KONG","JAPAO","MACAU","MONGOLIA","TAIWAN"],
  "SE Asia & Pacific":  ["AUSTRALIA","BRUNEI DARUSSALAM","CAMBOJA","FIJI","FILIPINAS","INDONESIA","MALASIA","MYANMAR (BIRMANIA)","NOVA ZELANDIA","SINGAPURA","TAILANDIA","VIETNAM"],
  "Middle East":        ["ARABIA SAUDITA","BAREIN","DJIBUTI","EMIR.ARABES UNIDOS","IRAN","IRAQUE","ISRAEL","JORDANIA","KUWEIT","LIBANO","OMAN","PALESTINA","QATAR","SIRIA","TURQUIA"],
  "North Africa":       ["ARGELIA","EGITO","LIBIA","MARROCOS","TUNISIA"],
  "Sub-Saharan Africa": ["AFRICA DO SUL","ANGOLA","CABO VERDE","COSTA DO MARFIM","GANA","MADAGASCAR","MAURICIO","NIGERIA","QUENIA","RUANDA","SENEGAL","SOMALIA","UGANDA"],
  "South Asia":         ["BANGLADESH","INDIA","MALDIVAS","PAQUISTAO","SRI LANKA"],
  "Russia & CIS":       ["ARMENIA","AZERBAIDJAO","BIELO-RUSSIA","CAZAQUISTAO","GEORGIA","RUSSIAN FEDERATION","UZBEQUISTAO"],
};

// ── Hub → English country list (VN Customs data) ──────────────────────────────
const VN_HUB_COUNTRIES: Record<string, string[]> = {
  "Nordics":            ["Denmark","Finland","Iceland","Norway","Sweden"],
  "Central Europe":     ["Germany","Belgium","France","Ireland","Luxembourg","Netherlands","UK","Austria","Switzerland"],
  "South Europe":       ["Albania","Bosnia and Herzegovina","Cyprus","Croatia","Spain","Slovenia","Greece","Italy","Malta","Montenegro","Portugal","Serbia"],
  "Eastern Europe":     ["Bulgaria","Estonia","Latvia","Lithuania","Poland","Romania","Ukraine"],
  "North America":      ["Canada","US","Mexico"],
  "Latin America":      ["Argentina","Bolivia","Chile","Colombia","Costa Rica","Cuba","Ecuador","El Salvador","Guatemala","Guyana","Jamaica","Nicaragua","Panama","Paraguay","Peru","Dominican Republic","Suriname","Uruguay","Venezuela"],
  "East Asia":          ["China","Korea","China, Hong Kong Special Administrative Region","Japan","Macau","Mongolia","Taiwan"],
  "SE Asia & Pacific":  ["Australia","Brunei Darussalam","Cambodia","Fiji","Philippines","Indonesia","Malaysia","Myanmar","New Zealand","Singapore","Thailand"],
  "Middle East":        ["Saudi Arabia","Bahrain","Djibouti","United Arab Emirates","Iran","Iraq","Israel","Jordan","Kuwait","Lebanon","Oman","Palestine","Qatar","Syrian Arab Republic","Turkey"],
  "North Africa":       ["Algeria","Egypt","Libya","Morocco","Tunisia"],
  "Sub-Saharan Africa": ["South Africa","Angola","Cabo Verde","Côte d'Ivoire","Ghana","Madagascar","Mauritius","Nigeria","Kenya","Rwanda","Senegal","Somalia","Uganda"],
  "South Asia":         ["Bangladesh","India","Maldives","Pakistan","Sri Lanka"],
  "Russia & CIS":       ["Armenia","Azerbaijan","Belarus","Kazakhstan","Georgia","Russia","Uzbekistan"],
};

function bagsToKT(bags: number) {
  return Math.round((bags * 60) / 1e6 * 10) / 10;
}

interface CecafeCountryYear {
  months: string[];
  countries: Record<string, Record<string, number>>;
}
interface CecafeJson {
  report: string;
  by_country: CecafeCountryYear;
  by_country_prev: CecafeCountryYear;
}

function buildRoutePopup(hubs: string[], cecafe: CecafeJson): string {
  const { by_country, by_country_prev, report } = cecafe;
  const currMonths = by_country.months ?? [];
  const prevMonths = by_country_prev.months ?? [];

  const rows = hubs.map(hub => {
    const pts = HUB_COUNTRIES[hub] ?? [];
    let curr = 0, prev = 0;
    pts.forEach(pt => {
      const mvC = by_country.countries?.[pt] ?? {};
      const mvP = by_country_prev.countries?.[pt] ?? {};
      curr += currMonths.reduce((s, m) => s + (mvC[m] ?? 0), 0);
      prev += prevMonths.slice(0, currMonths.length).reduce((s, m) => s + (mvP[m] ?? 0), 0);
    });
    const kt = bagsToKT(curr);
    const pct = prev > 0 ? Math.round((curr - prev) / prev * 100) : null;
    const chgColor = pct === null ? "#94a3b8" : pct >= 0 ? "#4ade80" : "#f87171";
    const chgStr = pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`;
    return `<tr>
      <td style="padding:2px 8px 2px 0;color:#cbd5e1">${hub}</td>
      <td style="padding:2px 4px;text-align:right;color:#e2e8f0;font-weight:600">${kt} kt</td>
      <td style="padding:2px 0 2px 8px;text-align:right;color:${chgColor}">${chgStr}</td>
    </tr>`;
  });

  const total = hubs.reduce((s, hub) => {
    const pts = HUB_COUNTRIES[hub] ?? [];
    return s + pts.reduce((s2, pt) => {
      const mv = by_country.countries?.[pt] ?? {};
      return s2 + currMonths.reduce((s3, m) => s3 + (mv[m] ?? 0), 0);
    }, 0);
  }, 0);

  const period = currMonths.length > 0
    ? currMonths[0].slice(0, 7) + (currMonths.length > 1 ? ` → ${currMonths[currMonths.length - 1].slice(0, 7)}` : "")
    : report;

  return `<div style="font-family:monospace;font-size:11px;background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:6px;min-width:240px;border:1px solid #334155">
    <div style="color:#94a3b8;font-size:10px;margin-bottom:6px">🇧🇷 Cecafe exports · ${period}</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="color:#64748b;font-weight:normal;text-align:left;padding-bottom:4px;border-bottom:1px solid #1e293b">Hub</th>
        <th style="color:#64748b;font-weight:normal;text-align:right;padding-bottom:4px;border-bottom:1px solid #1e293b">kt</th>
        <th style="color:#64748b;font-weight:normal;text-align:right;padding-bottom:4px;border-bottom:1px solid #1e293b">YoY</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
      <tfoot><tr>
        <td style="padding-top:4px;border-top:1px solid #1e293b;color:#94a3b8">Total</td>
        <td style="padding-top:4px;border-top:1px solid #1e293b;text-align:right;color:#f1f5f9;font-weight:700">${bagsToKT(total)} kt</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>`;
}

interface VnExportData {
  monthly_by_country: Record<string, Record<string, number>>;
}

function buildVnRoutePopup(hubs: string[], vnData: VnExportData): string {
  const mbc = vnData.monthly_by_country;
  const months = Object.keys(mbc).sort();
  const currMonths = months.slice(-12);
  const prevMonths = months.slice(-24, -12);

  const rows = hubs.map(hub => {
    const countries = VN_HUB_COUNTRIES[hub] ?? [];
    let curr = 0, prev = 0;
    currMonths.forEach(m => countries.forEach(c => { curr += mbc[m]?.[c] ?? 0; }));
    prevMonths.forEach(m => countries.forEach(c => { prev += mbc[m]?.[c] ?? 0; }));
    const kt = Math.round(curr / 100) / 10;
    const pct = prev > 0 ? Math.round((curr - prev) / prev * 100) : null;
    const chgColor = pct === null ? "#94a3b8" : pct >= 0 ? "#4ade80" : "#f87171";
    const chgStr = pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`;
    return `<tr>
      <td style="padding:2px 8px 2px 0;color:#cbd5e1">${hub}</td>
      <td style="padding:2px 4px;text-align:right;color:#e2e8f0;font-weight:600">${kt} kt</td>
      <td style="padding:2px 0 2px 8px;text-align:right;color:${chgColor}">${chgStr}</td>
    </tr>`;
  });

  const total = hubs.reduce((s, hub) => {
    const countries = VN_HUB_COUNTRIES[hub] ?? [];
    return s + currMonths.reduce((s2, m) => s2 + countries.reduce((s3, c) => s3 + (mbc[m]?.[c] ?? 0), 0), 0);
  }, 0);

  const period = currMonths.length > 0
    ? `${currMonths[0]} → ${currMonths[currMonths.length - 1]}`
    : "";

  return `<div style="font-family:monospace;font-size:11px;background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:6px;min-width:240px;border:1px solid #334155">
    <div style="color:#94a3b8;font-size:10px;margin-bottom:6px">🇻🇳 VN Customs exports · ${period}</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="color:#64748b;font-weight:normal;text-align:left;padding-bottom:4px;border-bottom:1px solid #1e293b">Hub</th>
        <th style="color:#64748b;font-weight:normal;text-align:right;padding-bottom:4px;border-bottom:1px solid #1e293b">kt</th>
        <th style="color:#64748b;font-weight:normal;text-align:right;padding-bottom:4px;border-bottom:1px solid #1e293b">YoY</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
      <tfoot><tr>
        <td style="padding-top:4px;border-top:1px solid #1e293b;color:#94a3b8">Total</td>
        <td style="padding-top:4px;border-top:1px solid #1e293b;text-align:right;color:#f1f5f9;font-weight:700">${Math.round(total / 100) / 10} kt</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>`;
}

const CATEGORY_COLORS: Record<string, string> = {
  supply: "#ef4444",
  demand: "#eab308",
  macro: "#3b82f6",
  general: "#6b7280",
};

// Per-type styling for the F-pin (factory). bg = icon background,
// fg = letter color, letter = single-char glyph in the square,
// label = human-readable subtitle shown in the popup.
// Kept in sync with MapLegend.tsx.
const FACTORY_TYPE_STYLE: Record<string, { bg: string; fg: string; letter: string; label: string }> = {
  mill:      { bg: "#a16207", fg: "#fff", letter: "M", label: "Origin mill / dry processing" },
  roastery:  { bg: "#7c2d12", fg: "#fff", letter: "R", label: "Roastery" },
  soluble:   { bg: "#fde68a", fg: "#1f2937", letter: "S", label: "Soluble (instant)" },
  decaf:     { bg: "#16a34a", fg: "#fff", letter: "D", label: "Decaffeination" },
  capsules:  { bg: "#94a3b8", fg: "#0f172a", letter: "C", label: "Capsules / pods" },
  mixed:     { bg: "#6366f1", fg: "#fff", letter: "F", label: "Mixed-use plant" },
  unknown:   { bg: "#475569", fg: "#cbd5e1", letter: "F", label: "Factory" },
};

// World-clock anchors. Each is placed on the ~5°N parallel (Cape Coast
// latitude) at a longitude roughly under each country, so they sit in the
// equatorial ocean band of the world view without colliding with pins.
const WORLD_CLOCKS: { city: string; tz: string; lat: number; lng: number }[] = [
  { city: "Brazil",  tz: "America/Sao_Paulo",  lat: 5, lng: -50 },
  { city: "Paris",   tz: "Europe/Paris",       lat: 5, lng:   0 },
  { city: "Vietnam", tz: "Asia/Ho_Chi_Minh",   lat: 5, lng: 105 },
];

function formatClock(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

interface CoffeeMapProps {
  onPinClick?: (item: NewsItem) => void;
  countries: CountryPin[];
  factories: FactoryPin[];
  news: NewsItem[];
  /** Set of factory `type` values to hide; empty = all visible. */
  hiddenFactoryTypes?: Set<string>;
}

export default function CoffeeMap({ onPinClick, countries, factories, news, hiddenFactoryTypes }: CoffeeMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const priceMarkersRef = useRef<LeafletMarker[]>([]);
  const freightMarkersRef = useRef<LeafletMarker[]>([]);
  // One Leaflet LayerGroup per factory type, so the filter UI can
  // add/remove entire categories without re-instantiating markers.
  const factoryLayersByTypeRef = useRef<Record<string, LeafletLayerGroup>>({});
  // setInterval id for the world-clock tick loop; cleared on unmount.
  const worldClockIntervalRef = useRef<number | null>(null);
  const [activeBasemap, setActiveBasemap] = useUrlState<string>("basemap", "dark", (raw) =>
    VALID_BASEMAP_IDS.includes(raw) ? raw : "dark"
  );
  const [showBasemapPanel, setShowBasemapPanel] = useState(false);
  // Import-sourcing flow overlay: arcs from origin countries to the US/EU bloc.
  const flowLayerRef = useRef<LeafletLayerGroup | null>(null);
  const [flowDest, setFlowDest] = useUrlState<string>("flows", "off", (raw) =>
    ["off", "US", "EU"].includes(raw) ? raw : "off");
  const [originPrices, setOriginPrices] = useState<OriginPrice[]>([]);
  const [freightData, setFreightData] = useState<{ routes: { id: string; rate: number; prev: number }[] } | null>(null);

  // Permanent price labels for origin pins. Fetch latest_prices + live RC/KC.
  // Acaphe: try /api/live (Redis, updated every 15 min) first; fall back to
  // the static snapshot so the map never goes blank.
  useEffect(() => {
    let cancelled = false;
    const fetchAcaphe = () =>
      fetch("/api/live", { cache: "no-store" })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => (d && !d.error) ? d : Promise.reject())
        .catch(() =>
          fetch("/data/acaphe_live.json").then(r => r.ok ? r.json() : null).catch(() => null)
        );
    Promise.all([
      cachedFetchStatic("/data/latest_prices.json").catch(() => null),
      fetchAcaphe(),
    ]).then(([latest, acaphe]) => {
      if (!cancelled) setOriginPrices(computeOriginPrices(latest as Parameters<typeof computeOriginPrices>[0], acaphe));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetch("/data/freight.json").then(r => r.ok ? r.json() : null).then(setFreightData).catch(() => null);
  }, []);

  // ── Map initialization (runs once) ────────────────────────────────────────
  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;
    // Capture the container node for the cleanup closure — mapRef.current may
    // read differently by teardown, but the node itself is stable for the
    // component's life.
    const mapEl = mapRef.current;
    let cancelled = false;

    import("leaflet").then(async (L) => {
      if (cancelled || !mapRef.current || (mapRef.current as unknown as Record<string, unknown>)._leaflet_id) return;
      // @ts-expect-error — leaflet CSS has no type declarations
      import("leaflet/dist/leaflet.css");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Leaflet: typeof L = ((L as unknown as { default?: typeof L }).default) || L;

      let map;
      try {
        const svgRenderer = Leaflet.svg({ padding: 1 });
        map = Leaflet.map(mapRef.current!, {
          zoomControl: false,
          fadeAnimation: true,
          renderer: svgRenderer,
        }).setView([20, -10], 3);
      } catch {
        return;
      }

      mapInstanceRef.current = map;

      // Initial tile layer (dark)
      tileLayerRef.current = Leaflet.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19 }
      ).addTo(map);

      Leaflet.control.zoom({ position: "topright" }).addTo(map);

      // Flow animation CSS
      if (!document.getElementById("coffee-flow-anim")) {
        const s = document.createElement("style");
        s.id = "coffee-flow-anim";
        s.textContent = `
          @keyframes flowDash { to { stroke-dashoffset: -20; } }
          .flow-route { stroke-dasharray: 12 8; animation: flowDash 1.4s linear infinite; }
          .flow-route-trunk { stroke-dasharray: 16 8; animation: flowDash 1.8s linear infinite; }
          .leaflet-interactive:focus { outline: none !important; }
          .leaflet-container path:focus { outline: none !important; }
        `;
        document.head.appendChild(s);
      }

      // Popup CSS
      if (!document.getElementById("cecafe-popup-style")) {
        const s = document.createElement("style");
        s.id = "cecafe-popup-style";
        s.textContent = `
          .cecafe-popup .leaflet-popup-content-wrapper { background: transparent; box-shadow: none; padding: 0; }
          .cecafe-popup .leaflet-popup-content { margin: 0; }
          .cecafe-popup .leaflet-popup-tip-container { display: none; }
          .leaflet-tooltip-dark { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; font-size: 10px; }
        `;
        document.head.appendChild(s);
      }

      // Load export data
      let cecafeData: CecafeJson | null = null;
      let vnData: VnExportData | null = null;
      try {
        const [cecafeRes, vnRes] = await Promise.all([
          fetch("/data/cecafe.json"),
          fetch("/data/vn_export_destination_port.json"),
        ]);
        if (cecafeRes.ok) cecafeData = await cecafeRes.json();
        if (vnRes.ok) vnData = await vnRes.json();
      } catch { /* silently skip */ }

      // ── Routes ──────────────────────────────────────────────────────────
      const logisticsLayer = Leaflet.layerGroup().addTo(map);
      ROUTES.forEach((r) => {
        if (!r.path || r.path.length === 0) return;

        const routeWeight = r.weight || 2;

        const visualLine = Leaflet.polyline(r.path, {
          color: r.color,
          weight: routeWeight,
          opacity: 0.85,
          interactive: false,
        }).addTo(logisticsLayer);
        const el = (visualLine as { _path?: Element })._path;
        if (el) el.classList.add(routeWeight >= 4 ? "flow-route-trunk" : "flow-route");

        const hasCecafe = r.cecafeHubs && r.cecafeHubs.length > 0 && cecafeData;
        const hasVn = r.vnHubs && r.vnHubs.length > 0 && vnData;

        const hitLine = Leaflet.polyline(r.path, {
          color: "transparent",
          weight: 20,
          opacity: 0,
          bubblingMouseEvents: false,
        });

        if (hasCecafe) {
          const popupHtml = buildRoutePopup(r.cecafeHubs!, cecafeData!);
          hitLine
            .bindTooltip(`${r.name} — click for export data`, { sticky: true, className: "leaflet-tooltip-dark" })
            .bindPopup(popupHtml, { maxWidth: 320, className: "cecafe-popup" });
        } else if (hasVn) {
          const popupHtml = buildVnRoutePopup(r.vnHubs!, vnData!);
          hitLine
            .bindTooltip(`${r.name} — click for VN export data`, { sticky: true, className: "leaflet-tooltip-dark" })
            .bindPopup(popupHtml, { maxWidth: 320, className: "cecafe-popup" });
        } else {
          hitLine.bindTooltip(r.name, { sticky: true });
        }

        hitLine.addTo(logisticsLayer);
      });

      // ── Origin ports (cyan ⚓) ────────────────────────────────────────────
      const portsLayer = Leaflet.layerGroup().addTo(map);
      PORTS.forEach((p) => {
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:#0ea5e9;border:2px solid #fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;">⚓</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        Leaflet.marker(p.l, { icon }).bindPopup(`Port of ${p.n}`).addTo(portsLayer);
      });

      // ── Destination hub markers (amber ◆) ────────────────────────────────
      HUB_PORTS.forEach((h) => {
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:#f59e0b;border:2px solid #fff;border-radius:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:#000;font-size:11px;font-weight:bold;">◆</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        Leaflet.marker(h.l, { icon })
          .bindPopup(`<div style="font-family:monospace;font-size:11px;background:#0f172a;color:#e2e8f0;padding:8px 10px;border-radius:4px;border:1px solid #334155"><b style="color:#f59e0b">${h.hub}</b><br><span style="color:#94a3b8">${h.n}</span></div>`, { className: "cecafe-popup" })
          .addTo(portsLayer);
      });

      // ── Country pins ──────────────────────────────────────────────────────
      const countriesLayer = Leaflet.layerGroup().addTo(map);
      (countries as CountryPin[]).forEach((c) => {
        const isProducer = c.type === "producer";
        const color = isProducer ? "#10b981" : "#3b82f6";
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:12px;height:12px;"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
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
          )
          .addTo(countriesLayer);
      });

      // ── Factory pins ──────────────────────────────────────────────────────
      // Spread exactly-overlapping markers in a small circle so they're all
      // individually clickable. We only displace pins that share IDENTICAL
      // source coords (within float-equality on lat+lng) — near-duplicates
      // already separate at city-level zoom. Displacement is ~50-100 m
      // (0.0005°) so the marker still sits inside the same industrial zone.

      // Defensive dedup BEFORE bucketing. The live DB has occasionally
      // accumulated stale rows from older seed iterations — visible as
      // factories rendered twice at the same coord (e.g. Dallmayr Berlin
      // showing as both F = mixed and R = roastery). If two entries share
      // identical coords AND one carries a specific type (mill / roastery /
      // soluble / decaf / capsules) while the other is the generic
      // "mixed" / "unknown" / null, the generic one is the stale duplicate
      // and we drop it. Same-coord entries with two SPECIFIC types
      // (e.g. one roastery + one mill) are left alone — they're real
      // co-located distinct facilities.
      const SPECIFIC_TYPES = new Set(["mill", "roastery", "soluble", "decaf", "capsules"]);
      const dedupBuckets = new Map<string, FactoryPin[]>();
      for (const f of factories as FactoryPin[]) {
        const k = `${f.lat},${f.lng}`;
        const list = dedupBuckets.get(k);
        if (list) list.push(f); else dedupBuckets.set(k, [f]);
      }
      const dedupedFactories: FactoryPin[] = [];
      dedupBuckets.forEach((list) => {
        if (list.length === 1) {
          dedupedFactories.push(list[0]);
          return;
        }
        const hasSpecific = list.some((f: FactoryPin) => !!f.type && SPECIFIC_TYPES.has(f.type));
        if (!hasSpecific) {
          // All entries are generic — keep them all (no signal to choose).
          dedupedFactories.push(...list);
          return;
        }
        // Drop generic-type ("mixed" / "unknown" / null) when a sibling
        // carries a specific type at the same coord.
        for (const f of list) {
          if (f.type && SPECIFIC_TYPES.has(f.type)) dedupedFactories.push(f);
        }
      });

      const coordBuckets = new Map<string, FactoryPin[]>();
      for (const f of dedupedFactories) {
        const k = `${f.lat},${f.lng}`;
        const list = coordBuckets.get(k);
        if (list) list.push(f); else coordBuckets.set(k, [f]);
      }
      const factoryDisplayCoords = new Map<FactoryPin, [number, number]>();
      coordBuckets.forEach((list) => {
        if (list.length === 1) {
          factoryDisplayCoords.set(list[0], [list[0].lat, list[0].lng]);
          return;
        }
        // Deterministic ordering (alpha by name) so positions are stable.
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
        const N = sorted.length;
        const radius = 0.0006;  // ~67 m at the equator
        sorted.forEach((f, i) => {
          const angle = (i * 2 * Math.PI) / N;
          const dLat = radius * Math.sin(angle);
          const dLng = radius * Math.cos(angle) / Math.cos(f.lat * Math.PI / 180);
          factoryDisplayCoords.set(f, [f.lat + dLat, f.lng + dLng]);
        });
      });
      // One LayerGroup per type, registered on the map. The filter useEffect
      // below adds/removes whole groups when the user toggles types in the
      // legend — avoids rebuilding markers on every toggle.
      const layerByType: Record<string, LeafletLayerGroup> = {};
      dedupedFactories.forEach((f) => {
        const t = (f.type as keyof typeof FACTORY_TYPE_STYLE) || "unknown";
        const style = FACTORY_TYPE_STYLE[t] ?? FACTORY_TYPE_STYLE.unknown;
        // Scale the icon by capacity: sqrt(cap_kt / 30) clamped to [0.85, 1.5]
        // so a 5 kt plant renders at ~14 px and a 80+ kt plant at ~24 px,
        // without the largest entries (300 kt Folgers) blowing up the icon.
        const cap = typeof f.cap_kt === "number" && f.cap_kt > 0 ? f.cap_kt : null;
        const scale = cap ? Math.max(0.85, Math.min(1.5, Math.sqrt(cap / 30))) : 1;
        const px = Math.round(16 * scale);
        const fontPx = Math.max(8, Math.round(9 * scale));
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:${style.bg};color:${style.fg};border:1px solid #fff;border-radius:3px;width:${px}px;height:${px}px;display:flex;align-items:center;justify-content:center;font-size:${fontPx}px;font-weight:700">${style.letter}</div>`,
          iconSize: [px, px],
          iconAnchor: [px / 2, px / 2],
        });
        const subtitle = f.type
          ? `<div style="color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin:2px 0 4px">${style.label}</div>`
          : "";
        const [displayLat, displayLng] = factoryDisplayCoords.get(f) ?? [f.lat, f.lng];
        const capLine = f.capacity ? `<br>Cap: ${f.capacity}` : "";
        const marker = Leaflet.marker([displayLat, displayLng], { icon })
          .bindPopup(`<b>${f.name}</b>${subtitle}${f.company || ""}${capLine}`);
        if (!layerByType[t]) layerByType[t] = Leaflet.layerGroup();
        marker.addTo(layerByType[t]);
      });
      // Add each type-group to the map; filter useEffect will toggle them.
      for (const lg of Object.values(layerByType)) lg.addTo(map);
      factoryLayersByTypeRef.current = layerByType;

      // ── World clocks ──────────────────────────────────────────────────────
      // Three live timezone clocks anchored on the ~5°N parallel (Cape Coast
      // latitude) at Brazilian-Atlantic, Cape-Coast, and Gulf-of-Thailand
      // longitudes. Updates every second via a single interval that mutates
      // the inner DOM nodes — no React re-render needed.
      const clocksLayer = Leaflet.layerGroup().addTo(map);
      const clockMarkers: { marker: LeafletMarker; tz: string }[] = [];
      WORLD_CLOCKS.forEach((c) => {
        const icon = Leaflet.divIcon({
          className: "",
          html: `
            <div style="background:rgba(15,23,42,0.92);border:1px solid #475569;border-radius:6px;padding:4px 8px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.5);pointer-events:none;font-family:ui-monospace,Menlo,monospace">
              <div style="font-size:8px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;line-height:1">${c.city}</div>
              <div data-clock="time" style="font-size:13px;font-weight:700;color:#fff;line-height:1.2;margin-top:2px">--:--:--</div>
            </div>`,
          iconSize: [78, 36],
          iconAnchor: [39, 18],
        });
        const m = Leaflet.marker([c.lat, c.lng], { icon, interactive: false }).addTo(clocksLayer);
        clockMarkers.push({ marker: m as LeafletMarker, tz: c.tz });
      });
      const tick = () => {
        const now = new Date();
        for (const cm of clockMarkers) {
          const el = cm.marker.getElement();
          if (!el) continue;
          const timeEl = el.querySelector<HTMLElement>('[data-clock="time"]');
          if (timeEl) timeEl.textContent = formatClock(cm.tz, now);
        }
      };
      tick();
      worldClockIntervalRef.current = window.setInterval(tick, 1000);

      // ── News pins ─────────────────────────────────────────────────────────
      const newsLayer = Leaflet.layerGroup().addTo(map);
      news
        .filter((item): item is NewsItem & { lat: number; lng: number } =>
          item.lat != null && item.lng != null)
        .forEach((item) => {
          const color = CATEGORY_COLORS[item.category] || "#6b7280";
          const icon = Leaflet.divIcon({
            className: "",
            html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:14px;height:14px;box-shadow:0 0 6px ${color}"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          Leaflet.marker([item.lat, item.lng], { icon })
            .on("click", () => onPinClick && onPinClick(item))
            .addTo(newsLayer);
        });
    });

    return () => {
      cancelled = true;
      if (worldClockIntervalRef.current !== null) {
        clearInterval(worldClockIntervalRef.current);
        worldClockIntervalRef.current = null;
      }
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      if (mapEl) (mapEl as unknown as Record<string, unknown>)._leaflet_id = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Factory type filter (reacts to hiddenFactoryTypes prop) ──────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const layers = factoryLayersByTypeRef.current;
    for (const [type, layer] of Object.entries(layers)) {
      const shouldHide = hiddenFactoryTypes?.has(type) ?? false;
      const isOnMap = map.hasLayer(layer);
      if (shouldHide && isOnMap) map.removeLayer(layer);
      else if (!shouldHide && !isOnMap) layer.addTo(map);
    }
  }, [hiddenFactoryTypes]);

  // ── Basemap switcher (reacts to activeBasemap state) ──────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const bm = BASEMAPS.find((b) => b.id === activeBasemap);
    if (!bm) return;
    import("leaflet").then((L) => {
      const Leaflet = (L as unknown as { default?: typeof L }).default ?? L;
      if (tileLayerRef.current) tileLayerRef.current.remove();
      tileLayerRef.current = Leaflet.tileLayer(bm.url, {
        attribution: bm.attr,
        subdomains: bm.subdomains || "abc",
        maxZoom: 19,
      }).addTo(map);
    });
  }, [activeBasemap]);

  // ── Import-sourcing flow arcs (origins → US/EU bloc) ──────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    let cancelled = false;
    if (flowLayerRef.current) { flowLayerRef.current.remove(); flowLayerRef.current = null; }
    if (flowDest === "off") return;
    import("leaflet").then(async (L) => {
      if (cancelled) return;
      const Leaflet = (L as unknown as { default?: typeof L }).default ?? L;
      const url = flowDest === "US" ? "/data/us_coffee_imports.json" : "/data/eu_coffee_imports.json";
      let data: { origins?: { name: string; latest_mt: number | null }[] } | null = null;
      try { data = await fetch(url).then(r => (r.ok ? r.json() : null)); } catch { data = null; }
      if (cancelled || !data || !mapInstanceRef.current) return;
      const dest = DEST[flowDest];
      const color = flowDest === "US" ? "#0ea5e9" : "#f59e0b";
      const ranked = (data.origins ?? []).filter(o => o.latest_mt).slice(0, 25);
      const maxV = Math.max(...ranked.map(o => o.latest_mt ?? 0), 1);
      const lg = Leaflet.layerGroup();
      const destDot = Leaflet.circleMarker(dest.ll, { radius: 7, color, weight: 2, fillColor: color, fillOpacity: 0.9 });
      destDot.bindTooltip(`${dest.name} — coffee imports by origin`, { direction: "top" }).addTo(lg);
      for (const o of ranked) {
        const c = centroidFor(o.name);
        if (!c) continue;
        const w = 1 + 6 * Math.sqrt((o.latest_mt ?? 0) / maxV);
        Leaflet.polyline(flowArc(c, dest.ll), { color, weight: w, opacity: 0.55, lineCap: "round" })
          .bindTooltip(`${o.name}: ${Math.round((o.latest_mt ?? 0) / 1000).toLocaleString()} kt`, { sticky: true })
          .addTo(lg);
        Leaflet.circleMarker(c, { radius: 2 + 4 * Math.sqrt((o.latest_mt ?? 0) / maxV), color, weight: 1, fillColor: color, fillOpacity: 0.65 })
          .bindTooltip(o.name, { direction: "top" }).addTo(lg);
      }
      lg.addTo(map);
      flowLayerRef.current = lg;
    });
    return () => { cancelled = true; };
  }, [flowDest]);

  // Origin-price permanent labels: standalone markers at hardcoded
  // producer-region coordinates. Independent of the CountryIntel pins,
  // so labels appear even if that DB table is empty or uses unexpected
  // names. Re-runs whenever the prices map refreshes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled) return;
      const Leaflet = (L as unknown as { default?: typeof L }).default ?? L;

      // Drop any existing price markers from a previous render
      priceMarkersRef.current.forEach(m => m.remove());
      priceMarkersRef.current = [];

      originPrices.forEach((price) => {
        // Tiny anchor dot so users can see where the label points to
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:#fbbf24;border:1.5px solid #fff;border-radius:50%;width:8px;height:8px;box-shadow:0 0 4px rgba(251,191,36,0.6);"></div>`,
          iconSize: [8, 8],
          iconAnchor: [4, 4],
        });
        const m = Leaflet.marker([price.lat, price.lng], { icon })
          .bindTooltip(
            `<div class="origin-price-tt-body">` +
              `<div class="origin-price-tt-name">${price.countryName}</div>` +
              `<div class="origin-price-tt-local">${price.local}</div>` +
              `<div class="origin-price-tt-usd">${price.usd}</div>` +
              `<div style="color:${price.diffColor}">${price.diff}</div>` +
            `</div>`,
            { permanent: true, direction: "right", offset: [8, 0], className: "origin-price-tt" },
          )
          .addTo(map);
        priceMarkersRef.current.push(m as LeafletMarker);
      });
    });
    return () => { cancelled = true; };
  }, [originPrices]);

  // ── Freight route labels ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !freightData) return;
    let cancelled = false;

    // Routes derived from base freight data via fixed multipliers
    const FREIGHT_ROUTES: {
      baseId: string; multiplier: number; transitDays: number;
      label: string; pos: [number, number];
    }[] = [
      { baseId: "vn-eu", multiplier: 0.90, transitDays: 27, label: "SGP → ANR", pos: [12.0, 58.0] },
      { baseId: "br-eu", multiplier: 1.00, transitDays: 19, label: "STS → ANR", pos: [22.0, -26.0] },
      { baseId: "co-eu", multiplier: 0.92, transitDays: 15, label: "HND → ANR", pos: [41.0, -36.0] },
    ];

    import("leaflet").then((L) => {
      if (cancelled) return;
      const Leaflet = (L as unknown as { default?: typeof L }).default ?? L;
      freightMarkersRef.current.forEach(m => m.remove());
      freightMarkersRef.current = [];

      FREIGHT_ROUTES.forEach(({ baseId, multiplier, transitDays, label, pos }) => {
        const base = freightData.routes.find(r => r.id === baseId);
        if (!base) return;
        const rate = Math.round(base.rate * multiplier);
        const prev = Math.round(base.prev * multiplier);
        const pct  = prev > 0 ? ((rate - prev) / prev * 100) : 0;
        const sign  = pct >= 0 ? "▲" : "▼";
        const color = pct > 0 ? "#22c55e" : pct < 0 ? "#ef4444" : "#94a3b8";

        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="display:inline-block;background:rgba(15,23,42,0.88);border:1px solid #475569;border-radius:5px;padding:4px 7px;font-family:monospace;font-size:9px;color:#cbd5e1;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none">
            <div style="font-weight:700;color:#fff;letter-spacing:.04em">${label} · ${transitDays}d</div>
            <div style="color:#e2e8f0">$${rate.toLocaleString()}/FEU</div>
            <div style="color:${color}">${sign}${Math.abs(pct).toFixed(1)}% WoW</div>
          </div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        const m = Leaflet.marker(pos, { icon, interactive: false }).addTo(map);
        freightMarkersRef.current.push(m as LeafletMarker);
      });
    });
    return () => { cancelled = true; };
  }, [freightData]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />

      {/* ── Basemap switcher panel ─────────────────────────────────────── */}
      <div style={{ position: "absolute", top: 8, left: 8, zIndex: 1000 }}>
        <button
          onClick={() => setShowBasemapPanel((v) => !v)}
          style={{
            background: "#1e293b",
            border: "1px solid #475569",
            color: "#cbd5e1",
            fontSize: 10,
            padding: "4px 8px",
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          🗺 Map Style
        </button>

        {/* Import-sourcing flow toggle */}
        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 4, background: "#1e293b", border: "1px solid #475569", borderRadius: 4, padding: "3px 6px", fontFamily: "monospace" }}>
          <span style={{ fontSize: 9, color: "#64748b" }}>Import flows</span>
          {(["off", "US", "EU"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setFlowDest(d)}
              style={{
                fontSize: 9,
                padding: "2px 6px",
                borderRadius: 3,
                cursor: "pointer",
                border: "1px solid " + (flowDest === d ? (d === "EU" ? "#f59e0b" : d === "US" ? "#0ea5e9" : "#64748b") : "transparent"),
                background: flowDest === d ? "#0f172a" : "transparent",
                color: flowDest === d ? (d === "EU" ? "#f59e0b" : d === "US" ? "#38bdf8" : "#cbd5e1") : "#94a3b8",
                fontFamily: "monospace",
              }}
            >
              {d === "off" ? "Off" : d}
            </button>
          ))}
        </div>

        {showBasemapPanel && (
          <div
            style={{
              marginTop: 4,
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: 8,
              width: 200,
            }}
          >
            <div style={{ fontSize: 9, color: "#64748b", marginBottom: 6, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Basemap
            </div>
            {BASEMAPS.map((bm) => (
              <button
                key={bm.id}
                onClick={() => { setActiveBasemap(bm.id); setShowBasemapPanel(false); }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: activeBasemap === bm.id ? "#1e3a5f" : "transparent",
                  border: activeBasemap === bm.id ? "1px solid #3b82f6" : "1px solid transparent",
                  borderRadius: 4,
                  padding: "5px 8px",
                  marginBottom: 3,
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                <div style={{ fontSize: 11, color: activeBasemap === bm.id ? "#93c5fd" : "#cbd5e1", fontWeight: 600 }}>
                  {bm.label}
                </div>
                <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>
                  {bm.desc}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
