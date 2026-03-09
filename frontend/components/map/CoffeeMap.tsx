"use client";
import { useEffect, useRef } from "react";
import { PORTS, ROUTES, MAP_CONFIG } from "@/lib/mapData";

interface CoffeeMapProps {
  onPinClick?: (item: any) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  supply: "#ef4444",
  demand: "#eab308",
  macro: "#3b82f6",
  general: "#6b7280",
};

export default function CoffeeMap({ onPinClick }: CoffeeMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;

    import("leaflet").then(async (L) => {
      // @ts-ignore
      import("leaflet/dist/leaflet.css");

      const map = (L as any).default
        ? (L as any).default.map(mapRef.current!, { zoomControl: false, fadeAnimation: true }).setView(MAP_CONFIG.initView, MAP_CONFIG.initZoom)
        : (L as any).map(mapRef.current!, { zoomControl: false, fadeAnimation: true }).setView(MAP_CONFIG.initView, MAP_CONFIG.initZoom);

      mapInstanceRef.current = map;

      const Leaflet = (L as any).default || L;

      Leaflet.tileLayer(MAP_CONFIG.theme, {
        attribution: "&copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      Leaflet.control.zoom({ position: "topright" }).addTo(map);

      // Logistics routes
      const logisticsLayer = Leaflet.layerGroup().addTo(map);
      ROUTES.forEach((r) => {
        if (r.path && r.path.length > 0) {
          Leaflet.polyline(r.path, {
            color: r.color,
            weight: r.weight || 2,
            opacity: 0.8,
          })
            .bindTooltip(r.name)
            .addTo(logisticsLayer);
        }
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

      // Country pins
      const { fetchMapCountries, fetchMapFactories, fetchNews } = await import("@/lib/api");

      const countriesLayer = Leaflet.layerGroup().addTo(map);
      fetchMapCountries().then((countries: any[]) => {
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
      });

      // Factory pins
      const factoriesLayer = Leaflet.layerGroup().addTo(map);
      fetchMapFactories().then((factories: any[]) => {
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
      });

      // News pins
      const newsLayer = Leaflet.layerGroup().addTo(map);
      fetchNews().then((items: any[]) => {
        items
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
    });

    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}
