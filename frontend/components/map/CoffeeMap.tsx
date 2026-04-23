"use client";
import { useEffect, useRef, useState } from "react";
import { PORTS, HUB_PORTS, ROUTES, BASEMAPS } from "@/lib/mapData";

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

interface CoffeeMapProps {
  onPinClick?: (item: any) => void;
  countries: any[];
  factories: any[];
  news: any[];
}

export default function CoffeeMap({ onPinClick, countries, factories, news }: CoffeeMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const [activeBasemap, setActiveBasemap] = useState("dark");
  const [showBasemapPanel, setShowBasemapPanel] = useState(false);

  // ── Map initialization (runs once) ────────────────────────────────────────
  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;
    let cancelled = false;

    import("leaflet").then(async (L) => {
      if (cancelled || !mapRef.current || (mapRef.current as any)._leaflet_id) return;
      // @ts-ignore
      import("leaflet/dist/leaflet.css");

      const Leaflet = (L as any).default || L;

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

        const visualLine = Leaflet.polyline(r.path, {
          color: r.color,
          weight: r.weight || 2,
          opacity: 0.85,
          interactive: false,
        }).addTo(logisticsLayer);
        const el = (visualLine as any)._path;
        if (el) el.classList.add(r.weight && r.weight >= 4 ? "flow-route-trunk" : "flow-route");

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

      // ── Factory pins ──────────────────────────────────────────────────────
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

      // ── News pins ─────────────────────────────────────────────────────────
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

  // ── Basemap switcher (reacts to activeBasemap state) ──────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const bm = BASEMAPS.find((b) => b.id === activeBasemap);
    if (!bm) return;
    import("leaflet").then((L) => {
      const Leaflet = (L as any).default || L;
      if (tileLayerRef.current) tileLayerRef.current.remove();
      tileLayerRef.current = Leaflet.tileLayer(bm.url, {
        attribution: bm.attr,
        subdomains: bm.subdomains || "abc",
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);
    });
  }, [activeBasemap]);

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
