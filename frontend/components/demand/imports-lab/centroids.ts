// Approx country centroids [lat, lng] for the sourcing flow map. Keyed by a
// normalised name so we can match USITC / Eurostat / Comtrade country labels.
// Unknown origins simply don't get an arc.
export const CENTROIDS: Record<string, [number, number]> = {
  brazil: [-10, -52], colombia: [4, -73], vietnam: [16, 106], honduras: [15, -86.5],
  guatemala: [15.5, -90.3], mexico: [23, -102], peru: [-10, -76], nicaragua: [12.9, -85],
  ethiopia: [9, 39], indonesia: [-2, 118], india: [22, 79], uganda: [1.3, 32.3],
  "costa rica": [9.9, -84], kenya: [0.2, 37.9], tanzania: [-6.3, 34.8],
  "papua new guinea": [-6.3, 145], "el salvador": [13.8, -88.9], rwanda: [-2, 29.9],
  burundi: [-3.4, 29.9], "cote d'ivoire": [7.5, -5.5], "ivory coast": [7.5, -5.5],
  cameroon: [5.7, 12.7], "congo (kinshasa)": [-2.9, 23.6], "democratic republic of the congo": [-2.9, 23.6],
  laos: [18, 105.4], thailand: [15.1, 101], ecuador: [-1.5, -78.4], bolivia: [-16.7, -64.7],
  venezuela: [7, -66], "dominican republic": [19, -70.5], yemen: [15.5, 48],
  philippines: [12.9, 122], myanmar: [21, 96], "burma": [21, 96], panama: [8.5, -80.1],
  cuba: [21.5, -78], haiti: [19, -72.4], madagascar: [-19, 46.7], togo: [8.6, 1],
  "sierra leone": [8.5, -11.8], guinea: [10.4, -10.9], angola: [-12, 18], malawi: [-13.3, 34.3],
  zambia: [-14, 27.8], nigeria: [9.1, 8.7], ghana: [7.9, -1], "timor-leste": [-8.8, 125.7],
  "east timor": [-8.8, 125.7], nepal: [28.4, 84], china: [35, 105], "papua n guinea": [-6.3, 145],
  jamaica: [18.1, -77.3], "trinidad and tobago": [10.5, -61.3], paraguay: [-23.4, -58.4],
  "sri lanka": [7.9, 80.8], "el salvador ": [13.8, -88.9],
};

// Destination anchor points for the arcs.
export const DEST: Record<string, { name: string; ll: [number, number] }> = {
  US: { name: "United States", ll: [38, -97] },
  EU: { name: "European Union", ll: [50.5, 9] },   // ~Frankfurt, EU import gravity
};

export function normalizeCountry(s: string): string {
  return s.toLowerCase().trim()
    .replace(/\(.*?\)/g, "")
    .replace(/,.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function centroidFor(name: string): [number, number] | null {
  return CENTROIDS[normalizeCountry(name)] ?? null;
}
