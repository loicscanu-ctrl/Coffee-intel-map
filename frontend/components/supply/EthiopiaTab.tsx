"use client";
import { useEffect, useState } from "react";
import { DataHealthBar } from "@/components/DataHealthBar";
import EthiopiaExportPanel from "@/components/supply/ethiopia/EthiopiaExportPanel";
import EthiopiaFarmerEconomics from "@/components/supply/ethiopia/EthiopiaFarmerEconomics";
import EthiopiaSupplyDemand from "@/components/supply/ethiopia/EthiopiaSupplyDemand";
import EthiopiaStoneXExport from "@/components/supply/ethiopia/EthiopiaStoneXExport";
import EthiopiaStoneXFarming from "@/components/supply/ethiopia/EthiopiaStoneXFarming";
import WeatherCharts from "@/components/supply/WeatherCharts";
import AnnualExportsPanel from "@/components/supply/AnnualExportsPanel";

type EthiopiaSubTab = "exports" | "supply-demand" | "farmer-economics" | "weather";
const SUB_TABS: { id: EthiopiaSubTab; label: string }[] = [
  { id: "exports",          label: "Exports" },
  { id: "supply-demand",    label: "Supply & Demand" },
  { id: "farmer-economics", label: "Farmer Economics" },
  { id: "weather",          label: "Weather" },
];

interface EthiopiaSupply {
  country: string;
  scraped_at: string | null;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    monthly: { month: string; total_k_bags: number; yoy_pct: number | null }[];
    annual?: { year: string; total_k_bags: number; yoy_pct: number | null }[];
  } | null;
  ecx_price: {
    etb_per_kg: number;
    as_of: string;
    grade: string;
  } | null;
  weather: {
    scraped_at: string;
    regions: {
      name: string;
      drought: "HIGH" | "MED" | "LOW" | "NONE";
      csi_30d?: number;
      csi_30d_level?: string;
    }[];
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
  harvest_cal: {
    main_crop_harvest: string;
    main_crop_flowering: string;
    description: string;
  };
  grade_structure: {
    grades: { grade: string; quality: string; defects: string; regions: string }[];
    processing: { natural_pct: number; washed_pct: number; note: string };
  };
}

const DEFAULT_HARVEST = {
  main_crop_harvest:   "Oct-Jan",
  main_crop_flowering: "Feb-Apr",
  description: "Ethiopia: main harvest Oct-Jan. 100% arabica. Natural (Harrar, Sidama) and washed (Yirgacheffe, Limu).",
};

const DEFAULT_GRADES = {
  grades: [
    { grade: "Grade 1", quality: "Specialty",  defects: "0-3",  regions: "Yirgacheffe, Sidama" },
    { grade: "Grade 2", quality: "Specialty",  defects: "4-12", regions: "Sidama, Limu" },
    { grade: "Grade 3", quality: "Premium",    defects: "13-25",regions: "Jimma, Harrar" },
    { grade: "Grade 4", quality: "Commercial", defects: "26-45",regions: "Various" },
  ],
  processing: { natural_pct: 65, washed_pct: 35, note: "Natural dominates in Harrar and Sidama; washed in Yirgacheffe." },
};

export default function EthiopiaTab() {
  const [subTab, setSubTab] = useState<EthiopiaSubTab>("exports");
  const [data, setData] = useState<EthiopiaSupply | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/ethiopia_supply.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => { setData(d); if (!d.exports) setSubTab("farmer-economics"); })
      .catch(() => setError(true));
  }, []);

  return (
    <div className="space-y-4">
      <DataHealthBar keys={["ethiopia_exports"]} />

      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
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

      {/* Supply & Demand (StoneX static research) and Weather are independent of the scraper feed. */}
      {subTab === "supply-demand" && <EthiopiaSupplyDemand />}
      {subTab === "weather" && <WeatherCharts dataUrl="/data/ethiopia_weather.json" title="Weather · Ethiopia" />}

      {/* The scraper-fed banners only matter for the data-dependent sub-tabs. */}
      {error && subTab !== "supply-demand" && subTab !== "weather" && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center space-y-1">
          <div className="text-sm text-slate-400">Ethiopia data not yet available</div>
          <div className="text-[10px] text-slate-600">
            Requires at least one scraper run with <code className="text-slate-400">ethiopia</code> and{" "}
            <code className="text-slate-400">ethiopia_weather</code> sources active.
          </div>
        </div>
      )}

      {!error && !data && subTab !== "supply-demand" && subTab !== "weather" && (
        <div className="text-xs text-slate-500 animate-pulse py-12 text-center">Loading Ethiopia data...</div>
      )}

      {subTab === "exports" && (
        <div className="space-y-3">
          {data && (
            data.exports?.annual?.length ? (
              <AnnualExportsPanel exports={{ ...data.exports, annual: data.exports.annual }} title="Ethiopia Green Coffee Exports" />
            ) : data.exports?.monthly?.length ? (
              <EthiopiaExportPanel exports={data.exports} ecx_price={data.ecx_price ?? null} />
            ) : (
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
                Export data not yet available — pending the next USDA PSD scrape.
              </div>
            )
          )}
          <EthiopiaStoneXExport />
        </div>
      )}

      {data && subTab === "farmer-economics" && (
        <div className="space-y-3">
          <EthiopiaFarmerEconomics
            weather={data.weather}
            enso={data.enso}
            harvest_cal={data.harvest_cal ?? DEFAULT_HARVEST}
            grade_structure={data.grade_structure ?? DEFAULT_GRADES}
          />
          <EthiopiaStoneXFarming />
        </div>
      )}
    </div>
  );
}
