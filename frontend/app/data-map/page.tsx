"use client";
import PageHeader from "@/components/PageHeader";
import Mermaid from "@/components/Mermaid";

const ARCHITECTURE = `flowchart TD
  subgraph SRC[External sources]
    BC[Barchart core-api]
    CFTC[CFTC COT report]
    JSD[jsDelivr FX]
    ACA[acaphe / Cecafe / ICO ...]
  end
  F13[["1.3 Daily OI Snapshot<br/>02:00 Mon-Fri"]]
  F23[["2.3 COT Scraper<br/>Fri 20:00"]]
  F19[["1.9 Quant CCI"]]
  FPOLL[["Acaphe poll 15m"]]
  FNEWS[["1.1/1.2/1.7/3.x"]]
  ARC[("contract_prices_archive.json<br/>SINGLE coffee OI+price source<br/>RC canonical · 5y")]
  DB[(Postgres · 13 tables)]
  EXP[["1.4 Export & Publish"]]
  BC --> F13 --> ARC
  BC --> FPOLL --> ACJ[/acaphe_live.json/]
  CFTC --> F23
  JSD --> F19 --> QJ[/quant_report·fx_history/]
  ACA --> FNEWS --> DB
  ARC -->|derive 30d| OIH[/oi_history.json/]
  ARC -->|FND export| FND[/oi_fnd_chart.json/]
  ARC -->|rebuild max-OI in 2.3| DB
  F23 -->|positions| DB
  DB --> EXP --> COTJ[/cot.json/]
  EXP --> MAC[/macro_cot.json/]
  COTJ --> SIGJ[/signals.json/]
  COTJ --> V_IP{{Industry Pulse}}
  COTJ --> V_SIG{{Signals/gauges}}
  OIH --> V_OI{{OI 7-day table}}
  FND --> V_FND{{OI to FND chart}}
  MAC --> V_MAC{{Macro MM}}
  SIGJ --> V_TG{{Telegram brief}}
  QJ --> V_CCI{{CCI/FX}}
  ACJ --> V_QUOTE{{Daily quotes}}`;

