"use client";
import { useMemo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { MacroCotWeek } from "@/lib/api";
import type { GlobalFlowMetrics } from "@/lib/pdf/types";
import AttributionTable from "./AttributionTable";
import SectionHeader from "./SectionHeader";
import { SECTOR_COLORS, SECTORS, SOFT_SYMBOLS } from "./constants";
import { transformMacroData } from "./transformMacroData";
import type { MacroToggle } from "./types";

export default function Step1GlobalFlow({
  macroData,
  macroError,
  globalFlowMetrics,
}: {
  macroData: MacroCotWeek[];
  macroError: boolean;
  globalFlowMetrics: GlobalFlowMetrics | null;
}) {
  const [macroToggle, setMacroToggle] = useState<MacroToggle>("gross");
  const [step1View, setStep1View]     = useState<"chart" | "table">("chart");

  const macroChartData = useMemo(
    () => transformMacroData(macroData, macroToggle),
    [macroData, macroToggle]
  );

  const macroNetSplitData = useMemo(() => {
    if (macroToggle !== "net") return null;
    return macroChartData.map(row => {
      const result: Record<string, any> = { date: row.date };
      for (const s of SECTORS) {
        const v = (row as any)[s] as number;
        result[`${s}_pos`] = v > 0 ? v : 0;
        result[`${s}_neg`] = v < 0 ? v : 0;
      }
      return result;
    });
  }, [macroChartData, macroToggle]);

  const macroYDomain = useMemo(() => {
    if (macroToggle !== "net" || !macroChartData.length) return undefined;
    const allVals = macroChartData.flatMap(d =>
      SECTORS.map(s => (d as any)[s] as number)
    );
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const pad = Math.max(Math.abs(min), Math.abs(max)) * 0.15;
    return [+(min - pad).toFixed(2), +(max + pad).toFixed(2)] as [number, number];
  }, [macroChartData, macroToggle]);

  const macroKpis = useMemo(() => {
    if (!macroData.length) return null;
    const weekTotals = (week: MacroCotWeek) => {
      let g = 0, n = 0;
      for (const c of week.commodities) {
        g += c.gross_exposure_usd ?? 0;
        n += c.net_exposure_usd   ?? 0;
      }
      return { gross: g, net: n };
    };
    const cur  = weekTotals(macroData[macroData.length - 1]);
    const prev = macroData.length >= 2 ? weekTotals(macroData[macroData.length - 2]) : null;
    return {
      totalGross: cur.gross,
      netExp:     cur.net,
      grossWoW:   prev ? cur.gross - prev.gross : null,
      netWoW:     prev ? cur.net   - prev.net   : null,
      date:       macroData[macroData.length - 1].date,
    };
  }, [macroData]);

  const softChartData = useMemo(() =>
    macroData
      .map(week => {
        const row: Record<string, any> = { date: week.date };
        for (const sym of SOFT_SYMBOLS) {
          const c = week.commodities.find(c => c.symbol === sym.key);
          if (!c) { row[sym.key] = 0; continue; }
          const g = c.gross_exposure_usd;
          const n = c.net_exposure_usd;
          const val =
            macroToggle === "gross"       ? g :
            macroToggle === "gross_long"  ? (g != null && n != null ? (g + n) / 2 : null) :
            macroToggle === "gross_short" ? (g != null && n != null ? (g - n) / 2 : null) :
            n;
          row[sym.key] = val != null ? val / 1e9 : 0;
        }
        return row;
      })
      .filter(row => SOFT_SYMBOLS.some(s => Math.abs(row[s.key]) > 0)),
    [macroData, macroToggle]);

  return (
    <div id="cot-section-1">
      <SectionHeader icon="Globe" title="1. Global Money Flow"
        subtitle="MM speculative exposure across 28 commodity markets (CFTC + ICE Europe). Toggle metric below." />
      {macroError && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-400 text-xs font-medium">
          Macro COT data unavailable — run the backfill script and ensure the backend is running.
        </div>
      )}

      {/* Toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {/* View toggle — Chart or Attribution Table */}
        {(["chart", "table"] as const).map(v => (
          <button
            key={v}
            onClick={() => setStep1View(v)}
            style={{
              padding: "4px 12px", borderRadius: 4, border: "1px solid #374151",
              background: step1View === v ? "#065f46" : "#1f2937",
              color: "#f9fafb", cursor: "pointer", fontSize: 12,
            }}
          >
            {v === "chart" ? "Chart" : "Attribution Table"}
          </button>
        ))}
        <span style={{ width: 1, height: 20, background: "#374151", margin: "0 4px" }} />
        {/* Existing mode toggle — gross/net/long/short */}
        {(["gross", "gross_long", "gross_short", "net"] as const).map(m => {
          const labels: Record<string, string> = {
            gross:       "Total Gross",
            gross_long:  "Gross Long",
            gross_short: "Gross Short",
            net:         "Net Exposure",
          };
          return (
            <button
              key={m}
              onClick={() => setMacroToggle(m)}
              style={{
                padding: "4px 12px", borderRadius: 4, border: "1px solid #374151",
                background: macroToggle === m ? "#4f46e5" : "#1f2937",
                color: "#f9fafb", cursor: "pointer", fontSize: 12,
              }}
            >
              {labels[m]}
            </button>
          );
        })}
      </div>

      {/* KPI Toddles */}
      {macroKpis && (() => {
        const fmtB    = (v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v / 1e9).toFixed(1)}B`;
        const fmtWoW  = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v / 1e9).toFixed(2)}B`;
        // Attribution fields are already in $B (divided by 1e9 at compute time)
        const fmtAttr = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}B`;
        const wowColor = (v: number | null) => v == null ? "#6b7280" : v >= 0 ? "#10b981" : "#ef4444";

        // Attribution totals from sectorBreakdown (sum non-null across all sectors)
        const sumAttr = (field: "grossOiEffectB" | "grossPriceEffectB" | "netOiEffectB" | "netPriceEffectB"): number | null => {
          if (!globalFlowMetrics) return null;
          const vals = globalFlowMetrics.sectorBreakdown.map(s => s[field]).filter((v): v is number => v !== null);
          return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0);
        };
        const grossOiTotal  = sumAttr("grossOiEffectB");
        const grossPxTotal  = sumAttr("grossPriceEffectB");
        const netOiTotal    = sumAttr("netOiEffectB");
        const netPxTotal    = sumAttr("netPriceEffectB");

        const kpis = [
          { label: "Gross Exposure",     value: fmtB(macroKpis.totalGross),  color: "#f9fafb" },
          { label: "Gross Exposure WoW", value: fmtWoW(macroKpis.grossWoW), color: wowColor(macroKpis.grossWoW) },
          { label: "Gross OI Δ",         value: fmtAttr(grossOiTotal),       color: wowColor(grossOiTotal) },
          { label: "Gross Px Δ",         value: fmtAttr(grossPxTotal),       color: wowColor(grossPxTotal) },
          { label: "Net Exposure",       value: fmtB(macroKpis.netExp),      color: macroKpis.netExp >= 0 ? "#10b981" : "#ef4444" },
          { label: "Net Exposure WoW",   value: fmtWoW(macroKpis.netWoW),   color: wowColor(macroKpis.netWoW) },
          { label: "Net OI Δ",           value: fmtAttr(netOiTotal),         color: wowColor(netOiTotal) },
          { label: "Net Px Δ",           value: fmtAttr(netPxTotal),         color: wowColor(netPxTotal) },
        ];
        return (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {kpis.map(k => (
              <div key={k.label} style={{
                flex: "1 1 120px", background: "#111827", border: "1px solid #1f2937",
                borderRadius: 8, padding: "10px 14px",
              }}>
                <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: k.color, fontFamily: "monospace" }}>{k.value}</div>
                <div style={{ fontSize: 9, color: "#4b5563", marginTop: 2 }}>{macroKpis.date}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {step1View === "chart" && (
      <>
      {/* Panel A — MM Exposure by Sector */}
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>MM Exposure by Sector (USD bn)</span>
      </div>
      {!macroData.length && !macroError && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-center" style={{ height: 260, marginBottom: 16 }}>
          <div className="h-2 w-32 rounded-full bg-slate-700 animate-pulse" />
        </div>
      )}
      {macroData.length > 0 && <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            data={macroToggle === "net" && macroNetSplitData ? macroNetSplitData : macroChartData}
            margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(0)}B`} width={52}
              domain={macroYDomain} />
            {macroToggle === "net" && <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />}
            {macroToggle === "net" ? (
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                content={(props: any) => {
                  if (!props.active || !props.payload) return null;
                  const byLabel: Record<string, { value: number; color: string }> = {};
                  for (const entry of props.payload) {
                    const key = String(entry.dataKey);
                    const sector = key.replace("_pos", "").replace("_neg", "");
                    const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                    if (!byLabel[label]) byLabel[label] = { value: 0, color: SECTOR_COLORS[sector] };
                    byLabel[label].value += entry.value || 0;
                  }
                  return (
                    <div style={{ background: "#111827", border: "1px solid #374151", padding: "6px 10px", fontSize: 11, borderRadius: 4 }}>
                      <p style={{ color: "#9ca3af", margin: "0 0 4px" }}>Week: {props.label}</p>
                      {Object.entries(byLabel)
                        .filter(([, d]) => Math.abs(d.value) >= 0.001)
                        .sort((a, b) => b[1].value - a[1].value)
                        .map(([label, d]) => (
                          <p key={label} style={{ color: d.value < 0 ? "#dc2626" : d.color, margin: "2px 0" }}>
                            {label}: {d.value < 0 ? "-$" : "$"}{Math.abs(d.value).toFixed(1)}B
                          </p>
                        ))}
                    </div>
                  );
                }}
              />
            ) : (
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                formatter={(v: any, name: any) => [`${(v as number) < 0 ? "-$" : "$"}${Math.abs(v as number).toFixed(1)}B`, name]}
                labelFormatter={(l: any) => `Week: ${l}`}
              />
            )}
            <Legend wrapperStyle={{ fontSize: 11 }} content={(props: any) => {
              const labelMap: Record<string, string> = { energy: "Energies", metals: "Metals", grains: "Grains", meats: "Meats", softs: "Softs", micros: "Micros" };
              const lastRow = macroChartData[macroChartData.length - 1];
              const order = lastRow
                ? [...SECTORS].sort((a, b) => Math.abs((lastRow as any)[b]) - Math.abs((lastRow as any)[a]))
                : [...SECTORS];
              return (
                <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", fontSize: 11, paddingTop: 4 }}>
                  {order.map(s => (
                    <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, color: "#d1d5db" }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: SECTOR_COLORS[s], display: "inline-block" }} />
                      {labelMap[s]}
                    </span>
                  ))}
                </div>
              );
            }} />
            {macroToggle === "net" ? (
              <>
                {SECTORS.map(sector => {
                  const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                  return (
                    <Area key={`${sector}_pos`} type="monotone" dataKey={`${sector}_pos`}
                      stackId="pos" name={label}
                      stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
                      fillOpacity={0.6} dot={false} />
                  );
                })}
                {SECTORS.map(sector => (
                  <Area key={`${sector}_neg`} type="monotone" dataKey={`${sector}_neg`}
                    stackId="neg" name={`${sector}_neg`}
                    stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
                    fillOpacity={0.6} dot={false} legendType="none" />
                ))}
              </>
            ) : (
              SECTORS.map(sector => {
                const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                return (
                  <Area key={sector} type="monotone" dataKey={sector}
                    stackId="1" name={label}
                    stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]}
                    fillOpacity={0.6} dot={false} />
                );
              })
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>}

      {/* Panel B — Weekly Change */}
      {(() => {
        const weeklyChangeData = macroChartData.slice(1).map((row, i) => {
          const prev = macroChartData[i];
          return {
            date:   row.date,
            energy: row.energy - prev.energy,
            metals: row.metals - prev.metals,
            grains: row.grains - prev.grains,
            meats:  row.meats  - prev.meats,
            softs:  row.softs  - prev.softs,
            micros: row.micros - prev.micros,
          };
        });
        return (
          <>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Weekly Change by Sector (USD bn) — inflows positive, outflows negative</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={weeklyChangeData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(1)}B`} width={52} />
                  <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                    formatter={(v: any, name: any) => [`${(v as number) < 0 ? "-$" : "$"}${Math.abs(v as number).toFixed(2)}B`, name]}
                    labelFormatter={(l: any) => `Week: ${l}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {SECTORS.map(sector => {
                    const label = sector === "energy" ? "Energies" : sector === "metals" ? "Metals" : sector.charAt(0).toUpperCase() + sector.slice(1);
                    return (
                      <Bar key={sector} dataKey={sector} stackId="1" name={label}
                        fill={SECTOR_COLORS[sector]} />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}
      </>
      )}

      {step1View === "table" && (
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", padding: 16, borderRadius: 12 }}>
          {globalFlowMetrics
            ? <AttributionTable gfm={globalFlowMetrics} />
            : <p style={{ color: "#6b7280", fontSize: 12 }}>Loading attribution data…</p>
          }
        </div>
      )}

      {/* Panel C — MM Exposure on Softs (by contract) */}
      {(() => {
        if (!softChartData.length) return null;

        // For net mode: split pos/neg per contract
        const softNetSplit = macroToggle === "net"
          ? softChartData.map(row => {
              const r: Record<string, any> = { date: row.date };
              for (const s of SOFT_SYMBOLS) {
                const v = row[s.key] as number;
                r[`${s.key}_pos`] = v > 0 ? v : 0;
                r[`${s.key}_neg`] = v < 0 ? v : 0;
              }
              return r;
            })
          : null;

        const softYDomain: [number, number] | undefined = macroToggle === "net" ? (() => {
          const vals = softChartData.flatMap(row => SOFT_SYMBOLS.map(s => row[s.key] as number));
          const mn = Math.min(...vals), mx = Math.max(...vals);
          const pad = Math.max(Math.abs(mn), Math.abs(mx)) * 0.15;
          return [+(mn - pad).toFixed(2), +(mx + pad).toFixed(2)];
        })() : undefined;

        return (
          <>
            <div style={{ marginBottom: 8, marginTop: 16 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>MM Exposure — Softs by Contract (USD bn)</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom: 16 }}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={macroToggle === "net" && softNetSplit ? softNetSplit : softChartData}
                  margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(2)}B`} width={58}
                    domain={softYDomain} />
                  {macroToggle === "net" && <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />}
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                    content={(props: any) => {
                      if (!props.active || !props.payload) return null;
                      const byLabel: Record<string, { value: number; color: string }> = {};
                      for (const entry of props.payload) {
                        const key = String(entry.dataKey).replace("_pos", "").replace("_neg", "");
                        const sym = SOFT_SYMBOLS.find(s => s.key === key);
                        if (!sym) continue;
                        if (!byLabel[sym.label]) byLabel[sym.label] = { value: 0, color: sym.color };
                        byLabel[sym.label].value += entry.value || 0;
                      }
                      return (
                        <div style={{ background: "#111827", border: "1px solid #374151", padding: "6px 10px", fontSize: 11, borderRadius: 4 }}>
                          <p style={{ color: "#9ca3af", margin: "0 0 4px" }}>Week: {props.label}</p>
                          {Object.entries(byLabel)
                            .filter(([, d]) => Math.abs(d.value) >= 0.0001)
                            .sort((a, b) => b[1].value - a[1].value)
                            .map(([label, d]) => (
                              <p key={label} style={{ color: d.value < 0 ? "#dc2626" : d.color, margin: "2px 0" }}>
                                {label}: {d.value < 0 ? "-$" : "$"}{Math.abs(d.value).toFixed(2)}B
                              </p>
                            ))}
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {macroToggle === "net" ? (
                    <>
                      {SOFT_SYMBOLS.map(s => (
                        <Area key={`${s.key}_pos`} type="monotone" dataKey={`${s.key}_pos`}
                          stackId="pos" name={s.label}
                          stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} />
                      ))}
                      {SOFT_SYMBOLS.map(s => (
                        <Area key={`${s.key}_neg`} type="monotone" dataKey={`${s.key}_neg`}
                          stackId="neg" name={`${s.key}_neg`}
                          stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} legendType="none" />
                      ))}
                    </>
                  ) : (
                    SOFT_SYMBOLS.map(s => (
                      <Area key={s.key} type="monotone" dataKey={s.key}
                        stackId="1" name={s.label}
                        stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} />
                    ))
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}

      {/* Panel D — Weekly Change by Contract (Softs) */}
      {(() => {
        if (softChartData.length < 2) return null;

        const weeklyChangeData = softChartData.slice(1).map((row, i) => {
          const prev = softChartData[i];
          const r: Record<string, any> = { date: row.date };
          for (const s of SOFT_SYMBOLS) r[s.key] = (row[s.key] as number) - (prev[s.key] as number);
          return r;
        });

        return (
          <>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Weekly Change — Softs by Contract (USD bn) — inflows positive, outflows negative</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={weeklyChangeData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(v: number) => `${v < 0 ? "-$" : "$"}${Math.abs(v).toFixed(2)}B`} width={58} />
                  <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }}
                    formatter={(v: any, name: any) => {
                      if (Math.abs(v) < 0.0001) return null;
                      return [`${(v as number) < 0 ? "-$" : "$"}${Math.abs(v as number).toFixed(2)}B`, name];
                    }}
                    labelFormatter={(l: any) => `Week: ${l}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {SOFT_SYMBOLS.map(s => (
                    <Bar key={s.key} dataKey={s.key} stackId="1" name={s.label} fill={s.color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}
    </div>
  );
}
