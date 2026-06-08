"use client";
/**
 * Report-mode wrapper for the COT positioning overview.
 *
 * Mirrors the dashboard's data path (CotDashboard/index.tsx): fetch the static
 * cot.json snapshot, transform it into ProcessedCotRow[], and render the
 * Overview narrative — the weekly per-market positioning summary (OI, price/
 * structure, industry coverage, managed-money flow). Self-contained, no chrome.
 */
import { useEffect, useMemo, useState } from "react";
import Overview from "@/components/futures/CotDashboard/Overview";
import { transformApiData } from "@/lib/cot/transformApiData";
import type { CotRawRow } from "@/lib/cot/types";

export default function CotOverviewReport({ isReportMode = true }: { isReportMode?: boolean }) {
  void isReportMode;
  const [rows, setRows] = useState<CotRawRow[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/data/cot.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CotRawRow[] | null) => {
        if (!d || !Array.isArray(d) || d.length === 0) { setErr(true); return; }
        setRows(d);
      })
      .catch(() => setErr(true));
  }, []);

  const data = useMemo(() => (rows ? transformApiData(rows) : []), [rows]);

  if (err) return <div className="p-4 text-xs text-slate-500">COT data unavailable.</div>;
  if (!rows) return <div className="p-4 text-xs text-slate-500">Loading COT positioning…</div>;

  return <Overview data={data} />;
}
