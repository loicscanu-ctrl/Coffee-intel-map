// Pure transforms + analysis for the Research "Certified stocks & tenderable
// parity" tool. No React here so the math can be unit-tested against the real
// JSON with a node script (scripts/test-parity.mjs) before it drives a chart.

export interface DatedPrice { date: string; price: number }
export interface Snapshot { date: string; total_lots_certified?: number | null }
export interface GradingEntry { port?: string; origin?: string; class?: number; tenderable?: boolean; lots?: number }
export interface GradingDay { date: string; entries?: GradingEntry[] }

// ── Origin cost parameters (robusta vs London RC) ────────────────────────────
// FOBbing = origin→vessel (documented in Origin Logistics). Tendering adders =
// the extra cost to place FOB coffee into an exchange warehouse (port transport
// + rent + loading-out + contract allowances) — the tenderable-parity stack from
// the Contract-rules paper. Freight is the VN→N.Europe ocean leg (FBX base/21.6).
export interface OriginParams {
  key: string;
  label: string;
  farmgateKey: string;      // origin_prices_history.origins key
  gradingOrigin: string;    // name as it appears in recent_activity.gradings
  fxTicker: string;         // fx_history pair key (local-per-USD); "" if already USD
  perKg: boolean;           // farmgate unit: true = per kg, false = per 60kg bag
  fobbingUsd: number;       // origin→vessel, USD/MT
}

export const PARITY_ADDERS_USD = 72;      // port transport 7 + rent 15 + loading-out 40 + allowances ~10
export const CONTAINER_MT = 21.6;

export const PARITY_ORIGINS: OriginParams[] = [
  { key: "vietnam", label: "Vietnam Robusta (FAQ G2)", farmgateKey: "vietnam", gradingOrigin: "Vietnam", fxTicker: "VND=X", perKg: true, fobbingUsd: 100 },
  { key: "brazil", label: "Brazil Conilon", farmgateKey: "brazil_conilon", gradingOrigin: "Brazilian Conillon", fxTicker: "BRL=X", perKg: false, fobbingUsd: 200 },
];

/** Convert a local farmgate quote to USD/MT using that day's FX (local-per-USD). */
export function farmgateToUsdMt(localPrice: number, fxLocalPerUsd: number, perKg: boolean): number | null {
  if (!fxLocalPerUsd || fxLocalPerUsd <= 0) return null;
  const usdPerUnit = localPrice / fxLocalPerUsd;      // USD per kg or per 60-kg bag
  return perKg ? usdPerUnit * 1000 : (usdPerUnit / 60) * 1000;  // → USD/MT
}

export interface CostStackRow {
  date: string;
  rc: number | null;
  farmgate: number | null;   // USD/MT
  atPort: number | null;     // farmgate + FOBbing (FOB + logistics)
  tendering: number | null;  // atPort + freight + parity adders (all-in delivered to exchange)
}

/** Build the daily cost-stack-vs-RC series over the window where farmgate exists. */
export function buildCostStack(
  farmgate: DatedPrice[],
  fx: DatedPrice[],
  rc: DatedPrice[],
  params: OriginParams,
  freightUsdPerMt: number,
): CostStackRow[] {
  const fxByDate = new Map(fx.map(d => [d.date, d.price]));
  const rcByDate = new Map(rc.map(d => [d.date, d.price]));
  // forward-fill helpers for FX/RC (markets close on weekends/holidays)
  const fxDates = fx.map(d => d.date).sort();
  const rcDates = rc.map(d => d.date).sort();
  const ffill = (dates: string[], byDate: Map<string, number>, on: string): number | null => {
    if (byDate.has(on)) return byDate.get(on)!;
    let lo = 0, hi = dates.length - 1, ans: string | null = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= on) { ans = dates[mid]; lo = mid + 1; } else hi = mid - 1; }
    return ans ? byDate.get(ans)! : null;
  };
  const out: CostStackRow[] = [];
  for (const { date, price } of farmgate) {
    const fxRate = params.fxTicker ? ffill(fxDates, fxByDate, date) : 1;
    const rcVal = ffill(rcDates, rcByDate, date);
    const farmUsd = params.fxTicker
      ? (fxRate != null ? farmgateToUsdMt(price, fxRate, params.perKg) : null)
      : farmgateToUsdMt(price, 1, params.perKg);
    const atPort = farmUsd != null ? farmUsd + params.fobbingUsd : null;
    const tendering = atPort != null ? atPort + freightUsdPerMt + PARITY_ADDERS_USD : null;
    out.push({ date, rc: rcVal, farmgate: farmUsd, atPort, tendering });
  }
  return out;
}

