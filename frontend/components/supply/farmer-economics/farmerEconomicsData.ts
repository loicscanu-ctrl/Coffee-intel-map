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

export interface ForecastAccuracyPoint {
  date: string;       // "Apr 8"
  forecast_c: number;
  actual_c: number;
}

export interface OniHistoryPoint {
  month: string;      // "Oct-24"
  value: number;
  forecast?: boolean;
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
  input_weight: number;  // fraction of total inputs cost; not all input categories have a FertilizerItem entry (pesticides + lime excluded)
  base_usd_per_bag: number;
}

export interface FarmerEconomicsData {
  country: string;
  season: string;
  cost: {
    total_usd_per_bag: number;
    yoy_pct: number;
    components: CostComponent[];
    inputs_detail: InputDetail[];
    kc_spot: number;
  };
  acreage: { thousand_ha: number; yoy_pct: number };
  yield:   { bags_per_ha: number; yoy_pct: number };
  weather: {
    regions: WeatherRegion[];
    daily_frost: DailyRiskRow[];
    daily_drought: DailyRiskRow[];
    forecast_accuracy: ForecastAccuracyPoint[];
    forecast_rmse: number;
    forecast_region: string;
  };
  enso: {
    phase: EnsoPhase;
    intensity: string;
    oni: number;
    peak_month: string;
    forecast_direction: string;
    oni_history: OniHistoryPoint[];
    regional_impact: RegionalImpact[];
    historical_stat: string;
  };
  fertilizer: {
    items: FertilizerItem[];
    next_application: string;
  };
}

// ── Mock data ────────────────────────────────────────────────────────────────

export const BRAZIL_FARMER_DATA: FarmerEconomicsData = {
  country: "brazil",
  season: "2025/26",
  cost: {
    total_usd_per_bag: 142,
    yoy_pct: 2.1,
    components: [
      { label: "Inputs",        share: 0.38, usd: 54, color: "#3b82f6" },
      { label: "Labor",         share: 0.27, usd: 38, color: "#22c55e" },
      { label: "Mechanization", share: 0.18, usd: 26, color: "#f59e0b" },
      { label: "Land rent",     share: 0.12, usd: 17, color: "#8b5cf6" },
      { label: "Admin",         share: 0.05, usd:  7, color: "#475569" },
    ],
    inputs_detail: [
      { label: "Nitrogen (urea / AN)",    share: 0.35, usd: 18 },
      { label: "Potassium (KCl)",         share: 0.25, usd: 14 },
      { label: "Phosphorus (MAP)",        share: 0.20, usd: 11 },
      { label: "Pesticides / fungicides", share: 0.15, usd:  8 },
      { label: "Lime / soil correction",  share: 0.05, usd:  3 },
    ],
    kc_spot: 302,
  },
  acreage: { thousand_ha: 2240, yoy_pct: 1.4 },
  yield:   { bags_per_ha: 32,   yoy_pct: -3.2 },
  weather: {
    regions: [
      { name: "Sul de Minas",  frost: "MED",  drought: "LOW"  },
      { name: "Cerrado",       frost: "NONE", drought: "HIGH" },
      { name: "Paraná",        frost: "HIGH", drought: "NONE" },
      { name: "Esp. Santo",    frost: "NONE", drought: "NONE" },
    ],
    daily_frost: [
      { region: "Sul de Minas", days: ["L","M","M","H","H","M","-","-","L","M","M","-","-","-"] },
      { region: "Paraná",       days: ["H","H","H","H","M","M","L","-","-","L","M","H","H","M"] },
    ],
    daily_drought: [
      { region: "Cerrado",      days: ["M","M","H","H","H","M","M","L","L","M","H","H","M","M"] },
      { region: "Sul de Minas", days: ["-","-","L","L","M","M","L","-","-","-","L","L","-","-"] },
    ],
    forecast_accuracy: [
      { date: "Apr 8",  forecast_c: 9.4,  actual_c: 9.7  },
      { date: "Apr 9",  forecast_c: 11.7, actual_c: 12.5 },
      { date: "Apr 10", forecast_c: 7.0,  actual_c: 6.8  },
      { date: "Apr 11", forecast_c: 6.0,  actual_c: 5.2  },
      { date: "Apr 12", forecast_c: 5.5,  actual_c: 7.8  },
      { date: "Apr 13", forecast_c: 8.0,  actual_c: 7.6  },
      { date: "Apr 14", forecast_c: 10.2, actual_c: 9.8  },
    ],
    // Pre-set display value; computed via computeRmse(forecast_accuracy) ≈ 1.0 over 7 sample days.
    // This field allows overriding with a longer historical window value if needed.
    forecast_rmse: 1.1,
    forecast_region: "Sul de Minas",
  },
  enso: {
    phase: "el-nino",
    intensity: "Moderate",
    oni: 1.4,
    peak_month: "Nov 2025",
    forecast_direction: "Neutral by Jun 2026",
    oni_history: [
      { month: "Oct-24", value: 0.1 },
      { month: "Nov-24", value: 0.3 },
      { month: "Dec-24", value: 0.6 },
      { month: "Jan-25", value: 0.9 },
      { month: "Feb-25", value: 1.1 },
      { month: "Mar-25", value: 1.3 },
      { month: "Apr-25", value: 1.5 },
      { month: "May-25", value: 1.7 },
      { month: "Jun-25", value: 1.6 },
      { month: "Jul-25", value: 1.5 },
      { month: "Aug-25", value: 1.3 },
      { month: "Sep-25", value: 1.1 },
      { month: "Oct-25", value: 0.9 },
      { month: "Nov-25", value: 0.7 },
      { month: "Dec-25", value: 0.5 },
      { month: "Jan-26", value: 0.3, forecast: true },
      { month: "Feb-26", value: 0.1, forecast: true },
      { month: "Mar-26", value: 0.0, forecast: true },
    ],
    regional_impact: [
      { region: "Sul de Minas", type: "DRY",  dots: 2, note: "rainfall −18% vs norm." },
      { region: "Cerrado",      type: "DRY",  dots: 3, note: "moisture deficit critical" },
      { region: "Paraná",       type: "COLD", dots: 2, note: "frost window +12 days" },
      { region: "Esp. Santo",   type: "WET",  dots: 1, note: "above-avg rainfall" },
    ],
    historical_stat: "El Niño years avg. Brazil arabica output −4.2% vs neutral",
  },
  fertilizer: {
    items: [
      {
        name: "Urea (N)",
        price_usd_mt: 312,
        mom_pct: 8.3,
        sparkline: [268, 274, 281, 290, 298, 312],
        input_weight: 0.35,
        base_usd_per_bag: 18.9,
      },
      {
        name: "MAP (P)",
        price_usd_mt: 584,
        mom_pct: 2.1,
        sparkline: [560, 565, 570, 572, 572, 584],
        input_weight: 0.20,
        base_usd_per_bag: 10.8,
      },
      {
        name: "KCl (K)",
        price_usd_mt: 278,
        mom_pct: -5.4,
        sparkline: [310, 305, 298, 292, 294, 278],
        input_weight: 0.25,
        base_usd_per_bag: 13.5,
      },
    ],
    next_application: "May–Jun",
  },
};
