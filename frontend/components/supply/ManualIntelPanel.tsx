"use client";
import React, { useEffect, useState } from "react";

interface IntelEntry {
  date: string;
  text: string;
  region?: string;
  tags?: string[];
}

interface IntelData {
  updated_at: string;
  entries: IntelEntry[];
}

export default function ManualIntelPanel() {
  const [data, setData] = useState<IntelData | null>(null);

  useEffect(() => {
    fetch(`/data/manual_intel.json?_=${Date.now()}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || data.entries.length === 0) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Local Intel</span>
          <span className="text-[9px] bg-amber-900/60 text-amber-400 px-1.5 py-0.5 rounded font-bold tracking-wide">
            HCMC
          </span>
        </div>
        <span className="text-[10px] text-slate-500">
          {data.entries.length} note{data.entries.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="divide-y divide-slate-800">
        {data.entries.map((e, i) => (
          <div key={i} className="px-4 py-2.5 flex gap-3 text-xs">
            <span className="text-slate-500 whitespace-nowrap font-mono shrink-0">{e.date}</span>
            <div className="flex-1 min-w-0">
              <span className="text-slate-200">{e.text}</span>
              {e.region && (
                <span className="ml-2 text-[10px] text-slate-500">· {e.region}</span>
              )}
              {e.tags && e.tags.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {e.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