const WORKFLOW_TO_VISUAL = `flowchart LR
  %% ============ FETCHERS (source · frequency) ============
  subgraph DAILY["Daily / intraday fetchers"]
    direction TB
    W13["1.3 Daily OI · 02:00 Mon-Fri<br/>src: Barchart core-api (KC+RM chain)"]
    WPOLL["Acaphe poll · every 15m (1-19h)<br/>src: acaphe live quotes"]
    W11["1.1 Daily News · 01:00<br/>src: RSS·B3·CEPEA·Cooabriel"]
    WORIG["Origin prices (in 1.1) · 01:00<br/>src: BCB·giacaphe·FNC·IHCAFE·UCDA·ECX"]
    WMET["Origin weather (in 1.1) · 01:00<br/>src: Open-Meteo (7 origins)"]
    W12["1.2 Freight · 02:00<br/>src: Freightos·Yahoo dry-bulk"]
    W17["1.7 Cecafe daily · 09:00<br/>src: B3 / cecafe.com.br"]
    W19["1.9 Quant CCI · 21:30 Mon-Fri<br/>src: jsDelivr FX·yfinance"]
  end
  subgraph WEEKLY["Weekly fetchers"]
    direction TB
    W23["2.3 COT + max-OI rebuild · Fri 20:00<br/>src: CFTC disagg report"]
    W22["2.2 Commodity prices · Tue 22:55<br/>src: Barchart"]
  end
  subgraph PERIODIC["Monthly / periodic fetchers"]
    direction TB
    W3B["1.3b Slow-data · 1st of month<br/>src: ECF·USDA PSD·AJCA·UCDA"]
    W31["3.1 Kaffeesteuer · 1st of month<br/>src: DESTATIS"]
    W32["3.2 Cecafe export · 15th<br/>src: cecafe.com.br"]
    W33["3.3 CONAB · yearly (May)<br/>src: conab.gov.br"]
    W41["4.1 Earnings · quarterly<br/>src: roaster filings"]
    WCPI["Retail CPI (in 1.4) <br/>src: BLS·Eurostat·BCB"]
    WFERT["Global fertilizers<br/>src: UN Comtrade·World Bank"]
  end

  %% ============ STORE ============
  ARC[("★ contract_prices_archive.json<br/>5y per-contract OI+price · RC canonical")]
  DB[(Postgres · 13 tables)]
  EXP{{"1.4 Export & Publish · 01:30 + on-2.3<br/>DB + archive → static JSON"}}

  %% ============ PUBLISHED JSON ============
  J_oi[/oi_history.json/]
  J_fnd[/oi_fnd_chart.json/]
  J_cot[/cot.json · cot_recent.json/]
  J_sig[/signals.json/]
  J_mac[/macro_cot.json/]
  J_q[/quant_report.json/]
  J_fx[/fx_history.json/]
  J_aca[/acaphe_live.json/]
  J_lp[/latest_prices.json/]
  J_fr[/freight.json/]
  J_orig[/origin_prices_history.json/]
  J_sup[/7x *_supply.json/]
  J_cec[/cecafe.json/]
  J_cecd[/cecafe_daily.json/]
  J_stk[/demand_stocks.json/]
  J_mix[/factory_mix.json/]
  J_earn[/earnings.json/]
  J_tax[/kaffeesteuer.json/]
  J_cpi[/retail_cpi.json/]
  J_ferts[/global_fertilizers.json/]
  J_farm[/farmer_economics.json · farmer_selling_brazil.json/]
  J_ev[/events.json · seed/]
  J_news[(news_feed · country_intel)]

  %% ============ VISUALS ============
  subgraph COT["COT tab"]
    c_ip{{Industry Pulse: price+PMPU+switch dots}}
    c_sig{{Signals · gauges · heatmap}}
    c_flow{{Global Flow · Dry Powder · Cycle · Report}}
    c_oifnd{{OI Evolution to FND}}
  end
  subgraph FUT["Futures tab"]
    f_quote{{Daily Live Quotes}}
    f_oi{{OI 7-day table}}
    f_oifnd{{OI Evolution to FND}}
  end
  subgraph MAC["Macro tab"]
    m_cci{{Coffee Currency Index}}
    m_fx{{FX Pair Time-Series}}
    m_xc{{Cross-Commodity MM}}
    m_fr{{Freight Context}}
    m_cpi{{Retail CPI}}
    m_fert{{Fertilizer Inputs · Origin Prices}}
  end
  subgraph DEM["Demand tab"]
    d_stk{{Stocks}}
    d_mix{{Roasting Mix}}
    d_earn{{Roaster Earnings}}
    d_tax{{Kaffeesteuer}}
  end
  subgraph SUP["Supply tab"]
    s_br{{Brazil Daily Registration}}
    s_farm{{Farmer Economics · Selling}}
    s_fert{{Fertilizers}}
    s_ctry{{Country pages}}
  end
  subgraph MAP["Map / News & Intel"]
    mp_px{{Price labels + ticker}}
    mp_exp{{Brazil exports}}
    mp_news{{News table · country intel}}
  end

  TG{{"📲 Telegram morning brief · 03:00<br/>LAST step — aggregates 9 sections"}}

  %% ===== fetch → store =====
  W13 --> ARC
  W23 -->|positions| DB
  ARC -->|max-OI rebuild| DB
  W22 --> DB
  W11 --> J_news
  WORIG --> DB
  WMET --> DB
  W3B --> DB
  W31 --> DB
  W32 --> DB
  W33 --> DB
  W41 --> DB
  WCPI --> DB
  WFERT --> DB

  %% ===== store → export → JSON =====
  ARC -->|derive 30d| J_oi
  ARC -->|FND export| J_fnd
  DB --> EXP
  WPOLL --> J_aca
  W19 --> J_q
  W19 --> J_fx
  W12 --> J_fr
  EXP --> J_cot --> J_sig
  EXP --> J_mac
  EXP --> J_lp
  EXP --> J_orig
  EXP --> J_sup
  EXP --> J_cec
  W17 --> J_cecd
  EXP --> J_stk
  EXP --> J_mix
  W41 --> J_earn
  W31 --> J_tax
  EXP --> J_cpi
  WFERT --> J_ferts
  EXP --> J_farm
  EXP --> J_fnd

  %% ===== JSON → visuals =====
  J_oi --> f_oi
  J_fnd --> f_oifnd
  J_fnd --> c_oifnd
  J_cot --> c_ip
  J_cot --> c_sig
  J_cot --> c_flow
  J_sig --> c_sig
  J_aca --> f_quote
  J_mac --> m_xc
  J_q --> m_cci
  J_fx --> m_fx
  J_fr --> m_fr
  J_cpi --> m_cpi
  J_farm --> m_fert
  J_orig --> m_fert
  J_lp --> mp_px
  J_cec --> mp_exp
  J_news --> mp_news
  J_stk --> d_stk
  J_mix --> d_mix
  J_earn --> d_earn
  J_tax --> d_tax
  J_cecd --> s_br
  J_farm --> s_farm
  J_ferts --> s_fert
  J_sup --> s_ctry
  J_sup --> mp_px

  %% ===== Telegram brief: the 9 sections it pulls (LAST step) =====
  J_aca -->|prices·cost| TG
  J_lp -->|prices·fx| TG
  J_orig -->|cost| TG
  J_cot -->|CoT| TG
  J_sig -->|CoT signals| TG
  J_ev -->|next-24h| TG
  J_sup -->|weather alerts| TG
  J_fr -->|freight| TG
  J_q -->|macro CCI| TG
  J_mac -->|macro MM| TG
  J_news -->|news| TG`;

