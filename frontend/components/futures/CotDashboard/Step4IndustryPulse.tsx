"use client";
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { ProcessedCotRow } from "@/lib/cot/types";
import { CHART_STYLE } from "./constants";
import SectionHeader from "./SectionHeader";

type MtKey = "pmpuLongMT_NY" | "pmpuLongMT_LDN" | "pmpuShortMT_NY" | "pmpuShortMT_LDN";

export default function Step4IndustryPulse({ recent52 }: { recent52: ProcessedCotRow[] }) {
  const mtFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;
  const mkChart = (market: "ny" | "ldn") => {
    const longKey:  MtKey = market === "ny" ? "pmpuLongMT_NY"  : "pmpuLongMT_LDN";
    const shortKey: MtKey = market === "ny" ? "pmpuShortMT_NY" : "pmpuShortMT_LDN";
    const priceKey: "priceNY" | "priceLDN" = market === "ny" ? "priceNY" : "priceLDN";
    const contractKey: "priceContractNY" | "priceContractLDN" =
      market === "ny" ? "priceContractNY" : "priceContractLDN";
    const prices   = recent52.map(d => d[priceKey]).filter(v => v > 0);
    const priceDomain: [number, number] = prices.length
      ? [Math.floor(Math.min(...prices) / 100) * 100, Math.ceil(Math.max(...prices) / 100) * 100]
      : [0, 500];

    // Detect week-to-week contract switches. Each switch becomes a vertical
    // reference line on the price chart so the reader can see when the
    // price track jumps to a different underlying contract (the max-OI
    // rule rolls liquidity as the front goes into FND).
    const switches: { date: string; from: string; to: string }[] = [];
    for (let i = 1; i < recent52.length; i++) {
      const prev = recent52[i - 1][contractKey];
      const curr = recent52[i][contractKey];
      if (prev && curr && prev !== curr) {
        switches.push({ date: recent52[i].date, from: prev, to: curr });
      }
    }
    const mtVals = recent52.flatMap(d => [d[longKey], d[shortKey]]).filter(v => v > 0);
    const mtDomain: [number, number] = mtVals.length
      ? [Math.floor(Math.min(...mtVals) / 1000) * 1000, Math.ceil(Math.max(...mtVals) / 1000) * 1000]
      : [0, 100000];
    const deltaData = recent52.slice(1).map((d, i) => {
      const dl  = d[longKey]  - recent52[i][longKey];
      const ds  = d[shortKey] - recent52[i][shortKey];
      const efp = market === "ny" ? d.efpMT : 0;
      return { date: d.date, deltaLong: dl, deltaShort: ds, efpMT: efp };
    });
    return (
      <div>
        {/* Panel A */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[300px] mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={recent52}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
              <YAxis yAxisId="left" stroke="#475569" fontSize={10} tickFormatter={mtFmt} domain={mtDomain}
                label={{ value: "MT", angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
              <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} domain={priceDomain} />
              <Tooltip contentStyle={CHART_STYLE} formatter={((v, name) => [
                name === "Price" ? Number(v).toFixed(0) : `${(Number(v) / 1000).toFixed(1)}k MT`, name as NameType,
              ]) satisfies Formatter<ValueType, NameType>} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Area yAxisId="left" type="monotone" dataKey={longKey}  name="Industry Long"  stroke="#92400e" fill="#92400e" fillOpacity={0.3} strokeWidth={2} dot={false} />
              <Area yAxisId="left" type="monotone" dataKey={shortKey} name="Industry Short" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey={priceKey} name="Price" stroke="#f59e0b" strokeWidth={2} dot={false} />
              {switches.map(sw => (
                <ReferenceLine
                  key={`switch-${sw.date}`}
                  yAxisId="right"
                  x={sw.date}
                  stroke="#ec4899"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  label={{
                    value: `→ ${sw.to}`,
                    position: "top",
                    fill: "#ec4899",
                    fontSize: 9,
                  }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Panel B */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={deltaData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={v => v.slice(5)} />
              <YAxis stroke="#475569" fontSize={10} tickFormatter={mtFmt}
                label={{ value: "MT", angle: -90, position: "insideLeft", offset: 10, fill: "#475569", fontSize: 9 }} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <Tooltip contentStyle={CHART_STYLE} formatter={((v, name) => [`${(Number(v) / 1000).toFixed(1)}k MT`, name as NameType]) satisfies Formatter<ValueType, NameType>} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="deltaLong"  name="Δ Long (wk)"  fill="#92400e" opacity={0.8} barSize={4} />
              <Bar dataKey="deltaShort" name="Δ Short (wk)" fill="#22c55e" opacity={0.8} barSize={4} />
              {market === "ny" && <Line type="monotone" dataKey="efpMT" name="EFP Physical" stroke="#f59e0b" strokeWidth={1.5} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };
  return (
    <div id="cot-section-4">
      <SectionHeader icon="Factory" title="6. Industry Pulse (Metric Tons)"
        subtitle="PMPU Gross Long & Short vs Price (max-OI contract; pink dashed line marks weeks where the price track switched to a new contract). Bottom: weekly position changes (NY includes EFP physical delivery)." />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
          {mkChart("ny")}
        </div>
        <div>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
          {mkChart("ldn")}
        </div>
      </div>
    </div>
  );
}
