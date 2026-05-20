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

// Exhaustive build — every panel, every source. (supersedes the condensed views)
const FULL = `flowchart LR
  %% ================= FETCHERS (source · frequency) =================
  subgraph DAILY["Daily / intraday"]
    direction TB
    W13["1.3 Daily OI · 02:00 M-F<br/>Barchart core-api (KC+RM chain)"]
    WPOLL["Acaphe poll · /15m (1-19h)<br/>acaphe live quotes"]
    W11["1.1 News · 01:00<br/>RSS·B3·CEPEA·Cooabriel·AJCA"]
    WORIG["Origin prices (1.1) · 01:00<br/>BCB·giacaphe·FNC·IHCAFE·UCDA·ECX·CEPEA"]
    WMET["Origin weather (1.1) · 01:00<br/>Open-Meteo ×7 origins"]
    W12["1.2 Freight · 02:00<br/>Freightos·Yahoo dry-bulk"]
    W17["1.7 Cecafe daily · 09:00<br/>B3 / cecafe.com.br"]
    W19["1.9 Quant CCI · 21:30 M-F<br/>jsDelivr FX·yfinance"]
  end
  subgraph WEEKLY["Weekly"]
    direction TB
    W23["2.3 COT + max-OI rebuild · Fri 20:00<br/>CFTC disagg report"]
    W22["2.2 Commodity prices · Tue 22:55<br/>Barchart"]
  end
  subgraph PERIODIC["Monthly / periodic"]
    direction TB
    W3B["1.3b Slow-data · 1st/mo<br/>ECF stocks·USDA PSD·AJCA·UCDA"]
    W31["3.1 Kaffeesteuer · 1st/mo · DESTATIS"]
    W32["3.2 Cecafe export · 15th · cecafe"]
    W33["3.3 CONAB · May · conab.gov.br"]
    W41["4.1 Earnings · quarterly · filings"]
    WCPI["Retail CPI · BLS·Eurostat·BCB"]
    WFERT["Fertilizers · UN Comtrade·World Bank"]
    WPOP["Population/age · UN WPP·World Bank"]
    WENSO["ENSO/ONI · NOAA"]
    WCNTRY["Origin supply · ICO·USDA·customs<br/>(CO·VN·ET·HN·ID·UG)"]
  end

  %% ================= STORE =================
  ARC[("★ contract_prices_archive.json<br/>5y per-contract OI+price · RC")]
  DB[(Postgres · 13 tables)]
  EXP{{"1.4 Export & Publish · 01:30 + on-2.3"}}

  %% ================= PUBLISHED JSON =================
  J_oi[/oi_history.json/]
  J_fnd[/oi_fnd_chart.json/]
  J_chain[/futures_chain.json/]
  J_cot[/cot.json · cot_recent.json/]
  J_sig[/signals.json/]
  J_mac[/macro_cot.json/]
  J_q[/quant_report.json/]
  J_fx[/fx_history.json/]
  J_aca[/acaphe_live.json/]
  J_lp[/latest_prices.json/]
  J_fr[/freight.json/]
  J_orig[/origin_prices_history.json/]
  J_cpi[/retail_cpi.json/]
  J_fe[/farmer_economics.json/]
  J_fsell[/farmer_selling_brazil.json/]
  J_ferts[/global_fertilizers.json/]
  J_stk[/demand_stocks.json/]
  J_mix[/factory_mix.json/]
  J_earn[/earnings.json/]
  J_tax[/kaffeesteuer.json/]
  J_cec[/cecafe.json/]
  J_cecd[/cecafe_daily.json/]
  J_co[/colombia_supply.json/]
  J_et[/ethiopia_supply.json/]
  J_hn[/honduras_supply.json/]
  J_id[/indonesia_supply.json/]
  J_ug[/uganda_supply.json/]
  J_vn[/vietnam_supply.json/]
  J_vnx[/vn_country_shares · vn_export_destination_port/]
  J_vnfe[/vn_farmer_economics · vn_physical_prices/]
  J_vnwl[/vn_water_levels.json/]
  J_vnw[/vn_weather.json/]
  J_ev[/events.json · seed/]
  J_intel[/manual_intel.json/]
  J_news[(news_feed · country_intel)]
  J_fact[/factories.json → /api/map/factories/]
  J_ctry[/countries.json → /api/map/countries/]

  %% ================= COT TAB =================
  subgraph COT["COT tab"]
    c_ip{{Industry Pulse: price+PMPU+switch}}
    c_sig{{Signals · severity}}
    c_gau{{Gauges}}
    c_hm{{Heatmap}}
    c_flow{{Global Flow}}
    c_dp{{Dry Powder}}
    c_cyc{{Cycle Location}}
    c_rep{{Report · backtest}}
    c_oi{{OI 7-day (CotWeekly)}}
    c_oifnd{{OI Evolution to FND}}
  end

  %% ================= FUTURES TAB =================
  subgraph FUT["Futures tab"]
    f_quote{{Daily Live Quotes}}
    f_chain{{Futures chain}}
    f_oi{{OI 7-day table}}
    f_oifnd{{OI Evolution to FND}}
  end

  %% ================= MACRO TAB =================
  subgraph MAC["Macro tab"]
    m_xc{{Cross-Commodity MM}}
    m_cci{{Coffee Currency Index}}
    m_fx{{FX Pair Time-Series}}
    m_fr{{Freight Context}}
    m_cpi{{Retail CPI}}
    m_fert{{Fertilizer Inputs}}
    m_orig{{Origin Prices}}
  end

  %% ================= DEMAND TAB =================
  subgraph DEM["Demand tab"]
    d_stk{{ICE/ECF Stocks}}
    d_ecf{{ECF panel}}
    d_psd{{PSD analytical}}
    d_jp{{Japan/AJCA panel}}
    d_age{{Age Cohort}}
    d_grow{{Growth Markets}}
    d_world{{World Consumption}}
    d_earn{{Roaster Earnings}}
    d_tax{{Kaffeesteuer (DE tax)}}
    d_mix{{Roasting Mix}}
  end

  %% ================= SUPPLY TAB =================
  subgraph SUP["Supply tab"]
    subgraph SBR["Brazil"]
      s_br{{Daily Registration}}
      s_mv{{Monthly Volume}}
      s_exp{{Export Charts}}
      s_bfe{{Farmer Economics}}
      s_sell{{Farmer Selling}}
      s_cec{{Monthly exports}}
    end
    subgraph SVN["Vietnam"]
      s_vnexp{{Export Explorer}}
      s_vndest{{Destination Estimate}}
      s_vnbal{{Balance Sheet}}
      s_vnfe{{Farmer Economics}}
      s_vnwl{{Water Levels}}
      s_vnw{{Weather Charts}}
    end
    subgraph SCO["Colombia"]
      s_coexp{{Export + Farmer Econ + Weather}}
    end
    subgraph SOTH["Ethiopia · Honduras · Indonesia · Uganda"]
      s_et{{Ethiopia tab}}
      s_hn{{Honduras tab}}
      s_id{{Indonesia tab}}
      s_ug{{Uganda tab + destinations + trade actors}}
    end
    s_fert{{Fertilizers tab}}
    s_intel{{Manual Intel}}
  end

  %% ================= MAP / NEWS & INTEL TAB =================
  subgraph MAP["Map / News & Intel tab"]
    mp_base{{CoffeeMap base}}
    mp_country{{Country pins + intel popups}}
    mp_factory{{Factory pins}}
    mp_price{{Price labels}}
    mp_exp{{Exports overlay}}
    mp_freight{{Freight overlay}}
    mp_vnport{{VN port-flow arrows}}
    mp_legend{{Map legend}}
    mp_news{{News Feed / Sidebar}}
  end

  %% ================= GLOBAL TICKER BAND (all tabs) =================
  TICKER{{"🎫 Market Ticker — GLOBAL band (app/layout, every tab)<br/>KC + RC live · FX"}}

  TG{{"📲 Telegram morning brief · 03:00<br/>LAST step — 9 sections"}}

  %% ================= EDGES: fetch → store =================
  W13 --> ARC
  W23 -->|positions| DB
  ARC -->|max-OI rebuild| DB
  W22 --> DB
  WORIG --> DB
  WMET --> DB
  WCNTRY --> DB
  W3B --> DB
  W33 --> DB
  WCPI --> DB
  WPOP --> DB
  WENSO --> DB

  %% ================= store → JSON =================
  ARC -->|derive 30d| J_oi
  ARC -->|FND export| J_fnd
  DB --> EXP
  WPOLL --> J_aca
  W19 --> J_q
  W19 --> J_fx
  W12 --> J_fr
  W17 --> J_cecd
  W31 --> J_tax
  W41 --> J_earn
  WFERT --> J_ferts
  EXP --> J_chain
  EXP --> J_cot --> J_sig
  EXP --> J_mac
  EXP --> J_lp
  EXP --> J_orig
  EXP --> J_cpi
  EXP --> J_fe
  EXP --> J_fsell
  EXP --> J_stk
  EXP --> J_mix
  EXP --> J_cec
  EXP --> J_co
  EXP --> J_et
  EXP --> J_hn
  EXP --> J_id
  EXP --> J_ug
  EXP --> J_vn
  EXP --> J_vnx
  EXP --> J_vnfe
  EXP --> J_vnwl
  EXP --> J_vnw

  %% ================= JSON → COT =================
  J_cot --> c_ip
  J_cot --> c_sig
  J_sig --> c_sig
  J_cot --> c_gau
  J_cot --> c_hm
  J_cot --> c_flow
  J_mac --> c_flow
  J_cot --> c_dp
  J_cot --> c_cyc
  J_cot --> c_rep
  J_cot --> c_oi
  J_fnd --> c_oifnd

  %% ================= JSON → FUTURES =================
  J_aca --> f_quote
  J_chain --> f_chain
  J_oi --> f_oi
  J_fnd --> f_oifnd

  %% ================= JSON → MACRO =================
  J_mac --> m_xc
  J_q --> m_cci
  J_fx --> m_fx
  J_fr --> m_fr
  J_cpi --> m_cpi
  J_fe --> m_fert
  J_orig --> m_orig

  %% ================= JSON → DEMAND =================
  J_stk --> d_stk
  J_stk --> d_ecf
  J_stk --> d_psd
  J_stk --> d_jp
  J_stk --> d_age
  J_stk --> d_grow
  J_stk --> d_world
  J_earn --> d_earn
  J_tax --> d_tax
  J_mix --> d_mix

  %% ================= JSON → SUPPLY =================
  J_cecd --> s_br
  J_cecd --> s_mv
  J_cecd --> s_exp
  J_fe --> s_bfe
  J_fsell --> s_sell
  J_cec --> s_cec
  J_vn --> s_vnexp
  J_vnx --> s_vndest
  J_vn --> s_vnbal
  J_vnfe --> s_vnfe
  J_vnwl --> s_vnwl
  J_vnw --> s_vnw
  J_co --> s_coexp
  J_et --> s_et
  J_hn --> s_hn
  J_id --> s_id
  J_ug --> s_ug
  J_ferts --> s_fert
  J_fe --> s_fert
  J_vn --> s_fert
  J_intel --> s_intel

  %% ================= JSON → MAP =================
  J_ctry --> mp_country
  J_news --> mp_country
  J_fact --> mp_factory
  J_lp --> mp_price
  J_aca --> mp_price
  J_cec --> mp_exp
  J_fr --> mp_freight
  J_vnx --> mp_vnport
  J_news --> mp_news
  mp_country --- mp_base
  mp_factory --- mp_base

  %% ================= GLOBAL TICKER BAND =================
  J_aca --> TICKER
  J_lp --> TICKER

  %% ================= Telegram (9 sections) =================
  J_aca -->|prices·cost| TG
  J_lp -->|fx| TG
  J_orig -->|cost| TG
  J_cot -->|CoT| TG
  J_sig -->|signals| TG
  J_ev -->|next-24h| TG
  J_co -->|weather| TG
  J_vn -->|weather| TG
  J_et -->|weather| TG
  J_hn -->|weather| TG
  J_id -->|weather| TG
  J_ug -->|weather| TG
  J_fr -->|freight| TG
  J_q -->|macro| TG
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
        <Card title="Full pipeline — every source · frequency → store → JSON → visual → Telegram">
          <Mermaid chart={FULL} />
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
