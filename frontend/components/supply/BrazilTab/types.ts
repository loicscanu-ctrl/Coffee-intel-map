// Shared types for the Brazil tab decomposition.

export interface VolumeSeries {
  date: string;
  conillon: number;
  arabica: number;
  total_verde: number;
  torrado: number;
  soluvel: number;
  total_industria: number;
  total: number;
}

export interface CountryYear {
  months: string[];
  countries: Record<string, Record<string, number>>;
}

export interface CecafeData {
  source: string;
  report: string;
  updated: string;
  unit: string;
  series: VolumeSeries[];
  by_country: CountryYear;
  by_country_prev: CountryYear;
  by_country_arabica?: CountryYear;
  by_country_arabica_prev?: CountryYear;
  by_country_conillon?: CountryYear;
  by_country_conillon_prev?: CountryYear;
  by_country_soluvel?: CountryYear;
  by_country_soluvel_prev?: CountryYear;
  by_country_torrado?: CountryYear;
  by_country_torrado_prev?: CountryYear;
  by_country_history?: Record<string, CountryYear>;
}

export type CecafeSourceKey = "embarques" | "certificados";

/** One source's per-crop, per-month, per-day cumulative bags. */
export interface CecafeSourceBucket {
  arabica:  Record<string, Record<string, number>>;   // "YYYY-MM" → { "1": cumBags, … }
  conillon: Record<string, Record<string, number>>;
  soluvel:  Record<string, Record<string, number>>;
}

export interface DailyData {
  updated: string;
  /** schema v2: parallel series per Cecafé table.
   *    embarques    = physical port loadings (Unidades de Embarques Marítimos…)
   *    certificados = paperwork issued (Emissão de Certificados de Origem)
   *  Legacy v1 files with top-level arabica/conillon/soluvel are migrated to
   *  sources.certificados on read. */
  sources?: Record<CecafeSourceKey, CecafeSourceBucket>;
  /** Legacy v1 fields — kept on the interface so old files still type-check.
   *  Component code reads through normalizeSources() below. */
  arabica?:  Record<string, Record<string, number>>;
  conillon?: Record<string, Record<string, number>>;
  soluvel?:  Record<string, Record<string, number>>;
}

export type SeriesKey = "total" | "arabica" | "conillon" | "soluvel" | "torrado";

export interface FilterState {
  hub: string | null;
  country: string | null;
  type: SeriesKey | null;
}

export type ViewMode  = "country" | "hub";
export type CoffeeType = "total" | "arabica" | "conillon" | "soluvel" | "torrado";
export type DestWindow = "CTD" | "L1M" | "L3M" | "L6M" | "L12M";

/** SSOT projection emitted daily by `backend/scraper/brazil_export_forecast.py`.
 *  See backend module docstring for math. Three Brazil-tab charts consume this
 *  without doing any forecast math of their own. */
export type ProjectionStatus = "realized" | "certificados" | "seasonality";

export interface ProjectionMonth {
  month:  string;             // "Apr"
  value:  number;             // bags (60 kg)
  status: ProjectionStatus;
  ym?:    string;             // "YYYY-MM" (helper field; tolerant if absent)
}

export interface BrazilProjection {
  crop_year:           string;             // "26/27"
  annual_target:       number;             // bags
  monthly_curve:       ProjectionMonth[];  // 12 rows, Apr → Mar
  generated_at?:       string;
  target_source?:      string;             // e.g. "USDA PSD (year 2025)"
  safeguard_triggered?: boolean;
  realized_through?:   string;             // "YYYY-MM"
  last_year_total?:    number;
}
