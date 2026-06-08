// Shared types for the CoT dashboard decomposition.

export type MacroToggle = "gross" | "gross_long" | "gross_short" | "net";

export interface MacroChartRow {
  date: string;
  energy: number;
  metals: number;
  grains: number;
  meats:  number;
  softs:  number;
  micros: number;
  coffeeShare: number | null;
}
