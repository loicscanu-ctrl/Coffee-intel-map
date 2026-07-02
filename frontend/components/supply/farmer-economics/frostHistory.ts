// Major Brazilian frost disasters — historical anchor for the Frost Watch
// panel. Mirror of backend/seed/frost_events.json (source of truth; these are
// static historical facts). `airMinC` is a representative observed 2 m air
// minimum for the worst-hit region on the peak night; the canopy minimum ran
// several degrees colder.
export interface FrostEvent {
  id: string;
  label: string;
  year: number;
  regions: string;
  airMinC: number;
  mechanism: "radiative" | "advective" | "black";
  impact: string;
}

export const FROST_HISTORY: FrostEvent[] = [
  {
    id: "1975-black-frost",
    label: "Geada Negra (Black Frost)",
    year: 1975,
    regions: "Paraná · Sul de Minas · São Paulo",
    airMinC: -4.0,
    mechanism: "black",
    impact: "~70% of Brazil's coffee trees killed; permanent collapse of Paraná as the leading state. Prices ~tripled.",
  },
  {
    id: "1994-double-frost",
    label: "1994 double frost",
    year: 1994,
    regions: "Sul de Minas · São Paulo · Paraná",
    airMinC: -3.0,
    mechanism: "radiative",
    impact: "Two frosts ~two weeks apart wrecked the 1995 crop — worst since 1975. Prices spiked > 100%.",
  },
  {
    id: "2021-july-frosts",
    label: "July 2021 frosts",
    year: 2021,
    regions: "Sul de Minas · Cerrado · São Paulo · Paraná",
    airMinC: -1.5,
    mechanism: "radiative",
    impact: "Clear, calm radiative nights drove canopy minima well below −1.5 °C air. ~10–20% of the 2022/23 crop lost; arabica ~doubled.",
  },
];
