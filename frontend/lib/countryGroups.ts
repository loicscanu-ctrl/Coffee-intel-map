// Shared country-classification toolbox, keyed by ISO3 so any part of the
// dashboard can reuse it (population cohorts, trade flows, etc.).
//
//  • GEO_HUB        — country → geographic hub (mirrors the Brazil/Indonesia
//                     export-destination hubs so the groupings line up).
//  • PRODUCERS      — coffee-growing countries.
//  • OECD           — OECD member states (proxy for "developed").
//  • ARABICA_MARKET — consuming markets whose cup skews arabica; everything
//                     else is treated as robusta-dominant.
//
// Geographic hub names / colours / order are kept identical to
// components/supply/IndonesiaExports/constants.ts on purpose.

export type GeoHub =
  | "Nordics" | "Central Europe" | "South Europe" | "Eastern Europe"
  | "North America" | "Latin America" | "East Asia" | "SE Asia & Pacific"
  | "Middle East" | "North Africa" | "Sub-Saharan Africa" | "South Asia"
  | "Russia & CIS" | "Other";

export const GEO_HUB: Record<string, GeoHub> = {
  // North America
  USA: "North America", CAN: "North America", MEX: "North America",
  // Nordics
  SWE: "Nordics", NOR: "Nordics", DNK: "Nordics", FIN: "Nordics", ISL: "Nordics",
  // Central Europe
  DEU: "Central Europe", FRA: "Central Europe", GBR: "Central Europe",
  NLD: "Central Europe", BEL: "Central Europe", LUX: "Central Europe",
  IRL: "Central Europe", AUT: "Central Europe", CHE: "Central Europe",
  CZE: "Central Europe", SVK: "Central Europe",
  // South Europe
  ITA: "South Europe", ESP: "South Europe", PRT: "South Europe",
  GRC: "South Europe", HRV: "South Europe", SVN: "South Europe",
  SRB: "South Europe", CYP: "South Europe", MLT: "South Europe",
  // Eastern Europe
  POL: "Eastern Europe", HUN: "Eastern Europe", ROU: "Eastern Europe",
  BGR: "Eastern Europe", EST: "Eastern Europe", LVA: "Eastern Europe",
  LTU: "Eastern Europe", UKR: "Eastern Europe",
  // Russia & CIS
  RUS: "Russia & CIS", BLR: "Russia & CIS", KAZ: "Russia & CIS",
  AZE: "Russia & CIS", GEO: "Russia & CIS", ARM: "Russia & CIS",
  UZB: "Russia & CIS", MDA: "Russia & CIS",
  // East Asia
  CHN: "East Asia", JPN: "East Asia", KOR: "East Asia", TWN: "East Asia",
  HKG: "East Asia", MNG: "East Asia",
  // SE Asia & Pacific
  IDN: "SE Asia & Pacific", VNM: "SE Asia & Pacific", THA: "SE Asia & Pacific",
  PHL: "SE Asia & Pacific", MYS: "SE Asia & Pacific", SGP: "SE Asia & Pacific",
  MMR: "SE Asia & Pacific", KHM: "SE Asia & Pacific", LAO: "SE Asia & Pacific",
  TLS: "SE Asia & Pacific", PNG: "SE Asia & Pacific", AUS: "SE Asia & Pacific",
  NZL: "SE Asia & Pacific",
  // South Asia
  IND: "South Asia", PAK: "South Asia", BGD: "South Asia", LKA: "South Asia",
  NPL: "South Asia",
  // Middle East
  TUR: "Middle East", SAU: "Middle East", ARE: "Middle East", QAT: "Middle East",
  KWT: "Middle East", BHR: "Middle East", OMN: "Middle East", YEM: "Middle East",
  LBN: "Middle East", JOR: "Middle East", ISR: "Middle East", IRQ: "Middle East",
  IRN: "Middle East", SYR: "Middle East",
  // North Africa
  EGY: "North Africa", DZA: "North Africa", MAR: "North Africa",
  TUN: "North Africa", LBY: "North Africa", SDN: "North Africa",
  // Sub-Saharan Africa
  ETH: "Sub-Saharan Africa", UGA: "Sub-Saharan Africa", KEN: "Sub-Saharan Africa",
  TZA: "Sub-Saharan Africa", CIV: "Sub-Saharan Africa", CMR: "Sub-Saharan Africa",
  RWA: "Sub-Saharan Africa", BDI: "Sub-Saharan Africa", COD: "Sub-Saharan Africa",
  COG: "Sub-Saharan Africa", MDG: "Sub-Saharan Africa", TGO: "Sub-Saharan Africa",
  GIN: "Sub-Saharan Africa", SLE: "Sub-Saharan Africa", AGO: "Sub-Saharan Africa",
  CAF: "Sub-Saharan Africa", GHA: "Sub-Saharan Africa", NGA: "Sub-Saharan Africa",
  ZMB: "Sub-Saharan Africa", ZWE: "Sub-Saharan Africa", MWI: "Sub-Saharan Africa",
  ZAF: "Sub-Saharan Africa", SEN: "Sub-Saharan Africa", GAB: "Sub-Saharan Africa",
  LBR: "Sub-Saharan Africa",
  // Latin America & Caribbean
  BRA: "Latin America", COL: "Latin America", HND: "Latin America",
  GTM: "Latin America", PER: "Latin America", NIC: "Latin America",
  CRI: "Latin America", SLV: "Latin America", ECU: "Latin America",
  VEN: "Latin America", BOL: "Latin America", PAN: "Latin America",
  DOM: "Latin America", HTI: "Latin America", CUB: "Latin America",
  JAM: "Latin America", TTO: "Latin America", ARG: "Latin America",
  CHL: "Latin America", URY: "Latin America", PRY: "Latin America",
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

export const HUB_ORDER: GeoHub[] = [
  "Nordics", "Central Europe", "South Europe", "Eastern Europe",
  "North America", "Latin America",
  "East Asia", "SE Asia & Pacific", "Middle East", "North Africa",
  "Sub-Saharan Africa", "South Asia", "Russia & CIS", "Other",
];

// Coffee-growing countries (ICO producers + notable smaller origins).
export const PRODUCERS: ReadonlySet<string> = new Set([
  "BRA", "VNM", "COL", "IDN", "ETH", "HND", "IND", "UGA", "MEX", "GTM",
  "PER", "NIC", "CRI", "CIV", "KEN", "TZA", "PNG", "SLV", "ECU", "CMR",
  "LAO", "MDG", "THA", "VEN", "COD", "RWA", "BDI", "YEM", "DOM", "HTI",
  "CUB", "PAN", "BOL", "PHL", "CHN", "TGO", "GIN", "SLE", "AGO", "CAF",
  "GHA", "NGA", "ZMB", "ZWE", "MWI", "TLS", "NPL", "GAB", "LBR", "COG",
  "TTO", "PRY", "MMR",
]);

// OECD member states (proxy for "developed").
export const OECD: ReadonlySet<string> = new Set([
  "AUS", "AUT", "BEL", "CAN", "CHL", "COL", "CRI", "CZE", "DNK", "EST",
  "FIN", "FRA", "DEU", "GRC", "HUN", "ISL", "IRL", "ISR", "ITA", "JPN",
  "KOR", "LVA", "LTU", "LUX", "MEX", "NLD", "NZL", "NOR", "POL", "PRT",
  "SVK", "SVN", "ESP", "SWE", "CHE", "TUR", "GBR", "USA",
]);

// Markets whose cup skews arabica (lighter roasts, filter/specialty, Gulf
// arabic coffee, origin self-consumption of washed arabica). Everything not
// listed is treated as robusta-dominant (espresso/instant/blends-heavy).
// First-pass classification — easy to tweak here as one source of truth.
export const ARABICA_MARKET: ReadonlySet<string> = new Set([
  // North America + Western/Northern Europe filter cultures
  "USA", "CAN", "SWE", "NOR", "DNK", "FIN", "ISL", "FRA", "GBR", "NLD",
  "BEL", "LUX", "IRL", "AUT", "CHE",
  // Pacific + East Asia specialty
  "JPN", "KOR", "TWN", "HKG", "AUS", "NZL",
  // Gulf (arabic light-roast arabica) + Turkish-style Levant/Anatolia
  "SAU", "ARE", "QAT", "KWT", "BHR", "OMN", "ISR", "LBN", "JOR", "TUR",
  // Arabica-producing origins that drink their own
  "ETH", "KEN", "RWA", "BDI", "TZA", "PNG", "COL", "CRI", "GTM", "HND",
  "SLV", "NIC", "PAN", "PER", "ECU", "BOL", "MEX", "DOM", "JAM", "CHL",
  "ARG", "URY",
]);

// ── Aggregation modes for "View by" selectors ───────────────────────────────
export type AggMode = "individual" | "geo" | "producing" | "development" | "consuming";

export interface AggGroup {
  key: string;        // stable series key
  label: string;      // legend label
  color: string;      // line colour
}

const TWO_TONE = {
  yes: "#34d399",  // emerald
  no:  "#f87171",  // rose
};

// Resolve the group a country belongs to under a given aggregation mode.
export function groupFor(iso3: string, mode: AggMode): AggGroup | null {
  const id = iso3.toUpperCase();
  switch (mode) {
    case "geo": {
      const hub = GEO_HUB[id] ?? "Other";
      return { key: hub, label: hub, color: HUB_COLORS[hub] ?? HUB_COLORS.Other };
    }
    case "producing": {
      const p = PRODUCERS.has(id);
      return p
        ? { key: "producing", label: "Producing countries", color: TWO_TONE.yes }
        : { key: "nonproducing", label: "Non-producing countries", color: TWO_TONE.no };
    }
    case "development": {
      const o = OECD.has(id);
      return o
        ? { key: "oecd", label: "OECD", color: TWO_TONE.yes }
        : { key: "developing", label: "Developing", color: TWO_TONE.no };
    }
    case "consuming": {
      const a = ARABICA_MARKET.has(id);
      return a
        ? { key: "arabica", label: "Arabica-dominant", color: "#f59e0b" }
        : { key: "robusta", label: "Robusta-dominant", color: "#78350f" };
    }
    default:
      return null;
  }
}

// Order groups appear in the legend / chips for a mode.
export function groupOrder(mode: AggMode): string[] {
  switch (mode) {
    case "geo":          return HUB_ORDER.slice();
    case "producing":    return ["producing", "nonproducing"];
    case "development":  return ["oecd", "developing"];
    case "consuming":    return ["arabica", "robusta"];
    default:             return [];
  }
}
