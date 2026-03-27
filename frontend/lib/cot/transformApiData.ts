// ── Constants ──────────────────────────────────────────────────────────────────
export const ARABICA_MT_FACTOR   = 17.01;
export const ROBUSTA_MT_FACTOR   = 10.00;
export const MARGIN_OUTRIGHT     = 6000;
export const MARGIN_SPREAD       = 1200;
export const CENTS_LB_TO_USD_TON = 22.0462;

// ── Real data transform ─────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
export function transformApiData(rows: any[]): any[] {
  if (!rows.length) return [];

  // Forward-fill missing market data (e.g. US holiday shifts NY release by 1 day)
  let lastNY:  any = null;
  let lastLDN: any = null;
  const filledRows = rows.map(row => {
    const ny  = row.ny  ?? lastNY  ?? null;
    const ldn = row.ldn ?? lastLDN ?? null;
    if (row.ny  != null) lastNY  = row.ny;
    if (row.ldn != null) lastLDN = row.ldn;
    return { ...row, ny, ldn };
  });

  let prevPriceNY  = 130;
  let prevPriceLDN = 1800;
  let cumulativeNominal = 0;
  let cumulativeMargin  = 0;

  // Pass 1: ordered for-loop — delta fields require access to previous row
  const base: any[] = [];
  for (let i = 0; i < filledRows.length; i++) {
    const row = filledRows[i];
    const ny  = row.ny  ?? {};
    const ldn = row.ldn ?? {};

    const oiNY  = ny.oi_total  ?? 0;
    const oiLDN = ldn.oi_total ?? 0;
    const totalOI = oiNY + oiLDN;

    // Spreading — from RAW API spread fields (NOT from the ny/ldn sub-objects below)
    const spreadingNY  = (ny.swap_spread  ?? 0) + (ny.mm_spread  ?? 0) + (ny.other_spread  ?? 0);
    const spreadingLDN = (ldn.swap_spread ?? 0) + (ldn.mm_spread ?? 0) + (ldn.other_spread ?? 0);
    const spreadingTotal = spreadingNY + spreadingLDN;
    const outrightTotal  = totalOI - spreadingTotal;

    // Price carry-forward
    const priceNY  = ny.price_ny   != null ? ny.price_ny   : prevPriceNY;
    const priceLDN = ldn.price_ldn != null ? ldn.price_ldn : prevPriceLDN;
    prevPriceNY  = priceNY;
    prevPriceLDN = priceLDN;

    const priceNY_USD_Ton  = priceNY * CENTS_LB_TO_USD_TON;
    const avgPrice_USD_Ton = totalOI > 0
      ? ((priceNY_USD_Ton * oiNY) + (priceLDN * oiLDN)) / totalOI
      : 0;

    // Delta OI
    const prev       = base[i - 1] ?? null;
    const deltaOINY  = prev ? oiNY  - prev.oiNY  : 0;
    const deltaOILDN = prev ? oiLDN - prev.oiLDN : 0;

    // Weekly nominal flow ($M)
    const flowNY  = (deltaOINY  * priceNY  * 375) / 1_000_000;
    const flowLDN = (deltaOILDN * priceLDN * 10)  / 1_000_000;
    const weeklyNominalFlow = flowNY + flowLDN;

    // Weekly margin flow ($M)
    const prevSpread   = prev ? prev.spreadingTotal : 0;
    const prevOutright = prev ? prev.outrightTotal  : 0;
    const deltaSpread   = spreadingTotal - prevSpread;
    const deltaOutright = outrightTotal  - prevOutright;
    const weeklyMarginFlow =
      ((deltaOutright * MARGIN_OUTRIGHT) + (deltaSpread * MARGIN_SPREAD)) / 1_000_000;

    cumulativeNominal += weeklyNominalFlow;
    cumulativeMargin  += weeklyMarginFlow;

    // ny/ldn sub-objects: camelCase OI fields used by Tabs 2-6
    // nonRepLong (capital R) matches d.ny[`${cat}Long`] where cat="nonRep" in Tab 2
    const nyObj = {
      pmpuLong:    ny.pmpu_long   ?? 0,  pmpuShort:   ny.pmpu_short  ?? 0,  pmpuSpread:   0,
      swapLong:    ny.swap_long   ?? 0,  swapShort:   ny.swap_short  ?? 0,  swapSpread:   ny.swap_spread  ?? 0,
      mmLong:      ny.mm_long     ?? 0,  mmShort:     ny.mm_short    ?? 0,  mmSpread:     ny.mm_spread    ?? 0,
      otherLong:   ny.other_long  ?? 0,  otherShort:  ny.other_short ?? 0,  otherSpread:  ny.other_spread ?? 0,
      nonRepLong:  ny.nr_long     ?? 0,  nonRepShort: ny.nr_short    ?? 0,  nonRepSpread: 0,
    };
    const ldnObj = {
      pmpuLong:    ldn.pmpu_long  ?? 0,  pmpuShort:   ldn.pmpu_short  ?? 0,  pmpuSpread:   0,
      swapLong:    ldn.swap_long  ?? 0,  swapShort:   ldn.swap_short  ?? 0,  swapSpread:   ldn.swap_spread  ?? 0,
      mmLong:      ldn.mm_long    ?? 0,  mmShort:     ldn.mm_short    ?? 0,  mmSpread:     ldn.mm_spread    ?? 0,
      otherLong:   ldn.other_long ?? 0,  otherShort:  ldn.other_short ?? 0,  otherSpread:  ldn.other_spread ?? 0,
      nonRepLong:  ldn.nr_long    ?? 0,  nonRepShort: ldn.nr_short    ?? 0,  nonRepSpread: 0,
    };

    // tradersNY/LDN: lowercase keys used by Tab 5 dpCats loop as m.tr["nonrep"]
    const tradersNY = {
      pmpu:   ny.t_pmpu_long  ?? 0,
      mm:     ny.t_mm_long    ?? 0,
      swap:   ny.t_swap_long  ?? 0,
      other:  ny.t_other_long ?? 0,
      nonrep: ny.t_nr_long    ?? 0,
    };
    const tradersNY_short = {
      pmpu:   ny.t_pmpu_short  ?? 0,
      mm:     ny.t_mm_short    ?? 0,
      swap:   ny.t_swap_short  ?? 0,
      other:  ny.t_other_short ?? 0,
      nonrep: ny.t_nr_short    ?? 0,
    };
    const tradersLDN = {
      pmpu:   ldn.t_pmpu_long  ?? 0,
      mm:     ldn.t_mm_long    ?? 0,
      swap:   ldn.t_swap_long  ?? 0,
      other:  ldn.t_other_long ?? 0,
      nonrep: 0,  // ICE has no NR trader count
    };
    const tradersLDN_short = {
      pmpu:   ldn.t_pmpu_short  ?? 0,
      mm:     ldn.t_mm_short    ?? 0,
      swap:   ldn.t_swap_short  ?? 0,
      other:  ldn.t_other_short ?? 0,
      nonrep: 0,
    };

    const pmpuShortMT_NY  = nyObj.pmpuShort * ARABICA_MT_FACTOR;
    const pmpuShortMT_LDN = ldnObj.pmpuShort * ROBUSTA_MT_FACTOR;
    const pmpuLongMT_NY   = nyObj.pmpuLong  * ARABICA_MT_FACTOR;
    const pmpuLongMT_LDN  = ldnObj.pmpuLong * ROBUSTA_MT_FACTOR;
    const efpMT = (ny.efp_ny ?? 0) * ARABICA_MT_FACTOR;

    base.push({
      id: i,
      date: row.date,
      priceNY, priceLDN, avgPrice_USD_Ton,
      oiNY, oiLDN, totalOI,
      spreadingTotal, outrightTotal,
      weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
      ny: nyObj, ldn: ldnObj,
      // Preserve forward-filled raw sub-objects for buildMarketMetrics (structure, exch_oi, t_mm_short)
      rawNy: ny, rawLdn: ldn,
      tradersNY, tradersNY_short, tradersLDN, tradersLDN_short,
      pmpuShortMT_NY, pmpuShortMT_LDN,
      pmpuShortMT: pmpuShortMT_NY + pmpuShortMT_LDN,
      pmpuLongMT_NY, pmpuLongMT_LDN,
      pmpuLongMT: pmpuLongMT_NY + pmpuLongMT_LDN,
      efpMT,
      timeframe: "historical",
    });
  }

  // Pass 2: timeframe buckets + 5-year (260-week) rolling ranks
  const n = base.length;
  return base.map((d, i) => {
    const timeframe =
      i === n - 1                ? "current"    :
      i === n - 2                ? "recent_1"   :
      (i >= n - 6 && i <= n - 3) ? "recent_4"  :
      (i >= n - 58 && i <= n - 7) ? "year"      :
                                    "historical";

    const slice    = base.slice(Math.max(0, i - 260), i + 1);
    const prices   = slice.map(s => s.priceNY);
    const maxP     = Math.max(...prices);
    const minP     = Math.min(...prices);
    const net      = d.ny.mmLong - d.ny.mmShort;
    const nets     = slice.map(s => s.ny.mmLong - s.ny.mmShort);
    const maxNet   = Math.max(...nets);
    const minNet   = Math.min(...nets);

    const ldnPrices = slice.map(s => s.priceLDN);
    const maxLP     = Math.max(...ldnPrices);
    const minLP     = Math.min(...ldnPrices);
    const netLDN    = d.ldn.mmLong - d.ldn.mmShort;
    const netsLDN   = slice.map(s => s.ldn.mmLong - s.ldn.mmShort);
    const maxNetLDN = Math.max(...netsLDN);
    const minNetLDN = Math.min(...netsLDN);

    return {
      ...d,
      timeframe,
      priceRank:    maxP     !== minP     ? ((d.priceNY - minP)    / (maxP     - minP))     * 100 : 50,
      oiRank:       maxNet   !== minNet   ? ((net       - minNet)   / (maxNet   - minNet))   * 100 : 50,
      priceRankLDN: maxLP    !== minLP    ? ((d.priceLDN - minLP)   / (maxLP    - minLP))    * 100 : 50,
      oiRankLDN:    maxNetLDN !== minNetLDN ? ((netLDN  - minNetLDN)/ (maxNetLDN - minNetLDN)) * 100 : 50,
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
