// Indonesia-side mirror of BrazilTab/types.ts. Same chart vocabulary
// (series, country-years, type filters, destination windows) re-cast
// for the BPS Web API payload at frontend/public/data/indonesia_exports.json.
//
// Type semantics differ from Brazil:
//   • Brazil splits arabica / conillon / soluble / roasted across the chart
//     stack. BPS only gives us species at the HS-2022 level — so the
//     Indonesia stack is arabica / robusta / other, where "other" sweeps up
//     decaf, roasted, husks, substitutes, plus the BTKI-2017 lumped code
//     09011110 from pre-Apr-2022 months.
//   • Unit on the wire is kilograms; charts work in metric tons (kt).

export type SeriesKey = "total" | "arabica" | "robusta" | "other";

export interface VolumeSeries {
  date:    string;      // "YYYY-MM"
  arabica: number;      // kg (HS 09011120 only)
  robusta: number;      // kg (HS 09011130 only)
  other:   number;      // kg (everything else under HS-0901xx in our allowlist)
  total:   number;      // kg
}

// Per-{country|port}, per-month volume map. Mirrors Brazil's CountryYear
// but indexed by English country names (no PT translation needed since
// BPS publishes destinations in uppercase English).
export interface CountryYear {
  months:    string[];                                 // ["YYYY-MM", …]
  countries: Record<string, Record<string, number>>;   // ctr → ym → kg
}

export interface IndonesiaExportsData {
  source:     string;
  source_url: string;
  scraped_at: string;
  series:                  VolumeSeries[];
  by_country:              CountryYear;   // total, current crop-year
  by_country_prev:         CountryYear;   // total, prev crop-year
  by_country_arabica:      CountryYear;
  by_country_arabica_prev: CountryYear;
  by_country_robusta:      CountryYear;
  by_country_robusta_prev: CountryYear;
  by_country_history:      Record<string, CountryYear>;  // crop-key → CountryYear (totals)
  by_port:                 CountryYear;
  by_port_prev:            CountryYear;
  by_port_history:         Record<string, CountryYear>;
}

export interface FilterState {
  hub:     string | null;
  country: string | null;
  port:    string | null;
  type:    SeriesKey | null;
}

export type ViewMode   = "country" | "port" | "hub";
export type DestWindow = "CTD" | "L1M" | "L3M" | "L6M" | "L12M";
