// ── Interfaces / types ────────────────────────────────────────────────────────

export interface VolumeSeries {
  date: string;
  conillon: number;
  arabica: number;
  total_verde: number;
  torrado: number;
  soluvel: number;
  total_industria: number;
  total: number;
}

export interface CountryYear {
  months: string[];
  countries: Record<string, Record<string, number>>;
}

export interface CecafeData {
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

export type SeriesKey = "total" | "arabica" | "conillon" | "soluvel" | "torrado" | "total_verde" | "total_industria";
export interface FilterState { hub: string | null; country: string | null; type: SeriesKey | null; }
export type ViewMode   = "country" | "hub";
export type CoffeeType = "total" | "arabica" | "conillon" | "soluvel" | "torrado";
export type DestWindow = "CTD" | "L1M" | "L3M" | "L6M" | "L12M";

// ── Color palette ─────────────────────────────────────────────────────────────

export const GREEN = "#22c55e";
export const AMBER = "#f59e0b";
export const BLUE  = "#60a5fa";
export const SLATE = "#94a3b8";
export const TEAL  = "#2dd4bf";

export const CROP_YEAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#60a5fa",
  "#64748b",
  "#475569",
  "#334155",
];

// ── Tooltip style ─────────────────────────────────────────────────────────────

export const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

// ── Country translation: Portuguese → English ─────────────────────────────────

export const COUNTRY_EN: Record<string, string> = {
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

// ── Hub groupings ─────────────────────────────────────────────────────────────

export const HUB_COLORS: Record<string, string> = {
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

export const COUNTRY_HUB: Record<string, string> = {
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

export const HUB_ORDER = [
  "Nordics","Central Europe","South Europe","Eastern Europe",
  "North America","Latin America",
  "East Asia","SE Asia & Pacific","Middle East","North Africa",
  "Sub-Saharan Africa","South Asia","Russia & CIS","Other",
];

// ── Month / crop-year helpers ─────────────────────────────────────────────────

export const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const CROP_MONTH_ORDER  = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
export const CROP_MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

export function bagsToKT(bags: number) {
  return Math.round((bags * 60) / 1e6 * 10) / 10;
}

export function monthLabel(ym: string) {
  return MONTH_LABELS[parseInt(ym.split("-")[1]) - 1];
}

export function fmtBags(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const mo = MONTH_LABELS[m - 1];
  return `${mo}-${String(y).slice(2)}`;
}

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function offsetYM(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function cropYearKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 4 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

export function toEn(pt: string): string {
  return COUNTRY_EN[pt] ?? pt;
}

export function getHub(ptCountry: string): string {
  return COUNTRY_HUB[ptCountry] ?? "Other";
}

// ── Filter + series helpers ───────────────────────────────────────────────────

export type SeriesKeyOf<T extends VolumeSeries> = keyof T;

export const EMPTY_CY: CountryYear = { months: [], countries: {} };

export function buildFilteredSeries(
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

// ── Filter UI constants ───────────────────────────────────────────────────────

export const TYPE_FILTER_OPTS: { key: SeriesKey; label: string; color: string }[] = [
  { key: "arabica",  label: "Arabica",  color: GREEN },
  { key: "conillon", label: "Conillon", color: TEAL  },
  { key: "soluvel",  label: "Soluble",  color: AMBER },
  { key: "torrado",  label: "Roasted",  color: BLUE  },
];

// ── Destination chart constants ───────────────────────────────────────────────

export const TYPE_LABELS: Record<CoffeeType, string> = {
  total:    "Total",
  arabica:  "Arabica",
  conillon: "Conillon",
  soluvel:  "Soluble",
  torrado:  "Roasted",
};

export const DEST_WINDOWS: { label: DestWindow; n: number | null }[] = [
  { label: "L1M",  n: 1  },
  { label: "L3M",  n: 3  },
  { label: "L6M",  n: 6  },
  { label: "L12M", n: 12 },
  { label: "CTD",  n: null },
];

// ── Domestic consumption estimate (USDA/ICO, 1000×60kg bags → kt) ─────────────

export const BRAZIL_DOMESTIC_KT: Record<string, number> = {
  "2005/06": 1062, "2006/07": 1074, "2007/08": 1086, "2008/09": 1104,
  "2009/10": 1116, "2010/11": 1182, "2011/12": 1206, "2012/13": 1236,
  "2013/14": 1260, "2014/15": 1290, "2015/16": 1254, "2016/17": 1278,
  "2017/18": 1314, "2018/19": 1320, "2019/20": 1332, "2020/21": 1338,
  "2021/22": 1380, "2022/23": 1398, "2023/24": 1434, "2024/25": 1446,
};

// ── Daily registration colors ─────────────────────────────────────────────────

export const DAILY_COLORS = {
  current:  "#ef4444",
  prior:    "#f97316",
  ly:       "#22c55e",
  hist:     "#475569",
  solv_cur: "#38bdf8",
  solv_pri: "#7dd3fc",
};
