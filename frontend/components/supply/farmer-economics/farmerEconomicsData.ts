// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "HIGH" | "MED" | "LOW" | "NONE";
export type EnsoPhase = "el-nino" | "la-nina" | "neutral";
export type ImpactType = "DRY" | "WET" | "COLD" | "WARM";
export type DayRisk = "H" | "M" | "L" | "-";

export interface CostComponent {
  label: string;
  share: number;   // 0–1
  usd: number;
  color: string;
}

export interface InputDetail {
  label: string;
  share: number;   // 0–1 of inputs total
  usd: number;
}

export interface WeatherRegion {
  name: string;
  frost: RiskLevel;
  drought: RiskLevel;
}

export interface DailyRiskRow {
  region: string;
  days: DayRisk[];  // length 14
}

export interface DroughtDayDetail {
  date: string;
  vpd: number;           // kPa
  precip_prob: number;   // %
  soil_moisture: number; // m³/m³ root-zone weighted
  drought_risk: DayRisk;
}

export interface DroughtDetailRow {
  region: string;
  days: DroughtDayDetail[];
}

// Current conditions from today's weather snapshot (replaces ForecastAccuracyPoint)
export interface CurrentCondition {
  region: string;
  temp_c: number;
  dew_point_c: number;
  cloud_cover_pct: number;
  wind_speed_kmh: number;
}

export interface OniHistoryPoint {
  month: string;      // "Oct-24"
  value: number;
  forecast?: boolean;
  preliminary?: boolean;
}

export interface OniForecastPoint {
  season: string;     // "MAM", "AMJ", …
  la_nina: number | null;
  neutral: number | null;
  el_nino: number | null;
}

export interface RegionalImpact {
  region: string;
  type: ImpactType;
  dots: number;       // 1–4
  note: string;
}

export interface FertilizerItem {
  name: string;
  price_usd_mt: number;
  mom_pct: number;
  sparkline: number[];   // 6 monthly prices, oldest first
  input_weight: number;
  base_usd_per_bag: number;
}

export interface FertilizerImportMonth {
  month: string;                    // "2026-01"
  urea_kt: number;
  kcl_kt: number;
  map_dap_kt: number;
  total_kt: number;
  total_fob_usd_m: number;
  urea_price_usd_mt:    number | null;
  kcl_price_usd_mt:     number | null;
  map_dap_price_usd_mt: number | null;
}

export interface FarmerEconomicsData {
  country: string;
  season: string;
  scraped_at: string;
  cost: {
    total_usd_per_bag: number;
    yoy_pct: number;
    season_label: string;
    components: CostComponent[];
    inputs_detail: InputDetail[];
    kc_spot: number;
    last_updated: string;
  } | null;
  acreage: { thousand_ha: number; yoy_pct: number; source_label: string } | null;
  yield:   { bags_per_ha: number; yoy_pct: number; source_label: string } | null;
  weather: {
    scraped_at: string;
    regions: WeatherRegion[];
    daily_frost: DailyRiskRow[];
    daily_drought: DailyRiskRow[];
    drought_detail?: DroughtDetailRow[];
    current_conditions: CurrentCondition[];
  } | null;
  enso: {
    phase: EnsoPhase;
    intensity: string;
    oni: number;
    peak_month: string;
    forecast_direction: string;
    oni_history: OniHistoryPoint[];
    oni_forecast: OniForecastPoint[];
    regional_impact: RegionalImpact[];
    historical_stat: string;
    last_updated: string;
  } | null;
  fertilizer: {
    items: FertilizerItem[];
    prices_as_of?: string;   // e.g. "Mar-2026" — last month with Comex data (FOB implied price)
    imports: {
      last_updated: string;
      monthly: FertilizerImportMonth[];
    } | null;
    next_application: string;
  };
}
