// Trade-flow matching engine: origin-reported exports (Cecafe, VN customs) vs
// destination-reported imports (Eurostat per-origin, USITC monthly-by-origin)
// for the big-4 pairs — Brazil & Vietnam → EU, US, Japan.
//
// For each pair we (a) estimate the reporting lag that best aligns the two
// series (cross-correlation over 0–3 months) as *evidence the match is real*,
// (b) measure how much of exports the destination captures over 12 months,
// and (c) estimate the coffee currently ON THE WATER as
//     in_transit ≈ recent export rate × physical voyage days / 30.4.
// Voyage days come from the freight-lane table (physical constant); the
// correlation lag is reporting-to-reporting and is shown as evidence, not used
// for tonnage. All computation is client-side over already-published JSONs.

export interface TradeFlow {
  origin: "Brazil" | "Vietnam" | "Indonesia" | "Uganda";
  dest: "EU" | "US" | "Japan";
  exportRateMt: number;        // avg of the last 2 reported export months
  lastExportMonth: string;
  transitDays: number;         // physical voyage estimate (freight lanes)
  inTransitMt: number;         // exportRate × transitDays/30.4
  lagMonths: number | null;    // best cross-correlation lag (evidence)
  corr: number | null;
  matchRatio: number | null;   // dest-reported imports / exports, last 12 common months
  path: [number, number][];    // sea-lane waypoints (lng may exceed 180 for the Pacific crossing)
}

// ── sea-lane paths (composed from the map's route waypoints) ─────────────────
const SANTOS_TRUNK: [number, number][] = [
  [-23.95, -46.3], [-18, -38], [-10, -32], [-5, -32], [5, -22], [15, -18], [25, -15],
  [33, -12], [37, -12], [43, -11], [48, -7], [50, -1], [51.2, 1.8], [52, 3],
];
const PATHS: Record<string, [number, number][]> = {
  "Brazil-EU": [...SANTOS_TRUNK, [51.8, 3.5], [51.22, 4.4]],
  "Brazil-US": [
    [-23.95, -46.3], [-18, -38], [-10, -32], [-5, -32], [0, -38], [5, -45],
    [15, -50], [25, -60], [33, -72], [38, -73], [40.5, -73.8],
  ],
  "Brazil-Japan": [
    [-23.95, -46.3], [-28, -40], [-36, -20], [-37, 0], [-37, 15], [-36, 18.5], [-36, 22],
    [-37, 35], [-32, 50], [-20, 55], [-10, 60], [-3, 70], [4, 78], [5.8, 80.4],
    [5.8, 95.5], [5.5, 98], [3, 100.5], [1.26, 103.8], [8, 110], [15, 116],
    [22, 123], [30, 128], [33, 134], [35.61, 139.78],
  ],
  "Vietnam-EU": [
    [10.76, 106.78], [8, 106], [3, 105], [1.26, 103.8], [3, 100.5], [5.5, 98], [5.8, 95.5],
    [5.8, 80.4], [10, 65], [14, 55], [12.5, 45], [12.6, 43.3], [18, 40], [22, 38],
    [27, 34.5], [29.5, 32.55], [31.2, 32.3], [32.5, 31], [34, 25], [36, 15], [37.5, 10],
    [37.5, 3], [37, 0], [36, -5.3], [37, -10], [43, -11], [48, -7], [49.5, -3.5],
    [50, -1], [50.5, 0], [51.2, 1.8], [52, 3], [51.8, 3.5], [51.26, 4.35],
  ],
  // lngs unwrapped past 180 so interpolation crosses the Pacific, not the map.
  "Vietnam-US": [
    [10.76, 106.78], [8, 110], [15, 125], [22, 138], [30, 150], [38, 158],
    [30, 175], [22, 195], [26, 212], [30, 227], [33.7, 241.8],
  ],
  "Vietnam-Japan": [
    [10.76, 106.78], [8, 110], [15, 116], [22, 123], [30, 128], [33, 134], [35.61, 139.78],
  ],
  "Indonesia-EU": [
    [-6.1, 106.88], [-3, 106], [1.26, 103.8], [3, 100.5], [5.5, 98], [5.8, 95.5],
    [5.8, 80.4], [10, 65], [14, 55], [12.5, 45], [12.6, 43.3], [18, 40], [22, 38],
    [27, 34.5], [29.5, 32.55], [31.2, 32.3], [32.5, 31], [34, 25], [36, 15], [37.5, 10],
    [37.5, 3], [37, 0], [36, -5.3], [37, -10], [43, -11], [48, -7], [49.5, -3.5],
    [50, -1], [50.5, 0], [51.2, 1.8], [52, 3], [51.8, 3.5], [51.26, 4.35],
  ],
  "Indonesia-US": [
    [-6.1, 106.88], [-3, 106], [1.26, 103.8], [8, 112], [15, 125], [22, 138], [30, 150],
    [38, 158], [30, 175], [22, 195], [26, 212], [30, 227], [33.7, 241.8],
  ],
  "Indonesia-Japan": [
    [-6.1, 106.88], [-3, 106], [1.26, 103.8], [8, 110], [15, 116], [22, 123],
    [30, 128], [33, 134], [35.61, 139.78],
  ],
  // Kampala → rail/road → Mombasa → Red Sea → Suez → Antwerp.
  "Uganda-EU": [
    [0.31, 32.58], [-1.29, 36.82], [-4.04, 39.66], [-4, 42], [0, 48], [5, 55],
    [12, 52], [12.5, 45], [12.6, 43.3], [18, 40], [22, 38], [27, 34.5],
    [29.5, 32.55], [31.2, 32.3], [32.5, 31], [34, 25], [36, 15], [37.5, 10],
    [37.5, 3], [37, 0], [36, -5.3], [37, -10], [43, -11], [48, -7], [49.5, -3.5],
    [50, -1], [50.5, 0], [51.2, 1.8], [52, 3], [51.8, 3.5], [51.26, 4.35],
  ],
};