/** Merge deep + recent snapshots into one sorted, de-duplicated level series (lots). */
export function buildLevelSeries(...snapshotSets: Snapshot[][]): DatedPrice[] {
  const byDate = new Map<string, number>();
  for (const set of snapshotSets) {
    for (const s of set) {
      const v = s.total_lots_certified;
      if (s.date && typeof v === "number") byDate.set(s.date, v);
    }
  }
  return Array.from(byDate.entries()).map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Monthly graded lots for a given origin (gross inflow to the exchange). */
export function buildOriginInflow(gradings: GradingDay[], gradingOrigin: string): { month: string; lots: number }[] {
  const byMonth = new Map<string, number>();
  for (const g of gradings) {
    const m = g.date?.slice(0, 7);
    if (!m) continue;
    for (const e of g.entries ?? []) {
      if (e.origin === gradingOrigin && typeof e.lots === "number") byMonth.set(m, (byMonth.get(m) ?? 0) + e.lots);
    }
  }
  return Array.from(byMonth.entries()).map(([month, lots]) => ({ month, lots })).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Event study: does certified stock build after RC is elevated? ────────────
function isoWeek(date: string): string {
  // Cheap, stable weekly bucket key: year + zero-padded week-of-year via date math.
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;             // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3);          // nearest Thursday
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

export interface EventStudy {
  weeks: number;                 // number of aligned weekly observations
  spanLabel: string;             // date range covered
  bestLag: number;               // weeks; lag of peak correlation of RC level vs forward Δlevel
  bestCorr: number;              // that correlation
  lagCorrs: { lag: number; corr: number }[];
  buildHiRc: number;             // avg Δlevel (lots) over the next K weeks when RC is in its top tercile
  buildLoRc: number;             // …bottom tercile
  horizonWeeks: number;          // K
}

/** Weekly-resample RC and the level series, then cross-correlate RC vs forward Δlevel. */
export function eventStudy(rc: DatedPrice[], level: DatedPrice[], horizonWeeks = 6, maxLag = 10): EventStudy | null {
  const lastPerWeek = (series: DatedPrice[]) => {
    const m = new Map<string, { date: string; price: number }>();
    for (const p of series) { const w = isoWeek(p.date); const cur = m.get(w); if (!cur || p.date > cur.date) m.set(w, { date: p.date, price: p.price }); }
    return m;
  };
  const rcW = lastPerWeek(rc);
  const lvW = lastPerWeek(level);
  const weeks = Array.from(lvW.keys()).filter(w => rcW.has(w)).sort();
  if (weeks.length < 20) return null;
  const rcArr = weeks.map(w => rcW.get(w)!.price);
  const lvArr = weeks.map(w => lvW.get(w)!.price);
  const dLevel = lvArr.map((v, i) => (i === 0 ? 0 : v - lvArr[i - 1]));  // weekly net change (lots)

  const lagCorrs: { lag: number; corr: number }[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i + lag < weeks.length; i++) { x.push(rcArr[i]); y.push(dLevel[i + lag]); }
    lagCorrs.push({ lag, corr: pearson(x, y) });
  }
  const valid = lagCorrs.filter(l => Number.isFinite(l.corr));
  const best = valid.reduce((b, l) => (Math.abs(l.corr) > Math.abs(b.corr) ? l : b), valid[0] ?? { lag: 0, corr: NaN });

  // Forward build after high vs low RC (terciles), horizon K weeks.
  const sorted = [...rcArr].sort((a, b) => a - b);
  const hiCut = sorted[Math.floor(sorted.length * 2 / 3)];
  const loCut = sorted[Math.floor(sorted.length / 3)];
  const fwdBuild = (i: number) => {
    let sum = 0, k = 0;
    for (let j = i + 1; j <= i + horizonWeeks && j < lvArr.length; j++) { sum += dLevel[j]; k++; }
    return k ? sum : null;
  };
  const hi: number[] = [], lo: number[] = [];
  for (let i = 0; i < weeks.length - horizonWeeks; i++) {
    const b = fwdBuild(i); if (b == null) continue;
    if (rcArr[i] >= hiCut) hi.push(b); else if (rcArr[i] <= loCut) lo.push(b);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return {
    weeks: weeks.length,
    spanLabel: `${lvW.get(weeks[0])!.date} → ${lvW.get(weeks[weeks.length - 1])!.date}`,
    bestLag: best.lag, bestCorr: best.corr, lagCorrs,
    buildHiRc: mean(hi), buildLoRc: mean(lo), horizonWeeks,
  };
}
