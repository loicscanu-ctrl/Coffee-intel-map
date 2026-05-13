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
  latest_post?: string | null;
  latest_pdf?: string | null;
  yearly_pdfs?: { year: string; pdf_url: string }[];
}

interface PsdAnnualEntry {
  year: string;
  imports_mt?: number | null;
  consumption_mt?: number | null;
  stocks_mt?: number | null;
}

interface PsdData {
  source: string;
  last_updated: string;
  annual: PsdAnnualEntry[];
  latest_year: string | null;
  latest_imports_mt: number | null;
  latest_consumption_mt: number | null;
  latest_stocks_mt: number | null;
}

interface AjcaData {
  source: string;
  source_url?: string | null;
  last_updated: string;
  latest_year: string | null;
  latest_imports_mt: number | null;
  latest_consumption_mt: number | null;
  monthly_imports_pdf?: string | null;
  monthly_exports_pdf?: string | null;
  supply_demand_pdf?:   string | null;
  yearly_imports_pdf?:  string | null;
  latest_origin_breakdown?: { country: string; imports_mt: number }[] | null;
  latest_origin_pdf?: string | null;
}

interface ProducerEntry {
  latest_year: string | null;
  latest_production_mt: number | null;
  latest_exports_mt: number | null;
  latest_consumption_mt: number | null;
  latest_stocks_mt: number | null;
  annual: PsdAnnualEntry[];
}

interface StocksPayload {
  generated_at: string;
  ecf: EcfData | null;
  eu: PsdData | null;
  japan: PsdData | null;
  usa: PsdData | null;
  ajca: AjcaData | null;
  producers: Record<string, ProducerEntry> | null;
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

// ── ECF panel (monthly) ──────────────────────────────────────────────────────

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
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">ECF European Port Stocks (monthly)</div>
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

