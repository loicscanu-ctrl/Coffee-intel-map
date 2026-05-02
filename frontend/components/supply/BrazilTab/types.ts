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

export interface DailyData {
  updated: string;
  arabica:  Record<string, Record<string, number>>; // "YYYY-MM" → { "1": cumBags, ... }
  conillon: Record<string, Record<string, number>>;
  soluvel:  Record<string, Record<string, number>>;
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
