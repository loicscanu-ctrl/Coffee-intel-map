// Port-name lookups + KC canonicalisation. The workbook + live scraper settle
// on long forms (NOLA, MIAMI, NY, HA/BR, VA, BAR) but older snapshots can carry
// short forms (NOR, MIA, NYK, HAM, VIR); _canonicalKC maps the aliases.

export const ARABICA_PORT_NAMES: Record<string, string> = {
  ANT:    "Antwerp",
  BAR:    "Barcelona",
  "HA/BR": "Hamburg/Bremen",
  HOU:    "Houston",
  MIAMI:  "Miami",
  NOLA:   "New Orleans",
  NY:     "New York",
  VA:     "Virginia",
};

const KC_PORT_ALIASES: Record<string, string> = {
  NOR:  "NOLA",
  NO:   "NOLA",
  MIA:  "MIAMI",
  MI:   "MIAMI",
  NYK:  "NY",
  HAM:  "HA/BR",
  HA:   "HA/BR",
  HO:   "HOU",
  VIR:  "VA",
};
export const _canonicalKC = (code: string): string => {
  const c = (code || "").toUpperCase();
  return KC_PORT_ALIASES[c] ?? c;
};

export const ROBUSTA_PORT_NAMES: Record<string, string> = {
  AMS: "Amsterdam",
  ANT: "Antwerp",
  BAR: "Barcelona",
  BRE: "Bremen",
  FEL: "Felixstowe",
  GEN: "Genoa",
  HAM: "Hamburg",
  HUL: "Hull",
  HUM: "Humberside",
  LEH: "Le Havre",
  LIV: "Liverpool",
  LON: "London",
  NOR: "Norfolk",
  NYK: "New York",
  ROT: "Rotterdam",
  TEE: "Teesside",
  TRI: "Trieste",
};