      <div className="text-[9px] text-slate-500 space-y-0.5">
        {ecf.latest_post && (
          <div>
            Latest report: {" "}
            <a href={ecf.latest_post} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">
              post
            </a>
            {ecf.latest_pdf && (
              <>
                {" · "}
                <a href={ecf.latest_pdf} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">
                  PDF
                </a>
              </>
            )}
          </div>
        )}
        {ecf.yearly_pdfs && ecf.yearly_pdfs.length > 0 && (
          <div>
            Yearly: {ecf.yearly_pdfs.slice(0, 5).map((y, i) => (
              <span key={y.year}>
                {i > 0 && " · "}
                <a href={y.pdf_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-200 underline">
                  {y.year}
                </a>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="text-[9px] text-slate-600">
        European Coffee Federation — green coffee stocks at all EU ports. Reported in tonnes; values shown as 60-kg bags equivalent.
      </div>
    </div>
  );
}

// ── Annual PSD panel (shared between EU and Japan) ───────────────────────────

function PsdPanel({
  data, title, accent, subtitle,
}: {
  data: PsdData;
  title: string;
  accent: string;
  subtitle: string;
}) {
  const recent = data.annual.slice(-12);
  const chartData = recent.map(p => ({
    year:    p.year,
    imports: p.imports_mt != null ? Math.round(p.imports_mt / 1000) : null,
    stocks:  p.stocks_mt  != null ? Math.round(p.stocks_mt  / 1000) : null,
  }));

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">{title}</div>
        <div className="text-[8px] text-slate-600">USDA · {data.last_updated}</div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Imports</div>
          <div className={`${accent} font-bold`}>{fmtThousands(data.latest_imports_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {data.latest_year}</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Consumption</div>
          <div className="text-white font-bold">{fmtThousands(data.latest_consumption_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {data.latest_year}</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Ending stocks</div>
          <div className="text-slate-300 font-bold">{fmtThousands(data.latest_stocks_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {data.latest_year}</div>
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

      <div className="text-[9px] text-slate-600">{subtitle}</div>
    </div>
  );
}

// ── AJCA panel (Japan native source) ─────────────────────────────────────────

function AjcaPanel({ ajca }: { ajca: AjcaData }) {
  const breakdown = ajca.latest_origin_breakdown;
  const total = breakdown?.reduce((s, r) => s + r.imports_mt, 0) || 0;
  const topRows = breakdown
    ? [...breakdown].sort((a, b) => b.imports_mt - a.imports_mt).slice(0, 8)
    : null;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Japan Green Coffee — AJCA</div>
        <div className="text-[8px] text-slate-600">AJCA · {ajca.last_updated}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Imports (green)</div>
          <div className="text-sky-300 font-bold">{fmtThousands(ajca.latest_imports_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {ajca.latest_year}</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] mb-0.5">Total consumption</div>
          <div className="text-white font-bold">{fmtThousands(ajca.latest_consumption_mt)}</div>
          <div className="text-[9px] text-slate-600">MT · {ajca.latest_year}</div>
        </div>
      </div>

      {topRows && topRows.length > 0 && (
        <div>
          <div className="text-[9px] text-slate-500 mb-1 uppercase tracking-wide">
            Monthly origin breakdown
            {ajca.latest_origin_pdf && (
              <a href={ajca.latest_origin_pdf} target="_blank" rel="noopener noreferrer"
                 className="ml-1 text-sky-600 hover:text-sky-400 normal-case">PDF</a>
            )}
          </div>
          <div className="space-y-0.5">
            {topRows.map(r => {
              const pct = total > 0 ? (r.imports_mt / total) * 100 : 0;
              return (
                <div key={r.country} className="flex items-center gap-1.5">
                  <div className="text-[9px] text-slate-400 w-20 truncate">{r.country}</div>
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                    <div className="bg-sky-500 h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="text-[9px] text-slate-400 font-mono w-10 text-right">{fmtThousands(r.imports_mt)}</div>
                  <div className="text-[9px] text-slate-600 w-8 text-right">{pct.toFixed(0)}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-[9px] text-slate-500 space-y-0.5">
        {ajca.monthly_imports_pdf && !breakdown && (
          <div>
            Latest monthly imports PDF: {" "}
            <a href={ajca.monthly_imports_pdf} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 underline">
              j-import
            </a>
          </div>
        )}
        {ajca.supply_demand_pdf && (
          <div>
            Supply &amp; demand: {" "}
            <a href={ajca.supply_demand_pdf} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 underline">
              data-jukyu
            </a>
          </div>
        )}
        {ajca.source_url && (
          <div>
            <a href={ajca.source_url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-400 underline">
              All Japan Coffee Association →
            </a>
          </div>
        )}
      </div>

      <div className="text-[9px] text-slate-600">
        Native Japanese source — AJCA statistics hub. Monthly PDF reports for imports / exports / supply-demand. Updates monthly.
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

  if (!data || (!data.ecf && !data.eu && !data.japan && !data.ajca && !data.usa)) {
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
        {data.eu ? (
          <PsdPanel
            data={data.eu}
            title="EU Green Coffee — Annual (USDA PSD)"
            accent="text-emerald-300"
            subtitle="USDA FAS PSD database — annual marketing-year figures for the European Union. Imports include all 27 member states."
          />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            EU PSD data pending scraper run
          </div>
        )}
        {data.ecf ? (
          <EcfPanel ecf={data.ecf} />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            ECF monthly data pending scraper run
          </div>
        )}
        {data.ajca ? (
          <AjcaPanel ajca={data.ajca} />
        ) : data.japan ? (
          <PsdPanel
            data={data.japan}
            title="Japan Green Coffee — Annual (USDA PSD)"
            accent="text-sky-300"
            subtitle="USDA FAS PSD database — annual marketing-year figures for Japan, world&apos;s 4th-largest importer."
          />
        ) : (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 text-center text-[10px] text-slate-500">
            Japan data pending scraper run (AJCA / PSD)
          </div>
        )}
        {data.usa && (
          <PsdPanel
            data={data.usa}
            title="USA Green Coffee — Annual (USDA PSD)"
            accent="text-amber-300"
            subtitle="USDA FAS PSD database — annual US green-coffee import and consumption figures. Key ICE warehouse destination market."
          />
        )}
      </div>
    </div>
  );
}
