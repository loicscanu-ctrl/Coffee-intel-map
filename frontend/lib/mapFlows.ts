// Helpers for the optional "Export flows" and "Freight flows" overlays
// on the world map. Each origin (Brazil / Vietnam / Indonesia) has its
// own destination-name encoding from upstream — Cecafe uses Portuguese,
// VN Customs uses titlecase English, and Indonesia's Comex feed uses
// UPPERCASE English with a few format quirks ("VIET NAM", "GERMANY,
// FED. REP. OF"). Rather than collapse them into a single normalised
// alphabet, we keep three explicit hub lookups so the per-country naming
// stays auditable in one place.

// Approximate destination-hub anchor points. Used as the arc endpoint for
// every per-origin export-flow visualization. Hubs that already have a
// HUB_PORTS entry in lib/mapData reuse that coordinate; the rest are
// gravity points at a representative consumption / re-export node.
export const HUB_LL: Record<string, [number, number]> = {
  "Nordics":            [55.68, 12.57],   // Copenhagen
  "Central Europe":     [51.22, 4.40],    // Antwerp — ANR cluster
  "South Europe":       [44.41, 8.93],    // Genoa
  "Eastern Europe":     [54.35, 18.65],   // Gdansk
  "North America":      [38.00, -97.00],  // mid-USA, matches imports-lab DEST.US
  "Latin America":      [10.40, -75.50],  // Cartagena
  "East Asia":          [35.60, 139.60],  // Tokyo
  "SE Asia & Pacific":  [1.20,  103.80],  // Singapore
  "Middle East":        [25.27,  55.30],  // Dubai
  "North Africa":       [36.77,   3.06],  // Algiers
  "Sub-Saharan Africa": [-4.00,  39.60],  // Mombasa
  "South Asia":         [13.08,  80.27],  // Chennai
  "Russia & CIS":       [59.94,  30.32],  // St Petersburg
};

// Approximate centroids of the three exporting origins, used as arc start.
export const ORIGIN_LL: Record<"BR" | "VN" | "ID", [number, number]> = {
  BR: [-10, -52],
  VN: [16,  106],
  ID: [-2,  118],
};

// One brand colour per export-flow origin so multiple can be turned on
// without visually fusing. Kept distinct from the import-flow palette
// (US sky-blue / EU amber).
export const ORIGIN_COLOR: Record<"BR" | "VN" | "ID", string> = {
  BR: "#10b981",   // emerald — Brazil
  VN: "#ef4444",   // red     — Vietnam
  ID: "#fb923c",   // orange  — Indonesia
};