// Physical voyage estimates (days) per lane — freight-route table.
const TRANSIT_DAYS: Record<string, number> = {
  "Brazil-EU": 19, "Brazil-US": 15, "Brazil-Japan": 35,
  "Vietnam-EU": 27, "Vietnam-US": 30, "Vietnam-Japan": 12,
  "Indonesia-EU": 30, "Indonesia-US": 24, "Indonesia-Japan": 9,
  "Uganda-EU": 26,   // incl. the Kampala→Mombasa inland leg
};

// ── destination country groupings in each export source's own naming ─────────
const EU_PT = ["ALEMANHA", "AUSTRIA", "BELGICA", "BULGARIA", "CROACIA", "CHIPRE",
  "REPUBL. TCHECA", "DINAMARCA", "ESLOVAQUIA", "ESLOVENIA", "ESPANHA", "ESTONIA",
  "FINLANDIA", "FRANCA", "GRECIA", "HUNGRIA", "IRLANDA", "ITALIA", "LETONIA (LATVIA)",
  "LITUANIA", "LUXEMBURGO", "MALTA", "PAISES BAIXOS (HOLANDA)", "POLONIA", "PORTUGAL",
  "ROMENIA", "SUECIA"];
const EU_EN = ["Germany", "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus",
  "Czech Republic", "Czechia", "Denmark", "Slovakia", "Slovenia", "Spain", "Estonia",
  "Finland", "France", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania",
  "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Sweden"];

// Indonesia's BPS file uses UPPERCASE English country names.
const EU_UPPER = EU_EN.map(n => n.toUpperCase());

type Series = Record<string, number>;   // {"YYYY-MM": MT}

