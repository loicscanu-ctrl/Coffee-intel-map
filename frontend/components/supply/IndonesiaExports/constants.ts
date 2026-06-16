// Lookup tables, palettes, and shared style tokens for Indonesia exports.

import type { CountryYear, DestWindow, SeriesKey } from "./types";

// ── Hub groupings: Indonesia destinations are in English (BPS publishes
// uppercase strings like "BELGIUM" / "UNITED STATES" / "GERMANY, FED. REP. OF").
// The hub map mirrors Brazil's regional groupings but is keyed in English.

export const COUNTRY_HUB: Record<string, string> = {
  // Nordics
  "DENMARK":          "Nordics",
  "FINLAND":          "Nordics",
  "ICELAND":          "Nordics",
  "NORWAY":           "Nordics",
  "SWEDEN":           "Nordics",
  // Central Europe
  "BELGIUM":                  "Central Europe",
  "FRANCE":                   "Central Europe",
  "GERMANY, FED. REP. OF":    "Central Europe",
  "GERMANY":                  "Central Europe",
  "IRELAND":                  "Central Europe",
  "LUXEMBOURG":               "Central Europe",
  "NETHERLANDS":              "Central Europe",
  "UNITED KINGDOM":           "Central Europe",
  "CZECH REPUBLIC":           "Central Europe",
  "SLOVAKIA":                 "Central Europe",
  "SWITZERLAND":              "Central Europe",
  "AUSTRIA":                  "Central Europe",
  // South Europe
  "ALBANIA":          "South Europe",
  "BOSNIA":           "South Europe",
  "CYPRUS":           "South Europe",
  "CROATIA":          "South Europe",
  "SPAIN":            "South Europe",
  "SLOVENIA":         "South Europe",
  "GREECE":           "South Europe",
  "ITALY":            "South Europe",
  "MALTA":            "South Europe",
  "MONTENEGRO":       "South Europe",
  "PORTUGAL":         "South Europe",
  "SERBIA":           "South Europe",
  // Eastern Europe
  "BULGARIA":         "Eastern Europe",
  "ESTONIA":          "Eastern Europe",
  "LATVIA":           "Eastern Europe",
  "LITHUANIA":        "Eastern Europe",
  "POLAND":           "Eastern Europe",
  "ROMANIA":          "Eastern Europe",
  "UKRAINE":          "Eastern Europe",
  // North America
  "CANADA":           "North America",
  "UNITED STATES":    "North America",
  "MEXICO":           "North America",
  // Latin America
  "ARGENTINA":             "Latin America",
  "BOLIVIA":               "Latin America",
  "CHILE":                 "Latin America",
  "COLOMBIA":              "Latin America",
  "COSTA RICA":            "Latin America",
  "CUBA":                  "Latin America",
  "ECUADOR":               "Latin America",
  "EL SALVADOR":           "Latin America",
  "GUATEMALA":             "Latin America",
  "GUYANA":                "Latin America",
  "JAMAICA":               "Latin America",
  "NICARAGUA":             "Latin America",
  "PANAMA":                "Latin America",
  "PARAGUAY":              "Latin America",
  "PERU":                  "Latin America",
  "DOMINICAN REPUBLIC":    "Latin America",
  "SURINAME":              "Latin America",
  "URUGUAY":               "Latin America",
  "VENEZUELA":             "Latin America",
  "CAPE VERDE":            "Latin America",
  // East Asia
  "CHINA":                "East Asia",
  "KOREA, REPUBLIC OF":   "East Asia",
  "KOREA":                "East Asia",
  "HONG KONG":            "East Asia",
  "JAPAN":                "East Asia",
  "MACAU":                "East Asia",
  "MONGOLIA":             "East Asia",
  "TAIWAN":               "East Asia",
  // SE Asia & Pacific
  "AUSTRALIA":         "SE Asia & Pacific",
  "BRUNEI":            "SE Asia & Pacific",
  "BRUNEI DARUSSALAM": "SE Asia & Pacific",
  "CAMBODIA":          "SE Asia & Pacific",
  "FIJI":              "SE Asia & Pacific",
  "PHILIPPINES":       "SE Asia & Pacific",
  "MALAYSIA":          "SE Asia & Pacific",
  "MYANMAR":           "SE Asia & Pacific",
  "NEW ZEALAND":       "SE Asia & Pacific",
  "SINGAPORE":         "SE Asia & Pacific",
  "THAILAND":          "SE Asia & Pacific",
  "VIET NAM":          "SE Asia & Pacific",
  "VIETNAM":           "SE Asia & Pacific",
  // Middle East
  "SAUDI ARABIA":             "Middle East",
  "BAHRAIN":                  "Middle East",
  "DJIBOUTI":                 "Middle East",
  "UNITED ARAB EMIRATES":     "Middle East",
  "IRAN (ISLAMIC REPUBLIC OF)": "Middle East",
  "IRAN":                     "Middle East",
  "IRAQ":                     "Middle East",
  "ISRAEL":                   "Middle East",
  "JORDAN":                   "Middle East",
  "KUWAIT":                   "Middle East",
  "LEBANON":                  "Middle East",
  "OMAN":                     "Middle East",
  "PALESTINE":                "Middle East",
  "QATAR":                    "Middle East",
  "SYRIA":                    "Middle East",
  "TURKEY":                   "Middle East",
  "YEMEN":                    "Middle East",
  // North Africa
  "ALGERIA":          "North Africa",
  "EGYPT":            "North Africa",
  "LIBYA":            "North Africa",
  "MOROCCO":          "North Africa",
  "TUNISIA":          "North Africa",
  "SUDAN":            "North Africa",
  // Sub-Saharan Africa
  "SOUTH AFRICA":     "Sub-Saharan Africa",
  "ANGOLA":           "Sub-Saharan Africa",
  "IVORY COAST":      "Sub-Saharan Africa",
  "GHANA":            "Sub-Saharan Africa",
  "MADAGASCAR":       "Sub-Saharan Africa",
  "MAURITIUS":        "Sub-Saharan Africa",
  "NIGERIA":          "Sub-Saharan Africa",
  "KENYA":            "Sub-Saharan Africa",
  "RWANDA":           "Sub-Saharan Africa",
  "SENEGAL":          "Sub-Saharan Africa",
  "SOMALIA":          "Sub-Saharan Africa",
  "UGANDA":           "Sub-Saharan Africa",
  "TANZANIA":         "Sub-Saharan Africa",
  // South Asia
  "BANGLADESH":       "South Asia",
  "INDIA":            "South Asia",
  "MALDIVES":         "South Asia",
  "PAKISTAN":         "South Asia",
  "SRI LANKA":        "South Asia",
  "NEPAL":            "South Asia",
  "AFGHANISTAN":      "South Asia",
  // Russia & CIS
  "ARMENIA":              "Russia & CIS",
  "AZERBAIJAN":           "Russia & CIS",
  "BELARUS":              "Russia & CIS",
  "KAZAKHSTAN":           "Russia & CIS",
  "GEORGIA":              "Russia & CIS",
  "RUSSIA FEDERATION":    "Russia & CIS",
  "RUSSIAN FEDERATION":   "Russia & CIS",
  "UZBEKISTAN":           "Russia & CIS",
  "KYRGYZSTAN":           "Russia & CIS",
  "TAJIKISTAN":           "Russia & CIS",
  "TURKMENISTAN":         "Russia & CIS",
  "MOLDOVA":              "Russia & CIS",
};

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

