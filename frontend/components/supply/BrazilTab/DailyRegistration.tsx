"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { DAILY_COLORS, TT_STYLE } from "./constants";
import { fmtBags, shiftMonth, shortMonthLabel } from "./helpers";
import type { DailyData } from "./types";

function DailyRegChart({
  title, monthsData, currentMonth, soluvelData,
}: {
  title: string;
  monthsData: Record<string, Record<string, number>>;
  currentMonth: string; // "YYYY-MM"
  soluvelData?: Record<string, Record<string, number>>;
}) {
  const priorMonth = shiftMonth(currentMonth, -1);
  const lyMonth    = shiftMonth(currentMonth, -12);

  const calMo = currentMonth.slice(5); // "MM"
  // Historical: same calendar month, excluding current and LY (prior month is different calMo, auto-excluded)
  const historicalMonths = Object.keys(monthsData)
    .filter(ym => ym.slice(5) === calMo && ym !== currentMonth && ym !== lyMonth)
    .sort();

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const get = (ym: string, day: number) => monthsData[ym]?.[String(day)] ?? null;
  const getSolv = (ym: string, day: number) => soluvelData?.[ym]?.[String(day)] ?? null;

  const chartData = days.map(d => ({
    day: d,
    current:  get(currentMonth, d),
    prior:    get(priorMonth, d),
    ly:       get(lyMonth, d),
    solv_cur: getSolv(currentMonth, d),
    solv_pri: getSolv(priorMonth, d),
    ...Object.fromEntries(historicalMonths.map(ym => [ym, get(ym, d)])),
  }));

  const lastCurrentDay = [...chartData].reverse().find(r => r.current !== null)?.day ?? 0;

  const hasPrior = Object.keys(monthsData[priorMonth] ?? {}).length > 0;
  const hasLy    = Object.keys(monthsData[lyMonth]    ?? {}).length > 0;

  const { priorFinal, lastPriorDay } = (() => {
    const pd = monthsData[priorMonth] ?? {};
    const keys = Object.keys(pd).map(Number).sort((a, b) => b - a);
    if (keys.length === 0) return { priorFinal: null, lastPriorDay: 0 };
    return { priorFinal: pd[String(keys[0])] ?? null, lastPriorDay: keys[0] };
  })();

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-sm font-semibold text-slate-200 mb-0.5">{title}</div>
      <div className="text-[10px] text-slate-500 mb-2">Daily cumulative registrations (bags)</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 9 }} interval={1} />
          <YAxis tickFormatter={fmtBags} tick={{ fill: "#94a3b8", fontSize: 9 }} width={46} />
          <Tooltip
            contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [v !== null ? fmtBags(v) : "—", name]}
            labelFormatter={(l: any) => `Day ${l}`}
          />
          <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {historicalMonths.map(ym => (
            <Line key={ym} type="monotone" dataKey={ym} name={shortMonthLabel(ym)}
              stroke={DAILY_COLORS.hist} strokeWidth={1} dot={false} connectNulls opacity={0.5} />
          ))}
          {hasLy && (
            <Line type="monotone" dataKey="ly" name={shortMonthLabel(lyMonth)}
              stroke={DAILY_COLORS.ly} strokeWidth={1.5} dot={false} connectNulls />
          )}
          {hasPrior && (
            <Line type="monotone" dataKey="prior"
              name={`Last month${priorFinal != null ? ` · ${fmtBags(priorFinal)}` : ""}`}
              stroke={DAILY_COLORS.prior} strokeWidth={1.5} strokeOpacity={0.7} connectNulls
              dot={(props: any) => {
                if (props.payload?.day !== lastPriorDay || props.payload?.prior == null) return <g key={props.key} />;
                return (
                  <g key={props.key}>
                    <circle cx={props.cx} cy={props.cy} r={3} fill={DAILY_COLORS.prior} />
                    <text x={props.cx + 5} y={props.cy - 4} fill="#fb923c" fontSize={9} fontFamily="monospace">
                      {fmtBags(props.payload.prior)}
                    </text>
                  </g>
                );
              }} />
          )}
          <Line type="monotone" dataKey="current" name={shortMonthLabel(currentMonth)}
            stroke={DAILY_COLORS.current} strokeWidth={2.5}
            dot={(props: any) => {
              if (props.payload?.day !== lastCurrentDay || props.payload?.current == null) return <g key={props.key} />;
              return (
                <g key={props.key}>
                  <circle cx={props.cx} cy={props.cy} r={3} fill={DAILY_COLORS.current} />
                  <text x={props.cx + 5} y={props.cy - 4} fill="#f87171" fontSize={9} fontFamily="monospace">
                    {fmtBags(props.payload.current)}
                  </text>
                </g>
              );
            }}
            connectNulls />
          {soluvelData && (
            <Line type="monotone" dataKey="solv_cur"
              name="Soluble"
              stroke={DAILY_COLORS.solv_cur} strokeWidth={1.5} strokeDasharray="4 2"
              dot={false} connectNulls />
          )}
          {soluvelData && (
            <Line type="monotone" dataKey="solv_pri"
              name="Soluble last month"
              stroke={DAILY_COLORS.solv_pri} strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.7}
              dot={false} connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DailyRegistrationSection() {
  const [data, setData] = useState<DailyData | null>(null);

  useEffect(() => {
    fetch("/data/cecafe_daily.json")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => {}); // section hidden if data not available
  }, []);

  if (!data) return null;

  const currentMonth = data.updated.slice(0, 7);
  // Only render if we have actual daily data for at least one month
  const hasData = Object.keys(data.arabica).length > 0 || Object.keys(data.conillon).length > 0;
  if (!hasData) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <DailyRegChart
        title="Brazil — Arabica Export Registration (Daily, Bags)"
        monthsData={data.arabica}
        currentMonth={currentMonth}
      />
      <DailyRegChart
        title="Brazil — Conilon Export Registration (Daily, Bags)"
        monthsData={data.conillon}
        currentMonth={currentMonth}
        soluvelData={data.soluvel}
      />
    </div>
  );
}
