"use client";
import type { FarmerEconomicsData } from "./farmerEconomicsData";

interface Props {
  acreage: FarmerEconomicsData["acreage"];
  yield_: FarmerEconomicsData["yield"];
}

function KpiCard({
  label, value, unit, yoyPct, source, invertColor = false,
}: {
  label: string;
  value: string;
  unit: string;
  yoyPct: number;
  source: string;
  invertColor?: boolean;
}) {
  const up = yoyPct >= 0;
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 flex-1">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-xl font-extrabold text-slate-100">{value}</span>
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
      <div className={`text-xs font-semibold mb-2 ${up === invertColor ? "text-green-400" : "text-red-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(yoyPct).toFixed(1)}% YoY
      </div>
      <div className="text-[9px] text-slate-600">{source}</div>
    </div>
  );
}

export default function AcreageYieldPanel({ acreage, yield_ }: Props) {
  return (
    <div className="flex gap-3">
      <KpiCard
        label="Harvested Area"
        value={acreage.thousand_ha.toLocaleString()}
        unit="thousand ha"
        yoyPct={acreage.yoy_pct}
        source="CONAB 2025/26"
        invertColor
      />
      <KpiCard
        label="Yield"
        value={String(yield_.bags_per_ha)}
        unit="bags / ha"
        yoyPct={yield_.yoy_pct}
        source="CONAB 2025/26"
        invertColor
      />
    </div>
  );
}
