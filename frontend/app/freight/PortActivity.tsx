"use client";
import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SeasonalRow } from "./FreightCharts";
import { VESSEL_TYPE_META, VESSEL_TYPE_KEYS, type VesselTypeKey } from "./vesselTypes";
import { calIdx, MONTHS } from "./seasonal";

// Heavy recharts bundle — lazy-load (client-only) like the other freight charts.
const SeasonalChart = dynamic(
  () => import("./FreightCharts").then((m) => m.SeasonalChart),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse" /> },
);

const METRICS = [
  { key: "portcalls", label: "Port Calls",        sub: "Arrival of ships · daily count" },
  { key: "import",    label: "Incoming Shipment", sub: "Estimated imports · metric tons" },
  { key: "export",    label: "Outgoing Shipment", sub: "Estimated exports · metric tons" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

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
  // Both views are seasonal calendar overlays: "daily" = per-day; "cumulative"
  // = running total from Jan 1. Default: daily.
  const [view, setView] = useState<"daily" | "cumulative">("daily");
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

  const unit = metric === "portcalls" ? "count" : "tons";
  const activeMetric = METRICS.find((m) => m.key === metric)!;

  // Seasonal (year-over-year) data, built once for both views. Each year is
  // aligned on a Jan→Dec calendar index. We produce two row sets:
  //   • daily      — per-day total, 7-day smoothed
  //   • cumulative — running total from Jan 1
  // Each overlays the latest 3 years (current / prev / prev2) and a grey min–max
  // band across the *prior* years (excluding the current year).
  const seasonal = useMemo(() => {
    if (!port) return null;
    const byYear: Record<number, Record<number, number>> = {};   // collapsed daily
    const cumByYear: Record<number, Record<number, number>> = {}; // running total
    const run: Record<number, number> = {};
    // port.series is already date-sorted (scraper orders by year,month,day), so a
    // single forward pass yields a correct running total per year.
    for (const pt of port.series) {
      const [Y, M, D] = pt.date.split("-").map(Number);
      const idx = calIdx(M, D);
      const val = activeTypes.reduce((a, t) => a + (Number(pt[`${metric}_${t}`]) || 0), 0);
      (byYear[Y] ||= {})[idx] = val;
      run[Y] = (run[Y] || 0) + val;
      (cumByYear[Y] ||= {})[idx] = run[Y];
    }
    const allYears = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    if (allYears.length === 0) return null;
    const curY = allYears[allYears.length - 1];
    const prevY = curY - 1;
    const prev2Y = curY - 2;

    // Trailing 7-point MA within each year (data is daily/contiguous).
    const smooth: Record<number, Record<number, number>> = {};
    for (const y of allYears) {
      const idxs = Object.keys(byYear[y]).map(Number).sort((a, b) => a - b);
      const win: number[] = [];
      const out: Record<number, number> = {};
      for (const i of idxs) {
        win.push(byYear[y][i]);
        if (win.length > 7) win.shift();
        out[i] = win.reduce((a, b) => a + b, 0) / win.length;
      }
      smooth[y] = out;
    }

    const priorYears = allYears.filter((y) => y < curY); // band excludes current year
    const buildRows = (src: Record<number, Record<number, number>>): SeasonalRow[] => {
      const out: SeasonalRow[] = [];
      for (let i = 1; i <= 365; i++) {
        const band = priorYears.map((y) => src[y]?.[i]).filter((v): v is number => v != null);
        out.push({
          idx: i,
          cur: src[curY]?.[i] ?? null,
          prev: src[prevY]?.[i] ?? null,
          prev2: src[prev2Y]?.[i] ?? null,
          band: band.length ? [Math.min(...band), Math.max(...band)] : null,
        });
      }
      return out;
    };
    const rows = buildRows(smooth);
    const cumRows = buildRows(cumByYear);

    // YTD: current year vs prior year over the same elapsed calendar window.
    const curIdxs = Object.keys(byYear[curY]).map(Number);
    const latest = curIdxs.length ? Math.max(...curIdxs) : 0;
    const ytd = (y: number) =>
      Object.entries(byYear[y] || {}).reduce((a, [i, v]) => (Number(i) <= latest ? a + v : a), 0);
    const ytdCur = ytd(curY);
    const ytdPrev = ytd(prevY);
    const ytdPct = ytdPrev > 0 ? ((ytdCur - ytdPrev) / ytdPrev) * 100 : null;

    // Current-month cumulative: the month of the latest data point, with each
    // year's running total within that month (x axis = day-of-month).
    const curM = Number(port.series[port.series.length - 1].date.slice(5, 7));
    const domByYear: Record<number, Record<number, number>> = {};
    const monthRun: Record<number, number> = {};
    let daysInMonth = 0;
    for (const pt of port.series) {
      if (Number(pt.date.slice(5, 7)) !== curM) continue;
      const Y = Number(pt.date.slice(0, 4));
      const D = Number(pt.date.slice(8, 10));
      const val = activeTypes.reduce((a, t) => a + (Number(pt[`${metric}_${t}`]) || 0), 0);
      monthRun[Y] = (monthRun[Y] || 0) + val;
      (domByYear[Y] ||= {})[D] = monthRun[Y];
      if (D > daysInMonth) daysInMonth = D;
    }
    const monthRows: SeasonalRow[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const band = priorYears.map((y) => domByYear[y]?.[d]).filter((v): v is number => v != null);
      monthRows.push({
        idx: d,
        cur: domByYear[curY]?.[d] ?? null,
        prev: domByYear[prevY]?.[d] ?? null,
        prev2: domByYear[prev2Y]?.[d] ?? null,
        band: band.length ? [Math.min(...band), Math.max(...band)] : null,
      });
    }
    const month = { name: MONTHS[curM - 1], days: daysInMonth };

    return {
      rows, cumRows, monthRows, month,
      years: { cur: curY, prev: prevY, prev2: prev2Y }, ytdCur, ytdPct,
    };
  }, [port, metric, activeTypes]);

  // Day-of-month ticks for the monthly chart: 1, 5, 10, … plus the last day.
  const monthTicks = useMemo(() => {
    const days = seasonal?.month.days ?? 0;
    if (!days) return [] as number[];
    const t = [1];
    for (let d = 5; d < days; d += 5) t.push(d);
    if (t[t.length - 1] !== days) t.push(days);
    return t;
  }, [seasonal?.month.days]);

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
          {/* Metric tabs + view toggle */}
          <div className="flex items-end justify-between gap-2 border-b border-slate-800">
            <div className="flex gap-1">
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
            <div className="flex gap-0.5 mb-1 bg-slate-800 rounded p-0.5">
              {([["daily", "Daily"], ["cumulative", "Cumulative"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2.5 py-0.5 text-[10px] rounded transition-colors ${
                    view === v ? "bg-sky-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Sub-header: metric description + YTD-vs-prior-year */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[10px] text-slate-500">
              {activeMetric.sub}
              {seasonal && (
                <span className="ml-2 text-slate-400">
                  · {seasonal.years.cur} YTD {unit === "tons"
                      ? `${Math.round(seasonal.ytdCur).toLocaleString("en-US")} t`
                      : `${Math.round(seasonal.ytdCur).toLocaleString("en-US")} calls`}
                  {seasonal.ytdPct != null && (
                    <span className={seasonal.ytdPct >= 0 ? "text-emerald-400 ml-1" : "text-red-400 ml-1"}>
                      ({seasonal.ytdPct >= 0 ? "+" : ""}{seasonal.ytdPct.toFixed(1)}% vs {seasonal.years.prev})
                    </span>
                  )}
                </span>
              )}
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
          ) : seasonal ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Full-year seasonal (daily or cumulative per the toggle) */}
              <div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                  Full year · {view === "cumulative" ? "cumulative" : "daily"}
                </div>
                <SeasonalChart
                  data={view === "cumulative" ? seasonal.cumRows : seasonal.rows}
                  unit={unit}
                  years={seasonal.years}
                />
              </div>
              {/* Current month, cumulative day-by-day */}
              <div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                  {seasonal.month.name} · month-to-date cumulative
                </div>
                <SeasonalChart
                  data={seasonal.monthRows}
                  unit={unit}
                  years={seasonal.years}
                  xDomain={[1, seasonal.month.days]}
                  xTicks={monthTicks}
                  xTickFormat={(d) => `${d}`}
                  xLabelFormat={(d) => `${seasonal.month.name} ${d}`}
                />
              </div>
            </div>
          ) : null}

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
