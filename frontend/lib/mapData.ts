// ── Origin ports (loading) ─────────────────────────────────────────────────────
export const PORTS: { n: string; l: [number, number] }[] = [
  { n: "Santos",          l: [-23.9,  -46.3]  },
  { n: "Paranaguá",       l: [-25.52, -48.53] },
  { n: "Rio de Janeiro",  l: [-22.9,  -43.2]  },
  { n: "Vitoria",         l: [-20.3,  -40.3]  },
  { n: "Salvador",        l: [-12.97, -38.50] },
  { n: "Varginha",        l: [-21.55, -45.43] },
  { n: "Cartagena", l: [10.4, -75.5] },
  { n: "Buenaventura", l: [3.88, -77.0] },
  { n: "Puerto Cortés", l: [15.8, -87.9] },
  { n: "Veracruz", l: [19.17, -96.13] },
  { n: "Ho Chi Minh City", l: [10.7, 106.6] },
  { n: "Jakarta", l: [-6.1, 106.8] },
  { n: "Mombasa", l: [-4.0, 39.6] },
  { n: "Cape Town", l: [-33.92, 18.42] },
  { n: "Chennai", l: [13.08, 80.27] },
  { n: "Tuticorin", l: [8.76, 78.13] },
  { n: "Antwerp", l: [51.22, 4.40] },
  { n: "Hamburg", l: [53.55, 9.99] },
  { n: "Trieste", l: [45.65, 13.78] },
  { n: "New York", l: [40.7, -74.0] },
  { n: "New Orleans", l: [29.9, -90.0] },
  { n: "Oakland", l: [37.8, -122.4] },
  { n: "Los Angeles", l: [33.7, -118.2] },
  { n: "Tokyo", l: [35.6, 139.6] },
  { n: "Singapore", l: [1.2, 103.8] },
  { n: "Barcelona", l: [41.38, 2.17] },
  { n: "Le Havre", l: [49.49, 0.10] },
  { n: "Basel", l: [47.55, 7.59] },
  { n: "London (Gateway)", l: [51.50, 0.50] },
  { n: "Genoa", l: [44.41, 8.93] },
  { n: "Algiers", l: [36.77, 3.06] },
  { n: "Shanghai", l: [31.23, 121.47] },
  { n: "Djibouti", l: [11.82, 43.14] },
  { n: "Sydney", l: [-33.86, 151.20] },
  { n: "Vienna", l: [48.20, 16.37] },
  { n: "Budapest", l: [47.49, 19.04] },
  { n: "Katowice", l: [50.26, 19.02] },
  { n: "Gioia Tauro", l: [38.43, 15.91] },
  { n: "Mersin", l: [36.81, 34.63] },
  { n: "Gothenburg", l: [57.71, 11.97] },
];

// ── Destination hub markers (one per regional hub) ────────────────────────────
// Hubs without an existing port in PORTS get a new marker here.
export const HUB_PORTS: { hub: string; n: string; l: [number, number] }[] = [
  { hub: "Nordics",        n: "Nordics Hub (Copenhagen)",          l: [55.68, 12.57] },
  { hub: "Eastern Europe", n: "Eastern Europe Hub (Gdansk)",        l: [54.35, 18.65] },
  { hub: "Latin America",  n: "Latin America Hub (Cartagena)",      l: [10.4, -75.5]  },
  { hub: "Middle East",    n: "Middle East Hub (Dubai)",             l: [25.27, 55.30] },
  { hub: "Russia & CIS",   n: "Russia & CIS Hub (St. Petersburg)",  l: [59.94, 30.32] },
];

// ── Basemap tile providers ────────────────────────────────────────────────────
export const BASEMAPS = [
  {
    id: "dark",
    label: "Dark",
    desc: "High contrast — best for route visibility",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attr: "© CARTO",
  },
  {
    id: "light",
    label: "Light",
    desc: "Clean reference view with geographic detail",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attr: "© CARTO",
  },
  {
    id: "satellite",
    label: "Satellite",
    desc: "True color imagery — shows agriculture & land use",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: "",
    attr: "© Esri, Maxar",
  },
  {
    id: "physical",
    label: "Physical",
    desc: "Terrain & climate zones — latitude bands visible",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
    subdomains: "",
    attr: "© Esri",
  },
  {
    id: "topo",
    label: "Topo",
    desc: "Topographic — altitude + lat/lon grid",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    attr: "© OpenTopoMap contributors",
  },
];

