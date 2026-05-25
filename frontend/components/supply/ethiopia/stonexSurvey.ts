// Ethiopia Coffee Crop Survey 2025/26 — StoneX (private research, not scraped).
// Field survey of 5 districts (Mana, Hambela, Gimbo, Shishonde, Bensa-Daye) +
// StoneX/USDA/ECTA secondary data. Stored as a static module so the daily
// ethiopia scraper (which owns ethiopia_supply.json) never overwrites it.
// Update when StoneX publishes the next crop survey.

export const STONEX_META = {
  source: "StoneX — Ethiopia Coffee Crop Survey",
  cropYear: "2025/26",
  authors: "StoneX Market Intelligence (Rossetti, Giraldo, Bezzon)",
  asOf: "Mar 2026",
  note: "Private research. Field survey of 5 representative districts + USDA/ECTA secondary data.",
};

// ── Headline (slide 2, 15-16) ────────────────────────────────────────────────
export const HEADLINE = {
  rankGlobal: 5,            // 5th-largest producer overall
  rankArabica: 3,          // 3rd-largest arabica (after Brazil, Colombia)
  avgYieldKgHa: 646,       // national avg green coffee per hectare
  production2526_mBags: 7.691,
  productionChangePct: -1.5,
  productivityChangePct: 18, // aggregate productivity vs prior year (W/SW-led)
  summary:
    "Center of origin for Coffea arabica and its largest genetic reserve; coffee is the main pillar of the economy. " +
    "Low average productivity (~646 kg/ha) reflects traditional smallholder practices. 2025/26 output ~7.69M bags (-1.5%) " +
    "masks a sharply asymmetric cycle: West & Southwest in a high year, South in a deep low.",
};

// ── Production by region, thousand 60-kg bags (slide 16) ──────────────────────
export type RegionRow = { region: string; y2324: number; y2425: number; y2526: number; changePct: number; sub?: RegionRow[] };
export const PRODUCTION_BY_REGION: RegionRow[] = [
  { region: "West", y2324: 3574, y2425: 3405, y2526: 4145, changePct: 21.7, sub: [
    { region: "Jimma",    y2324: 980,  y2425: 921,  y2526: 1170, changePct: 27.0 },
    { region: "Ilubabor", y2324: 997,  y2425: 968,  y2526: 1171, changePct: 21.0 },
    { region: "Wellega",  y2324: 1596, y2425: 1516, y2526: 1804, changePct: 19.0 },
  ]},
  { region: "Southwest", y2324: 1060, y2425: 929, y2526: 1387, changePct: 49.3, sub: [
    { region: "Kaffa",  y2324: 354, y2425: 255, y2526: 457, changePct: 79.2 },
    { region: "Sheka",  y2324: 298, y2425: 283, y2526: 410, changePct: 44.9 },
    { region: "Others", y2324: 407, y2425: 391, y2526: 520, changePct: 33.0 },
  ]},
  { region: "South", y2324: 2102, y2425: 3017, y2526: 1819, changePct: -39.7, sub: [
    { region: "Sidamo",             y2324: 503, y2425: 710,  y2526: 404, changePct: -43.1 },
    { region: "Gedeo (Yirgacheffe)", y2324: 754, y2425: 1271, y2526: 762, changePct: -40.1 },
    { region: "Borena (Guji)",      y2324: 449, y2425: 628,  y2526: 408, changePct: -35.1 },
    { region: "Others",             y2324: 396, y2425: 408,  y2526: 245, changePct: -40.0 },
  ]},
  { region: "East (Harar)", y2324: 350, y2425: 418, y2526: 306, changePct: -26.8, sub: [
    { region: "Bale",            y2324: 85,  y2425: 94,  y2526: 88, changePct: -6.3 },
    { region: "Harar Occidental", y2324: 167, y2425: 218, y2526: 146, changePct: -32.9 },
    { region: "Harar Oriental",  y2324: 97,  y2425: 107, y2526: 72,  changePct: -32.5 },
  ]},
  { region: "North", y2324: 36, y2425: 40, y2526: 34, changePct: -14.1 },
];
export const PRODUCTION_TOTAL = { region: "Ethiopia", y2324: 7121, y2425: 7809, y2526: 7691, changePct: -1.5 };

