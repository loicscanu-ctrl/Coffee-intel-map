import type { ProcessedCotRow } from "./types";

export type SignalSeverity = "info" | "warn" | "alert";
export type SignalMarket   = "NY" | "LDN";

export interface Signal {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  market: SignalMarket;
  severity: SignalSeverity;
  /** Directional score: positive = bullish, negative = bearish, 0 = neutral */
  score: number;
  text: string;
}

export interface HistoricalWeek {
  date: string;
  signals: Signal[];
  /** Net composite score for NY (KC) */
  scoreNY: number;
  /** Net composite score for LDN (RC) */
  scoreLDN: number;
  priceNY: number;
  priceLDN: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Dir = "up" | "down" | "flat";

/** WoW % change direction with 1% flat threshold. */
function dir(prev: number, curr: number): Dir {
  const base = Math.abs(prev) || 1;
  const chg  = (curr - prev) / base;
  if (chg >  0.01) return "up";
  if (chg < -0.01) return "down";
  return "flat";
}

/** 52-week min-max percentile of values[idx] — matches the Gauges display formula: (current−min)/(max−min). */
function pct52(values: number[], idx: number): number {
  const start  = Math.max(0, idx - 51);
  const window = values.slice(start, idx + 1);
  const min    = Math.min(...window);
  const max    = Math.max(...window);
  return max > min ? (values[idx] - min) / (max - min) : 0.5;
}

const isHigh = (s: number[], i: number) => pct52(s, i) >= 0.75;
const isLow  = (s: number[], i: number) => pct52(s, i) <= 0.25;

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Evaluate all 59 rule-based signals against the most recent COT week.
 * Requires at least 2 rows (current + previous for WoW deltas).
 * Uses full row history for 52-week percentile calculations.
 *
 * Proxy convention:
 *   pmpuShort ≈ Producers (hedgers)
 *   pmpuLong  ≈ Roasters  (commercial buyers)
 */
export function evaluateSignals(rows: ProcessedCotRow[]): Signal[] {
  const n = rows.length;
  if (n < 2) return [];

  const i    = n - 1;
  const curr = rows[i];
  const prev = rows[i - 1];

  // ── Time-series for 52-week percentile calcs ──────────────────────────────
  const nyProdS   = rows.map(r => r.ny.pmpuShort);
  const nyRoastL  = rows.map(r => r.ny.pmpuLong);
  const nyMmL     = rows.map(r => r.ny.mmLong);
  const nyMmS     = rows.map(r => r.ny.mmShort);
  const ldnProdS  = rows.map(r => r.ldn.pmpuShort);
  const ldnRoastL = rows.map(r => r.ldn.pmpuLong);
  const ldnMmL    = rows.map(r => r.ldn.mmLong);
  const ldnMmS    = rows.map(r => r.ldn.mmShort);
  const nyPrices  = rows.map(r => r.priceNY);
  const ldnPrices = rows.map(r => r.priceLDN);

  // ── WoW directions ────────────────────────────────────────────────────────
  type Mkt = "NY" | "LDN";

  const prodDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.pmpuShort,  curr.ny.pmpuShort),
    LDN: dir(prev.ldn.pmpuShort, curr.ldn.pmpuShort),
  };
  const roastDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.pmpuLong,  curr.ny.pmpuLong),
    LDN: dir(prev.ldn.pmpuLong, curr.ldn.pmpuLong),
  };
  const mmLDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.mmLong,  curr.ny.mmLong),
    LDN: dir(prev.ldn.mmLong, curr.ldn.mmLong),
  };
  const mmSDir: Record<Mkt, Dir> = {
    NY:  dir(prev.ny.mmShort,  curr.ny.mmShort),
    LDN: dir(prev.ldn.mmShort, curr.ldn.mmShort),
  };
  const priceDir: Record<Mkt, Dir> = {
    NY:  dir(prev.priceNY,  curr.priceNY),
    LDN: dir(prev.priceLDN, curr.priceLDN),
  };

  // ── OB/OS: 52-week price percentile (0–100) ───────────────────────────────
  const obosNY  = pct52(nyPrices,  i) * 100;
  const obosLDN = pct52(ldnPrices, i) * 100;

  // ── Curve structure (positive = backwardation, negative = contango) ────────
  const strNY   = (curr.rawNy?.structure_ny   ?? null) as number | null;
  const strLDN  = (curr.rawLdn?.structure_ldn ?? null) as number | null;
  const pStrNY  = (prev.rawNy?.structure_ny   ?? null) as number | null;
  const pStrLDN = (prev.rawLdn?.structure_ldn ?? null) as number | null;

  // ── Spreading OI ──────────────────────────────────────────────────────────
  const nySpOI   = curr.ny.swapSpread  + curr.ny.mmSpread  + curr.ny.otherSpread;
  const ldnSpOI  = curr.ldn.swapSpread + curr.ldn.mmSpread + curr.ldn.otherSpread;
  const pNySpOI  = prev.ny.swapSpread  + prev.ny.mmSpread  + prev.ny.otherSpread;
  const pLdnSpOI = prev.ldn.swapSpread + prev.ldn.mmSpread + prev.ldn.otherSpread;
  const nySpDir:  Dir = dir(pNySpOI,  nySpOI);
  const ldnSpDir: Dir = dir(pLdnSpOI, ldnSpOI);

  const signals: Signal[] = [];
  const add = (s: Signal) => signals.push(s);

  // ── CP — Producer Behavior ────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const pd = prodDir[mkt];
    const pr = priceDir[mkt];
    const ps = mkt === "NY" ? nyProdS : ldnProdS;

    if (pd === "up"   && pr === "up")
      add({ id:"CP1", name:"Normal Hedging",       category:"CP", categoryLabel:"Producer", market:mkt, severity:"info",  score:  0,
        text:"Producers locking in levels into price strength — standard hedging flow." });

    if (pd === "up"   && pr === "down")
      add({ id:"CP2", name:"Forced Liquidation",   category:"CP", categoryLabel:"Producer", market:mkt, severity:"warn",  score: -2,
        text:"Producers selling into weakness — suggests stock overhang or cash flow pressure regardless of price." });

    if (pd === "down" && pr === "up")
      add({ id:"CP3", name:"Bullish De-hedging",   category:"CP", categoryLabel:"Producer", market:mkt, severity:"warn",  score: +2,
        text:"Producers lifting hedges into rising price — signals expectation of further upside." });

    if (pd === "down" && pr === "down")
      add({ id:"CP4", name:"Defensive De-hedging", category:"CP", categoryLabel:"Producer", market:mkt, severity:"info",  score:  0,
        text:"Producers covering shorts on weakness — normal deleveraging, low conviction." });

    if (isHigh(ps, i))
      add({ id:"CP5", name:"Producer Exhaustion",  category:"CP", categoryLabel:"Producer", market:mkt, severity:"warn",  score: +2,
        text:"Producers near fully hedged (>75th pct, 52-week) — limited additional selling capacity from this actor." });

    if (isLow(ps, i))
      add({ id:"CP6", name:"Producer Dry Powder",  category:"CP", categoryLabel:"Producer", market:mkt, severity:"alert", score: -3,
        text:"Producers significantly under-hedged (<25th pct, 52-week) — large potential selling overhang ahead." });
  }

  // ── CR — Roaster Behavior ─────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const rd = roastDir[mkt];
    const pr = priceDir[mkt];
    const rs = mkt === "NY" ? nyRoastL : ldnRoastL;

    if (rd === "up"   && pr === "down")
      add({ id:"CR1", name:"Normal Coverage",     category:"CR", categoryLabel:"Roaster", market:mkt, severity:"info",  score:  0,
        text:"Roasters adding coverage into price weakness — standard buying flow." });

    if (rd === "up"   && pr === "up")
      add({ id:"CR2", name:"Forced Coverage",     category:"CR", categoryLabel:"Roaster", market:mkt, severity:"warn",  score: +1,
        text:"Roasters buying into rising price — suggests coverage urgency, potentially being squeezed." });

    if (rd === "down" && pr === "down")
      add({ id:"CR3", name:"Coverage Reduction",  category:"CR", categoryLabel:"Roaster", market:mkt, severity:"info",  score: -1,
        text:"Roasters reducing coverage on weakness — expecting further downside or reducing exposure." });

    if (rd === "down" && pr === "up")
      add({ id:"CR4", name:"Unusual Liquidation", category:"CR", categoryLabel:"Roaster", market:mkt, severity:"warn",  score: -2,
        text:"Roasters reducing coverage into rising price — may signal demand destruction or blend substitution toward Robusta." });

    if (isLow(rs, i) && pr === "up")
      add({ id:"CR5", name:"Squeeze Risk",        category:"CR", categoryLabel:"Roaster", market:mkt, severity:"alert", score: +3,
        text:"Roasters dangerously under-covered (<25th pct) into rising price — high risk of being forced to buy at unfavorable levels." });

    if (isHigh(rs, i))
      add({ id:"CR6", name:"Roaster Dry Powder",  category:"CR", categoryLabel:"Roaster", market:mkt, severity:"warn",  score: -2,
        text:"Roasters near fully covered (>75th pct) — limited additional buying capacity from this actor." });
  }

  // ── CI — Commercial Interaction ───────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const pd = prodDir[mkt];
    const rd = roastDir[mkt];

    if (pd === "down" && rd === "up")
      add({ id:"CI1", name:"Commercial Convergence Bullish", category:"CI", categoryLabel:"Commercial", market:mkt, severity:"warn",  score: +3,
        text:"Both commercials aligned bullish — strong fundamental demand signal." });

    if (pd === "up"   && rd === "down")
      add({ id:"CI2", name:"Commercial Convergence Bearish", category:"CI", categoryLabel:"Commercial", market:mkt, severity:"warn",  score: -3,
        text:"Both commercials aligned bearish — strong fundamental supply pressure signal." });

    if (pd === "up"   && rd === "up")
      add({ id:"CI3", name:"Commercial Divergence",          category:"CI", categoryLabel:"Commercial", market:mkt, severity:"info",  score:  0,
        text:"Producers and roasters on opposite sides — normal hedging flow, market in balance." });

    if (pd === "flat" && rd === "flat")
      add({ id:"CI4", name:"Commercial Vacuum",              category:"CI", categoryLabel:"Commercial", market:mkt, severity:"alert", score:  0,
        text:"No commercial activity — market driven purely by speculative flow. Highly fragile, vulnerable to sharp reversal when commercials re-engage." });
  }

  // ── ML — MM Longs Behavior ────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml  = mmLDir[mkt];
    const ms  = mmSDir[mkt];
    const pr  = priceDir[mkt];
    const mls = mkt === "NY" ? nyMmL : ldnMmL;
    void ms;

    if (ml === "up" && pr === "up" && !isHigh(mls, i))
      add({ id:"ML1", name:"Fund Bullish Entry",      category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"info",  score: +1,
        text:"Funds building longs into price strength — conviction depends on magnitude of the move." });

    if (ml === "up" && pr === "up" && isHigh(mls, i))
      add({ id:"ML2", name:"Fund Bullish Exhaustion", category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn",  score: -2,
        text:"Funds adding longs but near capacity (>75th pct) — bullish momentum likely limited, reversal risk increasing." });

    if (ml === "up" && pr === "down")
      add({ id:"ML3", name:"Contrarian Fund Buying",  category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn",  score: +1,
        text:"Funds buying into weakness — contrarian positioning. Check OI logs for sequence and verify against the brother contract." });

    if (ml === "down" && pr === "down")
      add({ id:"ML4", name:"Fund Long Liquidation",   category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"info",  score: -1,
        text:"Funds reducing longs into falling price — bearish momentum, trend following." });

    if (ml === "down" && pr === "up")
      add({ id:"ML5", name:"Fund Long Exit",          category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"warn",  score: -2,
        text:"Funds reducing longs despite rising price — may reflect lack of conviction or profit taking after a strong rally. Check cross-commodity allocation." });

    if (isHigh(mls, i) && pr !== "up")
      add({ id:"ML6", name:"Fund Long Overhang",      category:"ML", categoryLabel:"MM Longs", market:mkt, severity:"alert", score: -3,
        text:"Large speculative long position (>75th pct) with no price follow-through — significant liquidation risk." });
  }

  // ── MS — MM Shorts Behavior ───────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ms  = mmSDir[mkt];
    const ml  = mmLDir[mkt];
    const pr  = priceDir[mkt];
    const mss = mkt === "NY" ? nyMmS : ldnMmS;

    if (ms === "up" && pr === "down" && !isHigh(mss, i))
      add({ id:"MS1", name:"Fund Bearish Entry",       category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"info",  score: -1,
        text:"Funds building shorts into price weakness — conviction depends on magnitude of the move." });

    if (ms === "up" && pr === "down" && isHigh(mss, i))
      add({ id:"MS2", name:"Fund Bearish Exhaustion",  category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: +2,
        text:"Funds adding shorts near capacity (>75th pct) — bearish momentum likely limited, short covering risk increasing." });

    if (ms === "up" && pr === "up")
      add({ id:"MS3", name:"Contrarian Fund Shorting", category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: -2,
        text:"Funds shorting into rising price — contrarian positioning, betting on reversal." });

    if (ms === "down" && pr === "up")
      add({ id:"MS4", name:"Fund Short Covering",      category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"info",  score: +1,
        text:`Funds covering shorts into rising price — adds fuel to bullish momentum. ${
          ml === "up" ? "MM longs also rising: strong bullish conviction." :
          ml === "down" ? "MM longs falling: funds may be reducing coffee exposure overall." : ""
        }`.trim() });

    if (ms === "down" && pr === "down")
      add({ id:"MS5", name:"Reluctant Short Cover",    category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"warn",  score: +1,
        text:"Funds covering shorts despite falling price — may signal exhaustion of bearish thesis." });

    if (isHigh(mss, i) && pr !== "down")
      add({ id:"MS6", name:"Fund Short Squeeze Risk",  category:"MS", categoryLabel:"MM Shorts", market:mkt, severity:"alert", score: +3,
        text:"Large speculative short position (>75th pct) with no price follow-through — significant short squeeze risk." });
  }

  // ── MI — MM Longs × MM Shorts Interaction ────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml = mmLDir[mkt];
    const ms = mmSDir[mkt];

    if (ml === "up"   && ms === "down")
      add({ id:"MI1", name:"Speculative Conviction Bullish", category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score: +2,
        text:"Funds adding longs and covering shorts simultaneously — strong bullish conviction." });

    if (ml === "down" && ms === "up")
      add({ id:"MI2", name:"Speculative Conviction Bearish", category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score: -2,
        text:"Funds reducing longs and adding shorts simultaneously — strong bearish conviction." });

    if (ml === "up"   && ms === "up")
      add({ id:"MI3", name:"Speculative Confusion",          category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"warn",  score:  0,
        text:"Both sides growing — check net position to assess which side dominates. Cross-commodity check recommended." });

    if (ml === "down" && ms === "down")
      add({ id:"MI4", name:"Speculative Retreat",            category:"MI", categoryLabel:"MM Interaction", market:mkt, severity:"info",  score:  0,
        text:"Both sides reducing — check net change and cross-commodity allocation to determine if this is coffee-specific or broader deleveraging." });
  }

  // ── MPI — MM × Producers Interaction ─────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml  = mmLDir[mkt];
    const pd  = prodDir[mkt];
    const pr  = priceDir[mkt];
    const mls = mkt === "NY" ? nyMmL : ldnMmL;
    const ps  = mkt === "NY" ? nyProdS : ldnProdS;

    if (ml === "up"   && pd === "up"   && pr === "up")
      add({ id:"MPI1", name:"Classic Bullish Flow",              category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"info",  score: +2,
        text:"Funds buying against producer hedging into rising price — textbook bullish market structure. Producers locking in levels, funds betting on further upside." });

    if (ml === "up"   && pd === "up"   && pr === "down")
      add({ id:"MPI2", name:"Forced Market",                     category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"warn",  score: -2,
        text:"Funds buying against producer selling into falling price — check min/max levels of both actors and daily OI sequence to identify the dominant pressure." });

    if (ml === "up"   && pd === "down" && pr === "up")
      add({ id:"MPI3", name:"Squeeze Setup",                     category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"alert", score: +3,
        text:"Funds and producers both bullish simultaneously — strong squeeze risk, limited natural selling. Confirm with roaster coverage levels: if under-covered, squeeze is amplified." });

    if (ml === "down" && pd === "up"   && pr === "down")
      add({ id:"MPI4", name:"Bearish Capitulation",              category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"alert", score: -3,
        text:"Funds liquidating longs while producers add hedges — broad bearish alignment. Confirm with roaster behavior: if roasters also reducing coverage, conviction is across all actors." });

    if (ml === "down" && pd === "down" && pr === "up")
      add({ id:"MPI5", name:"Divergence Signal",                 category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"warn",  score: -1,
        text:"Funds reducing longs while producers lift hedges into rising price — neither actor convinced by the rally. Check if funds are near historical max (profit taking) or early in rally (lack of conviction)." });

    if (isHigh(mls, i) && isLow(ps, i))
      add({ id:"MPI6", name:"Fund Overhang vs Producer Pressure",category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"alert", score: -3,
        text:"Funds near long exhaustion (>75th pct) while producers significantly under-hedged (<25th pct) — large selling overhang ahead with limited fund buying capacity remaining. Bearish structural risk." });

    if (ml === "up"   && pd === "up"   && pr === "flat")
      add({ id:"MPI7", name:"Natural Market Balance",            category:"MPI", categoryLabel:"MM × Producer", market:mkt, severity:"info",  score:  0,
        text:"Funds and producers both active but price going nowhere — equilibrium. Expand to MM shorts and roaster coverage to identify which actor breaks first." });
  }

  // ── MRI — MM × Roasters Interaction ──────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const ml = mmLDir[mkt];
    const rd = roastDir[mkt];
    const pd = prodDir[mkt];
    const pr = priceDir[mkt];
    const rs = mkt === "NY" ? nyRoastL : ldnRoastL;

    if (ml === "up" && rd === "up" && pr === "up" && !isLow(rs, i))
      add({ id:"MRI1", name:"Double Buying Pressure",        category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"warn",  score: +2,
        text:"Funds and roasters buying simultaneously — powerful bullish combination creating structural demand pressure. Watch for producer response as natural counterbalance." });

    if (ml === "up" && rd === "up" && pr === "up" && isLow(rs, i))
      add({ id:"MRI2", name:"Roaster Squeeze Confirmed",     category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"alert", score: +3,
        text:"Funds buying while under-covered roasters (<25th pct) are forced into the market — classic squeeze dynamic. Price likely continues rising until roaster coverage normalizes." });

    if (ml === "up" && rd === "down" && pr === "up")
      add({ id:"MRI3", name:"Contrarian Divergence",         category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"warn",  score: -1,
        text:"Funds adding longs while roasters reduce coverage into rising price — check the alternative contract for blend switching. Undermines bullish thesis if substitution confirmed." });

    if (ml === "down" && rd === "down" && pr === "down")
      add({ id:"MRI4", name:"Bearish Convergence",           category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"alert", score: -3,
        text:"Funds and roasters both reducing exposure — broad-based selling. Roasters either well covered or expecting further downside. Strong bearish signal." });

    if (ml === "up" && rd === "flat" && pr === "up")
      add({ id:"MRI5", name:"Fund Buying vs Roaster Absence",category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"warn",  score:  0,
        text:"Funds driving price higher but roasters not participating — rally sustainable only if roasters are eventually forced to cover. Check roaster coverage percentile and calendar spread carry costs." });

    if (ml === "down" && rd === "up" && pr === "down")
      add({ id:"MRI6", name:"Roaster Coverage Opportunity",  category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"info",  score: +1,
        text:"Funds reducing while roasters opportunistically add coverage into weakness — puts a floor under the price decline." });

    if ((ml === "up" || ml === "down") && rd === "flat" && pd === "flat")
      add({ id:"MRI7", name:"Full Commercial Vacuum",        category:"MRI", categoryLabel:"MM × Roaster", market:mkt, severity:"alert", score:  0,
        text:"No commercial activity on either side — market entirely speculative. Highly fragile, vulnerable to sharp reversal when commercials re-engage." });
  }

  // ── CS — Curve Structure ──────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const str  = mkt === "NY" ? strNY  : strLDN;
    const pStr = mkt === "NY" ? pStrNY : pStrLDN;
    const rs   = mkt === "NY" ? nyRoastL : ldnRoastL;
    const ps   = mkt === "NY" ? nyProdS  : ldnProdS;
    const ml   = mmLDir[mkt];
    const rd   = roastDir[mkt];
    const label = mkt === "NY" ? "KC" : "RC";
    if (str === null) continue;

    // DB stores structure = deferred − front: negative = backwardation, positive = contango
    const back = str < 0;
    const con  = str > 0;

    if (back)
      add({ id:"CS1", name:"Backwardation Incentive", category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"info",  score: +1,
        text:`${label} curve in backwardation — front premium rewards long holders, supportive of bullish positioning. Verify that roll yield exceeds the risk-free rate to confirm the incentive is real.` });

    if (con && ml === "up")
      add({ id:"CS3", name:"Contango Pressure",       category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"warn",  score: -1,
        text:`${label} in contango while funds build longs — negative carry works against long holders. Conviction must be strong to justify the position.` });

    if (con && rd === "up")
      add({ id:"CS4", name:"Contango Relief",         category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"info",  score:  0,
        text:`${label} in contango while roasters add coverage — forward prices cheaper than spot, incentivizes forward buying. Normal and sustainable.` });

    if (back && pStr !== null && str < pStr && pct52(rs, i) <= 0.25)
      add({ id:"CS5", name:"Deepening Inversion",     category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"alert", score: +2,
        text:`${label} backwardation deepening while roasters are under-covered (<25th pct) — cost of forward coverage increasing week-on-week, amplifying squeeze risk. Cross-check against roll window.` });

    if (back && pStr !== null && str > pStr)
      add({ id:"CS6", name:"Inversion Easing",        category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"warn",  score: -1,
        text:`${label} backwardation losing strength — reduces incentive for longs to hold, may trigger gradual long liquidation. Check if easing coincides with roll window.` });

    if (con && isLow(ps, i))
      add({ id:"CS7", name:"Structural Contango",     category:"CS", categoryLabel:"Curve Structure", market:mkt, severity:"warn",  score: -1,
        text:`${label} in contango while producers significantly under-hedged — forward prices give producers attractive levels to add hedges. Potential selling overhang building.` });
  }

  // ── OB — Overbought / Oversold ────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const obos  = mkt === "NY" ? obosNY : obosLDN;
    const pr    = priceDir[mkt];
    const mls   = mkt === "NY" ? nyMmL    : ldnMmL;
    const rs    = mkt === "NY" ? nyRoastL : ldnRoastL;
    const ps    = mkt === "NY" ? nyProdS  : ldnProdS;
    const label = mkt === "NY" ? "KC" : "RC";

    if (obos > 80 && !isLow(rs, i))
      add({ id:"OB1", name:"Overbought Warning",       category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score: -2,
        text:`${label} technically overbought (>80th pct, 52-week) with funds near capacity — upside limited. Monitor calendar spread: if inversion weakens, holding costs may accelerate long liquidation.` });

    if (obos > 80 && isLow(rs, i))
      add({ id:"OB2", name:"Overbought but Supported", category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score:  0,
        text:`${label} overbought but roasters significantly under-covered (<25th pct) — technical selling pressure offset by structural commercial demand. Correction likely shallow.` });

    if (obos < 20 && isLow(mls, i))
      add({ id:"OB3", name:"Oversold Opportunity",     category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score: +2,
        text:`${label} technically oversold (<20th pct) with funds near minimum exposure — high potential for mean-reversion rally. If contango is deep, re-entry incentive for funds is reduced. Watch for catalyst.` });

    if (obos < 20 && isLow(ps, i))
      add({ id:"OB4", name:"Oversold but Vulnerable",  category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score:  0,
        text:`${label} oversold but producers significantly under-hedged (<25th pct) — potential recovery capped by producer selling overhang. Bounce likely limited.` });

    if (obos >= 20 && obos <= 80)
      add({ id:"OB5", name:"Neutral Zone",             category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"info",  score:  0,
        text:`${label} neither overbought nor oversold (${obos.toFixed(0)}th pct) — no technical pressure in either direction. Positioning and fundamentals are the primary drivers.` });

    if (obos > 80 && pr === "down")
      add({ id:"OB6", name:"Divergence Warning",       category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"alert", score: -3,
        text:`${label} overbought but price already falling — momentum turning. Check weekly change in trader counts: if also falling, unwind is broad-based.` });

    if (obos < 20 && pr === "up")
      add({ id:"OB7", name:"Oversold Divergence",      category:"OB", categoryLabel:"OB/OS", market:mkt, severity:"warn",  score: +2,
        text:`${label} technically oversold but price already recovering — short covering likely driving the move. Sustainable only if commercial buyers confirm with increased coverage.` });
  }

  // ── SP — Spreading ────────────────────────────────────────────────────────
  for (const mkt of ["NY", "LDN"] as const) {
    const spDir = mkt === "NY" ? nySpDir  : ldnSpDir;
    const pr    = priceDir[mkt];
    const str   = mkt === "NY" ? strNY   : strLDN;
    const pStr  = mkt === "NY" ? pStrNY  : pStrLDN;

    if (spDir === "up" && pr !== "up")
      add({ id:"SP1", name:"Spreading Increase",     category:"SP", categoryLabel:"Spreading", market:mkt, severity:"info",  score:  0,
        text:"Spreading OI increasing without directional price move — funds positioning across the curve. Often precedes a decisive directional move. Cross-check against calendar spread direction." });

    if (spDir === "down")
      add({ id:"SP2", name:"Spreading Decrease",     category:"SP", categoryLabel:"Spreading", market:mkt, severity:"info",  score:  0,
        text:"Funds collapsing spread positions — may signal transition to outright directional positioning. Watch which direction longs and shorts move next." });

    if (spDir === "up" && str !== null && pStr !== null && str > 0 && str > pStr)
      add({ id:"SP3", name:"Spreading vs Inversion", category:"SP", categoryLabel:"Spreading", market:mkt, severity:"warn",  score:  0,
        text:"Spreading OI increasing while backwardation deepens — funds likely harvesting backwardation premium. Not a directional signal but confirms curve structure is attracting capital." });
  }

  return signals;
}

// ── Composite score helpers ───────────────────────────────────────────────────

export function computeCompositeScores(signals: Signal[]): { scoreNY: number; scoreLDN: number } {
  let scoreNY  = 0;
  let scoreLDN = 0;
  for (const s of signals) {
    if (s.market === "NY")  scoreNY  += s.score;
    else                    scoreLDN += s.score;
  }
  return { scoreNY, scoreLDN };
}

// ── Historical tracking ───────────────────────────────────────────────────────

/**
 * Evaluate signals for each of the last `weeks` weeks.
 * Each call uses the full history up to that point for accurate percentile calcs.
 */
export function evaluateHistoricalSignals(rows: ProcessedCotRow[], weeks = 8): HistoricalWeek[] {
  const result: HistoricalWeek[] = [];
  const start = Math.max(1, rows.length - weeks);
  for (let end = start; end <= rows.length; end++) {
    const slice   = rows.slice(0, end);
    const sigs    = evaluateSignals(slice);
    const { scoreNY, scoreLDN } = computeCompositeScores(sigs);
    const row = rows[end - 1];
    result.push({ date: row.date, signals: sigs, scoreNY, scoreLDN, priceNY: row.priceNY, priceLDN: row.priceLDN });
  }
  return result;
}
