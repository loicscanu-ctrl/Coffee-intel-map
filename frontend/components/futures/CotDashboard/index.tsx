"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchMacroCot, type MacroCotWeek, type CotWeekly } from "@/lib/api";
import { buildGlobalFlowMetrics } from "@/lib/pdf/dataHelpers";
import type { GlobalFlowMetrics } from "@/lib/pdf/types";
import { transformApiData } from "@/lib/cot/transformApiData";
import { buildStandaloneHtml } from "@/lib/cot/standaloneTemplate";
import { useUrlState } from "@/lib/useUrlState";

import { NAV_STEPS } from "./constants";
import { generateData } from "./generateData";
import { ICONS } from "./icons";
import type { Step } from "./types";

import Overview from "./Overview";
import CotGauges from "./Gauges";
import CotHeatmap from "./Heatmap";
import Step1GlobalFlow from "./Step1GlobalFlow";
import Step4IndustryPulse from "./Step4IndustryPulse";
import Step5DryPowder from "./Step5DryPowder";
import Step6CycleLocation from "./Step6CycleLocation";
import Step7Report from "./Step7Report";
import Step8Analysis from "./Step8Analysis";
import OIHistoryTable from "@/components/futures/OIHistoryTable";
import PinToReport from "@/components/report/PinToReport";
import { evaluateSignals, evaluateHistoricalSignals } from "@/lib/cot/signalEngine";

