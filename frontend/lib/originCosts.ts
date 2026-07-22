// Single source of truth for origin FOBbing costs (origin logistics + exporter
// margin), in USD/MT. Edit these numbers here and every consumer updates:
//   - Research → Origin Logistics tab (the "~$X/t" headline figures)
//   - Market ticker: lifts origin spot prices to at-port parity vs RC futures
//   - Futures → Quotation tab: the flat reference price for each origin
//
// VN FAQ ≈ $65 logistics (Cat Lai trucking + port) + ~$35 exporter margin.
// See components/research/ResearchView.tsx → Origin Logistics for the full
// cost-stack breakdown behind each number.
export const FOBBING_USD: Record<string, number> = {
  "VN FAQ":  100,
  "CON T7":  200,
  "UGA S15": 265,
  "GT SHB":  280,   // Guatemala washed Arabica (full milling + Pacific-port export)
  "HN HG":   250,   // Honduras washed Arabica (milling + Puerto Cortés export)
};

export const VN_FAQ_FOBBING_USD = FOBBING_USD["VN FAQ"];

// Carry cost added per shipment month within a crop year, USD/MT.
export const MONTHLY_CARRY_USD = 30;

// ── FOB / CIF Antwerp conversion (Origin Farmgate Prices basis toggle) ──────
// FOB   = farmgate (USD/MT) + fobbing (the research-tab cost stack above).
// CIF   = FOB + ocean freight (route USD/FEU ÷ 21.6 MT) + financing of the
//         cargo value at CIF_FINANCING_RATE p.a. over the transit time.
export const CIF_FINANCING_RATE = 0.08;   // p.a., applied × transitDays/365 on FOB
export const FEU_MT = 21.6;               // net coffee MT per FEU (matches tender_parity)

export interface OriginExportCost {
  fobbingUsdMt: number;   // origin→vessel, USD/MT
  freightRoute: string;   // freight.json route id (FBX-derived, USD/FEU)
  transitDays:  number;   // port→Antwerp sailing time for the financing leg
}

// Keyed by origin_prices_history.json origin key (the panel's series keys).
// Fobbing reuses FOBBING_USD; origins without their own research-tab figure
// borrow the closest logistics twin (BR arabica ships the same Santos stack as
// conilon; DRUGAR/WUGAR clear through the same Kampala→Mombasa chain as S15).
// Transit: liner schedules to Antwerp — Santos ~16d, Caribbean ~17d,
// Mombasa/Djibouti ~28d, Ho Chi Minh ~32d.
export const ORIGIN_EXPORT_COSTS: Record<string, OriginExportCost> = {
  vietnam:        { fobbingUsdMt: FOBBING_USD["VN FAQ"],  freightRoute: "vn-eu", transitDays: 32 },
  brazil_conilon: { fobbingUsdMt: FOBBING_USD["CON T7"],  freightRoute: "br-eu", transitDays: 16 },
  brazil_arabica: { fobbingUsdMt: FOBBING_USD["CON T7"],  freightRoute: "br-eu", transitDays: 16 },
  uganda:         { fobbingUsdMt: FOBBING_USD["UGA S15"], freightRoute: "et-eu", transitDays: 28 },
  uganda_drugar:  { fobbingUsdMt: FOBBING_USD["UGA S15"], freightRoute: "et-eu", transitDays: 28 },
  uganda_wugar:   { fobbingUsdMt: FOBBING_USD["UGA S15"], freightRoute: "et-eu", transitDays: 28 },
  guatemala_estrictamente_duro:
                  { fobbingUsdMt: FOBBING_USD["GT SHB"],  freightRoute: "co-eu", transitDays: 17 },
};