// Per-workflow → exact visual (mirrors docs/DATA_PLATFORM_MAP.md §4a).
type Row = { wf: string; output: string; component: string; visual: string };
const ROWS: Row[] = [
  { wf: "1.3 Daily OI", output: "oi_history.json", component: "OIHistoryTable", visual: "Futures · OI 7-day table (+ COT §2)" },
  { wf: "1.3 Daily OI", output: "oi_fnd_chart.json", component: "OIFndChart", visual: "Futures + COT · OI Evolution to FND" },
  { wf: "1.3 → 2.3 rebuild", output: "cot.json price", component: "Step4IndustryPulse", visual: "COT · Industry Pulse — price + switch dots" },
  { wf: "1.1 Daily News", output: "news_feed / country_intel", component: "/api/news · CoffeeMap", visual: "Map · news labels / country intel" },
  { wf: "1.2 Freight", output: "freight.json", component: "FreightContextPanel", visual: "Macro · Freight Context" },
  { wf: "1.4 Export & Publish", output: "all static JSON", component: "—", visual: "plumbing — feeds every JSON visual" },
  { wf: "1.5 Fresh check", output: "—", component: "—", visual: "Telegram alert only" },
  { wf: "1.6 Morning Brief", output: "reads signals/events/JSON", component: "—", visual: "Telegram brief (the message)" },
  { wf: "1.7 Cecafe Daily", output: "cecafe_daily.json", component: "DailyRegistration", visual: "Supply · Brazil · Daily Registration" },
  { wf: "1.9 Quant CCI", output: "quant_report.json", component: "CurrencyIndexSection", visual: "Macro · Coffee Currency Index" },
  { wf: "1.9 Quant CCI", output: "fx_history.json", component: "FxTimeSeriesPanel", visual: "Macro · FX Pair Time-Series" },
  { wf: "Acaphe poll", output: "acaphe_live.json", component: "AcapheLiveQuotes", visual: "Futures · Daily Live Quotes" },
  { wf: "1.3b Slow-data", output: "demand_stocks.json", component: "StocksPanel", visual: "Demand · Stocks (ICE cert + PSD)" },
  { wf: "2.2 Commodity Prices", output: "latest_prices.json", component: "CoffeeMap", visual: "Map · price labels + ticker" },
  { wf: "2.3 COT + rebuild", output: "cot.json", component: "Step1/4/5/6/7/8", visual: "COT · Signals, Gauges, Heatmap, Global Flow, Industry Pulse, Dry Powder, Cycle, Report" },
  { wf: "2.3 COT + rebuild", output: "macro_cot.json", component: "CrossCommodityPanel", visual: "Macro · Cross-Commodity MM" },
  { wf: "2.3 COT + rebuild", output: "signals.json", component: "morning_brief", visual: "Telegram · CoT signals" },
  { wf: "3.1 Kaffeesteuer", output: "kaffeesteuer.json", component: "KaffeesteuerChart", visual: "Demand · Kaffeesteuer (DE tax)" },
  { wf: "3.2 Cecafe Export", output: "cecafe.json", component: "CoffeeMap", visual: "Map · Brazil monthly exports" },
  { wf: "3.3 CONAB", output: "farmer_economics.json", component: "FertilizerInputsPanel · FarmerSellingPanel", visual: "Macro · Fertilizer Inputs + Supply · Farmer Economics" },
  { wf: "4.1 Earnings", output: "earnings.json", component: "EarningsTable", visual: "Demand · Roaster Earnings" },
  { wf: "various / manual", output: "factory_mix.json", component: "RoastingMixPanel", visual: "Demand · Roasting Mix" },
  { wf: "various / manual", output: "global_fertilizers.json", component: "FertilizersTab", visual: "Supply · Fertilizers" },
  { wf: "various / manual", output: "manual_intel.json", component: "ManualIntelPanel", visual: "Supply · Manual Intel" },
  { wf: "various / manual", output: "retail_cpi.json", component: "RetailCpiPanel", visual: "Macro · Retail CPI" },
  { wf: "various / manual", output: "origin_prices_history.json", component: "OriginPricesPanel", visual: "Macro · Origin Prices" },
  { wf: "various / manual", output: "*_supply.json", component: "country tabs", visual: "Supply · country pages + Map" },
];

function WorkflowTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-700">
            <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Workflow</th>
            <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Output</th>
            <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Component</th>
            <th className="py-1.5 font-medium">Tab · Visual</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => (
            <tr key={i} className="border-b border-slate-800/60 align-top">
              <td className="py-1.5 pr-3 text-amber-400 whitespace-nowrap">{r.wf}</td>
              <td className="py-1.5 pr-3 font-mono text-slate-400 whitespace-nowrap">{r.output}</td>
              <td className="py-1.5 pr-3 font-mono text-slate-500 whitespace-nowrap">{r.component}</td>
              <td className="py-1.5 text-slate-300">{r.visual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function DataMapPage() {
  return (
    <div>
      <PageHeader
        title="Data Map"
        subtitle="How every fetch flows through storage to each dashboard visual. Source of truth: docs/DATA_PLATFORM_MAP.md"
      />
      <div className="p-4 space-y-4">
        <Card title="Full pipeline — source · frequency → store → JSON → visual → Telegram">
          <Mermaid chart={WORKFLOW_TO_VISUAL} />
        </Card>
        <Card title="Condensed architecture (the single-source view)">
          <Mermaid chart={ARCHITECTURE} />
        </Card>
        <div className="text-[11px] text-slate-500 leading-relaxed px-1">
          <p className="mb-1">
            <span className="text-amber-400">★ contract_prices_archive.json</span> is the single coffee
            OI+price source: one daily fetch (1.3) feeds it, and it fans out to the OI table, both
            OI→FND charts, and the Industry Pulse price (via the max-OI rebuild in 2.3).
          </p>
          <p>Symbol convention — FETCH=RM (Barchart) · STORE=RC (canonical) · DISPLAY=RM (OI table + FND chart).</p>
        </div>
        <Card title="Per-workflow → exact dashboard visual">
          <WorkflowTable />
        </Card>
      </div>
    </div>
  );
}
