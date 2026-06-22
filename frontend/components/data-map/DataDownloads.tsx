"use client";
import { useMemo, useState } from "react";

import { downloadCsv } from "@/lib/downloadCsv";
import {
  DATASETS,
  filterByFromYear,
  type Dataset,
  type DatasetGroup,
  type Timeframe,
} from "@/lib/dataExports/registry";

// Stable display order — keeps the user-named priorities (exports, imports,
// stocks, weather) above the markets/macro extras.
const GROUP_ORDER: DatasetGroup[] = [
  "Origin exports",
  "Destination imports",
  "Destination stocks",
  "Weather",
  "Prices & markets",
  "Macro",
];

// Sub-group order within each group — daily/weekly/monthly/annual most
// recent → least granular, snapshot last.
const TIMEFRAME_ORDER: Timeframe[] = ["Daily", "Weekly", "Monthly", "Annual", "Snapshot"];

// Pill colour per timeframe so the user can scan the grid by cadence at a glance.
const TIMEFRAME_PILL: Record<Timeframe, string> = {
  Daily:    "bg-emerald-950/60 text-emerald-300 border-emerald-800",
  Weekly:   "bg-sky-950/60 text-sky-300 border-sky-800",
  Monthly:  "bg-violet-950/60 text-violet-300 border-violet-800",
  Annual:   "bg-amber-950/60 text-amber-300 border-amber-800",
  Snapshot: "bg-slate-800 text-slate-300 border-slate-700",
};

// "From year" filter options. "All" maps to null (no filter).
const FROM_YEAR_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "All time",   value: null },
  { label: "From 1990",  value: 1990 },
  { label: "From 2000",  value: 2000 },
  { label: "From 2010",  value: 2010 },
  { label: "From 2015",  value: 2015 },
  { label: "From 2020",  value: 2020 },
  { label: "From 2023",  value: 2023 },
];

interface GroupedDatasets {
  group: DatasetGroup;
  byTimeframe: Array<{ timeframe: Timeframe; items: Dataset[] }>;
}

function groupAndOrder(): GroupedDatasets[] {
  return GROUP_ORDER.map(group => {
    const inGroup = DATASETS.filter(d => d.group === group);
    const byTf = new Map<Timeframe, Dataset[]>();
    for (const d of inGroup) {
      if (!byTf.has(d.timeframe)) byTf.set(d.timeframe, []);
      byTf.get(d.timeframe)!.push(d);
    }
    const byTimeframe = TIMEFRAME_ORDER
      .filter(tf => byTf.has(tf))
      .map(tf => ({ timeframe: tf, items: byTf.get(tf)!.sort((a, b) => a.label.localeCompare(b.label)) }));
    return { group, byTimeframe };
  }).filter(g => g.byTimeframe.length > 0);
}

export default function DataDownloads() {
  const [busy,     setBusy]     = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [fromYear, setFromYear] = useState<number | null>(null);
  const groups = useMemo(groupAndOrder, []);

  async function handle(d: Dataset) {
    setBusy(d.key); setError(null);
    try {
      const r = await fetch(d.jsonPath);
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${d.jsonPath}`);
      const raw = await r.json();
      const allRows = d.toRows(raw);
      const rows = filterByFromYear(allRows, d.dateField, fromYear);
      if (rows.length === 0) {
        throw new Error(
          allRows.length === 0
            ? `No rows produced for ${d.label} — JSON shape may have changed`
            : `All ${allRows.length} rows filtered out by "From year" — try widening the range`
        );
      }
      downloadCsv(d.filename, rows);
    } catch (e) {
      setError(`${d.label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const filterApplies = fromYear != null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Pick a dataset — a UTF-8 CSV downloads to your machine (BOM-prefixed so Excel opens
          non-Latin glyphs cleanly). Same data the dashboard reads, just flattened into rows.
        </p>
        <label className="text-[11px] text-slate-400 flex items-center gap-2 shrink-0">
          From year:
          <select
            value={fromYear ?? "all"}
            onChange={e => {
              const v = e.target.value;
              setFromYear(v === "all" ? null : Number(v));
            }}
            className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-slate-500"
          >
            {FROM_YEAR_OPTIONS.map(opt => (
              <option key={opt.label} value={opt.value ?? "all"}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      {filterApplies && (
        <p className="text-[10px] text-slate-500 -mt-3">
          Filter applies to datasets with a date column. Snapshot / calendar-month datasets
          (futures chain, latest prices, weather climatology) are unaffected.
        </p>
      )}

      {groups.map(({ group, byTimeframe }) => (
        <div key={group}>
          <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{group}</h3>
          <div className="space-y-3">
            {byTimeframe.map(({ timeframe, items }) => (
              <div key={timeframe}>
                <div className="text-[10px] font-medium text-slate-500 mb-1.5 flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 border rounded ${TIMEFRAME_PILL[timeframe]}`}>
                    {timeframe}
                  </span>
                  <span className="text-slate-600">{items.length} {items.length === 1 ? "dataset" : "datasets"}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {items.map(d => {
                    const isBusy = busy === d.key;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => handle(d)}
                        disabled={busy != null}
                        className="text-left p-3 border border-slate-700 rounded-lg bg-slate-900/40 hover:bg-slate-800 hover:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <div className="text-sm text-slate-100 flex items-center justify-between gap-2">
                          <span>{d.label}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {isBusy ? "downloading…" : "CSV"}
                          </span>
                        </div>
                        {d.note && (
                          <div className="text-[10px] text-slate-500 mt-1 leading-snug">{d.note}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <div className="text-[11px] text-red-400 border border-red-900/60 bg-red-950/30 rounded-md p-2">
          {error}
        </div>
      )}
    </div>
  );
}
