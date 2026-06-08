// Display-unit conversion + number formatting for the certified-stocks views.
// Values are stored in each market's native unit (KC = bags, RC = lots) and
// converted to the chosen display unit. Warrant/square counts are NOT converted.

export const fmtNum = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";

export type FlowUnit = "bags" | "tonnes" | "lots";
const _BAGS_PER_LOT = (10 * 1000) / 60;   // 166.67 (60-kg bags per 10-MT lot)

function _toChosen(v: number, native: "bags" | "lots", unit: FlowUnit): number {
  if (native === "bags") {
    return unit === "bags" ? v : unit === "tonnes" ? (v * 60) / 1000 : v / _BAGS_PER_LOT;
  }
  return unit === "lots" ? v : unit === "tonnes" ? v * 10 : v * _BAGS_PER_LOT;
}

export function _fmtUnit(v: number, native: "bags" | "lots", unit: FlowUnit): string {
  const c = _toChosen(v, native, unit);
  if (!Number.isFinite(c)) return "—";
  return (unit === "lots" ? Math.round(c * 10) / 10 : Math.round(c)).toLocaleString("en-US");
}

export const unitWord = (u: FlowUnit) => (u === "bags" ? "bags" : u === "tonnes" ? "t" : "lots");
