"use client";
/**
 * Report-mode wrapper for the Certified Stocks System Flow.
 *
 * The in-app chart (CertifiedStocksSystemFlow) is "dumb": its parent panel owns
 * data-fetching plus the unit/period controls and passes everything down. For
 * the Report Builder we want a *self-contained* visual with no controls — so
 * this wrapper fetches the same two JSON feeds the panel uses and renders the
 * flow with sensible defaults (month-to-date window, bags). This is the
 * `isReportMode` pattern in practice: same chart, clean chrome-free render.
 */
import { useEffect, useMemo, useState } from "react";
import CertifiedStocksSystemFlow from "@/components/demand/CertifiedStocksSystemFlow";
import { flowAnchor } from "@/lib/certifiedStocks/window";
import type { ArabicaJsonShape, RobustaJsonShape } from "@/lib/certifiedStocks/shapes";

export default function CertifiedStocksFlowReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode; // accepted for registry uniformity; this wrapper is always clean
  const [arabica, setArabica] = useState<ArabicaJsonShape | null>(null);
  const [robusta, setRobusta] = useState<RobustaJsonShape | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/data/certified_stocks_arabica.json").then((r) => (r.ok ? r.json() : null)),
      fetch("/data/certified_stocks_robusta.json").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([a, b]) => { setArabica(a); setRobusta(b); })
      .catch(() => setErr(true));
  }, []);

  // Default window = month-to-date, ending at the latest available data date
  // (mirrors the panel's FLOW_START_DEFAULT view).
  const { start, end } = useMemo(() => {
    const e = flowAnchor(arabica, robusta);
    const s = new Date(e.getFullYear(), e.getMonth(), 1);
    return { start: s, end: e };
  }, [arabica, robusta]);

  if (err) return <div className="p-4 text-xs text-slate-500">Certified stocks data unavailable.</div>;
  if (!arabica && !robusta) return <div className="p-4 text-xs text-slate-500">Loading certified stocks…</div>;

  return (
    <CertifiedStocksSystemFlow arabica={arabica} robusta={robusta} start={start} end={end} unit="bags" />
  );
}
