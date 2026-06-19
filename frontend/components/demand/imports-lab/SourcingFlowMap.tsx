"use client";
import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { centroidFor, DEST } from "./centroids";

interface Origin { name: string; latest_mt: number | null }

// Draw a slightly-curved arc between two [lat,lng] points (quadratic bezier
// sampled into a polyline) so overlapping flows fan out instead of stacking.
function arc(a: [number, number], b: [number, number], bend = 0.18): [number, number][] {
  const [la, loa] = a, [lb, lob] = b;
  const mx = (la + lb) / 2, my = (loa + lob) / 2;
  const dx = lb - la, dy = lob - loa;
  // perpendicular offset for the control point
  const cx = mx - dy * bend, cy = my + dx * bend;
  const pts: [number, number][] = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const x = (1 - t) ** 2 * la + 2 * (1 - t) * t * cx + t * t * lb;
    const y = (1 - t) ** 2 * loa + 2 * (1 - t) * t * cy + t * t * lob;
    pts.push([x, y]);
  }
  return pts;
}

export default function SourcingFlowMap({ origins, dest, color }: {
  origins: Origin[]; dest: "US" | "EU"; color: string;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      // @ts-expect-error — leaflet CSS has no type declarations
      import("leaflet/dist/leaflet.css");
      const Leaflet: typeof L = ((L as unknown as { default?: typeof L }).default) || L;
      if (cancelled || !elRef.current) return;

      if (!mapRef.current) {
        mapRef.current = Leaflet.map(elRef.current, {
          center: [25, -20], zoom: 2, minZoom: 1, maxZoom: 5,
          worldCopyJump: true, attributionControl: false, zoomControl: true,
        });
        Leaflet.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
          { subdomains: "abcd", maxZoom: 19 }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      if (!map) return;

      // clear previous arc/marker layers (keep the tile layer)
      map.eachLayer((layer) => {
        if ((layer as { _coffeeArc?: boolean })._coffeeArc) map.removeLayer(layer);
      });

      const d = DEST[dest];
      const ranked = origins.filter(o => o.latest_mt).slice(0, 25);
      const maxV = Math.max(...ranked.map(o => o.latest_mt ?? 0), 1);

      // destination marker
      const destDot = Leaflet.circleMarker(d.ll, {
        radius: 7, color, weight: 2, fillColor: color, fillOpacity: 0.9,
      });
      (destDot as { _coffeeArc?: boolean })._coffeeArc = true;
      destDot.bindTooltip(d.name, { direction: "top" }).addTo(map);

      for (const o of ranked) {
        const c = centroidFor(o.name);
        if (!c) continue;
        const w = 1 + 6 * Math.sqrt((o.latest_mt ?? 0) / maxV);
        const line = Leaflet.polyline(arc(c, d.ll), {
          color, weight: w, opacity: 0.55, lineCap: "round",
        });
        (line as { _coffeeArc?: boolean })._coffeeArc = true;
        line.bindTooltip(`${o.name}: ${Math.round((o.latest_mt ?? 0) / 1000).toLocaleString()} kt`,
          { sticky: true });
        line.addTo(map);
        const src = Leaflet.circleMarker(c, {
          radius: 2 + 4 * Math.sqrt((o.latest_mt ?? 0) / maxV),
          color, weight: 1, fillColor: color, fillOpacity: 0.65,
        });
        (src as { _coffeeArc?: boolean })._coffeeArc = true;
        src.bindTooltip(o.name, { direction: "top" }).addTo(map);
      }
    });
    return () => { cancelled = true; };
  }, [origins, dest, color]);

  // tear down on unmount
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  return <div ref={elRef} className="h-[420px] w-full rounded-lg overflow-hidden border border-slate-700" />;
}
