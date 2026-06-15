// Market-aware origin colors. KC palette is structured by ICE C-contract group
// (greens/blues/purples for Group 0, etc.); RC palette follows the origin spec
// (Vietnam dark blue, Indonesia blue, Brazil red-brown, African purples, …).
// Vietnam differs by market, so the dicts are separate; _originColor() routes.

export const KC_ORIGIN_COLORS: Record<string, string> = {
  "Costa Rica":        "#16a34a",
  "El Salvador":       "#22c55e",
  "Guatemala":         "#10b981",
  "Honduras":          "#14b8a6",
  "Mexico":            "#84cc16",
  "Nicaragua":         "#15803d",
  "Panama":            "#34d399",
  "Peru":              "#4ade80",
  "Papua New Guinea":  "#0ea5e9",
  "Kenya":             "#a855f7",
  "Tanzania":          "#9333ea",
  "Uganda":            "#c084fc",
  "Colombia":          "#14532d",
  "Burundi":           "#facc15",
  "India":             "#fb923c",
  "Rwanda":            "#fbbf24",
  "Venezuela":         "#fdba74",
  "Dominican Republic": "#f43f5e",
  "Ecuador":           "#ec4899",
  "Brazil":            "#7c2d12",
  "Vietnam":           "#92400e",
};

export const RC_ORIGIN_COLORS: Record<string, string> = {
  "Vietnam":                       "#1e3a8a",
  "Indonesia":                     "#3b82f6",
  "Brazil":                        "#7c2d12",
  "Brazilian Conillon":            "#7c2d12",
  "Uganda":                        "#a855f7",
  "Tanzania":                      "#9333ea",
  "Ethiopia":                      "#c084fc",
  "Cameroon":                      "#7e22ce",
  "Angola":                        "#6b21a8",
  "Cote dIvoire":                  "#9d4edd",
  "Cote d'Ivoire":                 "#9d4edd",
  "Ghana":                         "#a78bfa",
  "Guinea":                        "#8b5cf6",
  "Madagascar":                    "#7c3aed",
  "Republic of Madagascar":        "#7c3aed",
  "Sierra Leone":                  "#d8b4fe",
  "Togo":                          "#a855f7",
  "Nigeria":                       "#9d4edd",
  "DRC":                           "#7e22ce",
  "Congo":                         "#7e22ce",
  "Democratic Republic of Congo":  "#7e22ce",
  "India":                         "#0ea5e9",
  "Laos":                          "#06b6d4",
};
export const ORIGIN_DEFAULT = "#64748b";

export function _originColor(origin: string, market: "KC" | "RC"): string {
  const dict = market === "KC" ? KC_ORIGIN_COLORS : RC_ORIGIN_COLORS;
  return dict[origin] ?? ORIGIN_DEFAULT;
}
