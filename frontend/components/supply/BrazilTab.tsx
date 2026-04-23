"use client";
import React from "react";
import { useEffect, useState, useMemo } from "react";
import {
  BarChart, Bar, ComposedChart, LineChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";
import BrazilFarmerEconomics from "./farmer-economics/BrazilFarmerEconomics";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VolumeSeries {
  date: string;
  conillon: number;
  arabica: number;
  total_verde: number;
  torrado: number;
  soluvel: number;
  total_industria: number;
  total: number;
}

interface CountryYear {
  months: string[];
  countries: Record<string, Record<string, number>>;
}

interface CecafeData {
  source: string;
  report: string;
  updated: string;
  unit: string;
  series: VolumeSeries[];
  by_country: CountryYear;
  by_country_prev: CountryYear;
  by_country_arabica?: CountryYear;
  by_country_arabica_prev?: CountryYear;
  by_country_conillon?: CountryYear;
  by_country_conillon_prev?: CountryYear;
  by_country_soluvel?: CountryYear;
  by_country_soluvel_prev?: CountryYear;
  by_country_torrado?: CountryYear;
  by_country_torrado_prev?: CountryYear;
  by_country_history?: Record<string, CountryYear>;
}

// ── Country translation: Portuguese → English ─────────────────────────────────

const COUNTRY_EN: Record<string, string> = {
  "AFEGANISTAO":               "Afghanistan",
  "AFRICA DO SUL":             "South Africa",
  "ALBANIA":                   "Albania",
  "ALEMANHA":                  "Germany",
  "ANGOLA":                    "Angola",
  "ANTILHAS HOLANDESAS":       "Netherlands Antilles",
  "ARABIA SAUDITA":            "Saudi Arabia",
  "ARGELIA":                   "Algeria",
  "ARGENTINA":                 "Argentina",
  "ARMENIA":                   "Armenia",
  "AUSTRALIA":                 "Australia",
  "AZERBAIDJAO":               "Azerbaijan",
  "BANGLADESH":                "Bangladesh",
  "BAREIN":                    "Bahrain",
  "BELGICA":                   "Belgium",
  "BIELO-RUSSIA":              "Belarus",
  "BOLIVIA":                   "Bolivia",
  "BOSNIA-HERZEGOVINA":        "Bosnia & Herzegovina",
  "BRUNEI DARUSSALAM":         "Brunei",
  "BULGARIA":                  "Bulgaria",
  "CABO VERDE":                "Cape Verde",
  "CAMBOJA":                   "Cambodia",
  "CANADA":                    "Canada",
  "CAZAQUISTAO":               "Kazakhstan",
  "CHILE":                     "Chile",
  "CHINA":                     "China",
  "CHIPRE":                    "Cyprus",
  "COLOMBIA":                  "Colombia",
  "COREIA DO SUL (REPUBL.)":   "South Korea",
  "COSTA DO MARFIM":           "Ivory Coast",
  "COSTA RICA":                "Costa Rica",
  "CROACIA":                   "Croatia",
  "CUBA":                      "Cuba",
  "DINAMARCA":                 "Denmark",
  "DJIBUTI":                   "Djibouti",
  "E.U.A.":                    "USA",
  "EGITO":                     "Egypt",
  "EL SALVADOR":               "El Salvador",
  "EMIR.ARABES UNIDOS":        "UAE",
  "EQUADOR":                   "Ecuador",
  "ESLOVAQUIA":                "Slovakia",
  "ESLOVENIA":                 "Slovenia",
  "ESPANHA":                   "Spain",
  "ESTONIA":                   "Estonia",
  "FIJI":                      "Fiji",
  "FILIPINAS":                 "Philippines",
  "FINLANDIA":                 "Finland",
  "FRANCA":                    "France",
  "GANA":                      "Ghana",
  "GEORGIA":                   "Georgia",
  "GRECIA":                    "Greece",
  "GUATEMALA":                 "Guatemala",
  "GUIANA":                    "Guyana",
  "HONG KONG":                 "Hong Kong",
  "INDIA":                     "India",
  "INDONESIA":                 "Indonesia",
  "IRAN":                      "Iran",
  "IRAQUE":                    "Iraq",
  "IRLANDA":                   "Ireland",
  "ISLANDIA":                  "Iceland",
  "ISRAEL":                    "Israel",
  "ITALIA":                    "Italy",
  "JAMAICA":                   "Jamaica",
  "JAPAO":                     "Japan",
  "JORDANIA":                  "Jordan",
  "KUWEIT":                    "Kuwait",
  "LETONIA (LATVIA)":          "Latvia",
  "LIBANO":                    "Lebanon",
  "LIBIA":                     "Libya",
  "LITUANIA":                  "Lithuania",
  "LUXEMBURGO":                "Luxembourg",
  "MACAU":                     "Macau",
  "MADAGASCAR":                "Madagascar",
  "MALASIA":                   "Malaysia",
  "MALDIVAS":                  "Maldives",
  "MALTA":                     "Malta",
  "MARROCOS":                  "Morocco",
  "MAURICIO":                  "Mauritius",
  "MEXICO":                    "Mexico",
  "MONGOLIA":                  "Mongolia",
  "MONTENEGRO":                "Montenegro",
  "MYANMAR (BIRMANIA)":        "Myanmar",
  "NICARAGUA":                 "Nicaragua",
  "NIGERIA":                   "Nigeria",
  "NORUEGA":                   "Norway",
  "NOVA ZELANDIA":             "New Zealand",
  "OMAN":                      "Oman",
  "PAISES BAIXOS (HOLANDA)":   "Netherlands",
  "PALESTINA":                 "Palestine",
  "PANAMA":                    "Panama",
  "PAQUISTAO":                 "Pakistan",
  "PARAGUAI":                  "Paraguay",
  "PERU":                      "Peru",
  "POLONIA":                   "Poland",
  "PORTUGAL":                  "Portugal",
  "QATAR":                     "Qatar",
  "QUENIA":                    "Kenya",
  "REINO UNIDO":               "United Kingdom",
  "REP. DOMINICANA":           "Dominican Republic",
  "REPUBL. TCHECA":            "Czech Republic",
  "ROMENIA":                   "Romania",
  "RUANDA":                    "Rwanda",
  "RUSSIAN FEDERATION":        "Russia",
  "SENEGAL":                   "Senegal",
  "SERVIA":                    "Serbia",
  "SINGAPURA":                 "Singapore",
  "SIRIA":                     "Syria",
  "SOMALIA":                   "Somalia",
  "SRI LANKA":                 "Sri Lanka",
  "SUECIA":                    "Sweden",
  "SUICA":                     "Switzerland",
  "SURINAME":                  "Suriname",
  "TAILANDIA":                 "Thailand",
  "TAIWAN":                    "Taiwan",
  "TUNISIA":                   "Tunisia",
  "TURQUIA":                   "Turkey",
  "UCRANIA":                   "Ukraine",
  "UGANDA":                    "Uganda",
  "URUGUAI":                   "Uruguay",
  "UZBEQUISTAO":               "Uzbekistan",
  "VENEZUELA":                 "Venezuela",
  "VIETNAM":                   "Vietnam",
};

function toEn(pt: string): string {
  return COUNTRY_EN[pt] ?? pt;
}

// ── Hub groupings ─────────────────────────────────────────────────────────────

const HUB_COLORS: Record<string, string> = {
  "Nordics":             "#bfdbfe",
  "Central Europe":      "#60a5fa",
  "South Europe":        "#3b82f6",
  "Eastern Europe":      "#1d4ed8",
  "North America":       "#f59e0b",
  "Latin America":       "#fcd34d",
  "East Asia":           "#a78bfa",
  "SE Asia & Pacific":   "#c4b5fd",
  "Middle East":         "#f97316",
  "North Africa":        "#fb923c",
  "Sub-Saharan Africa":  "#86efac",
  "South Asia":          "#34d399",
  "Russia & CIS":        "#94a3b8",
  "Other":               "#475569",
};

const COUNTRY_HUB: Record<string, string> = {
  // Nordics
  "DINAMARCA":            "Nordics",
  "FINLANDIA":            "Nordics",
  "ISLANDIA":             "Nordics",
  "NORUEGA":              "Nordics",
  "SUECIA":               "Nordics",
  // Central Europe
  "ALEMANHA":             "Central Europe",
  "BELGICA":              "Central Europe",
  "FRANCA":               "Central Europe",
  "IRLANDA":              "Central Europe",
  "LUXEMBURGO":           "Central Europe",
  "PAISES BAIXOS (HOLANDA)": "Central Europe",
  "REINO UNIDO":          "Central Europe",
  "REPUBL. TCHECA":       "Central Europe",
  "ESLOVAQUIA":           "Central Europe",
  "SUICA":                "Central Europe",
  // South Europe
  "ALBANIA":              "South Europe",
  "BOSNIA-HERZEGOVINA":   "South Europe",
  "CHIPRE":               "South Europe",
  "CROACIA":              "South Europe",
  "ESPANHA":              "South Europe",
  "ESLOVENIA":            "South Europe",
  "GRECIA":               "South Europe",
  "ITALIA":               "South Europe",
  "MALTA":                "South Europe",
  "MONTENEGRO":           "South Europe",
  "PORTUGAL":             "South Europe",
  "SERVIA":               "South Europe",
  // Eastern Europe
  "BULGARIA":             "Eastern Europe",
  "ESTONIA":              "Eastern Europe",
  "LETONIA (LATVIA)":     "Eastern Europe",
  "LITUANIA":             "Eastern Europe",
  "POLONIA":              "Eastern Europe",
  "ROMENIA":              "Eastern Europe",
  "UCRANIA":              "Eastern Europe",
  // North America
  "CANADA":               "North America",
  "E.U.A.":               "North America",
  "MEXICO":               "North America",
  // Latin America
  "ARGENTINA":            "Latin America",
  "BOLIVIA":              "Latin America",
  "CHILE":                "Latin America",
  "COLOMBIA":             "Latin America",
  "COSTA RICA":           "Latin America",
  "CUBA":                 "Latin America",
  "EQUADOR":              "Latin America",
  "EL SALVADOR":          "Latin America",
  "GUATEMALA":            "Latin America",
  "GUIANA":               "Latin America",
  "JAMAICA":              "Latin America",
  "NICARAGUA":            "Latin America",
  "PANAMA":               "Latin America",
  "PARAGUAI":             "Latin America",
  "PERU":                 "Latin America",
  "REP. DOMINICANA":      "Latin America",
  "SURINAME":             "Latin America",
  "URUGUAI":              "Latin America",
  "VENEZUELA":            "Latin America",
  "ANTILHAS HOLANDESAS":  "Latin America",
  // East Asia
  "CHINA":                "East Asia",
  "COREIA DO SUL (REPUBL.)": "East Asia",
  "HONG KONG":            "East Asia",
  "JAPAO":                "East Asia",
  "MACAU":                "East Asia",
  "MONGOLIA":             "East Asia",
  "TAIWAN":               "East Asia",
  // SE Asia & Pacific
  "AUSTRALIA":            "SE Asia & Pacific",
  "BRUNEI DARUSSALAM":    "SE Asia & Pacific",
  "CAMBOJA":              "SE Asia & Pacific",
  "FIJI":                 "SE Asia & Pacific",
  "FILIPINAS":            "SE Asia & Pacific",
  "INDONESIA":            "SE Asia & Pacific",
  "MALASIA":              "SE Asia & Pacific",
  "MYANMAR (BIRMANIA)":   "SE Asia & Pacific",
  "NOVA ZELANDIA":        "SE Asia & Pacific",
  "SINGAPURA":            "SE Asia & Pacific",
  "TAILANDIA":            "SE Asia & Pacific",
  "VIETNAM":              "SE Asia & Pacific",
  // Middle East
  "ARABIA SAUDITA":       "Middle East",
  "BAREIN":               "Middle East",
  "DJIBUTI":              "Middle East",
  "EMIR.ARABES UNIDOS":   "Middle East",
  "IRAN":                 "Middle East",
  "IRAQUE":               "Middle East",
  "ISRAEL":               "Middle East",
  "JORDANIA":             "Middle East",
  "KUWEIT":               "Middle East",
  "LIBANO":               "Middle East",
  "OMAN":                 "Middle East",
  "PALESTINA":            "Middle East",
  "QATAR":                "Middle East",
  "SIRIA":                "Middle East",
  "TURQUIA":              "Middle East",
  // North Africa
  "ARGELIA":              "North Africa",
  "EGITO":                "North Africa",
  "LIBIA":                "North Africa",
  "MARROCOS":             "North Africa",
  "TUNISIA":              "North Africa",
  // Sub-Saharan Africa
  "AFRICA DO SUL":        "Sub-Saharan Africa",
  "ANGOLA":               "Sub-Saharan Africa",
  "CABO VERDE":           "Sub-Saharan Africa",
  "COSTA DO MARFIM":      "Sub-Saharan Africa",
  "GANA":                 "Sub-Saharan Africa",
  "MADAGASCAR":           "Sub-Saharan Africa",
  "MAURICIO":             "Sub-Saharan Africa",
  "NIGERIA":              "Sub-Saharan Africa",
  "QUENIA":               "Sub-Saharan Africa",
  "RUANDA":               "Sub-Saharan Africa",
  "SENEGAL":              "Sub-Saharan Africa",
  "SOMALIA":              "Sub-Saharan Africa",
  "UGANDA":               "Sub-Saharan Africa",
  // South Asia
  "BANGLADESH":           "South Asia",
  "INDIA":                "South Asia",
  "MALDIVAS":             "South Asia",
  "PAQUISTAO":            "South Asia",
  "SRI LANKA":            "South Asia",
  // Russia & CIS
  "ARMENIA":              "Russia & CIS",
  "AZERBAIDJAO":          "Russia & CIS",
  "BIELO-RUSSIA":         "Russia & CIS",
  "CAZAQUISTAO":          "Russia & CIS",
  "GEORGIA":              "Russia & CIS",
  "RUSSIAN FEDERATION":   "Russia & CIS",
  "UZBEQUISTAO":          "Russia & CIS",
};

function getHub(ptCountry: string): string {
  return COUNTRY_HUB[ptCountry] ?? "Other";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bagsToKT(bags: number) {
  return Math.round((bags * 60) / 1e6 * 10) / 10;
}

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(ym: string) {
  return MONTH_LABELS[parseInt(ym.split("-")[1]) - 1];
}

const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const BLUE  = "#60a5fa";
const SLATE = "#94a3b8";
const TEAL  = "#2dd4bf";

// Crop-year period palette: index 0 = most recent, ascending = older
const CROP_YEAR_COLORS = [
  "#ef4444",  // current    — red
  "#f97316",  // prior-1    — dark orange
  "#60a5fa",  // prior-2    — blue
  "#64748b",  // prior-3    — gray
  "#475569",  // prior-4    — darker gray
  "#334155",  // prior-5    — darkest gray
];

const HUB_ORDER = [
  "Nordics","Central Europe","South Europe","Eastern Europe",
  "North America","Latin America",
  "East Asia","SE Asia & Pacific","Middle East","North Africa",
  "Sub-Saharan Africa","South Asia","Russia & CIS","Other",
];

// ── Tooltip style shared ──────────────────────────────────────────────────────

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

// ── Brazil domestic consumption (USDA/ICO estimates, 1000×60kg bags → kt) ────
const BRAZIL_DOMESTIC_KT: Record<string, number> = {
  "2005/06": 1062, "2006/07": 1074, "2007/08": 1086, "2008/09": 1104,
  "2009/10": 1116, "2010/11": 1182, "2011/12": 1206, "2012/13": 1236,
  "2013/14": 1260, "2014/15": 1290, "2015/16": 1254, "2016/17": 1278,
  "2017/18": 1314, "2018/19": 1320, "2019/20": 1332, "2020/21": 1338,
  "2021/22": 1380, "2022/23": 1398, "2023/24": 1434, "2024/25": 1446,
};

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Daily Export Registration ─────────────────────────────────────────────────

interface DailyData {
  updated: string;
  arabica:  Record<string, Record<string, number>>; // "YYYY-MM" → { "1": cumBags, ... }
  conillon: Record<string, Record<string, number>>;
  soluvel:  Record<string, Record<string, number>>;
}

/** Offset "YYYY-MM" by n months (negative = back) */
function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtBags(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
  return `${mo}-${String(y).slice(2)}`;
}

const DAILY_COLORS = {
  current:  "#ef4444",  // red    — current month
  prior:    "#f97316",  // orange — prior month (Mes interior)
  ly:       "#22c55e",  // green  — same month last year
  hist:     "#475569",  // slate  — historical same-month
  solv_cur: "#38bdf8",  // sky    — soluvel current month
  solv_pri: "#7dd3fc",  // light sky — soluvel prior month
};

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

function DailyRegistrationSection() {
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

// ── Monthly Volume Chart ──────────────────────────────────────────────────────

// Crop month order: Apr(4)…Dec(12), Jan(1)…Mar(3)
const CROP_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const CROP_MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

function MonthlyVolumeChart({ series, typeFilter, isFiltered }: {
  series: VolumeSeries[];
  typeFilter?: SeriesKey | null;
  isFiltered?: boolean;
}) {
  const activeKey: SeriesKey = typeFilter ?? "total";
  const [cropYears, setCropYears] = useState(3);
  const [dailyData, setDailyData] = useState<DailyData | null>(null);

  useEffect(() => {
    if (isFiltered) { setDailyData(null); return; }
    fetch("/data/cecafe_daily.json")
      .then(r => r.json()).then(setDailyData).catch(() => {});
  }, [isFiltered]);

  // Group by crop year key → month number → record
  const cropGroups = useMemo(() => {
    const m: Record<string, Record<number, VolumeSeries>> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      if (!m[key]) m[key] = {};
      m[key][mo] = r;
    });
    return m;
  }, [series]);

  const sortedCropKeys = Object.keys(cropGroups).sort();
  const latestCrop     = sortedCropKeys[sortedCropKeys.length - 1];
  const showCrops      = sortedCropKeys.slice(-cropYears).reverse();
  const YEAR_COLORS    = CROP_YEAR_COLORS.slice(0, cropYears);

  // Registration-based forecast for the current unreleased month
  const forecast = useMemo(() => {
    if (!dailyData) return null;
    const ym = dailyData.updated.slice(0, 7); // "YYYY-MM"
    if (series.some(r => r.date === ym)) return null; // Cecafe already released it

    const [fy, fm] = ym.split("-").map(Number);
    const daysInMonth = new Date(fy, fm, 0).getDate();

    const latestVal = (monthMap: Record<string, Record<string, number>> | undefined) => {
      const md = monthMap?.[ym] ?? {};
      const keys = Object.keys(md).map(Number).sort((a, b) => b - a);
      return keys.length ? { val: md[String(keys[0])], day: keys[0] } : { val: 0, day: 0 };
    };

    const arab = latestVal(dailyData.arabica);
    const coni = latestVal(dailyData.conillon);
    const solv = latestVal(dailyData.soluvel);

    let cum = 0, refDay = 0;
    switch (activeKey) {
      case "arabica":  cum = arab.val; refDay = arab.day; break;
      case "conillon": cum = coni.val; refDay = coni.day; break;
      case "soluvel":  cum = solv.val; refDay = solv.day; break;
      case "torrado": case "total_verde": case "total_industria": return null;
      default:
        refDay = Math.max(arab.day, coni.day, solv.day);
        cum = arab.val + coni.val + solv.val;
    }

    if (!cum || !refDay) return null;
    return {
      kt:       Math.round(bagsToKT((cum / refDay) * daysInMonth) * 10) / 10,
      monthNum: fm,
      cropKey:  cropYearKey(ym),
      refDay,
      daysInMonth,
    };
  }, [dailyData, series, activeKey]);

  // Fixed key so Bar is always in DOM — avoids recharts reordering on dynamic add
  const EST_KEY = "__forecast__";

  const estColor = (() => {
    if (!forecast) return CROP_YEAR_COLORS[0];
    const idx = showCrops.indexOf(forecast.cropKey);
    return idx >= 0 ? YEAR_COLORS[idx] : CROP_YEAR_COLORS[0];
  })();

  const chartData = CROP_MONTH_ORDER.map((mo, i) => {
    const row: Record<string, number | string> = { month: CROP_MONTH_LABELS[i] };
    // Always include estimate key (0 when no forecast or wrong month) so bar slot is stable
    row[EST_KEY] = forecast && mo === forecast.monthNum ? forecast.kt : 0;
    showCrops.forEach(ck => {
      const r = cropGroups[ck]?.[mo];
      row[ck] = r ? bagsToKT(r[activeKey] ?? r.total) : 0;
    });
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Monthly Export Volume — {typeFilter ? TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label : "Total (All Types)"}
          </div>
          <div className="text-[10px] text-slate-500">
            Crop year (Apr–Mar) · Thousand metric tons (60 kg bags)
            {forecast && (
              <span className="ml-2 text-slate-600 italic">
                · est. based on registrations day {forecast.refDay}/{forecast.daysInMonth}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {[2, 3, 5].map(n => (
            <button key={n} onClick={() => setCropYears(n)}
              className={`text-[10px] px-2 py-0.5 rounded ${cropYears === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {n}Y
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [
              `${v} kt${name === EST_KEY ? " (est.)" : ""}`,
              name === EST_KEY ? `Crop ${forecast?.cropKey ?? ""} (forecast)` : `Crop ${name}`,
            ]} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: "#cbd5e1" }}>
                {v === EST_KEY
                  ? forecast ? `Crop ${forecast.cropKey} (est.)` : ""
                  : `Crop ${v}`}
              </span>
            )} />
          {/* Always first = leftmost; hidden until forecast loads */}
          <Bar key={EST_KEY} dataKey={EST_KEY} name={EST_KEY}
            fill={estColor} fillOpacity={forecast ? 0.35 : 0}
            legendType={forecast ? "square" : "none"} />
          {showCrops.map((ck, i) => (
            <Bar key={ck} dataKey={ck} name={ck}
              fill={YEAR_COLORS[i % YEAR_COLORS.length]}
              opacity={ck === latestCrop ? 1 : 0.65}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Annual Trend ──────────────────────────────────────────────────────────────

// Crop year: Apr Y → Mar Y+1, labelled "Y/Y+1" (e.g. "2024/25")
function cropYearKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 4 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

function AnnualTrendChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const [since, setSince] = useState(2010);
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  const annualData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; total: number; months: number }> = {};
    activeSeries.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, total: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].total    += r.total;
      byCrop[key].months   += 1;
    });
    const sortedKeys = Object.keys(byCrop).sort();
    const latestKey  = sortedKeys[sortedKeys.length - 1];
    const prevKey    = sortedKeys.length >= 2 ? sortedKeys[sortedKeys.length - 2] : null;
    const latestData = byCrop[latestKey];
    const prevData   = prevKey ? byCrop[prevKey] : null;

    // Projection gap for incomplete current crop (skip if destination or type filter active)
    const skipProj  = isFiltered || !!typeFilter;
    let projGap = 0;
    if (!skipProj && prevData && latestData.months < 12) {
      const ctdMonths = new Set(
        series.filter(r => cropYearKey(r.date) === latestKey).map(r => parseInt(r.date.split("-")[1]))
      );
      const prevCTD = series
        .filter(r => cropYearKey(r.date) === prevKey && ctdMonths.has(parseInt(r.date.split("-")[1])))
        .reduce((s, r) => s + r.arabica + r.conillon + r.soluvel + r.torrado, 0);
      const currCTD = latestData.arabica + latestData.conillon + latestData.soluvel + latestData.torrado;
      if (prevCTD > 0) {
        const prevFull = prevData.arabica + prevData.conillon + prevData.soluvel + prevData.torrado;
        projGap = Math.max(0, prevFull * (currCTD / prevCTD) - currCTD);
      }
    }

    // Determine which bars to show
    const showSingle = isFiltered || !!typeFilter;
    const typeLabel = typeFilter
      ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Selected")
      : "Total";

    return sortedKeys
      .map(k => {
        const d = byCrop[k];
        const isIncomplete = k === latestKey && d.months < 12;
        const row: Record<string, any> = {
          year: k,
          startYear: parseInt(k.split("/")[0]),
          domestic:  (!isFiltered && !typeFilter) ? (BRAZIL_DOMESTIC_KT[k] ?? null) : null,
          proj_gap:  isIncomplete ? Math.round(bagsToKT(projGap) * 10) / 10 : 0,
        };
        if (showSingle) {
          row[typeLabel] = bagsToKT(d[activeKey]);
        } else {
          row["Arabica (green)"]  = bagsToKT(d.arabica);
          row["Conillon (green)"] = bagsToKT(d.conillon);
          row["Soluble"]          = bagsToKT(d.soluvel);
          row["Roasted & Ground"] = bagsToKT(d.torrado);
        }
        return row;
      })
      .filter(r => r.startYear >= since);
  }, [activeSeries, series, since, isFiltered, typeFilter, activeKey]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Annual Export by Coffee Type — Crop Year (Apr–Mar)</div>
          <div className="text-[10px] text-slate-500">
            kt · {isFiltered ? "Total exports for selected origin" : "incl. domestic consumption (USDA est.) · † projected full year"}
          </div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={annualData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => {
              if (name === "domestic") return [`${v} kt`, "Domestic consumption (USDA est.)"];
              if (name === "proj_gap") return [`+${v} kt`, "Projected remaining"];
              return [`${v} kt`, name];
            }} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => (
              <span style={{ color: v === "domestic" ? "#f97316" : "#cbd5e1" }}>{
                v === "domestic" ? "Domestic consump. (USDA)" :
                v === "proj_gap" ? "† Projected" : v
              }</span>
            )} />
          {(isFiltered || typeFilter)
            ? <Bar dataKey={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total"}
                stackId="a" fill={typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.color ?? BLUE) : BLUE} />
            : <>
                <Bar dataKey="Arabica (green)"  stackId="a" fill={GREEN} />
                <Bar dataKey="Conillon (green)" stackId="a" fill={TEAL}  />
                <Bar dataKey="Soluble"          stackId="a" fill={AMBER} />
                <Bar dataKey="Roasted & Ground" stackId="a" fill={BLUE}  />
              </>
          }
          <Bar dataKey="proj_gap" stackId="a" fill="#818cf8" fillOpacity={0.35} stroke="#818cf8" strokeWidth={1} />
          {!isFiltered && (
            <Line dataKey="domestic" type="monotone" stroke="#f97316" strokeWidth={2}
              strokeDasharray="5 3" dot={false} connectNulls />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Coffee type share evolution ───────────────────────────────────────────

function TypeShareChart({ series }: { series: VolumeSeries[] }) {
  const [since, setSince] = useState(2010);

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; months: number }> = {};
    series.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].months   += 1;
    });

    return Object.entries(byCrop)
      .filter(([k]) => parseInt(k.split("/")[0]) >= since)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, d]) => {
        const total = d.arabica + d.conillon + d.soluvel + d.torrado;
        if (total === 0) return null;
        return {
          year:     k,
          Arabica:  Math.round(d.arabica  / total * 1000) / 10,
          Conillon: Math.round(d.conillon / total * 1000) / 10,
          Soluble:  Math.round(d.soluvel  / total * 1000) / 10,
          Roasted:  Math.round(d.torrado  / total * 1000) / 10,
        };
      })
      .filter(Boolean) as { year: string; Arabica: number; Conillon: number; Soluble: number; Roasted: number }[];
  }, [series, since]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Coffee Type Share — Crop Year Mix</div>
          <div className="text-[10px] text-slate-500">% of total exports per type · complete and partial crop years</div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [`${v}%`, name]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          <Bar dataKey="Arabica"  stackId="s" fill={GREEN} />
          <Bar dataKey="Conillon" stackId="s" fill={TEAL}  />
          <Bar dataKey="Soluble"  stackId="s" fill={AMBER} />
          <Bar dataKey="Roasted"  stackId="s" fill={BLUE}  />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Monthly seasonality heatmap ───────────────────────────────────────────

function intensityColor(ratio: number): string {
  if (ratio >= 0.90) return "#60a5fa";
  if (ratio >= 0.75) return "#2563eb";
  if (ratio >= 0.60) return "#1d4ed8";
  if (ratio >= 0.40) return "#1e3a5f";
  if (ratio >= 0.20) return "#1e293b";
  return "#0f172a";
}

function SeasonalityHeatmap({ series }: { series: VolumeSeries[] }) {
  const ROWS = 7;

  const { cropKeys, grid, latestCropMonth } = useMemo(() => {
    const byYear: Record<string, number[]> = {};
    series.forEach(r => {
      const ck  = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = Array(12).fill(0);
      byYear[ck][idx] += bagsToKT(r.total);
    });

    const sorted = Object.keys(byYear).sort();
    const shown  = sorted.slice(-ROWS);
    const currentCk = sorted[sorted.length - 1];

    const currentData = byYear[currentCk] ?? [];
    let lastIdx = -1;
    currentData.forEach((v, i) => { if (v > 0) lastIdx = i; });

    const grid = shown.map(ck => {
      const row = byYear[ck];
      const peak = Math.max(...row.filter(v => v > 0), 1);
      return { ck, cells: row.map(v => v > 0 ? v / peak : null), raw: row };
    });

    return { cropKeys: shown, grid, latestCropMonth: lastIdx };
  }, [series]);

  const currentCk = cropKeys[cropKeys.length - 1];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-200">Monthly Seasonality Heatmap</div>
        <div className="text-[10px] text-slate-500">
          Cell shade = volume relative to each year&apos;s peak month · dashed = not yet elapsed
        </div>
      </div>
      <div
        className="grid gap-[3px] text-[8px]"
        style={{ gridTemplateColumns: `44px repeat(12, 1fr)` }}
      >
        {/* Header row */}
        <div />
        {CROP_MONTH_LABELS.map(m => (
          <div key={m} className="text-center text-slate-500 pb-1">{m}</div>
        ))}

        {/* Data rows — newest first */}
        {[...grid].reverse().map(({ ck, cells, raw }) => (
          <React.Fragment key={ck}>
            <div
              className={`text-right pr-2 flex items-center justify-end ${
                ck === currentCk ? "text-slate-200 font-bold" : "text-slate-500"
              }`}
            >
              {ck.split("/")[1] ? `${ck.split("/")[0].slice(2)}/${ck.split("/")[1]}` : ck}
            </div>
            {cells.map((ratio, i) => {
              const isFuture = ck === currentCk && i > latestCropMonth;
              const kt       = Math.round(raw[i] * 10) / 10;
              const pct      = ratio !== null ? Math.round(ratio * 100) : null;
              return (
                <div
                  key={i}
                  title={ratio !== null ? `${CROP_MONTH_LABELS[i]}: ${kt}kt (${pct}% of peak)` : "No data"}
                  className={`h-5 rounded-[2px] ${isFuture ? "border border-dashed border-slate-700" : ""}`}
                  style={{
                    background: isFuture ? "#0f172a" : (ratio !== null ? intensityColor(ratio) : "#0f172a"),
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Color scale legend */}
      <div className="flex items-center gap-2 mt-3 text-[9px] text-slate-500">
        <span>Low</span>
        {[0.1, 0.3, 0.5, 0.68, 0.83, 0.95].map(r => (
          <div key={r} className="w-5 h-3 rounded-[2px]" style={{ background: intensityColor(r) }} />
        ))}
        <span>Peak</span>
      </div>
    </div>
  );
}

// ── Y/Y change by type ────────────────────────────────────────────────────────

const TYPE_SERIES = [
  { key: "arabica"  as const, label: "Arabica",  color: GREEN },
  { key: "conillon" as const, label: "Conillon", color: TEAL  },
  { key: "soluvel"  as const, label: "Soluble",  color: AMBER },
  { key: "torrado"  as const, label: "Roasted",  color: BLUE  },
];

function YoYByTypeChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const [since, setSince] = useState(2010);
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const showSingle = isFiltered || !!typeFilter;

  const chartData = useMemo(() => {
    const byCrop: Record<string, { arabica: number; conillon: number; soluvel: number; torrado: number; total: number; months: number }> = {};
    activeSeries.forEach(r => {
      const key = cropYearKey(r.date);
      if (!byCrop[key]) byCrop[key] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0, total: 0, months: 0 };
      byCrop[key].arabica  += r.arabica;
      byCrop[key].conillon += r.conillon;
      byCrop[key].soluvel  += r.soluvel;
      byCrop[key].torrado  += r.torrado;
      byCrop[key].total    += r.total;
      byCrop[key].months   += 1;
    });
    const sortedKeys = Object.keys(byCrop).sort();
    const latestKey  = sortedKeys[sortedKeys.length - 1];
    const completeKeys = sortedKeys.filter(k => k !== latestKey || byCrop[k].months === 12);
    const delta = (curr: number, prev: number) =>
      prev > 0 ? Math.round(bagsToKT(curr - prev) * 10) / 10 : null;

    return completeKeys
      .slice(1)
      .map((k, i) => {
        const prev = byCrop[completeKeys[i]];
        const curr = byCrop[k];
        const row: Record<string, any> = { year: k, startYear: parseInt(k.split("/")[0]) };
        if (showSingle) {
          const tf = typeFilter;
          const label = tf ? (TYPE_FILTER_OPTS.find(t => t.key === tf)?.label ?? "Total") : "Total";
          const key   = tf ?? "total";
          row[label] = delta(curr[key], prev[key]);
        } else {
          row["Arabica"]  = delta(curr.arabica,  prev.arabica);
          row["Conillon"] = delta(curr.conillon, prev.conillon);
          row["Soluble"]  = delta(curr.soluvel,  prev.soluvel);
          row["Roasted"]  = delta(curr.torrado,  prev.torrado);
        }
        return row;
      })
      .filter(r => r.startYear >= since);
  }, [activeSeries, since, showSingle, typeFilter]);

  const bars = showSingle
    ? [{ label: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total",
         color: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.color ?? BLUE) : BLUE }]
    : TYPE_SERIES.map(t => ({ label: t.label, color: t.color }));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Y/Y Change by Coffee Type — Crop Year</div>
          <div className="text-[10px] text-slate-500">Volume change vs prior crop year (kt) · complete crop years only</div>
        </div>
        <div className="flex gap-1">
          {[2000, 2010, 2015].map(y => (
            <button key={y} onClick={() => setSince(y)}
              className={`text-[10px] px-2 py-0.5 rounded ${since === y ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
              {y}+
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }} barCategoryGap="20%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
          <Tooltip contentStyle={TT_STYLE} formatter={(v: any, name: any) => [v !== null ? `${v > 0 ? "+" : ""}${v} kt` : "—", name]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {bars.map(b => (
            <Bar key={b.label} dataKey={b.label} fill={b.color} radius={[2, 2, 0, 0]} maxBarSize={14} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Rolling average trend vs LY ───────────────────────────────────────────────

// Ordered L1M → MAT (most recent on left, long-term reference on right)
const WINDOWS = [
  { label: "L1M", n: 1  },
  { label: "L3M", n: 3  },
  { label: "L6M", n: 6  },
  { label: "MAT", n: 12 },
];

const WINDOW_COLORS: Record<string, string> = {
  "MAT": "#475569",
  "L6M": "#64748b",
  "L3M": BLUE,
  "L1M": GREEN,
};

function RollingAvgChart({ series, filteredSeries, typeFilter }: { series: VolumeSeries[]; filteredSeries?: VolumeSeries[]; typeFilter?: SeriesKey | null }) {
  const isFiltered = !!filteredSeries;
  const activeSeries = filteredSeries ?? series;
  const showSingle = isFiltered || !!typeFilter;

  const avg = (arr: VolumeSeries[], key: "arabica" | "conillon" | "soluvel" | "torrado" | "total") =>
    arr.length > 0 ? arr.reduce((s, r) => s + r[key], 0) / arr.length : 0;

  const delta = (curr: number, prev: number) =>
    prev > 0 ? Math.round(bagsToKT(curr - prev) * 10) / 10 : null;

  const TYPES_WITH_TOTAL = showSingle
    ? [{ key: (typeFilter ?? "total") as SeriesKey, label: typeFilter ? (TYPE_FILTER_OPTS.find(t => t.key === typeFilter)?.label ?? "Total") : "Total" }]
    : [
        { key: "arabica"  as const, label: "Arabica"  },
        { key: "conillon" as const, label: "Conillon" },
        { key: "soluvel"  as const, label: "Soluble"  },
        { key: "torrado"  as const, label: "Roasted"  },
        { key: "total"    as const, label: "Total"    },
      ];

  const chartData = useMemo(() =>
    TYPES_WITH_TOTAL.map(t => {
      const row: Record<string, any> = { type: t.label };
      WINDOWS.forEach(w => {
        const curr = activeSeries.slice(-w.n);
        const prev = activeSeries.slice(-(w.n + 12), -12);
        row[w.label] = delta(avg(curr, t.key), avg(prev, t.key));
      });
      return row;
    })
  , [activeSeries, showSingle, typeFilter]);

  const latest = activeSeries[activeSeries.length - 1]?.date ?? "";
  const subtitle = latest ? `Latest: ${monthLabel(latest)} ${latest.split("-")[0]} · L1M→MAT = short-term to moving annual total` : "";

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="mb-1">
        <div className="text-sm font-semibold text-slate-200">Trend Tracker</div>
        <div className="text-[10px] text-slate-500">
          Volume delta vs same window one year prior (kt) · {subtitle}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="25%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="type" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [v !== null ? `${v > 0 ? "+" : ""}${v} kt` : "—", name]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          {WINDOWS.map(w => (
            <Bar key={w.label} dataKey={w.label} fill={WINDOW_COLORS[w.label]} radius={[2, 2, 0, 0]} maxBarSize={18} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Cumulative crop-year pace ─────────────────────────────────────────────

function CumulativePaceChart({ series, filteredSeries, typeFilter }: {
  series: VolumeSeries[];
  filteredSeries?: VolumeSeries[];
  typeFilter?: SeriesKey | null;
}) {
  const activeSeries = filteredSeries ?? series;
  const activeKey: SeriesKey = typeFilter ?? "total";

  // Group by crop year → crop month index → cumulative kt
  const grouped = useMemo(() => {
    const byYear: Record<string, { mo: number; kt: number }[]> = {};
    activeSeries.forEach(r => {
      const ck = cropYearKey(r.date);
      const mo  = parseInt(r.date.split("-")[1]);
      const idx = CROP_MONTH_ORDER.indexOf(mo);
      if (idx === -1) return;
      if (!byYear[ck]) byYear[ck] = [];
      byYear[ck].push({ mo: idx, kt: bagsToKT(r[activeKey] ?? r.total) });
    });
    // Sort each year's entries by crop month index, compute cumulative
    const result: Record<string, (number | null)[]> = {};
    Object.entries(byYear).forEach(([ck, pts]) => {
      pts.sort((a, b) => a.mo - b.mo);
      const arr: (number | null)[] = Array(12).fill(null);
      let cum = 0;
      pts.forEach(({ mo, kt }) => { cum += kt; arr[mo] = Math.round(cum * 10) / 10; });
      result[ck] = arr;
    });
    return result;
  }, [activeSeries, activeKey]);

  const sortedKeys = Object.keys(grouped).sort();
  if (sortedKeys.length < 2) return null;

  const currentKey = sortedKeys[sortedKeys.length - 1];
  const prior1Key  = sortedKeys[sortedKeys.length - 2];
  const prior2Key  = sortedKeys.length >= 3 ? sortedKeys[sortedKeys.length - 3] : null;

  // Last non-null index for current year
  const currentArr = grouped[currentKey];
  const lastIdx    = currentArr.reduce<number>((acc, v, i) => v !== null ? i : acc, -1);
  const lastKt     = lastIdx >= 0 ? (currentArr[lastIdx] ?? null) : null;

  // Pace vs prior year (same crop month)
  const prior1Arr   = grouped[prior1Key];
  const prior1AtIdx = lastIdx >= 0 ? (prior1Arr[lastIdx] ?? null) : null;
  const pacePct     = lastKt && prior1AtIdx && prior1AtIdx > 0
    ? Math.round((lastKt - prior1AtIdx) / prior1AtIdx * 100 * 10) / 10
    : null;

  const chartData = CROP_MONTH_LABELS.map((month, i) => ({
    month,
    [currentKey]: grouped[currentKey][i],
    [prior1Key]:  grouped[prior1Key][i],
    ...(prior2Key ? { [prior2Key]: grouped[prior2Key][i] } : {}),
  }));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">
            Cumulative Crop-Year Pace
          </div>
          <div className="text-[10px] text-slate-500">
            Cumulative exports by crop month (Apr → Mar) · kt
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: unknown, name: unknown) => [v !== null ? `${v} kt` : "—", `Crop ${name}`]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>Crop {v}</span>} />
          {prior2Key && (
            <Line type="monotone" dataKey={prior2Key} stroke={CROP_YEAR_COLORS[2]}
              strokeWidth={1} dot={false} connectNulls />
          )}
          <Line type="monotone" dataKey={prior1Key} stroke={CROP_YEAR_COLORS[1]}
            strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey={currentKey} stroke={CROP_YEAR_COLORS[0]}
            strokeWidth={2.5} dot={(props: any) => {
              if (props.index !== lastIdx || props.payload?.[currentKey] == null) return <g key={props.key} />;
              return (
                <g key={props.key}>
                  <circle cx={props.cx} cy={props.cy} r={3} fill={CROP_YEAR_COLORS[0]} />
                  <text x={props.cx} y={(props.cy ?? 0) + 16} fill="#f87171" fontSize={9} fontFamily="monospace" textAnchor="middle">
                    {Number(lastKt).toLocaleString("en-US")}kt
                  </text>
                </g>
              );
            }}
            connectNulls />
        </LineChart>
      </ResponsiveContainer>
      {pacePct !== null && (
        <div className="text-[10px] text-slate-500 mt-1">
          {currentKey} pace vs {prior1Key}:{" "}
          <span className={`font-bold ${pacePct >= 0 ? "text-green-400" : "text-red-400"}`}>
            {pacePct >= 0 ? "+" : ""}{pacePct}%
          </span>{" "}
          at same crop-month
        </div>
      )}
    </div>
  );
}

// ── Country/hub filter ────────────────────────────────────────────────────────

function buildFilteredSeries(
  ptCountries: string[],
  history: Record<string, CountryYear>,
  byPrev: CountryYear,
  byCurrent: CountryYear,
): VolumeSeries[] {
  const monthly: Record<string, number> = {};
  const sources = [...Object.values(history), byPrev, byCurrent];
  for (const cy of sources) {
    for (const pt of ptCountries) {
      const mv = cy.countries?.[pt] ?? {};
      for (const [ym, vol] of Object.entries(mv)) {
        monthly[ym] = (monthly[ym] ?? 0) + vol;
      }
    }
  }
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({
      date, total, arabica: 0, conillon: 0, soluvel: 0,
      torrado: 0, total_verde: 0, total_industria: 0,
    }));
}

type SeriesKey = "total" | "arabica" | "conillon" | "soluvel" | "torrado";
interface FilterState { hub: string | null; country: string | null; type: SeriesKey | null; }

const TYPE_FILTER_OPTS: { key: SeriesKey; label: string; color: string }[] = [
  { key: "arabica",  label: "Arabica",  color: GREEN },
  { key: "conillon", label: "Conillon", color: TEAL  },
  { key: "soluvel",  label: "Soluble",  color: AMBER },
  { key: "torrado",  label: "Roasted",  color: BLUE  },
];

function CountryHubFilter({
  byCountry,
  filter,
  onChange,
}: {
  byCountry: CountryYear;
  filter: FilterState;
  onChange: (f: FilterState) => void;
}) {
  // Get countries present in current data, sorted by export volume
  const sortedCountries = useMemo(() =>
    Object.entries(byCountry.countries ?? {})
      .sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0))
      .map(([pt]) => pt)
  , [byCountry]);

  const hubCountries = filter.hub
    ? sortedCountries.filter(pt => COUNTRY_HUB[pt] === filter.hub)
    : sortedCountries;

  const isActive = filter.hub !== null || filter.country !== null || filter.type !== null;
  const activeLabels = [
    filter.type ? TYPE_FILTER_OPTS.find(t => t.key === filter.type)?.label : null,
    filter.country ? toEn(filter.country) : filter.hub,
  ].filter(Boolean).join(" · ");

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide font-medium">Filter charts</span>
        {isActive && (
          <button onClick={() => onChange({ hub: null, country: null, type: null })}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-800 text-indigo-200 hover:bg-indigo-700">
            ✕ Clear ({activeLabels || "all"})
          </button>
        )}
      </div>

      {/* Coffee type pills */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-14 shrink-0">Type</span>
        <div className="flex flex-wrap gap-1">
          {TYPE_FILTER_OPTS.map(t => (
            <button key={t.key}
              onClick={() => onChange({ ...filter, type: filter.type === t.key ? null : t.key })}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                filter.type === t.key
                  ? "border-transparent text-slate-900 font-semibold"
                  : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              }`}
              style={filter.type === t.key ? { background: t.color } : { borderLeftColor: t.color, borderLeftWidth: 3 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hub pills */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 w-14 shrink-0">Hub</span>
        <div className="flex flex-wrap gap-1">
          {HUB_ORDER.map(hub => (
            <button key={hub}
              onClick={() => onChange({ ...filter, hub: filter.hub === hub ? null : hub, country: null })}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                filter.hub === hub
                  ? "border-indigo-500 bg-indigo-900 text-indigo-200"
                  : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              }`}
              style={filter.hub === hub ? {} : { borderLeftColor: HUB_COLORS[hub], borderLeftWidth: 3 }}>
              {hub}
            </button>
          ))}
        </div>
      </div>

      {/* Country pills within selected hub */}
      {hubCountries.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-[10px] text-slate-500 w-14 shrink-0 pt-0.5">Country</span>
          <div className="flex flex-wrap gap-1">
            {hubCountries.slice(0, 20).map(pt => (
              <button key={pt}
                onClick={() => onChange({ ...filter, country: filter.country === pt ? null : pt })}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  filter.country === pt
                    ? "bg-indigo-700 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                }`}>
                {toEn(pt)}
              </button>
            ))}
            {hubCountries.length > 20 && (
              <span className="text-[10px] text-slate-600 self-center">+{hubCountries.length - 20} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Country / Hub destination chart ──────────────────────────────────────────

type ViewMode  = "country" | "hub";
type CoffeeType = "total" | "arabica" | "conillon" | "soluvel" | "torrado";

const TYPE_LABELS: Record<CoffeeType, string> = {
  total:    "Total",
  arabica:  "Arabica",
  conillon: "Conillon",
  soluvel:  "Soluble",
  torrado:  "Roasted",
};

const EMPTY_CY: CountryYear = { months: [], countries: {} };

type DestWindow = "CTD" | "L1M" | "L3M" | "L6M" | "L12M";

const DEST_WINDOWS: { label: DestWindow; n: number | null }[] = [
  { label: "L1M",  n: 1  },
  { label: "L3M",  n: 3  },
  { label: "L6M",  n: 6  },
  { label: "L12M", n: 12 },
  { label: "CTD",  n: null },
];

// Offset a YYYY-MM string by -12 months
function offsetYM(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function DestinationChart({
  byCountry, byCountryPrev,
  byArabica, byArabicaPrev,
  byConillon, byConillonPrev,
  bySoluvel, bySoluvelPrev,
  byTorrado, byTorradoPrev,
  byCountryHistory,
}: {
  byCountry: CountryYear; byCountryPrev: CountryYear;
  byArabica?: CountryYear; byArabicaPrev?: CountryYear;
  byConillon?: CountryYear; byConillonPrev?: CountryYear;
  bySoluvel?: CountryYear; bySoluvelPrev?: CountryYear;
  byTorrado?: CountryYear; byTorradoPrev?: CountryYear;
  byCountryHistory?: Record<string, CountryYear>;
}) {
  const [mode, setMode]           = useState<ViewMode>("country");
  const [topN, setTopN]           = useState(15);
  const [coffeeType, setCoffeeType] = useState<CoffeeType>("total");
  const [destWindow, setDestWindow] = useState<DestWindow>("CTD");

  // Build a merged flat map: country → ym → vol, across all available data
  const mergedCountries = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    const sources: CountryYear[] = [
      ...Object.values(byCountryHistory ?? {}),
      byCountryPrev,
      byCountry,
    ];
    for (const cy of sources) {
      for (const [pt, mv] of Object.entries(cy.countries ?? {})) {
        if (!out[pt]) out[pt] = {};
        for (const [ym, vol] of Object.entries(mv)) {
          out[pt][ym] = (out[pt][ym] ?? 0) + vol;
        }
      }
    }
    return out;
  }, [byCountry, byCountryPrev, byCountryHistory]);

  // All available months (sorted)
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    [...Object.values(byCountryHistory ?? {}), byCountryPrev, byCountry].forEach(cy =>
      (cy.months ?? []).forEach(m => set.add(m))
    );
    return Array.from(set).sort();
  }, [byCountry, byCountryPrev, byCountryHistory]);

  const latestMonth  = allMonths[allMonths.length - 1] ?? "";
  const currentYear  = latestMonth.split("-")[0] ?? "2026";

  // Determine which months to include for current window
  const windowMonths: string[] = useMemo(() => {
    if (destWindow === "CTD") {
      // Crop-to-date: Apr of current crop year → latest
      const ck = cropYearKey(latestMonth);
      const cropStartYear = parseInt(ck.split("/")[0]);
      const cropStart = `${cropStartYear}-04`;
      return allMonths.filter(m => m >= cropStart && m <= latestMonth);
    }
    const n = DEST_WINDOWS.find(w => w.label === destWindow)!.n!;
    return allMonths.slice(-n);
  }, [destWindow, allMonths, latestMonth]);

  // Prev year comparison: same months offset -12
  const prevWindowMonths: string[] = useMemo(() =>
    windowMonths.map(m => offsetYM(m, 12))
  , [windowMonths]);

  // Determine which source has the type data for prev window months
  const activeData: CountryYear = (() => {
    switch (coffeeType) {
      case "arabica":  return byArabica  ?? EMPTY_CY;
      case "conillon": return byConillon ?? EMPTY_CY;
      case "soluvel":  return bySoluvel  ?? EMPTY_CY;
      case "torrado":  return byTorrado  ?? EMPTY_CY;
      default:         return byCountry;
    }
  })();
  const activePrev: CountryYear = (() => {
    switch (coffeeType) {
      case "arabica":  return byArabicaPrev  ?? EMPTY_CY;
      case "conillon": return byConillonPrev ?? EMPTY_CY;
      case "soluvel":  return bySoluvelPrev  ?? EMPTY_CY;
      case "torrado":  return byTorradoPrev  ?? EMPTY_CY;
      default:         return byCountryPrev;
    }
  })();

  // For type-specific data, we only have current + prev year (no deeper history)
  // Use merged (total) for current window when spanning into history
  const useTyped = coffeeType !== "total";

  // Period labels
  const wFirst = windowMonths[0] ?? "";
  const wLast  = windowMonths[windowMonths.length - 1] ?? "";
  const pwFirst = prevWindowMonths[0] ?? "";
  const pwLast  = prevWindowMonths[prevWindowMonths.length - 1] ?? "";
  const periodLabel = wFirst && wLast
    ? wFirst === wLast ? `${monthLabel(wFirst)} ${wFirst.split("-")[0]}`
      : `${monthLabel(wFirst)} ${wFirst.split("-")[0]}–${monthLabel(wLast)} ${wLast.split("-")[0]}`
    : "";
  const prevPeriodLabel = pwFirst && pwLast
    ? pwFirst === pwLast ? `${monthLabel(pwFirst)} ${pwFirst.split("-")[0]}`
      : `${monthLabel(pwFirst)} ${pwFirst.split("-")[0]}–${monthLabel(pwLast)} ${pwLast.split("-")[0]}`
    : "";

  // ── Aggregate by country ────────────────────────────────────────────────────
  const countryTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};

    if (useTyped) {
      // Type-specific: use activeData (current year) and activePrev only
      Object.entries(activeData.countries ?? {}).forEach(([c, mv]) => {
        const val = windowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (val > 0) out[c] = { current: val, prev: 0 };
      });
      Object.entries(activePrev.countries ?? {}).forEach(([c, mv]) => {
        const val = prevWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (val > 0) { if (!out[c]) out[c] = { current: 0, prev: 0 }; out[c].prev = val; }
      });
    } else {
      // Total: use merged map spanning all available history
      Object.entries(mergedCountries).forEach(([c, mv]) => {
        const curr = windowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        const prev = prevWindowMonths.reduce((s, m) => s + (mv[m] ?? 0), 0);
        if (curr > 0 || prev > 0) out[c] = { current: curr, prev };
      });
    }
    return out;
  }, [mergedCountries, activeData, activePrev, windowMonths, prevWindowMonths, useTyped]);

  // ── Aggregate by hub ────────────────────────────────────────────────────────
  const hubTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};
    Object.entries(countryTotals).forEach(([ptCountry, v]) => {
      const hub = getHub(ptCountry);
      if (!out[hub]) out[hub] = { current: 0, prev: 0 };
      out[hub].current += v.current;
      out[hub].prev    += v.prev;
    });
    return out;
  }, [countryTotals]);

  // ── Build chart data ────────────────────────────────────────────────────────
  const countryRows = useMemo(() =>
    Object.entries(countryTotals)
      .sort((a, b) => b[1].current - a[1].current)
      .slice(0, topN)
      .map(([pt, v]) => {
        const en = toEn(pt);
        return {
          label:      en.length > 20 ? en.slice(0, 19) + "…" : en,
          current:    bagsToKT(v.current),
          prev:       bagsToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: null as number | null,
        };
      })
  , [countryTotals, topN]);

  const hubRows = useMemo(() => {
    const totalCurrent = Object.values(hubTotals).reduce((s, v) => s + v.current, 0);
    const totalPrev    = Object.values(hubTotals).reduce((s, v) => s + v.prev,    0);

    return HUB_ORDER
      .map(hub => {
        const v = hubTotals[hub] ?? { current: 0, prev: 0 };
        const shareCurrent = totalCurrent > 0 ? v.current / totalCurrent * 100 : 0;
        const sharePrev    = totalPrev    > 0 ? v.prev    / totalPrev    * 100 : 0;
        const shareDelta   = Math.round((shareCurrent - sharePrev) * 10) / 10;
        return {
          label:      hub,
          current:    bagsToKT(v.current),
          prev:       bagsToKT(v.prev),
          pct:        v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
          shareDelta: totalPrev > 0 ? shareDelta : null,
        };
      })
      .filter(r => r.current > 0 || r.prev > 0)
      .sort((a, b) => b.current - a.current);
  }, [hubTotals]);

  const rows    = mode === "hub" ? hubRows : countryRows;
  const barH    = mode === "hub" ? rows.length * 30 + 40 : topN * 26 + 40;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">Export by Destination</div>
          <div className="text-[10px] text-slate-500">
            {TYPE_LABELS[coffeeType]} · {periodLabel} (green) vs {prevPeriodLabel} (grey) · Thousand metric tons
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {/* Window selector */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {DEST_WINDOWS.map(w => (
              <button key={w.label} onClick={() => setDestWindow(w.label)}
                className={`text-[10px] px-2 py-0.5 rounded ${destWindow === w.label ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {w.label}
              </button>
            ))}
          </div>
          {/* Coffee type selector */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {(Object.keys(TYPE_LABELS) as CoffeeType[]).map(t => (
              <button key={t} onClick={() => setCoffeeType(t)}
                className={`text-[10px] px-2 py-0.5 rounded ${coffeeType === t ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          {/* View toggle */}
          <div className="flex gap-1 border border-slate-600 rounded p-0.5">
            {(["country", "hub"] as ViewMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-[10px] px-2 py-0.5 rounded capitalize ${mode === m ? "bg-slate-600 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
                {m === "hub" ? "By Hub" : "By Country"}
              </button>
            ))}
          </div>
          {/* Top N (country only) */}
          {mode === "country" && (
            <div className="flex gap-1">
              {[10, 15, 25].map(n => (
                <button key={n} onClick={() => setTopN(n)}
                  className={`text-[10px] px-2 py-0.5 rounded ${topN === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
                  Top {n}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={barH}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: mode === "hub" ? 130 : 140 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis type="number" tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 9 }} />
          <YAxis type="category" dataKey="label" tick={{ fill: "#cbd5e1", fontSize: 9 }}
            width={mode === "hub" ? 125 : 135} />
          <Tooltip contentStyle={TT_STYLE}
            formatter={(v: any, name: any) => [
              `${v} kt`,
              name === "current" ? periodLabel : prevPeriodLabel,
            ]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={(v) => (
              <span style={{ color: "#cbd5e1" }}>
                {v === "current" ? periodLabel : prevPeriodLabel}
              </span>
            )} />
          <Bar dataKey="prev"    name="prev"    fill={SLATE} opacity={0.55} />
          <Bar dataKey="current" name="current" radius={[0, 3, 3, 0]}>
            {rows.map((r, i) => {
              const fill = mode === "hub"
                ? (HUB_COLORS[r.label] ?? "#475569")
                : (r.pct !== null && r.pct < 0 ? "#ef4444" : GREEN);
              return <Cell key={i} fill={fill} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* YoY change table */}
      <div className="mt-4 text-[10px]">
        {/* Header */}
        <div className={`grid pb-1 border-b border-slate-700 text-slate-500 font-medium gap-x-6`}
          style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}>
          <span>Destination</span>
          <span className="text-right">YoY vol. (same period)</span>
          {mode === "hub" && <span className="text-right">Share Δpp</span>}
        </div>

        {rows.map(r => {
          const hubRow = r as typeof hubRows[0];
          return (
            <div
              key={r.label}
              className="grid gap-x-6 py-0.5 border-b border-slate-800"
              style={{ gridTemplateColumns: mode === "hub" ? "1fr auto auto" : "1fr auto" }}
            >
              <span className="text-slate-300 truncate">{r.label}</span>
              <span className={`text-right ${
                r.pct === null ? "text-slate-500" : r.pct >= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {r.pct === null ? "n/a" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}
              </span>
              {mode === "hub" && (
                <span className={`text-right ${
                  hubRow.shareDelta === null ? "text-slate-500"
                  : hubRow.shareDelta > 0   ? "text-green-400"
                  : hubRow.shareDelta < 0   ? "text-red-400"
                  : "text-slate-500"
                }`}>
                  {hubRow.shareDelta === null ? "n/a"
                    : `${hubRow.shareDelta > 0 ? "+" : ""}${hubRow.shareDelta}pp`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BrazilTab() {
  const [data, setData]   = useState<CecafeData | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterState>({ hub: null, country: null, type: null });
  const [subTab, setSubTab] = useState<"exports" | "farmer-economics">("exports");

  useEffect(() => {
    fetch("/data/cecafe.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // All hooks must be called before any conditional return
  const filteredSeries = useMemo(() => {
    if (!data) return undefined;
    const { by_country_history, by_country_prev, by_country } = data;
    const history = by_country_history ?? {};
    const ptCountries = filter.country
      ? [filter.country]
      : filter.hub
      ? Object.entries(COUNTRY_HUB).filter(([, h]) => h === filter.hub).map(([pt]) => pt)
      : null;
    if (!ptCountries) return undefined;
    return buildFilteredSeries(ptCountries, history, by_country_prev ?? EMPTY_CY, by_country ?? EMPTY_CY);
  }, [filter, data]);

  if (error) return (
    <div className="text-center text-slate-500 py-16 text-sm">
      Cecafe data unavailable — scraper may not have run yet.
    </div>
  );
  if (!data) return (
    <div className="text-center text-slate-500 py-16 text-sm animate-pulse">Loading Cecafe data…</div>
  );

  const {
    series,
    by_country, by_country_prev,
    by_country_arabica, by_country_arabica_prev,
    by_country_conillon, by_country_conillon_prev,
    by_country_soluvel, by_country_soluvel_prev,
    by_country_torrado, by_country_torrado_prev,
    by_country_history,
    report, updated,
  } = data;
  const latest = series[series.length - 1];
  const prev   = series[series.length - 13]; // same month last year

  // Crop-to-date: Apr → latest month, using cropYearKey
  const latestCropKey  = cropYearKey(latest.date);
  const [cropStartY]   = latestCropKey.split("/").map(Number); // e.g. 2025 for "2025/26"
  const prevCropKey    = `${cropStartY - 1}/${String(cropStartY).slice(2)}`;

  // All months in the current crop year up to (and including) latest
  const ctdCurrent = series.filter(r => cropYearKey(r.date) === latestCropKey);
  // Same months in the previous crop year (same month indices)
  const ctdMonthIndices = new Set(ctdCurrent.map(r => parseInt(r.date.split("-")[1])));
  const ctdPrev    = series.filter(r =>
    cropYearKey(r.date) === prevCropKey &&
    ctdMonthIndices.has(parseInt(r.date.split("-")[1]))
  );

  const ctdTotal      = ctdCurrent.reduce((s, r) => s + r.total, 0);
  const ctdPrevTotal  = ctdPrev.reduce((s, r) => s + r.total, 0);
  const ctdChg        = ctdPrevTotal > 0 ? Math.round((ctdTotal - ctdPrevTotal) / ctdPrevTotal * 100) : null;
  const lyChg         = prev ? Math.round((latest.total - prev.total) / prev.total * 100) : null;
  const ctdMonthRange = ctdCurrent.length > 0
    ? `${monthLabel(ctdCurrent[0].date)}–${monthLabel(ctdCurrent[ctdCurrent.length - 1].date)}`
    : "";

  return (
    <div className="space-y-5">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 w-fit">
        {(["exports", "farmer-economics"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              subTab === t
                ? "bg-slate-700 text-slate-100"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {t === "exports" ? "Exports" : "Farmer Economics"}
          </button>
        ))}
      </div>

      {subTab === "farmer-economics" && <BrazilFarmerEconomics />}

      {subTab === "exports" && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-200">Brazil — Cecafe Export Data</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Report: {report} · Updated {updated} · Source: Cecafe (60 kg bags)
              </p>
            </div>
            <span className="text-[10px] bg-green-900/50 text-green-400 px-2 py-0.5 rounded border border-green-800">
              Arabica &amp; Conillon origin
            </span>
          </div>

          {/* Daily export registration (top section, rendered only when cecafe_daily.json exists) */}
          <DailyRegistrationSection />

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={`${latest.date} — total exports`}
              value={`${bagsToKT(latest.total).toFixed(1)} kt`}
              sub={`${(latest.total / 1000).toFixed(0)}k bags`}
            />
            <StatCard
              label="vs same month last year"
              value={lyChg !== null ? `${lyChg > 0 ? "+" : ""}${lyChg}%` : "—"}
              sub={prev ? `${bagsToKT(prev.total).toFixed(1)} kt in ${prev.date}` : ""}
            />
            <StatCard
              label={`Crop ${latestCropKey} — ${ctdMonthRange}`}
              value={`${bagsToKT(ctdTotal).toFixed(1)} kt`}
              sub={`${(ctdTotal / 1000).toFixed(0)}k bags crop-to-date`}
            />
            <StatCard
              label={`vs crop ${prevCropKey} same period`}
              value={ctdChg !== null ? `${ctdChg > 0 ? "+" : ""}${ctdChg}%` : "—"}
              sub={`${prevCropKey}: ${bagsToKT(ctdPrevTotal).toFixed(1)} kt`}
            />
          </div>

          {/* Origin filter */}
          <CountryHubFilter byCountry={by_country} filter={filter} onChange={setFilter} />

          {/* Charts */}
          <MonthlyVolumeChart series={filteredSeries ?? series} typeFilter={filter.type} isFiltered={!!filteredSeries} />
          <CumulativePaceChart series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <AnnualTrendChart    series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <TypeShareChart series={series} />
          <YoYByTypeChart      series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <SeasonalityHeatmap series={series} />
          <RollingAvgChart     series={series} filteredSeries={filteredSeries} typeFilter={filter.type} />
          <DestinationChart
            byCountry={by_country}         byCountryPrev={by_country_prev}
            byArabica={by_country_arabica} byArabicaPrev={by_country_arabica_prev}
            byConillon={by_country_conillon} byConillonPrev={by_country_conillon_prev}
            bySoluvel={by_country_soluvel} bySoluvelPrev={by_country_soluvel_prev}
            byTorrado={by_country_torrado} byTorradoPrev={by_country_torrado_prev}
            byCountryHistory={by_country_history}
          />
        </>
      )}
    </div>
  );
}
