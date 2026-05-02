import type { MacroCotWeek } from "@/lib/api";
import { ENERGY_SYMBOLS } from "./constants";
import type { MacroChartRow, MacroToggle } from "./types";

export function transformMacroData(weeks: MacroCotWeek[], mode: MacroToggle): MacroChartRow[] {
  return weeks.map(week => {
    const sectorTotals: Record<string, number> = { energy: 0, metals: 0, grains: 0, meats: 0, softs: 0, micros: 0 };
    let coffeeGross = 0;
    let totalGross  = 0;
    let hasCoffeePrice = true;

    for (const c of week.commodities) {
      const g = c.gross_exposure_usd;
      const n = c.net_exposure_usd;
      const val =
        mode === "gross"       ? g :
        mode === "gross_long"  ? (g != null && n != null ? (g + n) / 2 : null) :
        mode === "gross_short" ? (g != null && n != null ? (g - n) / 2 : null) :
        n;

      if (val == null) continue;
      const valB = val / 1e9;
      // Split "hard" into energy vs metals
      const displaySector = c.sector === "hard"
        ? (ENERGY_SYMBOLS.has(c.symbol) ? "energy" : "metals")
        : c.sector;
      sectorTotals[displaySector] = (sectorTotals[displaySector] ?? 0) + valB;

      if (c.symbol === "arabica" || c.symbol === "robusta") {
        if (c.gross_exposure_usd == null) hasCoffeePrice = false;
        else coffeeGross += c.gross_exposure_usd;
      }
      if (c.gross_exposure_usd != null) totalGross += c.gross_exposure_usd;
    }

    const coffeeShare = (hasCoffeePrice && totalGross > 0)
      ? (coffeeGross / totalGross) * 100
      : null;

    return {
      date:   week.date,
      energy: sectorTotals.energy ?? 0,
      metals: sectorTotals.metals ?? 0,
      grains: sectorTotals.grains ?? 0,
      meats:  sectorTotals.meats  ?? 0,
      softs:  sectorTotals.softs  ?? 0,
      micros: sectorTotals.micros ?? 0,
      coffeeShare,
    };
  }).filter(row =>
    Math.abs(row.energy) + Math.abs(row.metals) + Math.abs(row.grains) +
    Math.abs(row.meats) + Math.abs(row.softs) + Math.abs(row.micros) > 0
  );
}
