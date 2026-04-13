"use client";
import { useEffect, useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";

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
  "European Union":   "#60a5fa",
  "Non-EU Europe":    "#93c5fd",
  "North America":    "#f59e0b",
  "Latin America":    "#fcd34d",
  "East Asia":        "#a78bfa",
  "SE Asia & Pacific":"#c4b5fd",
  "Middle East":      "#f97316",
  "North Africa":     "#fb923c",
  "Sub-Saharan Africa":"#86efac",
  "South Asia":       "#34d399",
  "Russia & CIS":     "#94a3b8",
  "Other":            "#475569",
};

const COUNTRY_HUB: Record<string, string> = {
  // European Union
  "ALEMANHA":             "European Union",
  "BELGICA":              "European Union",
  "BULGARIA":             "European Union",
  "CHIPRE":               "European Union",
  "CROACIA":              "European Union",
  "DINAMARCA":            "European Union",
  "ESLOVAQUIA":           "European Union",
  "ESLOVENIA":            "European Union",
  "ESPANHA":              "European Union",
  "ESTONIA":              "European Union",
  "FINLANDIA":            "European Union",
  "FRANCA":               "European Union",
  "GRECIA":               "European Union",
  "IRLANDA":              "European Union",
  "ITALIA":               "European Union",
  "LETONIA (LATVIA)":     "European Union",
  "LITUANIA":             "European Union",
  "LUXEMBURGO":           "European Union",
  "MALTA":                "European Union",
  "PAISES BAIXOS (HOLANDA)": "European Union",
  "POLONIA":              "European Union",
  "PORTUGAL":             "European Union",
  "REPUBL. TCHECA":       "European Union",
  "ROMENIA":              "European Union",
  "SUECIA":               "European Union",
  // Non-EU Europe
  "ALBANIA":              "Non-EU Europe",
  "BOSNIA-HERZEGOVINA":   "Non-EU Europe",
  "ISLANDIA":             "Non-EU Europe",
  "MONTENEGRO":           "Non-EU Europe",
  "NORUEGA":              "Non-EU Europe",
  "REINO UNIDO":          "Non-EU Europe",
  "SERVIA":               "Non-EU Europe",
  "SUICA":                "Non-EU Europe",
  "TURQUIA":              "Non-EU Europe",
  "UCRANIA":              "Non-EU Europe",
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
  "DJIBUTI":              "Middle East",
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

const HUB_ORDER = [
  "European Union","Non-EU Europe","North America","Latin America",
  "East Asia","SE Asia & Pacific","Middle East","North Africa",
  "Sub-Saharan Africa","South Asia","Russia & CIS","Other",
];

// ── Tooltip style shared ──────────────────────────────────────────────────────

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

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

// ── Monthly Volume Chart ──────────────────────────────────────────────────────

function MonthlyVolumeChart({ series }: { series: VolumeSeries[] }) {
  const [years, setYears] = useState(3);

  const yearGroups = useMemo(() => {
    const m: Record<number, Record<number, VolumeSeries>> = {};
    series.forEach(r => {
      const [y, mo] = r.date.split("-").map(Number);
      if (!m[y]) m[y] = {};
      m[y][mo] = r;
    });
    return m;
  }, [series]);

  const latestYear = Math.max(...Object.keys(yearGroups).map(Number));
  const showYears  = Array.from({ length: years }, (_, i) => latestYear - i).reverse();
  const YEAR_COLORS = ["#475569", "#64748b", "#94a3b8", "#60a5fa", GREEN];

  const chartData = MONTH_LABELS.map((label, mi) => {
    const row: Record<string, number | string> = { month: label };
    showYears.forEach(y => {
      const d = yearGroups[y]?.[mi + 1];
      row[String(y)] = d ? bagsToKT(d.total) : 0;
    });
    return row;
  });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Monthly Export Volume — Total (All Types)</div>
          <div className="text-[10px] text-slate-500">Thousand metric tons (60 kg bags)</div>
        </div>
        <div className="flex gap-1">
          {[2, 3, 5].map(n => (
            <button key={n} onClick={() => setYears(n)}
              className={`text-[10px] px-2 py-0.5 rounded ${years === n ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>
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
          <Tooltip contentStyle={TT_STYLE} formatter={(v: any, name: any) => [`${v} kt`, `Year ${name}`]} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>Year {v}</span>} />
          {showYears.map((y, i) => (
            <Bar key={y} dataKey={String(y)} name={String(y)}
              fill={YEAR_COLORS[i % YEAR_COLORS.length]}
              opacity={y === latestYear ? 1 : 0.65}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Annual Trend ──────────────────────────────────────────────────────────────

function AnnualTrendChart({ series }: { series: VolumeSeries[] }) {
  const [since, setSince] = useState(2010);

  const annualData = useMemo(() => {
    const byYear: Record<number, { arabica: number; conillon: number; soluvel: number; torrado: number }> = {};
    series.forEach(r => {
      const y = parseInt(r.date.split("-")[0]);
      if (!byYear[y]) byYear[y] = { arabica: 0, conillon: 0, soluvel: 0, torrado: 0 };
      byYear[y].arabica  += r.arabica;
      byYear[y].conillon += r.conillon;
      byYear[y].soluvel  += r.soluvel;
      byYear[y].torrado  += r.torrado;
    });
    const latestYear = Math.max(...Object.keys(byYear).map(Number));
    return Object.entries(byYear)
      .filter(([y]) => parseInt(y) < latestYear)
      .map(([y, v]) => ({
        year:     y,
        "Arabica (green)":  bagsToKT(v.arabica),
        "Conillon (green)": bagsToKT(v.conillon),
        "Soluble":          bagsToKT(v.soluvel),
        "Roasted & Ground": bagsToKT(v.torrado),
      }))
      .sort((a, b) => parseInt(a.year) - parseInt(b.year))
      .filter(r => parseInt(r.year) >= since);
  }, [series, since]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="text-sm font-semibold text-slate-200">Annual Export by Coffee Type</div>
          <div className="text-[10px] text-slate-500">Thousand metric tons — complete years only</div>
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
        <BarChart data={annualData} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 9 }} angle={-45} textAnchor="end" />
          <YAxis tickFormatter={v => `${v}kt`} tick={{ fill: "#94a3b8", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={TT_STYLE} formatter={(v: any, name: any) => [`${v} kt`, name]} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 6 }}
            formatter={v => <span style={{ color: "#cbd5e1" }}>{v}</span>} />
          <Bar dataKey="Arabica (green)"  stackId="a" fill={GREEN} />
          <Bar dataKey="Conillon (green)" stackId="a" fill={TEAL}  />
          <Bar dataKey="Soluble"          stackId="a" fill={AMBER} />
          <Bar dataKey="Roasted & Ground" stackId="a" fill={BLUE}  />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Country / Hub destination chart ──────────────────────────────────────────

type ViewMode = "country" | "hub";

function DestinationChart({ byCountry, byCountryPrev }: { byCountry: CountryYear; byCountryPrev: CountryYear }) {
  const [mode, setMode]   = useState<ViewMode>("country");
  const [topN, setTopN]   = useState(15);

  const currentMonths = byCountry.months ?? [];
  const prevMonths    = byCountryPrev.months ?? [];
  const currentYear   = currentMonths[0]?.split("-")[0] ?? "2026";
  const prevYear      = prevMonths[0]?.split("-")[0] ?? "2025";

  const ytdLabel = currentMonths.length > 0
    ? `${monthLabel(currentMonths[0])}–${monthLabel(currentMonths[currentMonths.length - 1])} ${currentYear} YTD`
    : `${currentYear} YTD`;

  // ── Aggregate by country ────────────────────────────────────────────────────
  const countryTotals = useMemo(() => {
    const out: Record<string, { current: number; prev: number }> = {};
    Object.entries(byCountry.countries ?? {}).forEach(([c, mv]) => {
      out[c] = { current: Object.values(mv).reduce((a, b) => a + b, 0), prev: 0 };
    });
    Object.entries(byCountryPrev.countries ?? {}).forEach(([c, mv]) => {
      const prevVal = prevMonths
        .slice(0, currentMonths.length)
        .reduce((s, m) => s + (mv[m] ?? 0), 0);
      if (!out[c]) out[c] = { current: 0, prev: 0 };
      out[c].prev = prevVal;
    });
    return out;
  }, [byCountry, byCountryPrev, currentMonths, prevMonths]);

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
          label:   en.length > 20 ? en.slice(0, 19) + "…" : en,
          current: bagsToKT(v.current),
          prev:    bagsToKT(v.prev),
          pct:     v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
        };
      })
  , [countryTotals, topN]);

  const hubRows = useMemo(() =>
    HUB_ORDER
      .map(hub => {
        const v = hubTotals[hub] ?? { current: 0, prev: 0 };
        return {
          label:   hub,
          current: bagsToKT(v.current),
          prev:    bagsToKT(v.prev),
          pct:     v.prev > 0 ? Math.round((v.current - v.prev) / v.prev * 100) : null,
        };
      })
      .filter(r => r.current > 0 || r.prev > 0)
      .sort((a, b) => b.current - a.current)
  , [hubTotals]);

  const rows    = mode === "hub" ? hubRows : countryRows;
  const barH    = mode === "hub" ? rows.length * 30 + 40 : topN * 26 + 40;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-200">Export by Destination</div>
          <div className="text-[10px] text-slate-500">
            {ytdLabel} (green) vs same period {prevYear} (grey) · Thousand metric tons
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
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
              name === "current" ? `${currentYear} YTD` : `${prevYear} same period`,
            ]} />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
            formatter={(v) => (
              <span style={{ color: "#cbd5e1" }}>
                {v === "current" ? `${currentYear} YTD` : `${prevYear} same period`}
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
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10px]">
        <div className="col-span-2 grid grid-cols-2 gap-x-6 pb-1 border-b border-slate-700 text-slate-500 font-medium">
          <span>Destination</span>
          <span className="text-right">YoY (same-period)</span>
        </div>
        {rows.map(r => (
          <div key={r.label} className="contents">
            <span className="text-slate-300 truncate py-0.5 border-b border-slate-800">{r.label}</span>
            <span className={`text-right py-0.5 border-b border-slate-800 ${
              r.pct === null ? "text-slate-500" : r.pct >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              {r.pct === null ? "n/a" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BrazilTab() {
  const [data, setData] = useState<CecafeData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/cecafe.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return (
    <div className="text-center text-slate-500 py-16 text-sm">
      Cecafe data unavailable — scraper may not have run yet.
    </div>
  );
  if (!data) return (
    <div className="text-center text-slate-500 py-16 text-sm animate-pulse">Loading Cecafe data…</div>
  );

  const { series, by_country, by_country_prev, report, updated } = data;
  const latest = series[series.length - 1];
  const prev   = series[series.length - 13]; // same month last year

  const currentYear  = latest.date.split("-")[0];
  const ytdCurrent   = series.filter(r => r.date.startsWith(currentYear));
  const nMonths      = ytdCurrent.length;
  const ytdPrevYear  = String(parseInt(currentYear) - 1);
  const ytdPrev      = series.filter(r => {
    const [y, m] = r.date.split("-");
    return y === ytdPrevYear && parseInt(m) <= nMonths;
  });

  const ytdTotal    = ytdCurrent.reduce((s, r) => s + r.total, 0);
  const ytdPrevTotal = ytdPrev.reduce((s, r) => s + r.total, 0);
  const ytdChg      = ytdPrevTotal > 0 ? Math.round((ytdTotal - ytdPrevTotal) / ytdPrevTotal * 100) : null;
  const lyChg       = prev ? Math.round((latest.total - prev.total) / prev.total * 100) : null;
  const ytdMonths   = ytdCurrent.map(r => monthLabel(r.date)).join("/");

  return (
    <div className="space-y-5">
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
          label={`${ytdMonths} ${currentYear} YTD`}
          value={`${bagsToKT(ytdTotal).toFixed(1)} kt`}
          sub={`${(ytdTotal / 1000).toFixed(0)}k bags total`}
        />
        <StatCard
          label={`YTD vs ${ytdPrevYear} same period`}
          value={ytdChg !== null ? `${ytdChg > 0 ? "+" : ""}${ytdChg}%` : "—"}
          sub={`${ytdPrevYear}: ${bagsToKT(ytdPrevTotal).toFixed(1)} kt`}
        />
      </div>

      {/* Charts */}
      <MonthlyVolumeChart series={series} />
      <AnnualTrendChart   series={series} />
      <DestinationChart   byCountry={by_country} byCountryPrev={by_country_prev} />
    </div>
  );
}
