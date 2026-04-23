"use client";
import { useEffect, useState } from "react";
import VietnamExportPanel from "@/components/supply/VietnamExportPanel";
import VietnamExportExplorer from "@/components/supply/VietnamExportExplorer";
import VietnamDestinationEstimate from "@/components/supply/VietnamDestinationEstimate";
import VietnamFarmerEconomics from "@/components/supply/VietnamFarmerEconomics";

interface VietnamSupply {
  scraped_at: string | null;
  country: string;
  exports: {
    source: string;
    last_updated: string;
    unit: string;
    note?: string;
    monthly: { month: string; total_k_bags: number; yoy_pct: number | null }[];
  } | null;
  fertilizer_context: {
    source: string;
    note: string;
    key_suppliers: Record<string, string>;
    price_sensitivity: string;
    monthly?: { month: string; urea_kt: number; kcl_kt: number; npk_kt: number; dap_kt: number; total_kt: number }[];
  } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExportExplorerData = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharesData = any;

export default function VietnamTab() {
  const [subTab, setSubTab] = useState<"exports" | "farmer-economics">("exports");
  const [vnSupply, setVnSupply] = useState<VietnamSupply | null>(null);
  const [explorerData, setExplorerData] = useState<ExportExplorerData | null>(null);
  const [sharesData, setSharesData] = useState<SharesData | null>(null);

  useEffect(() => {
    fetch("/data/vietnam_supply.json")
      .then(r => r.json())
      .then(setVnSupply)
      .catch(() => {});
    fetch("/data/vn_export_destination_port.json")
      .then(r => r.json())
      .then(setExplorerData)
      .catch(() => {});
    fetch("/data/vn_country_shares.json")
      .then(r => r.json())
      .then(setSharesData)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "farmer-economics"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t === "exports" ? "Exports" : "Farmer Economics"}
          </button>
        ))}
      </div>

      {/* ── Farmer Economics ───────────────────────────────────────── */}
      {subTab === "farmer-economics" && (
        <VietnamFarmerEconomics />
      )}

      {/* ── Exports ────────────────────────────────────────────────── */}
      {subTab === "exports" && (
        <div className="space-y-5">
          {/* Monthly export volumes */}
          <div>
            <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
              Monthly Export Volumes
            </h2>
            {vnSupply?.exports ? (
              <VietnamExportPanel exports={vnSupply.exports} />
            ) : (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-2">
                  Monthly Export Volumes · VICOFA / Vietnam Customs
                </div>
                <p className="text-slate-500 text-xs italic">
                  {vnSupply === null ? "Loading…" : "Export data unavailable — run export_static_json.py to populate."}
                </p>
              </div>
            )}
          </div>

          {/* Estimated destination breakdown */}
          {vnSupply?.exports && sharesData && (
            <div>
              <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
                Estimated Destination · 2025–2026
              </h2>
              <VietnamDestinationEstimate
                monthlyExports={vnSupply.exports.monthly}
                sharesData={sharesData}
              />
            </div>
          )}

          {/* Export structure explorer */}
          {explorerData && (
            <div>
              <h2 className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-3">
                Export Structure · Vietnam Customs
              </h2>
              <VietnamExportExplorer data={explorerData} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
