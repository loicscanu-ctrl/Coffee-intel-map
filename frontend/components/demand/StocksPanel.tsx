"use client";
import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

interface MonthlyEntry {
  period?: string;
  month?: string;
  value_raw?: number;
  value_mt?: number;
  note?: string;
}

interface EcfData {
  source: string;
  last_updated: string;
  monthly: MonthlyEntry[];
  latest_bags: number;
  latest_m_bags: number | null;
}

interface JapanData {
  source: string;
  last_updated: string;
  monthly_imports: { month: string; value_mt: number }[];
  latest_mt: number | null;
  latest_bags: number | null;
}

interface StocksPayload {
  generated_at: string;
  ecf: EcfData | null;
  japan: JapanData | null;
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtPeriod(p: string): string {
  const m = p.match(/(\d{4})-(\d{2})/);
  if (m) return `${MONTH_ABBR[parseInt(m[2]) - 1]}-${m[1].slice(2)}`;
  return p.slice(0, 7);
}

function EcfPanel({ ecf }: { ecf: EcfData }) {
  const monthly = ecf.monthly.slice(-18);
  const chartData = monthly.map(m => ({
    period: fmtPeriod(m.period ?? m.month ?? ""),
    bags_m: m.value_raw != null ? +(m.value_raw / 1_000_000).toFixed(2) : null,
  })).filter(d => d.bags_m != null);

  const latestM = ecf.latest_m_bags ?? (ecf.latest_bags ? +(ecf.latest_bags / 1_000_000).toFixed(2) : null);

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">ECF European Port Stocks</div>
        <div className="text-[8px] text-slate-600">ECF · {ecf.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest stocks</div>
          <div className="text-white font-bold">{latestM != null ? `${latestM.toFixed(1)}M` : "—"}</div>
          <div className="text-[9px] text-slate-600">60-kg bags</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">In MT</div>
          <div className="text-white font-bold">
            {ecf.latest_bags ? `${Math.round(ecf.latest_bags * 0.06 / 1000)}k` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">metric tons</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Cover (est.)</div>
          <div className="text-slate-400 font-bold text-[11px]">
            {ecf.latest_bags ? `${Math.round(ecf.latest_bags / 500_000)} wks` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">vs EU consumption</div>
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="period" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={v => `${v}M`} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toFixed(2)}M bags`, "ECF Stocks"]} />
              <Bar dataKey="bags_m" fill="#6366f1" opacity={0.8} radius={[2,2,0,0]} />
              <Line dataKey="bags_m" type="monotone" stroke="#a5b4fc" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="text-[9px] text-slate-600">
        European Coffee Federation — green coffee stocks in Hamburg, Antwerp, Trieste, Le Havre, Barcelona + other EU ports.
      </div>
    </div>
  );
}

function JapanPanel({ japan }: { japan: JapanData }) {
  const monthly = japan.monthly_imports.slice(-18);
  const chartData = monthly.map(m => ({
    month: fmtPeriod(m.month),
    mt:    m.value_mt,
    bags:  Math.round(m.value_mt / 60 * 1000),
  }));

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Japan Coffee Imports (AJCA)</div>
        <div className="text-[8px] text-slate-600">AJCA · {japan.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Latest month</div>
          <div className="text-white font-bold">
            {japan.latest_mt ? `${(japan.latest_mt / 1000).toFixed(0)}k` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">metric tons</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">In bags</div>
          <div className="text-white font-bold">
            {japan.latest_bags ? `${(japan.latest_bags / 1000).toFixed(0)}k` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">60-kg bags</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Ann. run rate</div>
          <div className="text-slate-400 font-bold text-[11px]">
            {japan.latest_mt ? `${Math.round(japan.latest_mt * 12 / 1000)}k MT` : "—"}
          </div>
          <div className="text-[9px] text-slate-600">est. annual</div>
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown) => [`${Number(v).toLocaleString()} MT`, "Imports"]} />
              <Bar dataKey="mt" fill="#0ea5e9" opacity={0.8} radius={[2,2,0,0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="text-[9px] text-slate-600">
        All Japan Coffee Association (AJCA) — monthly green coffee import volumes. Japan is the world&apos;s 4th largest importer.
      </div>
    </div>
  );
}

export default function StocksPanel() {
  const [data, setData] = useState<StocksPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/data/demand_stocks.json")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-xs text-slate-500 animate-pulse p-4">Loading stocks data...</div>
    );
  }

  if (!data || (!data.ecf && !data.japan)) {
    return (
      <div className="bg-slate-900 border-b border-slate-700 p-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Consumer Market Stocks</div>
        <div className="text-xs text-slate-500">
          ECF and AJCA stock data not yet available — requires scraper run.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border-b border-slate-700 p-4 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Consumer Market Stocks</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.ecf ? (
          <EcfPanel ecf={data.ecf} />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            ECF data pending scraper run
          </div>
        )}
        {data.japan ? (
          <JapanPanel japan={data.japan} />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            AJCA Japan data pending scraper run
          </div>
        )}
      </div>
    </div>
  );
}
