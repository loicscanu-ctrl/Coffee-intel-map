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
  source_url?: string | null;
}

interface IceSeriesPoint {
  as_of: string;
  total_bags: number;
  eu_bags: number;
  us_bags: number;
  other_bags: number;
}

interface IceData {
  source: string;
  source_url?: string | null;
  last_updated: string;
  series: IceSeriesPoint[];
  latest: {
    total_bags: number;
    eu_bags: number;
    us_bags: number;
    other_bags: number;
  };
  by_port: Record<string, number>;
}

interface JapanAnnualEntry {
  year: string;
  imports_mt?: number | null;
  consumption_mt?: number | null;
  stocks_mt?: number | null;
}

interface JapanData {
  source: string;
  last_updated: string;
  annual: JapanAnnualEntry[];
  latest_year: string | null;
  latest_imports_mt: number | null;
  latest_consumption_mt: number | null;
  latest_stocks_mt: number | null;
}

interface StocksPayload {
  generated_at: string;
  ecf: EcfData | null;
  ice: IceData | null;
  japan: JapanData | null;
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtPeriod(p: string): string {
  const m = p.match(/(\d{4})-(\d{2})/);
  if (m) return `${MONTH_ABBR[parseInt(m[2]) - 1]}-${m[1].slice(2)}`;
  return p.slice(0, 7);
}

function fmtThousands(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

// ── ECF panel ─────────────────────────────────────────────────────────────────

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

      {chartData.length > 1 ? (
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
      ) : (
        <div className="h-32 flex items-center justify-center text-[10px] text-slate-600 italic">
          Monthly history not yet collected — scraper still building series.
        </div>
      )}

      <div className="text-[9px] text-slate-600">
        European Coffee Federation — green coffee stocks in Hamburg, Antwerp, Trieste, Le Havre, Barcelona + other EU ports.
        {ecf.source_url && (
          <>
            {" "}
            <a href={ecf.source_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-300 underline">
              source
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// ── ICE certified panel ──────────────────────────────────────────────────────

function IcePanel({ ice }: { ice: IceData }) {
  const recent = ice.series.slice(-90); // ~3 months of trading days
  const chartData = recent.map(p => ({
    date:   p.as_of.slice(5),
    eu_m:   +(p.eu_bags    / 1_000_000).toFixed(3),
    us_m:   +(p.us_bags    / 1_000_000).toFixed(3),
    total_m:+(p.total_bags / 1_000_000).toFixed(3),
  }));
  const pct = (n: number) => ice.latest.total_bags > 0
    ? Math.round((n / ice.latest.total_bags) * 100)
    : 0;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">ICE Arabica Certified Stocks</div>
        <div className="text-[8px] text-slate-600">ICE · {ice.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">EU ports</div>
          <div className="text-emerald-300 font-bold">{fmtThousands(ice.latest.eu_bags)}</div>
          <div className="text-[9px] text-slate-600">{pct(ice.latest.eu_bags)}% of total</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">US ports</div>
          <div className="text-sky-300 font-bold">{fmtThousands(ice.latest.us_bags)}</div>
          <div className="text-[9px] text-slate-600">{pct(ice.latest.us_bags)}% of total</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Total</div>
          <div className="text-white font-bold">{fmtThousands(ice.latest.total_bags)}</div>
          <div className="text-[9px] text-slate-600">60-kg bags</div>
        </div>
      </div>

      {chartData.length > 1 ? (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(chartData.length / 8))} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={v => `${v}M`} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name) => [`${Number(v).toFixed(3)}M bags`, name === "eu_m" ? "EU ports" : name === "us_m" ? "US ports" : "Total"]} />
              <Line dataKey="total_m" type="monotone" stroke="#e2e8f0" strokeWidth={1.5} dot={false} />
              <Line dataKey="eu_m"    type="monotone" stroke="#10b981" strokeWidth={1.2} dot={false} />
              <Line dataKey="us_m"    type="monotone" stroke="#0ea5e9" strokeWidth={1.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-32 flex items-center justify-center text-[10px] text-slate-600 italic">
          Building daily series — first reading just captured.
        </div>
      )}

      <div className="text-[9px] text-slate-600">
        ICE Coffee &lsquo;C&rsquo; certified stocks at licensed warehouses. EU ports = Antwerp, Hamburg, Bremen, Trieste, Genoa, Le Havre, Barcelona.
        {ice.source_url && (
          <>
            {" "}
            <a href={ice.source_url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-300 underline">
              source
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// ── Japan (PSD annual) panel ─────────────────────────────────────────────────

function JapanPanel({ japan }: { japan: JapanData }) {
  const recent = japan.annual.slice(-10);
  const chartData = recent.map(p => ({
    year:    p.year,
    imports: p.imports_mt != null ? Math.round(p.imports_mt / 1000) : null,
    stocks:  p.stocks_mt  != null ? Math.round(p.stocks_mt  / 1000) : null,
  }));

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Japan Green Coffee — Annual (USDA PSD)</div>
        <div className="text-[8px] text-slate-600">USDA · {japan.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Imports</div>
          <div className="text-white font-bold">{fmtThousands(japan.latest_imports_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {japan.latest_year}</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Consumption</div>
          <div className="text-white font-bold">{fmtThousands(japan.latest_consumption_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {japan.latest_year}</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Ending stocks</div>
          <div className="text-slate-300 font-bold">{fmtThousands(japan.latest_stocks_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {japan.latest_year}</div>
        </div>
      </div>

      {chartData.length > 1 ? (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, left: -10, bottom: 0 }}>
              <XAxis dataKey="year" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}k`} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: unknown, name) => [`${Number(v).toLocaleString()}k MT`, name === "imports" ? "Imports" : "Ending stocks"]} />
              <Bar dataKey="imports" fill="#0ea5e9" opacity={0.8} radius={[2,2,0,0]} />
              <Line dataKey="stocks" type="monotone" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-32 flex items-center justify-center text-[10px] text-slate-600 italic">
          Annual history not yet available.
        </div>
      )}

      <div className="text-[9px] text-slate-600">
        USDA Foreign Agricultural Service — Production, Supply &amp; Distribution database. Annual marketing-year figures.
      </div>
    </div>
  );
}

// ── Page section ─────────────────────────────────────────────────────────────

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

  if (!data || (!data.ecf && !data.ice && !data.japan)) {
    return (
      <div className="bg-slate-900 border-b border-slate-700 p-4">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">Consumer Market Stocks</div>
        <div className="text-xs text-slate-500">
          Stock data not yet available — requires scraper run.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border-b border-slate-700 p-4 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Consumer Market Stocks</div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.ice ? (
          <IcePanel ice={data.ice} />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            ICE certified data pending scraper run
          </div>
        )}
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
            Japan PSD data pending scraper run
          </div>
        )}
      </div>
    </div>
  );
}
