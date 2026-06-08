"use client";
import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { PortActivityRow } from "./FreightCharts";
import { VESSEL_TYPE_META, VESSEL_TYPE_KEYS, type VesselTypeKey } from "./vesselTypes";

// Heavy recharts bundle — lazy-load (client-only) like the other freight charts.
const PortActivityChart = dynamic(
  () => import("./FreightCharts").then((m) => m.PortActivityChart),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse" /> },
);

const VESSEL_TYPES = VESSEL_TYPE_KEYS;

const METRICS = [
  { key: "portcalls", label: "Port Calls",        sub: "Arrival of ships · daily count" },
  { key: "import",    label: "Incoming Shipment", sub: "Estimated imports · metric tons" },
  { key: "export",    label: "Outgoing Shipment", sub: "Estimated exports · metric tons" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

const RANGES = [
  { k: "1m", days: 30 },
  { k: "3m", days: 90 },
  { k: "6m", days: 180 },
  { k: "1y", days: 365 },
  { k: "all", days: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["k"];

type SeriesPoint = { date: string } & Record<string, number | string>;
// Index lists ports without their (heavy) series; the series lives in a
// per-port file fetched on demand.
type PortMeta = {
  key: string; portid: string; name: string; label: string;
  country: string; note: string; start: string; end: string;
};
type Port = PortMeta & { series: SeriesPoint[] };
type PortActivityIndex = {
  updated: string; source: string; dataset: string;
  vessel_types: string[]; ports: PortMeta[];
};

export default function PortActivity() {
  const [data, setData] = useState<PortActivityIndex | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [portKey, setPortKey] = useState<string>("");
  const [metric, setMetric] = useState<MetricKey>("portcalls");
  const [range, setRange] = useState<RangeKey>("3m");
  // Which vessel types are shown — toggled via the chips below. Default: all.
  const [activeTypes, setActiveTypes] = useState<VesselTypeKey[]>([...VESSEL_TYPE_KEYS]);
  // Per-port series fetched lazily and cached so re-selecting a port is instant.
  const [portCache, setPortCache] = useState<Record<string, Port>>({});

  const toggleType = (k: VesselTypeKey) =>
    setActiveTypes((cur) =>
      cur.includes(k) ? cur.filter((t) => t !== k) : [...VESSEL_TYPE_KEYS.filter((t) => cur.includes(t) || t === k)],
    );

  // Load the lightweight index up front.
  useEffect(() => {
    fetch("/data/port_activity/index.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: PortActivityIndex) => { setData(d); setPortKey(d.ports?.[0]?.key ?? ""); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Fetch the selected port's series on demand (once).
  useEffect(() => {
    if (!portKey || portCache[portKey]) return;
    let cancelled = false;
    fetch(`/data/port_activity/${portKey}.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((p: Port) => { if (!cancelled) setPortCache((c) => ({ ...c, [p.key]: p })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [portKey, portCache]);

  const port = portCache[portKey];
  const portMeta = useMemo(
    () => data?.ports.find((p) => p.key === portKey) ?? data?.ports[0],
    [data, portKey],
  );

  // Build chart rows: per-vessel-type values for the selected metric plus a
  // 7-day trailing moving average of the daily total. The MA is computed over
  // the *full* series first, then the visible window is sliced out — so the
  // left edge of a zoomed view still shows a correct trailing average.
  const chartData: PortActivityRow[] = useMemo(() => {
    if (!port) return [];
    // Total (and thus the moving average) reflects only the selected vessel types.
    const totals = port.series.map((pt) =>
      activeTypes.reduce((acc, t) => acc + (Number(pt[`${metric}_${t}`]) || 0), 0),
    );
    const ma = totals.map((_, i) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { sum += totals[j]; n++; }
      return n ? sum / n : 0;
    });

    const span = RANGES.find((r) => r.k === range)!.days;
    const start = span === Infinity ? 0 : Math.max(0, port.series.length - span);

    return port.series.slice(start).map((pt, idx) => {
      const i = start + idx;
      const row = { date: pt.date, ma: Math.round(ma[i] * 10) / 10 } as PortActivityRow;
      for (const t of VESSEL_TYPES) {
        (row as Record<string, number | string>)[t] = Number(pt[`${metric}_${t}`]) || 0;
      }
      return row;
    });
  }, [port, metric, range, activeTypes]);

  const unit = metric === "portcalls" ? "count" : "tons";
  const activeMetric = METRICS.find((m) => m.key === metric)!;

  // Window total + a vs-prior-window delta for a quick at-a-glance read.
  // Both sums respect the selected vessel types.
  const summary = useMemo(() => {
    if (chartData.length === 0) return null;
    const sumRow = (pt: SeriesPoint) =>
      activeTypes.reduce((a, t) => a + (Number(pt[`${metric}_${t}`]) || 0), 0);
    const cur = chartData.reduce((a, r) => {
      const rr = r as unknown as Record<string, number>;
      return a + activeTypes.reduce((s, t) => s + (rr[t] || 0), 0);
    }, 0);
    const span = chartData.length;
    const prevRows = port!.series.slice(
      Math.max(0, port!.series.length - 2 * span),
      Math.max(0, port!.series.length - span),
    );
    const prev = prevRows.reduce((a, pt) => a + sumRow(pt), 0);
    const pct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    return { cur, pct };
  }, [chartData, port, metric, activeTypes]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
            Port Activity — IMF PortWatch
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">
            Satellite-tracked vessel calls &amp; trade-volume estimates at coffee export gateways
          </div>
        </div>
        {/* Port selector */}
        {data && portMeta && (
          <select
            value={portKey}
            onChange={(e) => setPortKey(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 px-2 py-1 focus:outline-none focus:border-sky-600"
          >
            {data.ports.map((p) => (
              <option key={p.key} value={p.key}>{p.label} · {p.country}</option>
            ))}
          </select>
        )}
      </div>

      {/* Empty / loading state */}
      {!data && (
        <div className="h-[300px] flex items-center justify-center text-slate-500 text-xs text-center px-6">
          {loaded
            ? "Port activity data not yet available — pending the first PortWatch scrape (workflow 1.11)."
            : "Loading port activity…"}
        </div>
      )}

      {data && portMeta && (
        <>
          {/* Metric tabs */}
          <div className="flex gap-1 border-b border-slate-800">
            {METRICS.map((m) => {
              const on = m.key === metric;
              return (
                <button
                  key={m.key}
                  onClick={() => setMetric(m.key)}
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    on ? "border-sky-500 text-sky-300" : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Sub-header: metric description, window total, range buttons */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[10px] text-slate-500">
              {activeMetric.sub}
              {summary && (
                <span className="ml-2 text-slate-400">
                  · {unit === "tons"
                      ? `${Math.round(summary.cur).toLocaleString("en-US")} t`
                      : `${Math.round(summary.cur).toLocaleString("en-US")} calls`} this window
                  {summary.pct != null && (
                    <span className={summary.pct >= 0 ? "text-emerald-400 ml-1" : "text-red-400 ml-1"}>
                      ({summary.pct >= 0 ? "+" : ""}{summary.pct.toFixed(1)}% vs prior)
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.k}
                  onClick={() => setRange(r.k)}
                  className={`px-2 py-0.5 text-[10px] rounded font-mono uppercase ${
                    r.k === range ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {r.k}
                </button>
              ))}
            </div>
          </div>

          {/* Vessel-type filter — toggle which types are shown/summed */}
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider mr-1">Vessel types</span>
            {VESSEL_TYPE_META.map((t) => {
              const on = activeTypes.includes(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => toggleType(t.key)}
                  aria-pressed={on}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                    on
                      ? "border-slate-600 bg-slate-800 text-slate-200"
                      : "border-slate-800 bg-transparent text-slate-600 hover:text-slate-400"
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: on ? t.color : "transparent", border: `1px solid ${t.color}` }}
                  />
                  {t.label}
                </button>
              );
            })}
            {activeTypes.length !== VESSEL_TYPE_META.length && (
              <button
                onClick={() => setActiveTypes([...VESSEL_TYPE_KEYS])}
                className="ml-1 px-2 py-0.5 text-[10px] rounded-full text-sky-400 hover:text-sky-300"
              >
                Reset
              </button>
            )}
          </div>

          {!port ? (
            <div className="h-[300px] flex items-center justify-center text-slate-500 text-xs animate-pulse">
              Loading {portMeta.label}…
            </div>
          ) : activeTypes.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-slate-500 text-xs">
              Select at least one vessel type to display.
            </div>
          ) : (
            <PortActivityChart data={chartData} unit={unit} activeTypes={activeTypes} />
          )}

          <div className="text-[9px] text-slate-600 italic border-t border-slate-800 pt-2 flex justify-between flex-wrap gap-1">
            <span>{portMeta.name} ({portMeta.portid}) — {portMeta.note}</span>
            <span>
              Source: {data.source}
              {data.updated && ` · updated ${data.updated.slice(0, 10)}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
