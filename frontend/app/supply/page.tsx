"use client";
import { useState } from "react";
import BrazilTab from "@/components/supply/BrazilTab";
import VietnamTab from "@/components/supply/VietnamTab";
import FertilizersTab from "@/components/supply/FertilizersTab";

const TABS = [
  { id: "brazil",       label: "Brazil",       available: true  },
  { id: "vietnam",      label: "Vietnam",      available: true  },
  { id: "fertilizers",  label: "Fertilizers",  available: true  },
  { id: "colombia",     label: "Colombia",     available: false },
  { id: "ethiopia",     label: "Ethiopia",     available: false },
  { id: "honduras",     label: "Honduras",     available: false },
] as const;

type TabId = typeof TABS[number]["id"];

export default function SupplyPage() {
  const [tab, setTab] = useState<TabId>("brazil");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        {/* Page header */}
        <div>
          <h1 className="text-xl font-bold text-slate-100">Supply Intelligence</h1>
          <p className="text-xs text-slate-500 mt-1">
            Production &amp; export data by origin country
          </p>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit flex-wrap">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => t.available && setTab(t.id)}
              disabled={!t.available}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                tab === t.id
                  ? t.id === "fertilizers"
                    ? "bg-emerald-800 text-emerald-100"
                    : "bg-slate-700 text-slate-100"
                  : t.available
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  : "text-slate-600 cursor-not-allowed"
              }`}
            >
              {t.label}
              {!t.available && (
                <span className="ml-1 text-[8px] text-slate-600 align-middle">soon</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "brazil"      && <BrazilTab />}
        {tab === "vietnam"     && <VietnamTab />}
        {tab === "fertilizers" && <FertilizersTab />}
      </div>
    </div>
  );
}
