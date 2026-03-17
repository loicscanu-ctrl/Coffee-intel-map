export const PORTS: { n: string; l: [number, number] }[] = [
  { n: "Santos", l: [-23.9, -46.3] },
  { n: "Vitoria", l: [-20.3, -40.3] },
  { n: "Salvador", l: [-12.97, -38.50] },
  { n: "Cartagena", l: [10.4, -75.5] },
  { n: "Buenaventura", l: [3.88, -77.0] },
  { n: "Puerto Cortés", l: [15.8, -87.9] },
  { n: "Veracruz", l: [19.17, -96.13] },
  { n: "Ho Chi Minh City", l: [10.7, 106.6] },
  { n: "Jakarta", l: [-6.1, 106.8] },
  { n: "Mombasa", l: [-4.0, 39.6] },
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
  { n: "Pacific", l: [40.0, -170.0] },
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
];

export const ROUTES: { name: string; color: string; weight?: number; path: [number, number][] }[] = [

  // ═══════════════════════════════════════════════════════════
  // MAIN TRUNK: Singapore → Antwerp (Malacca → Indian Ocean → Suez → Med → Channel)
  // No other routes share these waypoints.
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
      [14.0, 55.0],    // Gulf of Aden approach
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
      [22.0, -165.0],  // mid-Pacific (ships converge here from Asia)
      [26.0, -148.0],
      [30.0, -133.0],
      [33.7, -118.2],  // Los Angeles Port
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // FEEDERS → MAIN TRUNK  (stop where they join the trunk)
  // ═══════════════════════════════════════════════════════════

  // HCMC → Singapore
  {
    name: "Feeder: HCMC → Singapore",
    color: "#2ecc71",
    path: [[10.76, 106.78], [8.0, 106.0], [3.0, 105.0], [1.26, 103.8]],
  },
  // Jakarta → Singapore
  {
    name: "Feeder: Jakarta → Singapore",
    color: "#9b59b6",
    path: [[-6.10, 106.88], [-3.0, 106.0], [1.26, 103.8]],
  },

  // India spurs — branch from trunk, stop at India port
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

  // Mediterranean port spurs — branch from trunk
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

  // English Channel port spurs — branch from trunk
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
  // AMERICAS ROUTES  (terminate at Channel entry or trunk junctions)
  // ═══════════════════════════════════════════════════════════

  // Brazil → Europe (terminates at Channel entry [48.0, -7.0])
  {
    name: "Brazil (Santos) → Channel Entry",
    color: "#e74c3c",
    path: [[-23.95, -46.3], [-25.0, -44.0], [-20.0, -36.0], [-10.0, -32.0], [-5.0, -31.0], [5.0, -28.0], [20.0, -25.0], [40.0, -15.0], [48.0, -7.0]],
  },
  {
    name: "Deviation: Salvador → Brazil Atlantic Route",
    color: "#e74c3c",
    path: [[-12.97, -38.50], [-13.0, -35.0], [-10.0, -32.0]],
  },
  {
    name: "Deviation: Vitoria → Brazil Atlantic Route",
    color: "#e74c3c",
    path: [[-20.3, -40.3], [-20.0, -38.0]],
  },

  // Brazil → New York (direct Atlantic)
  {
    name: "Brazil (Santos) → NY",
    color: "#e74c3c",
    path: [[-23.95, -46.3], [-24.5, -44.0], [-20.0, -38.0], [-10.0, -34.0], [-5.0, -34.5], [5.0, -45.0], [15.0, -55.0], [25.0, -68.0], [32.0, -74.0], [38.0, -73.0], [40.5, -73.8]],
  },

  // Brazil → Japan via Cape of Good Hope (approaches Singapore from south, then South China Sea to Japan)
  {
    name: "Brazil (Santos) → Japan (Cape Route)",
    color: "#e74c3c",
    path: [
      [-23.95, -46.3],
      [-28.0, -40.0],
      [-34.0, -20.0],
      [-36.0, 0.0],
      [-36.0, 15.0],
      [-35.0, 25.0],
      [-30.0, 50.0],
      [-20.0, 70.0],
      [-10.0, 80.0],
      [-5.0, 88.0],
      // Approach Singapore from the south — does NOT enter Malacca Strait trunk
      [-1.0, 97.0],
      [0.5, 102.0],
      [1.26, 103.8],   // Singapore
      // Continue to Japan via South China Sea (separate from Trans-Pacific trunk)
      [8.0, 110.0],
      [15.0, 116.0],
      [22.0, 123.0],
      [30.0, 128.0],
      [35.61, 139.78], // Tokyo
    ],
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

  // Singapore → Central Pacific (northern Pacific lane, terminus in open Pacific)
  {
    name: "Singapore → Pacific",
    color: "#2ecc71",
    path: [[1.26, 103.8], [8.0, 112.0], [15.0, 125.0], [22.0, 138.0], [30.0, 155.0], [38.0, 170.0], [40.0, -170.0]],
  },

  // Singapore → Sydney
  {
    name: "Singapore → Sydney",
    color: "#e74c3c",
    path: [[1.26, 103.8], [-1.0, 105.0], [-3.0, 107.0], [-5.0, 112.0], [-6.0, 120.0], [-7.5, 128.0], [-9.5, 135.0], [-10.2, 142.0], [-13.0, 146.0], [-20.0, 152.0], [-30.0, 154.0], [-33.86, 151.20]],
  },

  // Shanghai deviation off Trans-Pacific trunk
  {
    name: "Deviation: Pacific → Shanghai",
    color: "#e74c3c",
    path: [[12.0, 120.0], [22.0, 121.0], [31.23, 121.47]],
  },

  // Japan deviation off Trans-Pacific trunk
  {
    name: "Deviation: Pacific → Japan",
    color: "#2ecc71",
    path: [[18.0, 135.0], [28.0, 136.0], [35.61, 139.78]],
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

export const MAP_CONFIG = {
  theme: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  initView: [20, -10] as [number, number],
  initZoom: 3,
};
