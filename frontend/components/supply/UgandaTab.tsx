"use client";
import { useEffect, useState } from "react";
import UgandaExportPanel from "@/components/supply/uganda/UgandaExportPanel";
import UgandaFarmerEconomics from "@/components/supply/uganda/UgandaFarmerEconomics";
import UgandaDestPanel from "@/components/supply/uganda/UgandaDestinationsPanel";
import UgandaTradeActors from "@/components/supply/uganda/UgandaTradeActorsPanel";
// UgandaTab itself is dynamic-imported from supply/page.tsx with { ssr: false },
// so these panels are already lazy-loaded as part of UgandaTab's chunk —
// nested dynamic() would just add per-subtab RTTs without bundle-size benefit
// (recharts and shared libs go into the vendor chunk regardless).

type SubTab = "exports" | "destinations" | "trade-actors" | "farmer-economics";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "exports",          label: "Exports" },
  { id: "destinations",     label: "Destinations" },
  { id: "trade-actors",     label: "Exporters / Buyers" },
  { id: "farmer-economics", label: "Farmer Economics" },
];

interface ExportMonth {
  month: string;
  total_bags: number;
  total_k_bags: number;
  robusta_bags?: number;
  arabica_bags?: number;
  robusta_k_bags?: number;
  arabica_k_bags?: number;
  robusta_pct?: number;
  arabica_pct?: number;
  avg_price_usd_kg?: number;
  total_value_usd?: number;
  yoy_pct?: number | null;
}

interface UgandaSupply {
  country: string;
  scraped_at: string | null;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    monthly: ExportMonth[];
  } | null;
  ucda_detail: {
    month: string;
    grades: { grade: string; qty_bags?: number; pct_qty?: number; price_usd_kg?: number; pct_val?: number }[];
    exporters: { rank: number; company: string; robusta_bags?: number; arabica_bags?: number; total_bags: number; pct_individual?: number }[];
    destinations: { rank: number; country: string; robusta_bags?: number; arabica_bags?: number; total_bags: number; pct_individual?: number }[];
    buyers: { rank: number; company: string; robusta_bags?: number; arabica_bags?: number; total_bags: number; pct_individual?: number }[];
    farmgate: Record<string, number>;
  } | null;
  ucda_price: { usd_cwt?: number; as_of?: string; grade?: string } | null;
  weather: {
    scraped_at: string;
    regions: { name: string; drought: "HIGH" | "MED" | "LOW" | "NONE"; csi_30d?: number; csi_30d_level?: string }[];
    daily_drought: { region: string; days: ("H"|"M"|"L"|"-")[] }[];
  } | null;
  enso: {
    phase: "el-nino" | "la-nina" | "neutral";
    intensity: string;
    oni: number;
    peak_month: string;
    forecast_direction: string;
    oni_history: { month: string; value: number; preliminary?: boolean }[];
    regional_impact: { region: string; type: string; note: string; dots: number }[];
    historical_stat: string;
    last_updated: string;
  } | null;
  harvest_cal: { main_crop_harvest: string; fly_crop_harvest: string; description: string };
  production_mix: { robusta_pct: number; arabica_pct: number; note: string; key_regions: { robusta: string[]; arabica: string[] } };
}

const DEFAULT_HARVEST = {
  main_crop_harvest: "Oct-Feb",
  fly_crop_harvest:  "Apr-Jun",
  description: "Uganda has two crop cycles. Main crop Oct-Feb; fly crop Apr-Jun. 75% robusta, 25% arabica.",
};
const DEFAULT_MIX = {
  robusta_pct: 75, arabica_pct: 25,
  note: "Uganda is Africa's leading robusta exporter. Screen 15 benchmark grade.",
  key_regions: { robusta: ["Kasese", "Masaka", "Mbale"], arabica: ["Mt Elgon", "Rwenzori"] },
};

export default function UgandaTab() {
  const [subTab, setSubTab] = useState<SubTab>("exports");
  const [data, setData]     = useState<UgandaSupply | null>(null);
  const [error, setError]   = useState(false);

  useEffect(() => {
    fetch("/data/uganda_supply.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit flex-wrap">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t.id
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center space-y-1">
          <div className="text-sm text-slate-400">Uganda data not yet available</div>
          <div className="text-[10px] text-slate-600">
            Run bootstrap_ucda_reports.py then export_uganda.py to populate.
          </div>
        </div>
      )}

      {!error && !data && (
        <div className="text-xs text-slate-500 animate-pulse py-12 text-center">
          Loading Uganda data...
        </div>
      )}

      {data && subTab === "exports" && (
        data.exports ? (
          <UgandaExportPanel
            exports={data.exports}
            ucda_price={data.ucda_price ?? null}
            ucda_detail={data.ucda_detail ?? null}
          />
        ) : (
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
            Export data not yet available — run UCDA report bootstrap
          </div>
        )
      )}

      {data && subTab === "destinations" && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <UgandaDestPanel
            destinations={data.ucda_detail?.destinations ?? []}
            month={data.ucda_detail?.month ?? ""}
          />
        </div>
      )}

      {data && subTab === "trade-actors" && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <UgandaTradeActors
            exporters={data.ucda_detail?.exporters ?? []}
            buyers={data.ucda_detail?.buyers ?? []}
            month={data.ucda_detail?.month ?? ""}
          />
        </div>
      )}

      {data && subTab === "farmer-economics" && (
        <UgandaFarmerEconomics
          weather={data.weather}
          enso={data.enso}
          harvest_cal={data.harvest_cal ?? DEFAULT_HARVEST}
          production_mix={data.production_mix ?? DEFAULT_MIX}
        />
      )}
    </div>
  );
}