const shiftMonth = (m: string, k: number): string => {
  let [y, mo] = m.split("-").map(Number);
  mo -= k;
  while (mo < 1) { mo += 12; y -= 1; }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}`;
};

function corrAtLag(exp: Series, imp: Series, lag: number): { r: number; n: number } | null {
  const xs: number[] = [], ys: number[] = [];
  for (const [m, iv] of Object.entries(imp)) {
    const ev = exp[shiftMonth(m, lag)];
    if (ev && iv) { xs.push(ev); ys.push(iv); }
  }
  const n = xs.length;
  if (n < 8) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  const num = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0) * ys.reduce((s, v) => s + (v - my) ** 2, 0));
  return { r: den ? num / den : 0, n };
}

function analysePair(origin: TradeFlow["origin"], dest: TradeFlow["dest"],
                     exp: Series, imp: Series): TradeFlow | null {
  const months = Object.keys(exp).filter(m => exp[m] > 0).sort();
  if (months.length < 2) return null;
  const lastTwo = months.slice(-2);
  const exportRateMt = lastTwo.reduce((s, m) => s + exp[m], 0) / lastTwo.length;

  let lagMonths: number | null = null, corr: number | null = null;
  for (const lag of [0, 1, 2, 3]) {
    const c = corrAtLag(exp, imp, lag);
    if (c && (corr == null || c.r > corr)) { corr = c.r; lagMonths = lag; }
  }
  const common = Object.keys(imp).filter(m => exp[m] > 0).sort().slice(-12);
  const expSum = common.reduce((s, m) => s + exp[m], 0);
  const matchRatio = expSum > 0 ? common.reduce((s, m) => s + imp[m], 0) / expSum : null;

  const key = `${origin}-${dest}`;
  const transitDays = TRANSIT_DAYS[key];
  return {
    origin, dest, exportRateMt, lastExportMonth: months[months.length - 1],
    transitDays, inTransitMt: exportRateMt * transitDays / 30.4,
    lagMonths: corr != null ? lagMonths : null, corr, matchRatio,
    path: PATHS[key],
  };
}

// ── data loading ──────────────────────────────────────────────────────────────
interface CecafeCY { months: string[]; countries: Record<string, Record<string, number>> }

async function j(url: string): Promise<unknown | null> {
  try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
}

interface IdRow { month: string; by_destination?: { country: string; kg?: number }[] }
interface UgRow { month: string; by_destination?: { country: string; bags?: number }[] }

export async function fetchTradeFlows(): Promise<TradeFlow[]> {
  const [cecafe, vn, eu, us, id, ug] = await Promise.all([
    j("/data/cecafe.json") as Promise<{ by_country?: CecafeCY; by_country_prev?: CecafeCY } | null>,
    j("/data/vn_export_by_destination.json") as Promise<{ countries?: Record<string, Series> } | null>,
    j("/data/eu_coffee_imports.json") as Promise<{ origins?: { name: string; monthly?: Series }[] } | null>,
    j("/data/us_coffee_imports.json") as Promise<{ monthly_origins?: Record<string, Series> } | null>,
    j("/data/indonesia_exports.json") as Promise<{ series?: IdRow[] } | null>,
    j("/data/uganda_monthly.json") as Promise<{ series?: UgRow[] } | null>,
  ]);

  const cecafeSeries = (names: string[]): Series => {
    const out: Series = {};
    for (const block of [cecafe?.by_country_prev, cecafe?.by_country]) {
      for (const n of names) {
        for (const [m, bags] of Object.entries(block?.countries?.[n] ?? {})) {
          out[m] = (out[m] ?? 0) + (bags as number) * 60 / 1000;   // bags → MT
        }
      }
    }
    return out;
  };
  const vnSeries = (names: string[]): Series => {
    const out: Series = {};
    for (const n of names) {
      for (const [m, mt] of Object.entries(vn?.countries?.[n] ?? {})) {
        if (mt) out[m] = (out[m] ?? 0) + mt;
      }
    }
    return out;
  };
  const euImports = (origin: string): Series =>
    eu?.origins?.find(o => o.name === origin)?.monthly ?? {};
  const usImports = (origin: string): Series => us?.monthly_origins?.[origin] ?? {};

  const idSeries = (names: string[]): Series => {
    const out: Series = {};
    const set = new Set(names);
    for (const row of id?.series ?? []) {
      for (const e of row.by_destination ?? []) {
        if (set.has(e.country) && e.kg) out[row.month] = (out[row.month] ?? 0) + e.kg / 1000;
      }
    }
    return out;
  };
  const ugSeries = (names: string[]): Series => {
    const out: Series = {};
    const set = new Set(names);
    for (const row of ug?.series ?? []) {
      for (const e of row.by_destination ?? []) {
        if (set.has(e.country) && e.bags) out[row.month] = (out[row.month] ?? 0) + e.bags * 60 / 1000;
      }
    }
    return out;
  };

  const flows = [
    analysePair("Brazil", "EU", cecafeSeries(EU_PT), euImports("Brazil")),
    analysePair("Brazil", "US", cecafeSeries(["E.U.A."]), usImports("Brazil")),
    analysePair("Brazil", "Japan", cecafeSeries(["JAPAO"]), {}),
    analysePair("Vietnam", "EU", vnSeries(EU_EN), euImports("Vietnam")),
    analysePair("Vietnam", "US", vnSeries(["United States of America"]), usImports("Vietnam")),
    analysePair("Vietnam", "Japan", vnSeries(["Japan"]), {}),
    analysePair("Indonesia", "EU", idSeries(EU_UPPER), euImports("Indonesia")),
    analysePair("Indonesia", "US", idSeries(["UNITED STATES"]), usImports("Indonesia")),
    analysePair("Indonesia", "Japan", idSeries(["JAPAN"]), {}),
    analysePair("Uganda", "EU", ugSeries(EU_EN), euImports("Uganda")),
  ];
  return flows.filter((f): f is TradeFlow => f != null);
}

// ── path interpolation for the boat animation ────────────────────────────────
export function pathInterpolator(path: [number, number][]): (t: number) => [number, number] {
  // cumulative planar lengths (good enough for animation pacing)
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    cum.push(cum[i - 1] + d);
  }
  const total = cum[cum.length - 1] || 1;
  return (t: number) => {
    const target = Math.min(Math.max(t, 0), 1) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const f = (target - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const lat = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f;
    let lng = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f;
    if (lng > 180) lng -= 360;    // unwrapped Pacific crossing → display coords
    return [lat, lng];
  };
}

export const KT_PER_BOAT = 25;   // one 🚢 ≈ 25 kt on the water
export const boatsFor = (f: TradeFlow) =>
  Math.min(6, Math.max(1, Math.round(f.inTransitMt / (KT_PER_BOAT * 1000))));
