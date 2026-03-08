"use client";
import { useEffect, useRef } from "react";
import { PORTS, ROUTES, MAP_CONFIG } from "@/lib/mapData";

export default function CoffeeMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;

    import("leaflet").then((L) => {
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
    });

    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return <div ref={mapRef} style={{ width: "100%", height: "100%" }} />;
}
