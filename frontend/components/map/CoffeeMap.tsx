"use client";
import { useEffect, useRef } from "react";
import { PORTS, ROUTES, MAP_CONFIG } from "@/lib/mapData";

// ── Hub → Portuguese country list (subset used for aggregation) ──────────────
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

const CATEGORY_COLORS: Record<string, string> = {
  supply: "#ef4444",
  demand: "#eab308",
  macro: "#3b82f6",
  general: "#6b7280",
};

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
      } catch {
        return;
      }

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

      // Load Cecafe data for route popups
      let cecafeData: CecafeJson | null = null;
      try {
        const res = await fetch("/data/cecafe.json");
        if (res.ok) cecafeData = await res.json();
      } catch { /* silently skip */ }

      // Logistics routes
      const logisticsLayer = Leaflet.layerGroup().addTo(map);
      ROUTES.forEach((r) => {
        if (!r.path || r.path.length === 0) return;

        // Visual line — not interactive so hover cursor doesn't fight with the hit area
        const visualLine = Leaflet.polyline(r.path, {
          color: r.color,
          weight: r.weight || 2,
          opacity: 0.85,
          interactive: false,
        }).addTo(logisticsLayer);
        const el = (visualLine as any)._path;
        if (el) el.classList.add(r.weight && r.weight >= 4 ? "flow-route-trunk" : "flow-route");

        // Wide transparent hit-area on top for easy clicking
        const hasExport = r.cecafeHubs && r.cecafeHubs.length > 0 && cecafeData;
        const hitLine = Leaflet.polyline(r.path, {
          color: "transparent",
          weight: 20,
          opacity: 0,
          bubblingMouseEvents: false,
        });

        if (hasExport) {
          const popupHtml = buildRoutePopup(r.cecafeHubs!, cecafeData!);
          hitLine
            .bindTooltip(`${r.name} — click for export data`, { sticky: true, className: "leaflet-tooltip-dark" })
            .bindPopup(popupHtml, { maxWidth: 320, className: "cecafe-popup" });
          // Inject popup CSS once
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
        } else {
          hitLine.bindTooltip(r.name, { sticky: true });
        }

        hitLine.addTo(logisticsLayer);
      });

      // Ports
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

      // Country pins (from props)
      const countriesLayer = Leaflet.layerGroup().addTo(map);
      countries.forEach((c: any) => {
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

      // Factory pins (from props)
      const factoriesLayer = Leaflet.layerGroup().addTo(map);
      factories.forEach((f: any) => {
        const icon = Leaflet.divIcon({
          className: "",
          html: `<div style="background:#6366f1;border:1px solid #fff;border-radius:3px;width:16px;height:16px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;">F</div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        Leaflet.marker([f.lat, f.lng], { icon })
          .bindPopup(`<b>${f.name}</b><br>${f.company || ""}<br>Cap: ${f.capacity || ""}`)
          .addTo(factoriesLayer);
      });

      // News pins (from props)
      const newsLayer = Leaflet.layerGroup().addTo(map);
      news
        .filter((item: any) => item.lat != null && item.lng != null)
        .forEach((item: any) => {
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
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      if (mapRef.current) (mapRef.current as any)._leaflet_id = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}
