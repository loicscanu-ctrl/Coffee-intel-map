"use client";
import { useMemo, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { ARABICA_MT_FACTOR, ROBUSTA_MT_FACTOR } from "@/lib/cot/transformApiData";
import { CAT_ITEMS, CHART_STYLE } from "./constants";
import SectionHeader from "./SectionHeader";
import { CatToggles } from "./Toggles";

export default function Step5DryPowder({ data }: { data: any[] }) {
  const [dpCats, setDpCats] = useState({ pmpu: false, mm: true, swap: false, other: false, nonrep: false });

  const processedDpData = useMemo(() => {
    const compute = (market: "ny" | "ldn") => {
      const byTf: Record<string, { date: string; traders: number; oi: number }[]> = {
        historical: [], year: [], recent_4: [], recent_1: [], current: [],
      };
      const mt = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
      data.forEach(d => {
        const trL = market === "ny" ? d.tradersNY : d.tradersLDN;
        const trS = market === "ny" ? (d as any).tradersNY_short : (d as any).tradersLDN_short;
        let dpLong = 0, dpShort = 0, dpTradersLong = 0, dpTradersShort = 0;
        Object.keys(dpCats).forEach(cat => {
          if ((dpCats as any)[cat]) {
            const oiKey = cat === "nonrep" ? "nonRep" : cat;
            dpLong         += ((d as any)[market][`${oiKey}Long`])  * mt;
            dpShort        += ((d as any)[market][`${oiKey}Short`]) * mt;
            dpTradersLong  += (trL as any)?.[cat] ?? 0;
            dpTradersShort += (trS as any)?.[cat] ?? 0;
          }
        });
        const tf = d.timeframe as string;
        if (byTf[tf]) {
          if (dpTradersLong  > 0) byTf[tf].push({ date: d.date, traders: dpTradersLong,  oi: dpLong  });
          if (dpTradersShort > 0) byTf[tf].push({ date: d.date, traders: dpTradersShort, oi: -dpShort });
        }
      });
      return byTf;
    };
    return { ny: compute("ny"), ldn: compute("ldn") };
  }, [data, dpCats]);

  const dpDomain = useMemo(() => {
    const calc = (byTf: Record<string, { date: string; traders: number; oi: number }[]>) => {
      const all = Object.values(byTf).flat();
      if (!all.length) return { x: [0, 1000] as [number, number], y: [-5000000, 5000000] as [number, number] };
      const tVals = all.map(p => p.traders).filter(v => v > 0);
      const oVals = all.map(p => p.oi);
      const tMin  = tVals.length ? Math.min(...tVals) : 0;
      const tMax  = tVals.length ? Math.max(...tVals) : 1000;
      const oMin  = oVals.length ? Math.min(...oVals) : -5000000;
      const oMax  = oVals.length ? Math.max(...oVals) : 5000000;
      const tPad  = (tMax - tMin) * 0.1 || 10;
      const oPad  = Math.max(Math.abs(oMax), Math.abs(oMin)) * 0.1;
      return {
        x: [Math.floor(tMin - tPad), Math.ceil(tMax + tPad)] as [number, number],
        y: [Math.floor(oMin < 0 ? oMin * 1.1 : oMin - oPad), Math.ceil(oMax > 0 ? oMax * 1.1 : oMax + oPad)] as [number, number],
      };
    };
    return { ny: calc(processedDpData.ny), ldn: calc(processedDpData.ldn) };
  }, [processedDpData]);

  const mkScatter = (market: "ny" | "ldn") => {
    const d = processedDpData[market];
    const dom = dpDomain[market];
    const legendContent = (props: any) => {
      const items = [...(props.payload ?? [])].reverse();
      return (
        <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 10, paddingTop: 8 }}>
          {items.map((e: any, i: number) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, color: "#94a3b8" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: e.color, display: "inline-block" }} />
              {e.value}
            </span>
          ))}
        </div>
      );
    };
    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis type="number" dataKey="traders" name="# traders" stroke="#475569" fontSize={10}
              domain={dom.x}
              label={{ value: "# traders", position: "insideBottom", offset: -10, fill: "#475569", fontSize: 10 }} />
            <YAxis type="number" dataKey="oi" name="OI" stroke="#475569" fontSize={10}
              domain={dom.y}
              tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
              label={{ value: "OI (k MT)", angle: -90, position: "insideLeft", offset: -10, fill: "#475569", fontSize: 10 }} />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE}
              formatter={(v: any, name: any) => name === "# traders"
                ? [Math.round(Number(v)).toString(), name]
                : [`${(Number(v) / 1000).toFixed(1)}k MT`, name]} />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} content={legendContent} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Scatter name="Historic"   data={d.historical} fill="#bfdbfe" fillOpacity={0.18} {...{ size: 12  } as any} />
            <Scatter name="Prior Y"    data={d.year}       fill="#3b82f6" fillOpacity={0.45} {...{ size: 28  } as any} />
            <Scatter name="Prior 4W"   data={d.recent_4}   fill="#eab308" fillOpacity={0.9}  {...{ size: 78  } as any} />
            <Scatter name="Prior week" data={d.recent_1}   fill="#c2410c" fillOpacity={1.0}  {...{ size: 154 } as any} />
            <Scatter name="Last CoT"   data={d.current}    fill="#ef4444" fillOpacity={1.0}  {...{ size: 314 } as any} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div id="cot-section-5">
      <SectionHeader icon="Droplets" title="5. Dry Powder Indicator"
        subtitle="Gross Long OI (positive) and Gross Short OI (negative) vs number of traders. Color = recency." />
      <div className="flex items-center gap-3 mb-4">
        <CatToggles cats={dpCats} set={k => setDpCats(p => ({ ...p, [k]: !p[k as keyof typeof p] }))} items={CAT_ITEMS} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
          {mkScatter("ny")}
        </div>
        <div>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
          {mkScatter("ldn")}
        </div>
      </div>
    </div>
  );
}