// ── Supply & demand balance, thousand 60-kg bags (slide 20) ───────────────────
export type SDRow = { year: string; opening: number; production: number; total: number; consumption: number; exports: number; ending: number };
export const SD_BALANCE: SDRow[] = [
  { year: "19/20", opening: 1355, production: 7197, total: 8552, consumption: 2924, exports: 4063, ending: 1565 },
  { year: "20/21", opening: 1565, production: 7320, total: 8885, consumption: 2647, exports: 4622, ending: 1616 },
  { year: "21/22", opening: 1616, production: 7839, total: 9455, consumption: 2940, exports: 4867, ending: 1648 },
  { year: "22/23", opening: 2088, production: 6993, total: 9081, consumption: 2000, exports: 3872, ending: 3209 },
  { year: "23/24", opening: 3209, production: 7121, total: 10330, consumption: 1700, exports: 5940, ending: 2690 },
  { year: "24/25", opening: 2690, production: 7809, total: 10499, consumption: 1600, exports: 7816, ending: 1083 },
  { year: "25/26", opening: 1083, production: 7691, total: 8774, consumption: 1500, exports: 5480, ending: 1794 },
];

// ── Exports outlook (slide 17) ────────────────────────────────────────────────
export const EXPORTS_OUTLOOK = {
  record2425: { bagsM: 7.8, revenueUsdBn: 2.65 },
  forecast2526: { bagsM: 5.48, changePct: -30 },
  ectaNote: "ECTA: ~200k MT shipped in H1 FY2025/26, then lost pace; gradual recovery expected in H2.",
  drivers: [
    "International prices fell from the ~USD 4/lb peak, cutting the incentive to sell.",
    "Producers are holding stocks, betting on higher prices — intensified by birr depreciation, which turns physical coffee into a currency hedge.",
    "Exporters who bought domestically at high prices can't close profitable external deals → margin compression slows shipments.",
  ],
};

// ── Currency & inflation (slide 18) ───────────────────────────────────────────
export const FX_INFLATION = {
  birrPerUsd_2yAgo: 58,
  birrPerUsd_mar26: 153,
  depreciationPct: 160,
  inflation_mar25_pct: 26.6,
  summary:
    "USD/Birr went from ~58 (two years ago) to ~153 by Mar 2026 (~160% depreciation); inflation 26.6% (Mar 2025). " +
    "Farmers increasingly treat stored coffee as a more reliable store of value than cash — a key driver of the export drop.",
};

// ── Domestic consumption (slide 19) ───────────────────────────────────────────
export const DOMESTIC_CONSUMPTION = {
  series_mBags: [
    { year: "19/20", value: 2.924 },
    { year: "20/21", value: 2.647 },
    { year: "21/22", value: 2.940 },
    { year: "22/23", value: 2.000 },
    { year: "23/24", value: 1.700 },
    { year: "24/25", value: 1.600 },
    { year: "25/26", value: 1.500 },
  ],
  declinePct6y: 49,
  retail: {
    cityGreenBirrKg: "1,500–1,600",
    cityGreenPriorYearBirrKg: "~800",
    producingRegionBirrKg: "1,000–1,300 (was 400–600)",
  },
  context:
    "Per-capita GDP ~USD 940/yr (~USD 78/mo ≈ Birr 12,063). 1 kg/month in cities now commits >12% of monthly income — " +
    "unviable for low/middle-income urban consumers. Farmers (self-supplied) keep drinking 2-3×/day; the hit is on urban demand.",
};

// ── Preliminary 2026/27 estimate, thousand bags (slide 21) ────────────────────
export const FORECAST_2627 = {
  rows: [
    { region: "West",      y2526: 4145, y2627: 3315, changePct: -20.0 },
    { region: "Southwest", y2526: 1387, y2627: 971,  changePct: -30.0 },
    { region: "South",     y2526: 1819, y2627: 2910, changePct: 60.0 },
    { region: "East",      y2526: 306,  y2627: 345,  changePct: 12.7 },
    { region: "North",     y2526: 34,   y2627: 39,   changePct: 14.7 },
  ],
  total: { region: "Ethiopia", y2526: 7691, y2627: 7580, changePct: -1.4 },
  note:
    "Biennial cycle inverts: South returns to high cycle (+60%), Southwest enters low cycle (-30%). " +
    "Caution: many recently-planted young trees in the South (e.g. Bensa-Daye, 25% <4yr) won't be in full production yet, " +
    "which may temper the South's rebound. Full benefit of replanting expected from 2027/28.",
};