export const HUB_ORDER = [
  "Nordics","Central Europe","South Europe","Eastern Europe",
  "North America","Latin America",
  "East Asia","SE Asia & Pacific","Middle East","North Africa",
  "Sub-Saharan Africa","South Asia","Russia & CIS","Other",
];

// ── Port groupings (origin side of Indonesia) ──────────────────────────────
// Treat Indonesia's main loading ports as "hubs" the same way Brazil's
// destinations get grouped — but here they're origin clusters, not foreign
// regions. Useful when toggling DestinationChart's hub view in port mode.

export const PORT_ISLAND: Record<string, string> = {
  "PANJANG":              "Sumatra",
  "BELAWAN":              "Sumatra",
  "MUSI RIVER/BOOM BARU": "Sumatra",
  "KUALA TANJUNG":        "Sumatra",
  "BRANTI (U)":           "Sumatra",
  "SELAT PANJANG":        "Sumatra",
  "DUMAI":                "Sumatra",
  "PALEMBANG":            "Sumatra",
  "TANJUNG PRIOK":        "Java",
  "TANJUNG PERAK":        "Java",
  "TANJUNG EMAS":         "Java",
  "JAKARTA / PASAR IKAN": "Java",
  "JAKARTA \\/ PASAR IKAN": "Java",
  "SOEKARNO-HATTA (U)":   "Java",
  "MAKASSAR":             "Sulawesi",
  "BITUNG":               "Sulawesi",
  "NGURAH RAI (U)":       "Bali / Nusa Tenggara",
  "BENOA":                "Bali / Nusa Tenggara",
  "AMBON":                "Maluku",
};