export const ROUTES: {
  name: string;
  color: string;
  weight?: number;
  path: [number, number][];
  /** Cecafe hub names whose export volumes to show on click */
  cecafeHubs?: string[];
  /** VN Customs hub names whose export volumes to show on click */
  vnHubs?: string[];
}[] = [

  // ═══════════════════════════════════════════════════════════
  // MAIN TRUNK: Singapore → Antwerp (Malacca → Indian Ocean → Suez → Med → Channel)
  // ═══════════════════════════════════════════════════════════
  {
    name: "Singapore → Antwerp (Main Trunk)",
    color: "#ffffff",
    weight: 4,
    path: [
      [1.26, 103.8],   // Singapore
      [3.0, 100.5],    // Malacca Strait
      [5.5, 98.0],     // Malacca Strait N
      [5.8, 95.5],     // Bay of Bengal  ← Chennai feeder junction
      [5.8, 80.4],     // Indian Ocean   ← Tuticorin feeder junction
      [10.0, 65.0],    // Arabian Sea
      [14.0, 55.0],    // Gulf of Aden approach  ← Middle East spur junction
      [12.5, 45.0],    // Red Sea
      [12.6, 43.3],    // Bab-el-Mandeb  ← Uganda / Djibouti feeder junction
      [18.0, 40.0],    // Red Sea
      [22.0, 38.0],    // Red Sea N
      [27.0, 34.5],    // Gulf of Suez approach
      [29.5, 32.55],   // Suez Canal S
      [31.2, 32.3],    // Suez Canal
      [32.5, 31.0],    // Port Said area
      [34.0, 25.0],    // Eastern Med
      [36.0, 15.0],    // Central Med  ← Trieste / Gioia Tauro branch junction
      [37.5, 10.0],    // Western Med  ← Genoa branch junction
      [37.5, 3.0],     // Western Med  ← Barcelona / Algiers branch junction
      [37.0, 0.0],     // Near Ibiza
      [36.0, -5.3],    // Gibraltar
      [37.0, -10.0],   // Atlantic off Portugal
      [43.0, -11.0],   // Bay of Biscay
      [48.0, -7.0],    // Channel entry  ← Brazil / Honduras routes terminate here
      [49.5, -3.5],    // English Channel
      [50.0, -1.0],    // English Channel  ← Le Havre spur junction
      [50.5, 0.0],     // English Channel
      [51.2, 1.8],     // Strait of Dover  ← London spur junction
      [52.0, 3.0],     // North Sea  ← Hamburg spur junction
      [51.8, 3.5],     // Turn toward Antwerp
      [51.26, 4.35],   // Antwerp
    ],
    cecafeHubs: ["Nordics", "Central Europe", "South Europe", "Eastern Europe", "Middle East", "North Africa", "Russia & CIS"],
  },

  // North Sea spur: junction → Hamburg
  {
    name: "North Sea → Hamburg",
    color: "#ffffff",
    weight: 3,
    path: [[52.0, 3.0], [53.5, 6.0], [54.0, 8.0], [53.55, 9.99]],
  },

  // Pacific arrival corridor: mid-Pacific → Los Angeles
  {
    name: "Pacific → Los Angeles (arrival)",
    color: "#2ecc71",
    weight: 3,
    path: [
      [22.0, -165.0],
      [26.0, -148.0],
      [30.0, -133.0],
      [33.7, -118.2],
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // FEEDERS → MAIN TRUNK
  // ═══════════════════════════════════════════════════════════

  // HCMC → Singapore (with VN export popup)
  {
    name: "Feeder: HCMC → Singapore",
    color: "#2ecc71",
    path: [[10.76, 106.78], [8.0, 106.0], [3.0, 105.0], [1.26, 103.8]],
    vnHubs: ["Nordics", "Central Europe", "South Europe", "Eastern Europe", "North America",
             "East Asia", "SE Asia & Pacific", "Middle East", "North Africa",
             "Sub-Saharan Africa", "South Asia", "Russia & CIS"],
  },

  // Jakarta → Singapore
  {
    name: "Feeder: Jakarta → Singapore",
    color: "#9b59b6",
    path: [[-6.10, 106.88], [-3.0, 106.0], [1.26, 103.8]],
  },

  // India spurs
  {
    name: "Spur: Trunk → Tuticorin",
    color: "#00875a",
    path: [[5.8, 80.4], [7.5, 79.0], [8.76, 78.13]],
  },
  {
    name: "Spur: Trunk → Chennai",
    color: "#00875a",
    path: [[5.8, 95.5], [10.0, 90.0], [13.08, 80.27]],
  },

  // East Africa → Red Sea trunk junction
  {
    name: "Feeder: Uganda → Red Sea Trunk",
    color: "#f39c12",
    path: [[-4.04, 39.66], [-4.0, 42.0], [0.0, 48.0], [5.0, 55.0], [12.0, 52.0], [12.5, 45.0], [12.6, 43.3]],
  },
  {
    name: "Feeder: Djibouti → Red Sea Trunk",
    color: "#f39c12",
    path: [[11.82, 43.14], [12.2, 43.5], [12.6, 43.3]],
  },

  // ── NEW HUB SPURS ─────────────────────────────────────────
  // Middle East hub: trunk junction → Gulf of Oman → Dubai
  {
    name: "Spur: Gulf of Aden → Dubai",
    color: "#f39c12",
    weight: 2,
    path: [
      [14.0, 55.0],   // Arabian Sea junction (main trunk)
      [18.0, 57.5],   // Gulf of Aden / Oman approach
      [22.5, 59.5],   // SE Oman coast
      [24.5, 58.5],   // Muscat / Gulf of Oman
      [25.5, 57.0],   // Strait of Hormuz E
      [26.0, 56.2],   // Strait of Hormuz
      [25.27, 55.30], // Dubai
    ],
  },

  // Nordics hub: Hamburg → Copenhagen
  {
    name: "Spur: Hamburg → Copenhagen",
    color: "#ffffff",
    weight: 2,
    path: [[53.55, 9.99], [54.3, 10.7], [55.0, 11.5], [55.68, 12.57]],
  },

  // Eastern Europe hub: Hamburg → Baltic → Gdansk
  {
    name: "Spur: Hamburg → Gdansk",
    color: "#ffffff",
    weight: 2,
    path: [[53.55, 9.99], [54.0, 10.5], [54.2, 12.5], [54.3, 15.5], [54.35, 18.65]],
  },

  // Russia & CIS hub: Hamburg → Baltic → St. Petersburg
  {
    name: "Spur: Hamburg → St. Petersburg",
    color: "#9b59b6",
    weight: 2,
    path: [
      [53.55, 9.99],  // Hamburg
      [54.0, 10.5],   // Kiel area
      [55.0, 12.5],   // Oresund (Denmark/Sweden)
      [55.5, 16.0],   // Baltic W
      [56.5, 18.5],   // Baltic central
      [57.5, 21.5],   // Baltic E (Latvia area)
      [59.5, 24.5],   // Gulf of Finland W
      [59.94, 30.32], // St. Petersburg
    ],
  },
  // ─────────────────────────────────────────────────────────

  // Mediterranean port spurs
  {
    name: "Spur: Med → Trieste",
    color: "#f39c12",
    path: [[36.0, 15.0], [39.8, 19.2], [42.5, 16.0], [44.5, 13.5], [45.64, 13.76]],
  },
  {
    name: "Spur: Med → Gioia Tauro",
    color: "#f39c12",
    path: [[36.0, 15.0], [37.6, 15.3], [38.2, 15.5], [38.43, 15.91]],
  },
  {
    name: "Spur: Med → Genoa",
    color: "#16a085",
    path: [[37.5, 10.0], [39.0, 11.0], [41.5, 10.5], [43.5, 9.5], [44.41, 8.93]],
  },
  {
    name: "Spur: Med → Algiers",
    color: "#16a085",
    path: [[37.5, 3.0], [36.77, 3.06]],
  },
  {
    name: "Deviation: Med → Barcelona",
    color: "#16a085",
    path: [[37.5, 3.0], [39.0, 2.5], [41.38, 2.17]],
  },

  // English Channel port spurs
  {
    name: "Spur: Channel → Le Havre",
    color: "#16a085",
    path: [[50.0, -1.0], [49.8, 0.0], [49.49, 0.10]],
  },
  {
    name: "Spur: Channel → London",
    color: "#16a085",
    path: [[51.2, 1.8], [51.5, 1.0], [51.50, 0.50]],
  },

  // ═══════════════════════════════════════════════════════════
  // AMERICAS ROUTES
  // ═══════════════════════════════════════════════════════════

  // ── Brazil trunks (Santos origin) ───────────────────────────────────────
  //
  // Architecture (cleaned up): two main trunks share Santos.
  //
  //   East trunk:  Santos → Atlantic divergence (NY + Cartagena peel off NW)
  //                       → Gibraltar (Med branch peels off E to Mersin,
  //                                    reusing existing Med spurs for
  //                                    Algiers / Barcelona / Genoa / Trieste
  //                                    / Gioia Tauro)
  //                       → Bay of Biscay → Channel → North Sea → Baltic
  //                       → St Petersburg, with spurs to Le Havre, London,
  //                         Antwerp, Hamburg, Gothenburg.
  //
  //   South trunk: Santos → Cape Town (terminus spur) → Indian Ocean
  //                       → Tuticorin spur → Malacca → Shanghai spur
  //                       → Tokyo.
  //
  // Vitória feeds the East trunk in mid Atlantic. Old separate routes to
  // West Africa, North Africa, the Conilon/Cartagena leg, and the two
  // standalone Santos→Channel/NY routes are absorbed into these trunks.

  // Atlantic divergence point (shared waypoint for trunk + NY/Cartagena spurs)
  //   [-5.0, -32.0]   off Cabo de São Roque (Brazil's NE peak) — same coords
  //                   shared on all three routes so they visually overlap until
  //                   peeling off in the right places
  // Med divergence point
  //   [37.0, -12.0]   off Cape St. Vincent in the deep Atlantic; the main
  //                   trunk continues N to the Channel, the Med branch peels
  //                   off SE through Gibraltar.

  // ─────────────────────────────────────────────────────────────────────────
  // BRAZIL EAST TRUNK: Santos → St Petersburg
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Brazil East Trunk: Santos → St Petersburg",
    color: "#e74c3c",
    weight: 4,
    path: [
      [-23.95, -46.3],  // Santos
      [-18.0,  -38.0],  // off Vitória (Vitória feeder joins here)
      [-10.0,  -32.0],  // mid Brazilian coast
      [-5.0,   -32.0],  // off Cabo de São Roque (divergence 1: NY + Cartagena peel off)
      [5.0,    -22.0],  // mid Atlantic, heading NE (away from Brazil's NE coast)
      [15.0,   -18.0],  //
      [25.0,   -15.0],  //
      [33.0,   -12.0],  // off NW Africa
      [37.0,   -12.0],  // off Cape St. Vincent (divergence 2: Med branch peels off SE)
      [43.0,   -11.0],  // Bay of Biscay
      [48.0,   -7.0],   // Channel entry
      [50.0,   -1.0],   // English Channel (Le Havre spur junction — existing)
      [51.2,    1.8],   // Dover Strait (London spur junction — existing)
      [52.0,    3.0],   // North Sea (Antwerp + Hamburg spur junctions)
      [54.0,    8.0],   // North Sea N
      [55.0,   12.5],   // Oresund (Gothenburg spur junction)
      [56.5,   18.5],   // Baltic central
      [57.5,   21.5],   // Baltic E
      [59.5,   24.5],   // Gulf of Finland W
      [59.94,  30.32],  // St Petersburg
    ],
    cecafeHubs: ["Nordics", "Central Europe", "South Europe", "Eastern Europe", "Russia & CIS"],
  },

  // Atlantic divergence → NY. Peels off at Cabo de São Roque, heads NNW
  // through the open Atlantic well east of the Caribbean Antilles, then
  // approaches the US coast off Cape Hatteras.
  {
    name: "Brazil East Spur: Atlantic → NY",
    color: "#e74c3c",
    path: [
      [-5.0,  -32.0],   // divergence 1 (shared with trunk)
      [0.0,   -38.0],   // equatorial Atlantic, paralleling NE Brazil coast
      [5.0,   -45.0],   // NE of Cabo Branco, well offshore
      [15.0,  -50.0],   // mid Atlantic, east of the Lesser Antilles
      [25.0,  -60.0],   // Atlantic, SE of Bermuda
      [33.0,  -72.0],   // offshore Cape Hatteras
      [38.0,  -73.0],   // offshore Delaware Bay
      [40.5,  -73.8],   // New York
    ],
    cecafeHubs: ["North America"],
  },

  // Atlantic divergence → Cartagena. Peels off at Cabo de São Roque, hugs
  // the Guianas coast offshore (~3°N of land), enters the Caribbean north
  // of Trinidad, tracks N of Venezuela & the Goajira peninsula, and turns
  // south to Cartagena.
  {
    name: "Brazil East Spur: Atlantic → Cartagena",
    color: "#e74c3c",
    path: [
      [-5.0,  -32.0],   // divergence 1 (shared with trunk)
      [0.0,   -38.0],   // equatorial Atlantic (shared with NY spur initially)
      [5.0,   -45.0],   // NE of Cabo Branco (shared with NY spur)
      [7.0,   -52.0],   // offshore French Guiana
      [9.0,   -58.0],   // offshore Guyana / Suriname
      [11.0,  -62.0],   // Caribbean, NW of Trinidad
      [12.5,  -68.0],   // Caribbean, N of Curaçao
      [13.0,  -73.0],   // N of the Goajira peninsula
      [11.0,  -76.0],   // turning south toward Cartagena
      [10.4,  -75.5],   // Cartagena
    ],
    cecafeHubs: ["Latin America"],
  },

  // Med branch: peels off the main trunk in the deep Atlantic off Cape St.
  // Vincent, enters the Med at Gibraltar, then reuses the existing Med
  // spurs at the [37.5, 3.0] / [37.5, 10.0] / [36.0, 15.0] junctions for
  // Algiers, Barcelona, Genoa, Trieste and Gioia Tauro before continuing
  // east to Mersin.
  {
    name: "Brazil East Branch: Atlantic → Mersin (via Gibraltar / Med)",
    color: "#e74c3c",
    weight: 3,
    path: [
      [37.0,  -12.0],   // divergence 2 — off Cape St. Vincent (shared with trunk)
      [36.0,   -8.5],   // SW of Cape St. Vincent, heading SE
      [36.0,   -5.3],   // Gibraltar
      [37.0,    0.0],   // near Ibiza
      [37.5,    3.0],   // Western Med — Barcelona / Algiers junction (existing)
      [37.5,   10.0],   // Western Med — Genoa junction (existing)
      [36.0,   15.0],   // Central Med — Trieste / Gioia Tauro junction (existing)
      [34.0,   25.0],   // Eastern Med
      [36.0,   33.0],   // off Cyprus
      [36.81,  34.63],  // Mersin
    ],
    cecafeHubs: ["Middle East", "Eastern Europe"],
  },

  // North-Europe spurs off the East Trunk
  {
    name: "Brazil East Spur: North Sea → Antwerp",
    color: "#e74c3c",
    weight: 2,
    path: [[52.0, 3.0], [51.8, 3.5], [51.22, 4.40]],
  },
  {
    name: "Brazil East Spur: Oresund → Gothenburg",
    color: "#e74c3c",
    weight: 2,
    path: [[55.0, 12.5], [57.0, 12.0], [57.71, 11.97]],
  },

  // Vitória feeder: joins the East Trunk near the mid-Atlantic Brazilian coast
  {
    name: "Feeder: Vitória → Brazil East Trunk",
    color: "#e74c3c",
    weight: 2,
    path: [[-20.3, -40.3], [-19.0, -39.0], [-18.0, -38.0]],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // BRAZIL SOUTH TRUNK: Santos → Tokyo (via Cape, Tuticorin, Shanghai)
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "Brazil South Trunk: Santos → Tokyo",
    color: "#e74c3c",
    weight: 4,
    path: [
      [-23.95, -46.3],  // Santos
      [-28.0,  -40.0],  // S Atlantic
      [-36.0,  -20.0],  // Mid S Atlantic
      [-37.0,   0.0],   // S Atlantic E (stays at ~37°S to clear Africa to the south)
      [-37.0,  15.0],   // S of Africa
      [-36.0,  18.5],   // S of Cape Town (Cape Town spur peels off N here)
      [-36.0,  22.0],   // rounding Cape Agulhas
      [-37.0,  35.0],   // S Indian Ocean (well south of Madagascar)
      [-32.0,  50.0],   // east of Madagascar's southern tip
      [-20.0,  55.0],   // east of central Madagascar
      [-10.0,  60.0],   // NE Indian Ocean (clear of all land)
      [-3.0,   70.0],   // central Indian Ocean
      [4.0,    78.0],   // S of Sri Lanka
      [5.8,    80.4],   // Tuticorin spur junction (existing — reused)
      [5.8,    95.5],   // Bay of Bengal
      [5.5,    98.0],   // Malacca Strait N
      [3.0,   100.5],   // Mid Malacca
      [1.26,  103.8],   // Singapore (passing through)
      [8.0,   110.0],   // S China Sea
      [15.0,  116.0],   // S China Sea, W of Luzon
      [22.0,  123.0],   // Luzon Strait
      [30.0,  128.0],   // East China Sea (Shanghai spur junction — existing)
      [33.0,  134.0],   //
      [35.61, 139.78],  // Tokyo
    ],
    cecafeHubs: ["East Asia", "SE Asia & Pacific", "Sub-Saharan Africa", "South Asia"],
  },

  // Cape Town spur: branch off the South Trunk at the sub-Cape junction,
  // turning north into Table Bay to dock.
  {
    name: "Brazil South Spur: Cape Junction → Cape Town",
    color: "#e74c3c",
    weight: 2,
    path: [[-36.0, 18.5], [-34.5, 18.4], [-33.92, 18.42]],
  },

  // Honduras → Channel Entry
  {
    name: "Honduras → Channel Entry",
    color: "#3498db",
    path: [[15.8, -87.9], [18.5, -86.5], [21.8, -85.5], [24.5, -81], [30, -75], [35, -60], [42, -40], [48.0, -7.0]],
  },
  {
    name: "Honduras → NOLA",
    color: "#3498db",
    path: [[15.8, -87.9], [18.5, -86.5], [21.8, -86], [24.5, -88], [29, -89], [29.9, -90]],
  },
  {
    name: "Sea: Veracruz → New Orleans",
    color: "#9b59b6",
    path: [[19.17, -96.13], [22.0, -95.0], [26.0, -92.0], [29.9, -90.0]],
  },

  // Colombia
  {
    name: "Colombia → NY",
    color: "#9b59b6",
    path: [[10.4, -75.5], [12, -76], [19.5, -74.5], [24, -73], [32, -74], [40.7, -74]],
  },
  {
    name: "Colombia → Oakland",
    color: "#9b59b6",
    path: [[3.88, -77.0], [5, -80], [10, -88], [15, -98], [20, -108], [28, -116], [33, -120], [37.8, -122.4]],
  },

  // ═══════════════════════════════════════════════════════════
  // ASIA ROUTES
  // ═══════════════════════════════════════════════════════════

  // Singapore → Pacific
  {
    name: "Singapore → Pacific",
    color: "#2ecc71",
    path: [[1.26, 103.8], [8.0, 112.0], [15.0, 125.0], [22.0, 138.0], [30.0, 150.0], [38.0, 158.0]],
  },

  // Singapore → Sydney (via Java Sea, Torres Strait approach)
  {
    name: "Singapore → Sydney",
    color: "#e74c3c",
    path: [[1.26, 103.8], [-1.0, 105.0], [-3.0, 107.0], [-5.0, 112.0], [-6.0, 120.0], [-7.5, 128.0], [-9.5, 135.0], [-10.2, 142.0], [-13.0, 146.0], [-20.0, 152.0], [-30.0, 154.0], [-33.86, 151.20]],
  },

  // Shanghai deviation
  {
    name: "Deviation Singapore → Shanghai",
    color: "#e74c3c",
    path: [[30.0, 128.0], [31.23, 121.47]],
  },

  // ═══════════════════════════════════════════════════════════
  // INLAND & RAIL ROUTES
  // ═══════════════════════════════════════════════════════════
  {
    name: "Inland: Uganda → Mombasa",
    color: "#2c3e50",
    path: [[0.31, 32.58], [0.63, 34.27], [0.51, 35.26], [-0.30, 36.08], [-1.29, 36.82], [-4.04, 39.66]],
  },
  {
    name: "Inland: Ethiopia → Djibouti",
    color: "#2c3e50",
    path: [[9.145, 40.4897], [8.54, 39.27], [9.0, 40.1], [9.6, 41.8], [11.82, 43.14]],
  },
  {
    name: "Rail: Trieste → Vienna",
    color: "#2c3e50",
    path: [[45.65, 13.78], [46.0, 14.5], [47.0, 15.4], [48.20, 16.37]],
  },
  {
    name: "Rail: Trieste → Budapest",
    color: "#2c3e50",
    path: [[45.65, 13.78], [46.0, 14.5], [46.5, 15.6], [46.8, 17.7], [47.49, 19.04]],
  },
  {
    name: "Rail: Vienna → South Poland",
    color: "#2c3e50",
    path: [[48.20, 16.37], [49.2, 17.0], [49.8, 18.2], [50.26, 19.02]],
  },
  {
    name: "Rail: Trieste → Antwerp",
    color: "#2c3e50",
    path: [[45.64, 13.76], [46.6, 13.8], [47.8, 13.0], [48.1, 11.5], [48.7, 9.1], [50.0, 8.2], [50.3, 7.6], [50.9, 6.9], [51.26, 4.35]],
  },
  {
    name: "Rail: Trieste → Hamburg",
    color: "#2c3e50",
    path: [[45.64, 13.76], [46.6, 13.8], [47.8, 13.0], [49.4, 11.1], [51.3, 9.9], [53.53, 9.96]],
  },
  {
    name: "Inland: Rondonia → Santos",
    color: "#2c3e50",
    path: [[-11.4, -61.5], [-15.6, -56.1], [-18.9, -48.3], [-22.5, -47.0], [-23.95, -46.3]],
  },
  {
    name: "Inland: Linhares → Vitoria",
    color: "#2c3e50",
    path: [[-19.39, -40.07], [-20.31, -40.33]],
  },
  {
    name: "Inland: Varginha → Santos",
    color: "#2c3e50",
    path: [[-21.55, -45.43], [-23.0, -46.0], [-23.95, -46.3]],
  },
  {
    name: "Inland: Bahia → Salvador",
    color: "#2c3e50",
    path: [[-14.86, -40.84], [-12.96, -38.50]],
  },
  {
    name: "Inland: Buon Ma Thuot → HCMC",
    color: "#2c3e50",
    path: [[12.66, 108.04], [11.3, 107.5], [10.76, 106.78]],
  },
  {
    name: "Inland: Lampung → Jakarta",
    color: "#2c3e50",
    path: [[-5.43, 105.26], [-5.9, 106.0], [-6.10, 106.88]],
  },
  {
    name: "Inland: Armenia → Buenaventura",
    color: "#2c3e50",
    path: [[4.53, -75.67], [4.31, -76.07], [3.90, -76.30], [3.88, -77.06]],
  },
  {
    name: "Inland: Armenia → Cartagena",
    color: "#2c3e50",
    path: [[4.53, -75.67], [4.81, -75.69], [6.24, -75.58], [7.98, -75.20], [9.30, -75.40], [10.40, -75.52]],
  },
  {
    name: "Inland: Comayagua → Puerto Cortés",
    color: "#2c3e50",
    path: [[14.46, -87.64], [15.2, -87.9], [15.84, -87.94]],
  },
  {
    name: "Inland: Antwerp → Basel (Swiss)",
    color: "#2c3e50",
    path: [[51.26, 4.35], [50.9, 6.9], [49.5, 8.4], [48.6, 7.8], [47.55, 7.59]],
  },
];
