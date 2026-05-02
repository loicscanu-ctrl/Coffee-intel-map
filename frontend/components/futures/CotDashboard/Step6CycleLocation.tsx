"use client";
import {
  ScatterChart, Scatter, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts";
import { CHART_STYLE } from "./constants";
import SectionHeader from "./SectionHeader";

export default function Step6CycleLocation({ recent52 }: { recent52: any[] }) {
  const cycleColor = (d: any, market: "ny" | "ldn") => {
    if (d.timeframe === "current")  return market === "ny" ? "#ef4444" : "#3b82f6";
    if (d.timeframe === "recent_1") return "#f97316";
    if (d.timeframe === "recent_4") return "#eab308";
    return "#64748b";
  };
  const cycleOpacity = (d: any) => {
    if (d.timeframe === "current")  return 1.0;
    if (d.timeframe === "recent_1") return 0.85;
    if (d.timeframe === "recent_4") return 0.75;
    if (d.timeframe === "year")     return 0.25;
    return 0.12;
  };
  const nyPts  = recent52.map(d => ({ x: d.oiRank,    y: d.priceRank,    timeframe: d.timeframe, date: d.date }));
  const ldnPts = recent52.map(d => ({ x: d.oiRankLDN, y: d.priceRankLDN, timeframe: d.timeframe, date: d.date }));

  const mkCycle = (pts: typeof nyPts, market: "ny" | "ldn") => (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis type="number" dataKey="x" domain={[0, 100]} stroke="#475569" fontSize={10}
            label={{ value: "Net Positioning Rank (%)", position: "bottom", offset: 0, fill: "#475569", fontSize: 10 }} />
          <YAxis type="number" dataKey="y" domain={[0, 100]} stroke="#475569" fontSize={10}
            label={{ value: "Price Rank (%)", angle: -90, position: "insideLeft", fill: "#475569", fontSize: 10 }} />
          <ReferenceArea x1={0}  x2={25}  y1={0}  y2={25}  fill="#10b981" fillOpacity={0.08} stroke="#10b981" strokeOpacity={0.25}
            label={{ value: "OVERSOLD",   position: "insideTopRight",    fill: "#10b981", fontSize: 9, fontWeight: "bold" }} />
          <ReferenceArea x1={75} x2={100} y1={75} y2={100} fill="#ef4444" fillOpacity={0.08} stroke="#ef4444" strokeOpacity={0.25}
            label={{ value: "OVERBOUGHT", position: "insideBottomLeft",  fill: "#ef4444", fontSize: 9, fontWeight: "bold" }} />
          <ReferenceLine x={50} stroke="#475569" strokeDasharray="5 5" />
          <ReferenceLine y={50} stroke="#475569" strokeDasharray="5 5" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_STYLE}
            formatter={(v: any, _: any, props: any) => [`${Number(v).toFixed(1)}%`, props.name]}
            labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.date ?? ""} />
          <Scatter name={market === "ny" ? "NY Arabica" : "LDN Robusta"} data={pts}>
            {pts.map((d, i) => (
              <Cell key={i} fill={cycleColor(d, market)} fillOpacity={cycleOpacity(d)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div id="cot-section-6">
      <SectionHeader icon="Scale" title="6. Cycle Location (OB/OS Matrix)"
        subtitle="X = MM Net Positioning 5Y rank · Y = Price 5Y rank · Red=last week · Orange=prior week · Yellow=prior 4 weeks · Grey=history." />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
          {mkCycle(nyPts, "ny")}
        </div>
        <div>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
          {mkCycle(ldnPts, "ldn")}
        </div>
      </div>
    </div>
  );
}
