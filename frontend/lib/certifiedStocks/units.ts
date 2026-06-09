// Display-unit conversion + number formatting for the certified-stocks views.
// Values are stored in each market's native unit (KC = bags, RC = lots) and
// converted to the chosen display unit. Warrant/square counts are NOT converted.

export const fmtNum = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";

export type FlowUnit = "bags" | "tonnes" | "lots";

// Lot sizes differ by contract:
//   • Robusta (RC): 1 lot = 10 MT       = 166.67 bags @ 60 kg.
//   • Arabica (KC): 1 lot = 37,500 lb   = 17.009 MT ≈ 283.49 bags @ 60 kg.
// Native unit also differs: KC volumes are stored in bags, RC in lots.
const _BAGS_PER_LOT_RC = (10 * 1000) / 60;   // 166.67
const _MT_PER_LOT_KC = (37_500 * 0.45359237) / 1000;   // 17.009
const _BAGS_PER_LOT_KC = (_MT_PER_LOT_KC * 1000) / 60;  // ≈ 283.49

function _toChosen(v: number, native: "bags" | "lots", unit: FlowUnit): number {
  if (native === "bags") {
    // Arabica (KC): stored in 60-kg bags; 1 lot = 17.009 MT = 283.49 bags.
    return unit === "bags" ? v : unit === "tonnes" ? (v * 60) / 1000 : v / _BAGS_PER_LOT_KC;
  }
  // Robusta (RC): stored in 10-MT lots.
  return unit === "lots" ? v : unit === "tonnes" ? v * 10 : v * _BAGS_PER_LOT_RC;
}

export function _fmtUnit(v: number, native: "bags" | "lots", unit: FlowUnit): string {
  const c = _toChosen(v, native, unit);
  if (!Number.isFinite(c)) return "—";
  return (unit === "lots" ? Math.round(c * 10) / 10 : Math.round(c)).toLocaleString("en-US");
}

export const unitWord = (u: FlowUnit) => (u === "bags" ? "bags" : u === "tonnes" ? "t" : "lots");
