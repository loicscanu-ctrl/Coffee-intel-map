"use client";
import { useState } from "react";

import { downloadCsv } from "@/lib/downloadCsv";
import { DATASETS, type Dataset, type DatasetGroup } from "@/lib/dataExports/registry";

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

function groupBy(): Record<DatasetGroup, Dataset[]> {
  const acc = Object.fromEntries(GROUP_ORDER.map(g => [g, [] as Dataset[]])) as Record<DatasetGroup, Dataset[]>;
  for (const d of DATASETS) acc[d.group].push(d);
  return acc;
}

export default function DataDownloads() {
  const [busy,  setBusy]  = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = groupBy();

  async function handle(d: Dataset) {
    setBusy(d.key); setError(null);
    try {
      const r = await fetch(d.jsonPath);
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${d.jsonPath}`);
      const raw = await r.json();
      const rows = d.toRows(raw);
      if (rows.length === 0) throw new Error(`No rows produced for ${d.label} — JSON shape may have changed`);
      downloadCsv(d.filename, rows);
    } catch (e) {
      setError(`${d.label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Pick a dataset — a UTF-8 CSV downloads to your machine (BOM-prefixed so Excel opens
        non-Latin glyphs cleanly). Same data the dashboard reads, just flattened into rows.
      </p>

      {GROUP_ORDER.map(g => {
        const list = groups[g];
        if (list.length === 0) return null;
        return (
          <div key={g}>
            <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{g}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {list.map(d => {
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
        );
      })}

      {error && (
        <div className="text-[11px] text-red-400 border border-red-900/60 bg-red-950/30 rounded-md p-2">
          {error}
        </div>
      )}
    </div>
  );
}
