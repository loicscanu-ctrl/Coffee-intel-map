"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup as LeafletLayerGroup, Map as LeafletMap } from "leaflet";
import { RISK_META, type EnsoRiskPin, type RiskLevel } from "@/lib/enso";

const LEVELS: RiskLevel[] = ["high", "moderate", "low"];

export default function EnsoRiskMap({ pins }: { pins: EnsoRiskPin[] }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Record<RiskLevel, LeafletLayerGroup | null>>({ high: null, moderate: null, low: null });
  const [hidden, setHidden] = useState<Set<RiskLevel>>(() => new Set());

  const summary = useMemo(() => {
    const s: Record<RiskLevel, number> = { high: 0, moderate: 0, low: 0 };
    for (const p of pins) s[p.level] += 1;
    return s;
  }, [pins]);

  // Build the map once.
  useEffect(() => {
    if (mapInstanceRef.current || !mapRef.current) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current || (mapRef.current as unknown as Record<string, unknown>)._leaflet_id) return;
      // @ts-expect-error — leaflet CSS has no type declarations
      import("leaflet/dist/leaflet.css");
      const Leaflet: typeof L = ((L as unknown as { default?: typeof L }).default) || L;

      const map = Leaflet.map(mapRef.current!, { zoomControl: false, worldCopyJump: true }).setView([8, 0], 2);
      mapInstanceRef.current = map;
      Leaflet.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "© CARTO", subdomains: "abcd", maxZoom: 19 }
      ).addTo(map);
      Leaflet.control.zoom({ position: "topright" }).addTo(map);

      const groups: Record<RiskLevel, LeafletLayerGroup> = {
        high: Leaflet.layerGroup(),
        moderate: Leaflet.layerGroup(),
        low: Leaflet.layerGroup(),
      };
      for (const p of pins) {
        const radius = p.level === "high" ? 9 : p.level === "moderate" ? 7 : 5;
        Leaflet.circleMarker([p.lat, p.lon], {
          radius,
          color: p.color,
          fillColor: p.color,
          fillOpacity: 0.55,
          weight: 1.5,
        })
          .bindPopup(
            `<b>${p.region}</b> · ${p.country}<br/>Risk: <b style="color:${p.color}">${RISK_META[p.level].label}</b><br/>${p.driver}`
          )
          .addTo(groups[p.level]);
      }
      LEVELS.forEach((lvl) => groups[lvl].addTo(map));
      layersRef.current = groups;
    });

    return () => {
      cancelled = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [pins]);

  // Toggle level layers on/off.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    LEVELS.forEach((lvl) => {
      const group = layersRef.current[lvl];
      if (!group) return;
      const isHidden = hidden.has(lvl);
      if (isHidden && map.hasLayer(group)) map.removeLayer(group);
      if (!isHidden && !map.hasLayer(group)) group.addTo(map);
    });
  }, [hidden]);

  const toggle = (lvl: RiskLevel) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Crop-risk map · click a region for the ENSO driver
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {LEVELS.map((lvl) => {
            const off = hidden.has(lvl);
            return (
              <button
                key={lvl}
                onClick={() => toggle(lvl)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border transition ${
                  off ? "border-slate-700 text-slate-600" : "border-slate-600 text-slate-200"
                }`}
                title={off ? `Show ${RISK_META[lvl].label}` : `Hide ${RISK_META[lvl].label}`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: off ? "transparent" : RISK_META[lvl].color, border: `1px solid ${RISK_META[lvl].color}` }}
                />
                {RISK_META[lvl].label} ({summary[lvl]})
              </button>
            );
          })}
        </div>
      </div>
      <div ref={mapRef} className="w-full rounded-md overflow-hidden" style={{ height: 360, background: "#0f172a" }} />
    </div>
  );
}
