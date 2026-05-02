// Illustrative data fallback used when the backend isn't reachable.
// Generates ~20 years of synthetic weekly CoT rows.

import {
  ARABICA_MT_FACTOR, ROBUSTA_MT_FACTOR,
  MARGIN_OUTRIGHT, MARGIN_SPREAD, CENTS_LB_TO_USD_TON,
} from "@/lib/cot/transformApiData";

export function generateData() {
  const weeks = 1040; // ~20 years
  const data: any[] = [];
  let priceNY = 130, priceLDN = 1800, oiNY = 180000, oiLDN = 110000;
  let cumulativeNominal = 0, cumulativeMargin = 0;

  for (let i = 0; i < weeks; i++) {
    // Start ~20 years ago (early 2006)
    const date = new Date(2006, 0, 1 + i * 7).toISOString().split("T")[0];
    priceNY  = Math.max(60,  Math.min(400, priceNY  + (Math.random() - 0.48) * 8));
    priceLDN = Math.max(800, Math.min(5000, priceLDN + (Math.random() - 0.48) * 60));
    oiNY     = Math.max(80000,  Math.min(380000, oiNY  + (Math.random() - 0.5) * 5000));
    oiLDN    = Math.max(50000,  Math.min(250000, oiLDN + (Math.random() - 0.5) * 3000));

    const spreadingNY  = Math.floor(oiNY  * (0.18 + Math.random() * 0.04));
    const spreadingLDN = Math.floor(oiLDN * (0.10 + Math.random() * 0.03));
    const totalOI = oiNY + oiLDN;
    const priceNY_USD_Ton = priceNY * CENTS_LB_TO_USD_TON;
    const avgPrice_USD_Ton = ((priceNY_USD_Ton * oiNY) + (priceLDN * oiLDN)) / totalOI;

    const deltaOINY  = i > 0 ? oiNY  - data[i-1].oiNY  : 0;
    const deltaOILDN = i > 0 ? oiLDN - data[i-1].oiLDN : 0;
    const flowNY  = (deltaOINY  * priceNY  * 375) / 1_000_000;
    const flowLDN = (deltaOILDN * priceLDN * 10)  / 1_000_000;
    const weeklyNominalFlow = flowNY + flowLDN;

    const prevSpread   = i > 0 ? data[i-1].spreadingTotal  : 0;
    const prevOutright = i > 0 ? data[i-1].outrightTotal   : 0;
    const deltaSpread  = (spreadingNY + spreadingLDN) - prevSpread;
    const deltaOutright = (totalOI - (spreadingNY + spreadingLDN)) - prevOutright;
    const weeklyMarginFlow = ((deltaOutright * MARGIN_OUTRIGHT) + (deltaSpread * MARGIN_SPREAD)) / 1_000_000;

    cumulativeNominal += weeklyNominalFlow;
    cumulativeMargin  += weeklyMarginFlow;

    const mkBreakdown = (oi: number, baseT: number) => ({
      oi: {
        pmpuLong:   oi * 0.05, pmpuShort:  oi * 0.45,
        mmLong:     oi * 0.175, mmShort:   oi * 0.075,
        swapLong:   oi * 0.06,  swapShort:  oi * 0.04,
        otherLong:  oi * 0.03,  otherShort: oi * 0.02,
        nonRepLong: oi * 0.05,  nonRepShort: oi * 0.05,
      },
      traders: {
        pmpu: Math.floor(baseT * 0.15), mm:     Math.floor(baseT * 0.15),
        swap: Math.floor(baseT * 0.05), other:  Math.floor(baseT * 0.10),
        nonrep: Math.floor(baseT * 0.55),
      },
    });

    const nyD  = mkBreakdown(oiNY,  200 + Math.floor(Math.random() * 50));
    const ldnD = mkBreakdown(oiLDN, 150 + Math.floor(Math.random() * 40));
    const efp  = Math.floor(Math.random() * 1500);

    const isLast  = i === weeks - 1;
    const isPrev1 = i === weeks - 2;
    const isPrev4 = i >= weeks - 6 && i <= weeks - 3;
    const isYear  = i >= weeks - 58 && i <= weeks - 7;

    data.push({
      id: i, date, priceNY, priceLDN, avgPrice_USD_Ton,
      oiNY, oiLDN, totalOI,
      spreadingTotal: spreadingNY + spreadingLDN,
      outrightTotal: (oiNY + oiLDN) - (spreadingNY + spreadingLDN),
      weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
      ny: nyD.oi, ldn: ldnD.oi,
      tradersNY: nyD.traders, tradersLDN: ldnD.traders,
      pmpuShortMT_NY:  nyD.oi.pmpuShort * ARABICA_MT_FACTOR,
      pmpuShortMT_LDN: ldnD.oi.pmpuShort * ROBUSTA_MT_FACTOR,
      pmpuShortMT:     (nyD.oi.pmpuShort * ARABICA_MT_FACTOR) + (ldnD.oi.pmpuShort * ROBUSTA_MT_FACTOR),
      pmpuLongMT_NY:   nyD.oi.pmpuLong  * ARABICA_MT_FACTOR,
      pmpuLongMT_LDN:  ldnD.oi.pmpuLong * ROBUSTA_MT_FACTOR,
      pmpuLongMT:      (nyD.oi.pmpuLong * ARABICA_MT_FACTOR) + (ldnD.oi.pmpuLong * ROBUSTA_MT_FACTOR),
      efpMT: efp * ARABICA_MT_FACTOR,
      timeframe: isLast ? "current" : isPrev1 ? "recent_1" : isPrev4 ? "recent_4" : isYear ? "year" : "historical",
    });
  }

  return data.map((d, i) => {
    const slice    = data.slice(Math.max(0, i - 260), i + 1);
    const maxP     = Math.max(...slice.map(s => s.priceNY));
    const minP     = Math.min(...slice.map(s => s.priceNY));
    const net      = d.ny.mmLong - d.ny.mmShort;
    const nets     = slice.map(s => s.ny.mmLong - s.ny.mmShort);
    const maxLP    = Math.max(...slice.map(s => s.priceLDN));
    const minLP    = Math.min(...slice.map(s => s.priceLDN));
    const netLDN   = d.ldn.mmLong - d.ldn.mmShort;
    const netsLDN  = slice.map(s => s.ldn.mmLong - s.ldn.mmShort);
    return {
      ...d,
      priceRank:    (maxP  - minP)  > 0 ? ((d.priceNY  - minP)  / (maxP  - minP))  * 100 : 50,
      oiRank:       (Math.max(...nets)  - Math.min(...nets))  > 0 ? ((net    - Math.min(...nets))   / (Math.max(...nets)   - Math.min(...nets)))   * 100 : 50,
      priceRankLDN: (maxLP - minLP) > 0 ? ((d.priceLDN - minLP) / (maxLP - minLP)) * 100 : 50,
      oiRankLDN:    (Math.max(...netsLDN) - Math.min(...netsLDN)) > 0 ? ((netLDN - Math.min(...netsLDN)) / (Math.max(...netsLDN) - Math.min(...netsLDN))) * 100 : 50,
    };
  });
}
