"use client";

interface AcreageData { thousand_ha: number; yoy_pct: number; source_label?: string; }
interface YieldData   { bags_per_ha:  number; yoy_pct: number; source_label?: string; }

interface Props {
  acreage: AcreageData;
  yield_:  YieldData;
  acreage_arabica?: AcreageData | null;
  yield_arabica?:   YieldData   | null;
  acreage_conilon?: AcreageData | null;
  yield_conilon?:   YieldData   | null;
  yieldUnit?: "bags/ha" | "mt/ha";
}

function KpiCard({
  label, value, unit, yoyPct, source, accent,
}: {
  label: string; value: string; unit: string; yoyPct: number; source: string; accent?: string;
}) {
  const up = yoyPct >= 0;
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700 flex-1 min-w-0"
      style={accent ? { borderColor: accent + "44" } : {}}>
      <div className="text-[9px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-lg font-extrabold text-slate-100">{value}</span>
        <span className="text-[10px] text-slate-500">{unit}</span>
      </div>
      <div className={`text-[10px] font-semibold mb-1.5 ${up ? "text-green-400" : "text-red-400"}`}>
        {up ? "▲" : "▼"} {Math.abs(yoyPct).toFixed(1)}% YoY
      </div>
      <div className="text-[8px] text-slate-600">{source}</div>
    </div>
  );
}

function VarietyBlock({
  label, accent, acreage, yield_,
}: {
  label: string; accent: string; acreage: AcreageData; yield_: YieldData;
}) {
  const prod = Math.round(acreage.thousand_ha * yield_.bags_per_ha / 1000 * 10) / 10;
  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: accent + "44", background: accent + "08" }}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: accent }}>
          {label}
        </span>
        <span className="text-[8px] text-slate-500 font-mono">
          ~{prod}M bags
        </span>
      </div>
      <div className="flex gap-2">
        <KpiCard
          label="Harvested Area"
          value={acreage.thousand_ha.toLocaleString()}
          unit="k ha"
          yoyPct={acreage.yoy_pct}
          source={acreage.source_label ?? "CONAB Safra"}
          accent={accent}
        />
        <KpiCard
          label="Yield"
          value={String(yield_.bags_per_ha)}
          unit="bags/ha"
          yoyPct={yield_.yoy_pct}
          source={yield_.source_label ?? "CONAB Safra"}
          accent={accent}
        />
      </div>
    </div>
  );
}

export default function AcreageYieldPanel({
  acreage, yield_,
  acreage_arabica, yield_arabica,
  acreage_conilon, yield_conilon,
  yieldUnit = "bags/ha",
}: Props) {
  const hasSplit = acreage_arabica && yield_arabica && acreage_conilon && yield_conilon;

  if (hasSplit) {
    return (
      <div className="space-y-2">
        <VarietyBlock label="Arabica" accent="#22c55e" acreage={acreage_arabica!} yield_={yield_arabica!} />
        <VarietyBlock label="Conilon / Robusta" accent="#f59e0b" acreage={acreage_conilon!} yield_={yield_conilon!} />
      </div>
    );
  }

  const yieldValue = yieldUnit === "mt/ha"
    ? (yield_.bags_per_ha * 0.06).toFixed(2)
    : String(yield_.bags_per_ha);
  const yieldUnitStr = yieldUnit === "mt/ha" ? "mt / ha" : "bags / ha";

  // Fallback: single combined panel (original layout)
  return (
    <div className="flex gap-3">
      <KpiCard
        label="Harvested Area"
        value={acreage.thousand_ha.toLocaleString()}
        unit="thousand ha"
        yoyPct={acreage.yoy_pct}
        source={acreage.source_label ?? "CONAB Safra"}
      />
      <KpiCard
        label="Yield"
        value={yieldValue}
        unit={yieldUnitStr}
        yoyPct={yield_.yoy_pct}
        source={yield_.source_label ?? "CONAB Safra"}
      />
    </div>
  );
}