// Indonesia → hub map. Uses the exact uppercase names that show up in
// indonesia_exports.json series[].by_destination so a destination either
// matches exactly or simply doesn't get an arc (no silent miscounts).
export const IN_HUB_COUNTRIES: Record<string, string[]> = {
  "Nordics":            ["DENMARK","FINLAND","ICELAND","NORWAY","SWEDEN"],
  "Central Europe":     ["GERMANY","GERMANY, FED. REP. OF","BELGIUM","FRANCE","IRELAND","LUXEMBOURG","NETHERLANDS","UNITED KINGDOM","AUSTRIA","SWITZERLAND"],
  "South Europe":       ["ALBANIA","BOSNIA AND HERZEGOVINA","CYPRUS","CROATIA","SPAIN","SLOVENIA","GREECE","ITALY","MALTA","MONTENEGRO","PORTUGAL","SERBIA"],
  "Eastern Europe":     ["BULGARIA","ESTONIA","LATVIA","LITHUANIA","POLAND","ROMANIA","UKRAINE","CZECH REPUBLIC","SLOVAKIA"],
  "North America":      ["CANADA","UNITED STATES","MEXICO"],
  "Latin America":      ["ARGENTINA","BRAZIL","CHILE","COLOMBIA","COSTA RICA","CUBA","ECUADOR","EL SALVADOR","GUATEMALA","PANAMA","PERU","DOMINICAN REPUBLIC","URUGUAY","VENEZUELA"],
  "East Asia":          ["CHINA","KOREA, REPUBLIC OF","HONG KONG","JAPAN","MACAU","MONGOLIA","TAIWAN"],
  "SE Asia & Pacific":  ["AUSTRALIA","BRUNEI DARUSSALAM","CAMBODIA","FIJI","PHILIPPINES","MALAYSIA","MYANMAR","NEW ZEALAND","SINGAPORE","THAILAND","VIET NAM","VIETNAM"],
  "Middle East":        ["SAUDI ARABIA","BAHRAIN","DJIBOUTI","UNITED ARAB EMIRATES","IRAN (ISLAMIC REPUBLIC OF)","IRAQ","ISRAEL","JORDAN","KUWAIT","LEBANON","OMAN","PALESTINE","QATAR","SYRIAN ARAB REPUBLIC","TURKEY","YEMEN"],
  "North Africa":       ["ALGERIA","EGYPT","LIBYA","MOROCCO","TUNISIA"],
  "Sub-Saharan Africa": ["SOUTH AFRICA","ANGOLA","CABO VERDE","COTE D'IVOIRE","GHANA","MADAGASCAR","MAURITIUS","NIGERIA","KENYA","RWANDA","SENEGAL","SOMALIA","UGANDA"],
  "South Asia":         ["BANGLADESH","INDIA","MALDIVES","PAKISTAN","SRI LANKA"],
  "Russia & CIS":       ["ARMENIA","AZERBAIJAN","BELARUS","KAZAKHSTAN","GEORGIA","RUSSIA","RUSSIA FEDERATION","UZBEKISTAN"],
};

// Aggregate one origin's monthly export volume by destination hub, given
// a country→volume reducer that walks the source-specific JSON shape.
// `summedPerCountry` is the {countryName → totalVolume} map after the
// caller has done the time-window aggregation in the source's natural
// shape (Cecafe months × countries vs VN months × countries vs Indonesia
// series×by_destination). Returns one row per hub with non-zero volume.
export function aggregateByHub(
  summedPerCountry: Record<string, number>,
  hubMap: Record<string, string[]>,
): Array<{ hub: string; volume: number }> {
  return Object.entries(hubMap)
    .map(([hub, countries]) => ({
      hub,
      volume: countries.reduce((s, c) => s + (summedPerCountry[c] ?? 0), 0),
    }))
    .filter(x => x.volume > 0);
}

// ── Freight ─────────────────────────────────────────────────────────────────

// Lat/lng for every port that appears in freight.json.routes.from/to. Kept
// inline (not in lib/mapData PORTS) because Rotterdam isn't a coffee
// loading port and adding it to PORTS would muddy that list's purpose.
export const FREIGHT_PORT_LL: Record<string, [number, number]> = {
  "Ho Chi Minh": [10.70, 106.60],
  "Santos":      [-23.90, -46.30],
  "Cartagena":   [10.40, -75.50],
  "Djibouti":    [11.82,  43.14],
  "Rotterdam":   [51.95,   4.14],
  "Hamburg":     [53.55,   9.99],
  "Los Angeles": [33.70, -118.20],
  "New York":    [40.70, -74.00],
};

export interface FreightRoute {
  id:    string;
  from:  string;
  to:    string;
  rate:  number;
  prev?: number;
  unit?: string;
  proxy?: boolean;
}

// Per-route colour by WoW direction. Uses the same green/red palette as
// the freight markers already on the map (CoffeeMap.tsx line ~754) so the
// two overlays read as one visual language.
export function freightArcColor(rate: number, prev?: number): string {
  if (prev == null || prev === 0) return "#94a3b8";
  const pct = (rate - prev) / prev;
  return pct > 0.005 ? "#22c55e" : pct < -0.005 ? "#ef4444" : "#94a3b8";
}
