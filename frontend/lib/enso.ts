// Types + presentation constants for the ENSO Intelligence tab (enso.json,
// written by backend/scraper/build_enso_intel.py).

export interface EnsoForecastSeason {
  season: string;   // 3-mo code, e.g. "MAM"
  la_nina: number;  // probability %
  neutral: number;
  el_nino: number;
}

export interface OniPoint {
  month?: string;
  value: number;
  preliminary?: boolean;
}

export interface OniLongPoint {
  year: number;
  month: number;
  label: string;
  value: number;
}

export interface AlignedPoint {
  offset: number;   // 0 == "now" (latest ONI month); negatives trail, positives forward
  value: number;
  label?: string;
}

export interface EnsoAnalog {
  year: number;
  mse: number;
  series: AlignedPoint[];
}

export type RiskLevel = "high" | "moderate" | "low";

export interface EnsoRiskPin {
  region: string;
  country: string;
  lat: number;
  lon: number;
  level: RiskLevel;
  color: string;
  driver: string;
  severity: number;
}

export interface EnsoData {
  phase: string;
  intensity: string;
  oni: number | null;
  peak_month: string | null;
  forecast_direction: string | null;
  oni_history: OniPoint[];
  oni_forecast: EnsoForecastSeason[];
  historical_stat: string | null;
  analogs: EnsoAnalog[];
  oni_history_long: OniLongPoint[];
  current_window: AlignedPoint[];
  risk: { pins: EnsoRiskPin[]; summary: Record<string, number> };
  last_updated: string | null;
}

export const PHASE_META: Record<string, { label: string; color: string }> = {
  "el-nino": { label: "El Niño", color: "#dc2626" },
  "la-nina": { label: "La Niña", color: "#3b82f6" },
  neutral:   { label: "Neutral", color: "#94a3b8" },
};

export const RISK_META: Record<RiskLevel, { label: string; color: string }> = {
  high:     { label: "High",     color: "#dc2626" },
  moderate: { label: "Moderate", color: "#f59e0b" },
  low:      { label: "Low",      color: "#16a34a" },
};

export function phaseLabel(phase: string): string {
  return PHASE_META[phase]?.label ?? phase;
}
