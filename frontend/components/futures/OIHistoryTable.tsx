"use client";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const GITHUB_OI_URL =
  "https://raw.githubusercontent.com/loicscanu-ctrl/Coffee-intel-map/main/data/oi_history.json";

interface OIEntry { symbol: string; oi: number; chg: number; }
interface DayData  { date: string; contracts: OIEntry[]; }

const LETTER_TO_MONTH: Record<string, number> = {
  F:1, G:2, H:3, J:4, K:5, M:6,
  N:7, Q:8, U:9, V:10, X:11, Z:12,
};

function symSortKey(sym: string): number {
  const m = sym.match(/^(?:KC|RM)([FGHJKMNQUVXZ])(\d{2})$/i);
  if (!m) return 9999;
  const month = LETTER_TO_MONTH[m[1].toUpperCase()] ?? 0;
  const year  = parseInt(m[2], 10);
  return year * 100 + month;
}

function shortSym(sym: string) {
  return sym.replace(/^(RM|KC)/, "");
}

function fmtChg(chg: number | null): string {
  if (chg === null) return "—";
  return (chg > 0 ? "+" : "") + chg.toLocaleString();
}

// ── Embedded static history (7 trading days, newest first) ────────────────────

const mk = (symbol: string, oi: number): OIEntry => ({ symbol, oi, chg: 0 });

