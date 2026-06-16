"use client";
import { useEffect, useState, useMemo } from "react";
import {
  ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, BarChart,
} from "recharts";
import { MONTH_ABBR } from "@/lib/formatters";

interface HSRow      { code: string; description: string; kg: number; usd: number; }
interface DestRow    { country: string; kg: number; usd: number; robusta_green_kg: number; arabica_green_kg: number; }
interface PortRow    { port: string;    kg: number; usd: number; robusta_green_kg: number; arabica_green_kg: number; }
interface MonthRow {
  month: string;
  row_count: number;
  total_coffee_kg: number;
  total_coffee_usd: number;
  robusta_green_kg: number;
  arabica_green_kg: number;
  by_destination: DestRow[];
  by_port: PortRow[];
  by_hs: HSRow[];
}
interface IndonesiaExports {
  source: string;
  source_url: string;
  scraped_at: string;
  unit_weight: string;
  unit_value: string;
  series: MonthRow[];
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

// Palette: robusta = warm orange, arabica = cool blue, lumped green = neutral
// emerald (signals pre-2022 BTKI-2017 era), other coffee = slate.
const COLOR_ROBUSTA = "#f97316";
const COLOR_ARABICA = "#3b82f6";
const COLOR_LUMPED  = "#10b981";
const COLOR_OTHER   = "#475569";

const HS_LUMPED_GREEN  = "09011110";  // BTKI-2017 Arabica WIB / robusta OIB
const HS_ROBUSTA_GREEN = "09011130";  // BTKI-2022
const HS_ARABICA_GREEN = "09011120";  // BTKI-2022

function fmtMonth(m: string) {
  const [yr, mo] = m.split("-");
  return `${MONTH_ABBR[parseInt(mo) - 1]}-${yr.slice(2)}`;
}

function fmtKg(kg: number) {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(2)}M`;
  if (kg >= 1_000)     return `${(kg / 1_000).toFixed(0)}k`;
  return `${kg.toFixed(0)}`;
}

/** Sum any per-row breakdown ({country|port|code → kg}) across N months.
 *  `keyField` is the human-facing label field on the row (e.g. "country"
 *  for destinations, "port" for ports of departure). */
function sumBy(
  rows: MonthRow[],
  pick: (m: MonthRow) => (DestRow | PortRow)[],
  keyField: "country" | "port",
): { key: string; kg: number; robusta_green_kg: number; arabica_green_kg: number }[] {
  const acc = new Map<string, { kg: number; robusta_green_kg: number; arabica_green_kg: number }>();
  for (const m of rows) {
    for (const r of pick(m)) {
      const k = keyField === "country"
        ? ((r as DestRow).country ?? "Unknown")
        : ((r as PortRow).port ?? "Unknown");
      const cur = acc.get(k) ?? { kg: 0, robusta_green_kg: 0, arabica_green_kg: 0 };
      cur.kg += r.kg ?? 0;
      cur.robusta_green_kg += r.robusta_green_kg ?? 0;
      cur.arabica_green_kg += r.arabica_green_kg ?? 0;
      acc.set(k, cur);
    }
  }
  return Array.from(acc.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.kg - a.kg);
}

export default function IndonesiaBPSExportsPanel() {
  const [data, setData] = useState<IndonesiaExports | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/indonesia_exports.json")
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const derived = useMemo(() => {
    if (!data?.series?.length) return null;
    const series = [...data.series].sort((a, b) => a.month.localeCompare(b.month));

    // Each month → stacked components: arabica_green, robusta_green,
    // green_unsplit (pre-2022 09011110 only), other (residual). Tooltip
    // shows them all even when 0.
    const chartData = series.map(m => {
      const lumped = m.by_hs.find(h => h.code === HS_LUMPED_GREEN)?.kg ?? 0;
      const other  = Math.max(0, m.total_coffee_kg - m.robusta_green_kg - m.arabica_green_kg - lumped);
      return {
        month: fmtMonth(m.month),
        rawMonth: m.month,
        arabica:  m.arabica_green_kg,
        robusta:  m.robusta_green_kg,
        lumped,
        other,
        total:    m.total_coffee_kg,
      };
    });

    const last = series[series.length - 1];
    const prev12 = series.slice(-13, -1);
    const avg12 = prev12.length
      ? prev12.reduce((s, r) => s + r.total_coffee_kg, 0) / prev12.length
      : 0;
    const yearSoFar = last
      ? series.filter(r => r.month.startsWith(last.month.slice(0, 4)))
              .reduce((s, r) => s + r.total_coffee_kg, 0)
      : 0;
    const sameMoYrAgo = last
      ? series.find(r => {
          const [y, mo] = last.month.split("-");
          return r.month === `${Number(y) - 1}-${mo}`;
        })
      : null;
    const yoyPct = sameMoYrAgo && sameMoYrAgo.total_coffee_kg
      ? ((last!.total_coffee_kg - sameMoYrAgo.total_coffee_kg) / sameMoYrAgo.total_coffee_kg) * 100
      : null;

    // Top destinations + ports over the last 12 months (window aligned to
    // most-recent data point — usually two months behind today).
    const recent12 = series.slice(-12);
    const topDests = sumBy(recent12, m => m.by_destination, "country").slice(0, 10);
    const topPorts = sumBy(recent12, m => m.by_port, "port").slice(0, 10);

    return { chartData, last, avg12, yearSoFar, yoyPct, topDests, topPorts, recentWindow: recent12 };
  }, [data]);

  if (error) {
    return (
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-xs text-slate-500">
        Indonesia BPS export data not available — workflow 0.9 has not run yet.
      </div>
    );
  }
  if (!data || !derived) {
    return (
      <div className="text-xs text-slate-500 animate-pulse py-12 text-center">
        Loading BPS exports…
      </div>
    );
  }

  const { chartData, last, avg12, yearSoFar, yoyPct, topDests, topPorts, recentWindow } = derived;
  const windowLabel = recentWindow.length
    ? `${fmtMonth(recentWindow[0].month)} → ${fmtMonth(recentWindow[recentWindow.length - 1].month)}`
    : "";

  return (
    <div className="space-y-3">
      {/* ── headline ───────────────────────────────────────────────── */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">
            Indonesia Coffee Exports · Monthly · BPS Web API
          </div>
          <div className="text-[8px] text-slate-600">
            HS-0901xx · {chartData.length} months · last {last ? fmtMonth(last.month) : "—"}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 text-xs font-mono">
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Last month</div>
            <div className="text-white font-bold">{last ? fmtKg(last.total_coffee_kg) : "—"}</div>
            <div className="text-[9px] text-slate-600">kg green-equiv.</div>
            {yoyPct != null && (
              <div className={`text-[9px] font-semibold ${yoyPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {yoyPct >= 0 ? "▲" : "▼"} {Math.abs(yoyPct).toFixed(1)}% YoY
              </div>
            )}
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">12-mo avg</div>
            <div className="text-white font-bold">{fmtKg(avg12)}</div>
            <div className="text-[9px] text-slate-600">kg / month</div>
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">YTD {last?.month.slice(0, 4)}</div>
            <div className="text-white font-bold">{fmtKg(yearSoFar)}</div>
            <div className="text-[9px] text-slate-600">cumulative kg</div>
          </div>
          <div>
            <div className="text-slate-500 text-[9px] mb-0.5">Latest species split</div>
            <div className="text-[10px] flex items-baseline gap-2">
              <span style={{ color: COLOR_ROBUSTA }} className="font-bold">
                {last ? fmtKg(last.robusta_green_kg) : "—"}
              </span>
              <span className="text-slate-500">robusta</span>
            </div>
            <div className="text-[10px] flex items-baseline gap-2">
              <span style={{ color: COLOR_ARABICA }} className="font-bold">
                {last ? fmtKg(last.arabica_green_kg) : "—"}
              </span>
              <span className="text-slate-500">arabica</span>
            </div>
          </div>
        </div>

        {/* ── monthly trend ───────────────────────────────────────── */}
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: -4, bottom: 0 }}>
              <XAxis
                dataKey="month" tick={{ fontSize: 7, fill: "#64748b" }}
                axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 14))}
              />
              <YAxis
                tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}M`}
                width={42}
              />
              <Tooltip
                contentStyle={TT_STYLE}
                formatter={(v: unknown, name?: string | number) => {
                  const label =
                    name === "arabica" ? "Arabica green (HS-2022)" :
                    name === "robusta" ? "Robusta green (HS-2022)" :
                    name === "lumped"  ? "Arabica/Robusta lumped (HS-2017 09011110)" :
                    name === "other"   ? "Other coffee (roasted, decaf, husks, substitutes)" :
                    String(name);
                  return [`${fmtKg(Number(v))} kg`, label];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 9, color: "#94a3b8" }} iconSize={8} verticalAlign="top"
                formatter={(value) =>
                  value === "arabica" ? "Arabica green" :
                  value === "robusta" ? "Robusta green" :
                  value === "lumped"  ? "Arabica/Robusta (HS-2017)" :
                  "Other (roasted / decaf / husks)"
                }
              />
              <Bar dataKey="lumped"  stackId="a" name="lumped"  fill={COLOR_LUMPED}  />
              <Bar dataKey="robusta" stackId="a" name="robusta" fill={COLOR_ROBUSTA} />
              <Bar dataKey="arabica" stackId="a" name="arabica" fill={COLOR_ARABICA} />
              <Bar dataKey="other"   stackId="a" name="other"   fill={COLOR_OTHER}   />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="text-[9px] text-slate-600 leading-snug">
          Source: <a href={data.source_url} target="_blank" rel="noreferrer" className="underline">webapi.bps.go.id/v1/api/dataexim</a> ·
          Indonesia&apos;s Bureau of Statistics. Pre-Apr-2022 months sit under BTKI-2017
          which lumped Arabica + Robusta into one &ldquo;not roasted, not decaffeinated&rdquo; code
          (09011110, green ribbon); BTKI-2022 introduced the species split visible
          from Apr-2022 onward.
        </div>
      </div>

      {/* ── destination + port breakdowns ──────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">
              Top destinations · last 12 months
            </div>
            <div className="text-[8px] text-slate-600">{windowLabel}</div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={topDests.map(d => ({ name: d.key, kg: d.kg }))}
                margin={{ top: 2, right: 30, left: 8, bottom: 0 }}
              >
                <XAxis
                  type="number" tick={{ fontSize: 7, fill: "#64748b" }}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}M`}
                />
                <YAxis
                  type="category" dataKey="name" width={120}
                  tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false}
                />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown) => [`${fmtKg(Number(v))} kg`, "Volume"]}
                />
                <Bar dataKey="kg" fill="#8b5cf6" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">
              Top ports of departure · last 12 months
            </div>
            <div className="text-[8px] text-slate-600">{windowLabel}</div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={topPorts.map(p => ({ name: p.key, kg: p.kg }))}
                margin={{ top: 2, right: 30, left: 8, bottom: 0 }}
              >
                <XAxis
                  type="number" tick={{ fontSize: 7, fill: "#64748b" }}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}M`}
                />
                <YAxis
                  type="category" dataKey="name" width={120}
                  tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false}
                />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown) => [`${fmtKg(Number(v))} kg`, "Volume"]}
                />
                <Bar dataKey="kg" fill="#06b6d4" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