// ── Surveyed districts (slides 4-5, 15) ───────────────────────────────────────
export type District = {
  name: string; zone: string; region: "West" | "Southwest" | "South"; cycle: "high" | "low";
  altitude: string; rainfall: string; temp: string; wetUnits: number; dryUnits: number;
  prodChangePct: number; yield2425: number; yield2526: number; avgAreaHa: number;
};
export const DISTRICTS: District[] = [
  { name: "Mana",       zone: "Jimma",  region: "West",      cycle: "high", altitude: "1,470–2,610 m", rainfall: "1,979 mm", temp: "13–27 °C",     wetUnits: 31, dryUnits: 24, prodChangePct: 38,  yield2425: 397.4, yield2526: 549.3, avgAreaHa: 1.0 },
  { name: "Gimbo",      zone: "Kaffa",  region: "Southwest", cycle: "high", altitude: "1,000–2,400 m", rainfall: "—",        temp: "12.8–27.8 °C", wetUnits: 55, dryUnits: 26, prodChangePct: 119, yield2425: 260.3, yield2526: 570.4, avgAreaHa: 0.7 },
  { name: "Shishonde",  zone: "Kaffa",  region: "Southwest", cycle: "high", altitude: "1,000–2,400 m", rainfall: "—",        temp: "8.5–23.7 °C",  wetUnits: 55, dryUnits: 26, prodChangePct: 95,  yield2425: 289.5, yield2526: 565.7, avgAreaHa: 0.6 },
  { name: "Bensa-Daye", zone: "Sidama", region: "South",     cycle: "low",  altitude: "—",             rainfall: "1,700 mm", temp: "11.5–26.6 °C", wetUnits: 38, dryUnits: 5,  prodChangePct: -19, yield2425: 405.8, yield2526: 326.9, avgAreaHa: 1.4 },
  { name: "Hambela",    zone: "Guji",   region: "South",     cycle: "low",  altitude: "1,400–2,200 m", rainfall: "900–1,600 mm", temp: "24–27 °C",  wetUnits: 16, dryUnits: 22, prodChangePct: -26, yield2425: 600.3, yield2526: 442.2, avgAreaHa: 1.3 },
];

// ── Demographics (slide 6) ────────────────────────────────────────────────────
export const DEMOGRAPHICS = {
  avgFamilyMembersRange: "6.2–9.3",
  householdHeadAgeRange: "39–51",
  typicalHoldingHa: "≤ 1",
  note:
    "Family-based farming on small plots (generally ≤1 ha) with large households (6–10 members). Heads older in Mana, " +
    "younger in Bensa-Daye. Fragmentation limits productive scale and access to inputs/equipment.",
};

// ── Agronomic practices, % of surveyed farmers (slide 7) ──────────────────────
// Column order: Mana(W), Hambela(S), Gimbo(SW), Shishonde(SW), Bensa-Daye(S).
export const AGRONOMY = {
  districts: ["Mana", "Hambela", "Gimbo", "Shishonde", "Bensa-Daye"],
  practices: [
    { label: "Row planting (2×2 m)",     values: [100, 13, 100, 100, 93] },
    { label: "Has pruning shears",        values: [14, 0, 2, 0, 35] },
    { label: "Performs pruning/training", values: [19, 0, 2, 2, 48] },
    { label: "Performed stumping",        values: [57, 2, 29, 27, 45] },
    { label: "Planted new seedlings",     values: [95, 45, 71, 76, 75] },
    { label: "Applies organic fertilizer", values: [62, 23, 39, 66, 92] },
    { label: "Grown under shade",         values: [100, 5, 100, 100, 100] },
    { label: "Optimized shade density",   values: [100, 57, 100, 100, 10] },
  ],
  note:
    "Row planting is widely adopted except Hambela (86.7% still random). Pruning is the main bottleneck — almost no shears " +
    "in Hambela/Gimbo/Shishonde, so unproductive branches compete for nutrients. New-seedling planting is advancing fast, " +
    "motivated by recent high prices.",
};

// ── Tree-age structure (slide 8) ──────────────────────────────────────────────
export const TREE_AGE = {
  summary:
    "Crops are mostly at productive age (5–25 yr). Two imbalances stand out: Mana has >1/3 of trees over 25 yr (aging), " +
    "while Bensa-Daye shows a high share of young (<4 yr) not-yet-productive trees — strong recent replanting. Renewal, " +
    "driven by high prices, is structurally positive but its yield benefit should materialise mainly from 2027/28.",
  manaOldSharePct: 36,           // >25 yr in Mana
  bensaYoungSharePct: 25,        // <4 yr in Bensa-Daye
  avgSeedlingsPlantedLastYear: { "Bensa-Daye": 1049.4, "Hambela": 351.6, "Gimbo": 203.8, "Shishonde": 342.8, "Mana": 344.6 },
};
