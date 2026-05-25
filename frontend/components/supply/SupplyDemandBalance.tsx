"use client";
// Standardized Supply & Demand balance — same visual format as the Ethiopia
// (StoneX) S&D, but fed by USDA PSD per-origin data from demand_stocks.json, so
// every origin renders an identical balance view. Self-contained (own fetch).
import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, Line, LabelList, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid, ReferenceLine,
} from "recharts";

interface AnnualRow {
  year: string;
  begin_stocks_mt?: number;
  production_mt?: number;
  imports_mt?: number;
  exports_mt?: number;
  consumption_mt?: number;
  stocks_mt?: number;
}

const TT = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };
const CARD = "bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3";
const MT_PER_KBAG = 60;                         // 1 thousand 60-kg bags = 60 MT
const kbags = (mt: number | undefined) => Math.round((mt ?? 0) / MT_PER_KBAG);
const chgCls = (v: number) => (v >= 0 ? "text-emerald-400" : "text-red-400");
const segLabel = (v: unknown) => { const n = Number(v); return n && Math.abs(n) >= 1 ? Math.round(n).toLocaleString() : ""; };

export default function SupplyDemandBalance({ origin, label, years = 12 }: { origin: string; label: string; years?: number }) {
  const [rows, setRows] = useState<AnnualRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/demand_stocks.json")
      .then(r => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const annual = d?.producers?.[origin]?.annual;
        if (Array.isArray(annual) && annual.length) setRows(annual);
        else setError(true);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [origin]);

  if (error) return <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">USDA PSD supply & demand data unavailable for {label}.</div>;
  if (!rows) return <div className="text-xs text-slate-500 animate-pulse py-12 text-center">Loading supply &amp; demand…</div>;

  const recent = rows.slice(-years).map(r => {
    const opening = kbags(r.begin_stocks_mt);
    const ending  = kbags(r.stocks_mt);
    const delta   = ending - opening;
    return {
      year: (r.year ?? "").slice(-2),
      opening, production: kbags(r.production_mt), exports: kbags(r.exports_mt),
      consumption: kbags(r.consumption_mt), ending,
      stockBuild: Math.max(delta, 0), stockDraw: Math.min(delta, 0),
    };
  });

  return (
    <div className="space-y-3">
      <div className={CARD}>
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label} — Supply &amp; Demand (thousand 60-kg bags)</div>
          <div className="text-[8px] text-slate-600">USDA FAS PSD</div>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={recent} stackOffset="sign" margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}M`} />
              <ReferenceLine y={0} stroke="#475569" />
              <Tooltip contentStyle={TT} formatter={(v: unknown, n) => [`${Number(v).toLocaleString()}k bags`, String(n)]} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <Bar dataKey="opening"     name="Opening"     stackId="a" fill="#64748b"><LabelList dataKey="opening"     position="center" fontSize={8} fill="#f8fafc" formatter={segLabel} /></Bar>
              <Bar dataKey="exports"     name="Exports"     stackId="a" fill="#f59e0b"><LabelList dataKey="exports"     position="center" fontSize={8} fill="#1e293b" formatter={segLabel} /></Bar>
              <Bar dataKey="consumption" name="Consumption" stackId="a" fill="#3b82f6"><LabelList dataKey="consumption" position="center" fontSize={8} fill="#f8fafc" formatter={segLabel} /></Bar>
              <Bar dataKey="stockBuild"  name="Stock build" stackId="a" fill="#22c55e" radius={[2, 2, 0, 0]}><LabelList dataKey="stockBuild" position="center" fontSize={8} fill="#0b1220" formatter={segLabel} /></Bar>
              <Bar dataKey="stockDraw"   name="Stock draw"  stackId="a" fill="#ef4444"><LabelList dataKey="stockDraw" position="center" fontSize={8} fill="#f8fafc" formatter={segLabel} /></Bar>
              <Line dataKey="production" name="Production"  type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-slate-500 leading-relaxed">
          Each column stacks Opening + Exports + Consumption + stock change. Green = stock build; red below axis = destock.
          The purple Production line is a reference — any gap above the stack is imports + non-bean (roast/soluble) disappearance
          &amp; adjustments. Source: USDA FAS PSD (green-bean balance).
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1 pr-2 font-medium">Year</th>
                <th className="py-1 px-1 text-right font-medium">Open</th>
                <th className="py-1 px-1 text-right font-medium">Prod</th>
                <th className="py-1 px-1 text-right font-medium">Exports</th>
                <th className="py-1 px-1 text-right font-medium">Cons</th>
                <th className="py-1 pl-1 text-right font-medium">End</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={r.year} className={`border-t border-slate-700/50 ${i === recent.length - 1 ? "text-amber-300" : "text-slate-300"}`}>
                  <td className="py-0.5 pr-2">{r.year}</td>
                  <td className="py-0.5 px-1 text-right">{r.opening.toLocaleString()}</td>
                  <td className="py-0.5 px-1 text-right">{r.production.toLocaleString()}</td>
                  <td className="py-0.5 px-1 text-right">{r.exports.toLocaleString()}</td>
                  <td className="py-0.5 px-1 text-right">{r.consumption.toLocaleString()}</td>
                  <td className={`py-0.5 pl-1 text-right ${chgCls(r.ending - r.opening)}`}>{r.ending.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