export const ISLAND_COLORS: Record<string, string> = {
  "Sumatra":              "#22c55e",
  "Java":                 "#f97316",
  "Sulawesi":             "#a78bfa",
  "Bali / Nusa Tenggara": "#fcd34d",
  "Maluku":               "#34d399",
  "Other":                "#475569",
};

export const ISLAND_ORDER = [
  "Java","Sumatra","Sulawesi","Bali / Nusa Tenggara","Maluku","Other",
];

// ── Calendar / crop-year helpers ──────────────────────────────────────────────

export const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Crop month order: Apr(4)…Dec(12), Jan(1)…Mar(3) — mirrors Brazil so the
// existing chart layouts (heatmap, cumulative pace) can be reused 1:1.
export const CROP_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
export const CROP_MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

// ── Color tokens ──────────────────────────────────────────────────────────────

export const GREEN  = "#22c55e";
export const AMBER  = "#f59e0b";
export const BLUE   = "#60a5fa";
export const SLATE  = "#94a3b8";
export const ORANGE = "#f97316";

// Crop-year period palette (index 0 = most recent, ascending = older).
export const CROP_YEAR_COLORS = [
  "#ef4444",  // current   — red
  "#f97316",  // prior-1   — orange
  "#60a5fa",  // prior-2   — blue
  "#64748b",  // prior-3   — gray
  "#475569",  // prior-4   — darker gray
  "#334155",  // prior-5   — darkest gray
];

export const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 11 };

// ── Type palette: arabica / robusta / other ────────────────────────────────

export const TYPE_FILTER_OPTS: { key: SeriesKey; label: string; color: string }[] = [
  { key: "arabica", label: "Arabica", color: BLUE   },
  { key: "robusta", label: "Robusta", color: ORANGE },
  { key: "other",   label: "Other",   color: SLATE  },
];

export const TYPE_LABELS: Record<SeriesKey, string> = {
  total:   "Total",
  arabica: "Arabica",
  robusta: "Robusta",
  other:   "Other",
};

// ── Rolling-window comparison ─────────────────────────────────────────────────

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

// ── Destination-chart windows ─────────────────────────────────────────────────

export const DEST_WINDOWS: { label: DestWindow; n: number | null }[] = [
  { label: "L1M",  n: 1  },
  { label: "L3M",  n: 3  },
  { label: "L6M",  n: 6  },
  { label: "L12M", n: 12 },
  { label: "CTD",  n: null },
];

export const EMPTY_CY: CountryYear = { months: [], countries: {} };