const STATIC_HISTORY: Record<"arabica" | "robusta", DayData[]> = {
  arabica: [
    { date: "2026-03-25", contracts: [mk("KCK26",61395), mk("KCN26",43063), mk("KCU26",30117), mk("KCZ26",24574), mk("KCH27",7928),  mk("KCK27",1887), mk("KCU27",1749), mk("KCZ27",1529), mk("KCN27",991),  mk("KCH28",332)] },
    { date: "2026-03-24", contracts: [mk("KCK26",63382), mk("KCN26",43279), mk("KCU26",29935), mk("KCZ26",24225), mk("KCH27",7626),  mk("KCK27",1804), mk("KCU27",1777), mk("KCZ27",1525), mk("KCN27",1006), mk("KCH28",302)] },
    { date: "2026-03-23", contracts: [mk("KCK26",64198), mk("KCN26",42984), mk("KCU26",28957), mk("KCZ26",23811), mk("KCH27",7607),  mk("KCK27",1661), mk("KCU27",1646), mk("KCZ27",1462), mk("KCN27",974),  mk("KCH28",293)] },
    { date: "2026-03-20", contracts: [mk("KCK26",66602), mk("KCN26",42341), mk("KCU26",30094), mk("KCZ26",23955), mk("KCH27",6971),  mk("KCK27",1557), mk("KCU27",1620), mk("KCZ27",1446), mk("KCN27",936),  mk("KCH28",293)] },
    { date: "2026-03-19", contracts: [mk("KCK26",68457), mk("KCN26",42492), mk("KCU26",28863), mk("KCZ26",23140), mk("KCH27",6874),  mk("KCK27",1407), mk("KCU27",1540), mk("KCZ27",1429), mk("KCN27",935),  mk("KCH28",288)] },
    { date: "2026-03-18", contracts: [mk("KCH26",106),   mk("KCK26",68610), mk("KCN26",42441), mk("KCU26",27971), mk("KCZ26",22769), mk("KCH27",7014),  mk("KCK27",1331), mk("KCU27",1495), mk("KCZ27",1431), mk("KCN27",943),  mk("KCH28",285)] },
    { date: "2026-03-17", contracts: [mk("KCH26",161),   mk("KCK26",68988), mk("KCN26",42133), mk("KCU26",27306), mk("KCZ26",22676), mk("KCH27",7017),  mk("KCK27",1307), mk("KCU27",1482), mk("KCZ27",1399), mk("KCN27",939),  mk("KCH28",275)] },
    { date: "2026-03-16", contracts: [mk("KCH26",201),   mk("KCK26",70784), mk("KCN26",38387), mk("KCU26",26471), mk("KCZ26",22580), mk("KCH27",6428),  mk("KCK27",1260), mk("KCU27",1419), mk("KCZ27",1363), mk("KCN27",904),  mk("KCH28",273)] },
    { date: "2026-03-13", contracts: [mk("KCH26",279),   mk("KCK26",70173), mk("KCN26",37996), mk("KCU26",25985), mk("KCZ26",21796), mk("KCH27",6028),  mk("KCK27",1191), mk("KCU27",1372), mk("KCZ27",1359), mk("KCN27",811),  mk("KCH28",272)] },
    { date: "2026-03-12", contracts: [mk("KCH26",322),   mk("KCK26",70305), mk("KCN26",37784), mk("KCU26",25762), mk("KCZ26",21856), mk("KCH27",5851),  mk("KCK27",1191), mk("KCU27",1337), mk("KCZ27",1359), mk("KCN27",819),  mk("KCH28",270)] },
  ],
  robusta: [
    { date: "2026-03-25", contracts: [mk("RMK26",37906), mk("RMN26",28516), mk("RMU26",9999), mk("RMX26",4147), mk("RMF27",3868), mk("RMH27",1294), mk("RMK27",516), mk("RMN27",273)] },
    { date: "2026-03-24", contracts: [mk("RMK26",39446), mk("RMN26",28003), mk("RMU26",10378), mk("RMX26",4076), mk("RMF27",3881), mk("RMH27",1301), mk("RMK27",500), mk("RMN27",248), mk("RMU27",207)] },
    { date: "2026-03-23", contracts: [mk("RMK26",41662), mk("RMN26",26137), mk("RMU26",10575), mk("RMX26",4146), mk("RMF27",3748), mk("RMH27",1153), mk("RMN27",224)] },
    { date: "2026-03-20", contracts: [mk("RMK26",44268), mk("RMN26",24291), mk("RMU26",10595), mk("RMX26",4278), mk("RMF27",3652), mk("RMH27",1141), mk("RMK27",530), mk("RMN27",219), mk("RMU27",207)] },
    { date: "2026-03-19", contracts: [mk("RMK26",47363), mk("RMN26",23784), mk("RMU26",10920), mk("RMX26",4263), mk("RMF27",3577), mk("RMH27",1195), mk("RMK27",527), mk("RMN27",208), mk("RMU27",207)] },
    { date: "2026-03-18", contracts: [mk("RMK26",48422), mk("RMN26",23148), mk("RMU26",10693), mk("RMX26",4153), mk("RMF27",3577), mk("RMH27",1166), mk("RMK27",527), mk("RMN27",208), mk("RMU27",207)] },
    { date: "2026-03-17", contracts: [mk("RMK26",47615), mk("RMN26",22182), mk("RMU26",10496), mk("RMX26",4149), mk("RMF27",3517), mk("RMH27",1164), mk("RMK27",525), mk("RMN27",207)] },
    { date: "2026-03-16", contracts: [mk("RMH26",6),     mk("RMK26",46966), mk("RMN26",21954), mk("RMU26",10097), mk("RMX26",4028), mk("RMF27",3502), mk("RMH27",1143), mk("RMK27",530), mk("RMN27",202)] },
    { date: "2026-03-13", contracts: [mk("RMK26",47149), mk("RMN26",21764), mk("RMU26",9851),  mk("RMX26",4085), mk("RMF27",3444), mk("RMH27",1085), mk("RMK27",521), mk("RMN27",197)] },
    { date: "2026-03-12", contracts: [mk("RMH26",6),     mk("RMK26",47431), mk("RMN26",21061), mk("RMU26",9587), mk("RMX26",3918), mk("RMF27",3414), mk("RMH27",1083), mk("RMK27",511), mk("RMN27",192), mk("RMU27",205)] },
  ],
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function OIHistoryTable({ market }: { market: "robusta" | "arabica" }) {
  const [days, setDays] = useState<DayData[]>(STATIC_HISTORY[market]);

  useEffect(() => {
    // Merge helper: takes a priority list of DayData[] arrays (first = highest priority)
    // and combines them, with earlier sources winning per symbol per date.
    function mergeSources(sources: DayData[][]): DayData[] {
      const dateMap = new Map<string, DayData>();
      for (const source of sources.slice().reverse()) {
        for (const day of source) {
          const existing = dateMap.get(day.date);
          if (!existing) {
            dateMap.set(day.date, { ...day, contracts: [...day.contracts] });
          } else {
            // Higher-priority source symbols win; lower fills missing
            const existingSyms = new Set(existing.contracts.map(c => c.symbol));
            day.contracts.forEach(c => { if (!existingSyms.has(c.symbol)) existing.contracts.push(c); });
          }
        }
      }
      return Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date));
    }

    Promise.all([
      fetch(`${API_URL}/api/futures/oi-history?market=${market}&days=30`)
        .then(r => r.json()).catch(() => [] as DayData[]),
      fetch(GITHUB_OI_URL)
        .then(r => r.json())
        .then((j: Record<string, DayData[]>) => j[market] ?? [])
        .catch(() => [] as DayData[]),
    ]).then(([localDays, githubDays]: [DayData[], DayData[]]) => {
      // Priority: local API > GitHub JSON > static embedded
      const merged = mergeSources([STATIC_HISTORY[market], githubDays, localDays]);
      if (merged.length) setDays(merged);
    });
  }, [market]);

  const symbols = Array.from(
    new Set(days.flatMap(d => d.contracts.map(c => c.symbol)))
  ).sort((a, b) => symSortKey(a) - symSortKey(b));

  function getOI(dayIdx: number, sym: string): number | null {
    const c = days[dayIdx]?.contracts.find(x => x.symbol === sym);
    return c ? c.oi : null;
  }

  function getOIChg(dayIdx: number, sym: string): number | null {
    const cur  = getOI(dayIdx, sym);
    const prev = getOI(dayIdx + 1, sym);
    if (cur === null || prev === null) return null;
    return cur - prev;
  }

  const totals = days.map((d, i) => {
    const totalOI  = d.contracts.reduce((s, c) => s + c.oi, 0);
    const totalChg = symbols.reduce<number | null>((acc, sym) => {
      const chg = getOIChg(i, sym);
      return chg === null ? acc : (acc ?? 0) + chg;
    }, null);
    return { oi: totalOI, chg: totalChg };
  });

  const label = market === "robusta" ? "LDN OI" : "NY OI";

  return (
    <div className="overflow-x-auto mt-2">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-700">
            <th className="text-left text-slate-400 px-2 py-1 sticky left-0 bg-slate-900 min-w-[56px]">
              contract
            </th>
            {days.map(d => (
              <th key={d.date} colSpan={2} className="text-center text-slate-400 px-1 py-1 border-l border-slate-800 whitespace-nowrap">
                {d.date}
              </th>
            ))}
          </tr>
          <tr className="border-b border-slate-700 text-slate-500">
            <th className="sticky left-0 bg-slate-900" />
            {days.map(d => (
              <>
                <th key={d.date + "-oi"}  className="text-right px-2 py-0.5 border-l border-slate-800 font-normal whitespace-nowrap">{label}</th>
                <th key={d.date + "-chg"} className="text-right px-2 py-0.5 font-normal whitespace-nowrap">OI Chg</th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map(sym => (
            <tr key={sym} className="border-b border-slate-800 hover:bg-slate-800/40">
              <td className="px-2 py-1 text-slate-300 font-medium sticky left-0 bg-slate-900">
                {shortSym(sym)}
              </td>
              {days.map((d, i) => {
                const oi  = getOI(i, sym);
                const chg = getOIChg(i, sym);
                return (
                  <>
                    <td key={d.date + sym + "-oi"}
                        className="text-right px-2 py-1 text-slate-200 border-l border-slate-800">
                      {oi !== null ? oi.toLocaleString() : "—"}
                    </td>
                    <td key={d.date + sym + "-chg"}
                        className={`text-right px-2 py-1 font-medium ${
                          chg === null ? "text-slate-600" :
                          chg > 0      ? "bg-green-900/40 text-green-300" :
                          chg < 0      ? "bg-red-900/40 text-red-300" :
                                         "text-slate-500"
                        }`}>
                      {chg !== null ? fmtChg(chg) : "—"}
                    </td>
                  </>
                );
              })}
            </tr>
          ))}
          <tr className="border-t-2 border-slate-600 font-bold">
            <td className="px-2 py-1 text-slate-200 sticky left-0 bg-slate-900">Total</td>
            {totals.map((t, i) => (
              <>
                <td key={i + "-tot-oi"}
                    className="text-right px-2 py-1 text-white border-l border-slate-800">
                  {t.oi.toLocaleString()}
                </td>
                <td key={i + "-tot-chg"}
                    className={`text-right px-2 py-1 ${
                      t.chg === null ? "text-slate-600" :
                      t.chg > 0     ? "bg-green-900/40 text-green-300" :
                      t.chg < 0     ? "bg-red-900/40 text-red-300" :
                                      "text-slate-500"
                    }`}>
                  {fmtChg(t.chg)}
                </td>
              </>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
