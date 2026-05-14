"use client";
import { useEffect, useState } from "react";

interface IcoReference {
  marketing_year:       string;
  world_consumption_mt: number;
  source:               string;
  source_url:           string;
  note:                 string;
}

interface WorldConsumption {
  tracked_consumption_mt: number;
  tracked_countries:      number;
  tracked_latest_year:    string | null;
  ico_reference:          IcoReference;
  tracked_vs_ico_pct:     number;
}

interface DemandStocks {
  world_consumption?: WorldConsumption | null;
}

function fmtMt(mt: number): string {
  if (mt >= 1_000_000) return `${(mt / 1_000_000).toFixed(2)} Mt`;
  if (mt >= 1_000)     return `${Math.round(mt / 1000)} kt`;
  return `${Math.round(mt)} t`;
}

export default function WorldConsumptionWidget() {
  const [wc, setWc] = useState<WorldConsumption | null>(null);

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: DemandStocks) => setWc(d.world_consumption ?? null))
      .catch(() => {});
  }, []);

  if (!wc) return null;

  const ico = wc.ico_reference;
  const delta = wc.tracked_consumption_mt - ico.world_consumption_mt;
  const deltaPct = (delta / ico.world_consumption_mt) * 100;

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            USDA PSD — Tracked Consumption
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-1">
            {fmtMt(wc.tracked_consumption_mt)}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            {wc.tracked_countries} countries · latest year {wc.tracked_latest_year ?? "—"}
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            ICO — World Consumption Reference
          </div>
          <div className="text-2xl font-bold text-amber-300 font-mono mt-1">
            {fmtMt(ico.world_consumption_mt)}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Marketing year {ico.marketing_year} ·{" "}
            <a href={ico.source_url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300 underline">
              {ico.source}
            </a>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Δ Tracked vs ICO World
          </div>
          <div className={`text-2xl font-bold font-mono mt-1 ${deltaPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Coverage: {wc.tracked_vs_ico_pct.toFixed(1)}% of ICO world total ({delta >= 0 ? "+" : ""}{fmtMt(Math.abs(delta)).replace(/^/, delta >= 0 ? "" : "-")})
          </div>
        </div>
      </div>
    </div>
  );
}