export default function CotDashboard() {
  const [step, setStep] = useUrlState<Step>("step", 10, (raw) => {
    const n = Number(raw);
    return ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as number[]).includes(n) ? (n as Step) : 10;
  });
  const [cotRows, setCotRows] = useState<CotWeekly[] | null>(null);
  const [cotError, setCotError] = useState(false);
  const [macroData, setMacroData] = useState<MacroCotWeek[]>([]);
  const [macroError, setMacroError] = useState(false);

  useEffect(() => {
    // Single source: the static cot.json published by the daily export
    // (export_static_json → workflow 1.4). COT is a WEEKLY series, so the
    // static snapshot is as fresh as a live /api/cot fetch would be — and
    // it's a CDN-cached file, so we skip the redundant 3 MB live re-fetch
    // (and the backend dependency) entirely. Full history stays in the DB /
    // /api/cot for anyone who needs it; the published file is trimmed to the
    // window the dashboard actually renders (see export_cot).
    fetch("/data/cot.json")
      .then(r => (r.ok ? r.json() : null))
      .then((rows: CotWeekly[] | null) => {
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          setCotError(true);   // no static data → fall back to mock + banner
          return;
        }
        setCotRows(rows as CotWeekly[]);
      })
      .catch(() => setCotError(true));

    fetchMacroCot().then(setMacroData).catch(() => setMacroError(true));
  }, []);

  const data = useMemo(
    () => (cotRows?.length ? transformApiData(cotRows as unknown as import("@/lib/cot/types").CotRawRow[]) : generateData()),
    [cotRows]
  );
  const latest    = data[data.length - 1];
  const recent52  = data.slice(-52);
  const signals            = useMemo(() => evaluateSignals(data), [data]);
  const historicalSignals  = useMemo(() => evaluateHistoricalSignals(data), [data]);

  const globalFlowMetrics = useMemo(
    (): GlobalFlowMetrics | null =>
      macroData.length >= 2 ? buildGlobalFlowMetrics(macroData) : null,
    [macroData]
  );

  // ── HTML export ──────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!exporting) return;
    let cancelled = false;

    const doExport = async () => {
      if (cancelled) return;
      try {
        // 1. Fetch CDN libraries (once — they get embedded in the file)
        const CDN = {
          react:     "https://unpkg.com/react@18.2.0/umd/react.production.min.js",
          reactDom:  "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js",
          propTypes: "https://unpkg.com/prop-types@15.8.1/prop-types.min.js",
          recharts:  "https://unpkg.com/recharts@2.12.7/umd/Recharts.js",
          babel:     "https://unpkg.com/@babel/standalone/babel.min.js",
        };
        const [reactJs, reactDomJs, propTypesJs, rechartsJs, babelJs] = await Promise.all(
          Object.values(CDN).map(url => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.text(); }))
        );

        // 2. Fetch compiled app CSS (Tailwind output — exact classes used in the app)
        const linkEls = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
        const cssTexts = await Promise.all(linkEls.map(l => fetch(l.href).then(r => r.text()).catch(() => "")));
        const inlineStyleEls = Array.from(document.querySelectorAll("style")).map(s => s.textContent ?? "");
        const appCss = [...cssTexts, ...inlineStyleEls].join("\n");

        // 3. Build the standalone HTML
        const dateStr = new Date().toISOString().split("T")[0];
        const html = buildStandaloneHtml(
          data,
          macroData,
          globalFlowMetrics ?? null,
          signals,
          historicalSignals,
          dateStr,
          reactJs, reactDomJs, propTypesJs, rechartsJs, babelJs,
          appCss
        );

        // 4. Download
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url;
        a.download = `COT-Dashboard-${dateStr}.html`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert("Export failed — check your internet connection and try again.\n" + String(err));
      }
      if (!cancelled) setExporting(false);
    };

    doExport();
    return () => { cancelled = true; };
  }, [exporting, data, macroData, globalFlowMetrics, signals, historicalSignals]);

  return (
    <div className="space-y-4" style={{ position: "relative" }}>
      {/* Mock-data warning only when the static cot.json failed to load. */}
      {cotError && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-400 text-xs font-medium">
          Data unavailable — showing illustrative data only (prices random, data ends ~Nov 2025).
        </div>
      )}
      {/* Loading bar only while the static snapshot hasn't resolved yet. */}
      {cotRows === null && !cotError && (
        <div className="mb-3 h-2 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full bg-slate-600 animate-pulse w-full" />
        </div>
      )}
      {/* Horizontal step nav — sticky, scrolls to section */}
      <div className="flex items-center gap-1 flex-wrap border-b border-slate-700 pb-1 sticky top-0 z-10 bg-gray-900 pt-1">
        {NAV_STEPS.map(s => (
          <button key={s.id} data-nav={String(s.id)}
            onClick={() => { setStep(s.id); document.getElementById(`cot-section-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              step === s.id ? "bg-slate-800 text-amber-400 border border-slate-700" : "text-slate-500 hover:text-slate-300"
            }`}>
            <span className={step === s.id ? "text-amber-400" : "text-slate-600"}>{ICONS[s.icon]}</span>
            {s.label}
          </button>
        ))}
        {cotRows !== null && (
          <span className="ml-auto text-[10px] text-slate-600 font-mono">
            NY {latest.priceNY.toFixed(2)}¢ · LDN ${latest.priceLDN.toFixed(0)}
          </span>
        )}
        <button
          onClick={() => setExporting(true)}
          disabled={!recent52.length || exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {exporting ? "Generating…" : "↓ Download HTML"}
        </button>
      </div>

      {cotRows !== null && !cotError && (
        <div className="text-[10px] text-slate-500 font-mono px-1">
          COT data as of <span className="text-slate-400">{latest.date}</span>
        </div>
      )}

      <div id="cot-section-10" className="relative">
        <div className="absolute right-0 -top-1 z-10"><PinToReport id="cot_overview" /></div>
        <Overview data={data} />
      </div>

      {/* 2. NY & London OI — 14-Day Tracking. Moved from /futures Exchange
          tab so positioning context sits next to the COT signal output. */}
      <div id="cot-section-9" className="space-y-3">
        <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold px-1">
          2. NY & London OI — 14-Day Tracking
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              NY OI
            </h3>
            <OIHistoryTable market="arabica" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              LDN OI
            </h3>
            <OIHistoryTable market="robusta" />
          </div>
        </div>
        {/* OIFndChart (OI Evolution to FND) moved to /futures Exchange tab
            (bottom) — the buildup-into-FND view is operational roll context,
            not COT positioning context. */}
      </div>

      <div id="cot-section-2"><CotHeatmap data={data} /></div>
      <div id="cot-section-3"><CotGauges data={data} /></div>

      <div id="cot-section-1"><Step1GlobalFlow macroData={macroData} macroError={macroError} globalFlowMetrics={globalFlowMetrics} /></div>

      <div id="cot-section-4"><Step4IndustryPulse  data={data} /></div>
      <div id="cot-section-5"><Step5DryPowder      data={data} /></div>
      <div id="cot-section-6"><Step6CycleLocation  recent52={recent52} /></div>
      <div id="cot-section-7"><Step7Report         data={data} recent52={recent52} /></div>

      {/* Signals moved to the end of the report. */}
      <div id="cot-section-8"><Step8Analysis signals={signals} historicalSignals={historicalSignals} /></div>
    </div>
  );
}
