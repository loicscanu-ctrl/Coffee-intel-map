// Lookup tables, palettes, and shared style tokens for the Brazil tab.

import type { CountryYear, CoffeeType, DestWindow, SeriesKey } from "./types";

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

// ── Calendar / crop-year helpers ──────────────────────────────────────────────

export const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Crop month order: Apr(4)…Dec(12), Jan(1)…Mar(3)
export const CROP_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
export const CROP_MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

// ── Color tokens ──────────────────────────────────────────────────────────────

export const GREEN = "#22c55e";
export const AMBER = "#f59e0b";
export const BLUE  = "#60a5fa";
export const SLATE = "#94a3b8";
export const TEAL  = "#2dd4bf";

// Crop-year period palette: index 0 = most recent, ascending = older
export const CROP_YEAR_COLORS = [
  "#ef4444",  // current    — red
  "#f97316",  // prior-1    — dark orange
  "#60a5fa",  // prior-2    — blue
  "#64748b",  // prior-3    — gray
  "#475569",  // prior-4    — darker gray
  "#334155",  // prior-5    — darkest gray
];

export const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

// ── Brazil domestic consumption (USDA/ICO estimates, 1000×60kg bags → kt) ────

export const BRAZIL_DOMESTIC_KT: Record<string, number> = {
  "2005/06": 1062, "2006/07": 1074, "2007/08": 1086, "2008/09": 1104,
  "2009/10": 1116, "2010/11": 1182, "2011/12": 1206, "2012/13": 1236,
  "2013/14": 1260, "2014/15": 1290, "2015/16": 1254, "2016/17": 1278,
  "2017/18": 1314, "2018/19": 1320, "2019/20": 1332, "2020/21": 1338,
  "2021/22": 1380, "2022/23": 1398, "2023/24": 1434, "2024/25": 1446,
};

// ── Chart-specific palettes ───────────────────────────────────────────────────

export const DAILY_COLORS = {
  current:  "#ef4444",  // red    — current month
  prior:    "#f97316",  // orange — prior month (Mes interior)
  ly:       "#22c55e",  // green  — same month last year
  hist:     "#475569",  // slate  — historical same-month
  solv_cur: "#38bdf8",  // sky    — soluvel current month
  solv_pri: "#7dd3fc",  // light sky — soluvel prior month
};

export const TYPE_SERIES = [
  { key: "arabica"  as const, label: "Arabica",  color: GREEN },
  { key: "conillon" as const, label: "Conillon", color: TEAL  },
  { key: "soluvel"  as const, label: "Soluble",  color: AMBER },
  { key: "torrado"  as const, label: "Roasted",  color: BLUE  },
];

export const TYPE_FILTER_OPTS: { key: SeriesKey; label: string; color: string }[] = [
  { key: "arabica",  label: "Arabica",  color: GREEN },
  { key: "conillon", label: "Conillon", color: TEAL  },
  { key: "soluvel",  label: "Soluble",  color: AMBER },
  { key: "torrado",  label: "Roasted",  color: BLUE  },
];

export const TYPE_LABELS: Record<CoffeeType, string> = {
  total:    "Total",
  arabica:  "Arabica",
  conillon: "Conillon",
  soluvel:  "Soluble",
  torrado:  "Roasted",
};

// ── Rolling-window comparison ─────────────────────────────────────────────────

// Ordered L1M → MAT (most recent on left, long-term reference on right)
export const WINDOWS = [
  { label: "L1M", n: 1  },
  { label: "L3M", n: 3  },
  { label: "L6M", n: 6  },
  { label: "MAT", n: 12 },
];

export const WINDOW_COLORS: Record<string, string> = {
  "MAT": "#475569",
  "L6M": "#64748b",
  "L3M": BLUE,
  "L1M": GREEN,
};

// ── Destination chart windows ─────────────────────────────────────────────────

export const DEST_WINDOWS: { label: DestWindow; n: number | null }[] = [
  { label: "L1M",  n: 1  },
  { label: "L3M",  n: 3  },
  { label: "L6M",  n: 6  },
  { label: "L12M", n: 12 },
  { label: "CTD",  n: null },
];

export const EMPTY_CY: CountryYear = { months: [], countries: {} };
