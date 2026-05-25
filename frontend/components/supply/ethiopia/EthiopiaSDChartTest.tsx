"use client";
// TEMPORARY comparison tab — shows two ways to render the S&D balance so we can
// pick one. Delete this file (and its sub-tab in EthiopiaTab) once chosen.
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import { SD_BALANCE } from "./stonexSurvey";

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const C = { opening: "#64748b", exports: "#f59e0b", consumption: "#3b82f6", build: "#22c55e", draw: "#ef4444", ending: "#94a3b8", line: "#e2e8f0" };

export default function EthiopiaSDChartTest() {
  const data = SD_BALANCE.map(r => {
    const delta = r.ending - r.opening;
    return {
      year: r.year,
      opening: r.opening,
      exports: r.exports,
      consumption: r.consumption,
      ending: r.ending,
      production: r.production,
      stockBuild: Math.max(delta, 0),
      stockDraw: Math.min(delta, 0),  // negative → renders below the zero axis
    };
  });

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-amber-400/80 bg-amber-950/30 rounded px-3 py-2 border border-amber-900/40">
        Temporary comparison tab. Both charts use the same StoneX 2025/26 balance. Pick one and I&apos;ll wire it into the
        real Supply &amp; Demand tab and remove this.
      </div>

      {/* ── Option A: total-supply stack with signed stock change ── */}
      <div className={CARD}>
        <div className="text-[10px] text-slate-300 uppercase tracking-wide font-semibold">
          Option A — Total-supply stack (your description)
        </div>
        <div className="text-[10px] text-slate-500 leading-relaxed">
          Bottom→top: <span style={{ color: C.opening }}>Opening</span> + <span style={{ color: C.exports }}>Exports</span> +{" "}
          <span style={{ color: C.consumption }}>Consumption</span> + <span style={{ color: C.build }}>stock build</span>.
          The 3 upper segments = Production. Destock years (23/24, 24/25) show a{" "}
          <span style={{ color: C.draw }}>red drawdown</span> below the axis — that&apos;s the negative ΔStock the stack can&apos;t carry on top.
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -6, bottom: 0 }} stackOffset="sign">
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}M`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip contentStyle={TT} formatter={(v: unknown, n) => [`${Number(v).toLocaleString()}k`, String(n)]} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="opening"     name="Opening"      stackId="a" fill={C.opening} />
              <Bar dataKey="exports"     name="Exports"      stackId="a" fill={C.exports} />
              <Bar dataKey="consumption" name="Consumption"  stackId="a" fill={C.consumption} />
              <Bar dataKey="stockBuild"  name="Stock build"  stackId="a" fill={C.build} radius={[2, 2, 0, 0]} />
              <Bar dataKey="stockDraw"   name="Stock draw"   stackId="a" fill={C.draw} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Option B: disappearance stack, always positive ── */}
      <div className={CARD}>
        <div className="text-[10px] text-slate-300 uppercase tracking-wide font-semibold">
          Option B — Disappearance stack (always positive)
        </div>
        <div className="text-[10px] text-slate-500 leading-relaxed">
          Stack = <span style={{ color: C.exports }}>Exports</span> + <span style={{ color: C.consumption }}>Consumption</span> +{" "}
          <span style={{ color: C.ending }}>Ending stocks</span> (= total supply, always positive). The{" "}
          <span style={{ color: C.line }}>Opening</span> line marks carry-in, so the bar above it ≈ Production; ΔStock = top segment vs the line.
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}M`} />
              <Tooltip contentStyle={TT} formatter={(v: unknown, n) => [`${Number(v).toLocaleString()}k`, String(n)]} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="exports"     name="Exports"       stackId="b" fill={C.exports} />
              <Bar dataKey="consumption" name="Consumption"   stackId="b" fill={C.consumption} />
              <Bar dataKey="ending"      name="Ending stocks" stackId="b" fill={C.ending} radius={[2, 2, 0, 0]} />
              <Line dataKey="opening"    name="Opening (carry-in)" type="stepAfter" stroke={C.line} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              <Line dataKey="production" name="Production"    type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
