"use client";
import PageHeader from "@/components/PageHeader";
import Mermaid from "@/components/Mermaid";

// Shared class definitions appended to every per-tab diagram. `vis` (the tab's
// own colour) is supplied per diagram.
const DEFS = `
  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;`;

const ARCHITECTURE = `flowchart LR
  BC[Barchart core-api]
  CFTC[CFTC COT report]
  ARC[("contract_prices_archive.json<br/>SINGLE coffee OI+price source<br/>RC canonical · 5y")]
  DB[(Postgres · 13 tables)]
  EXP{{"1.4 Export & Publish · 02:30"}}
  F13["1.3 Daily OI · 02:00 M-F"]
  F23["2.3 COT · Fri 20:00"]
  J[/~30 static JSON/]
  VIS{{dashboard visuals}}
  BC --> F13 --> ARC --> DB
  CFTC --> F23 --> DB
  ARC -->|max-OI rebuild in 2.3| DB
  DB --> EXP --> J --> VIS
  ARC --> J
  classDef scr fill:#0f172a,stroke:#334155,color:#94a3b8;
  classDef store fill:#450a0a,stroke:#ef4444,color:#fecaca;
  classDef proc fill:#1f2937,stroke:#64748b,color:#cbd5e1;
  classDef json fill:#1e293b,stroke:#475569,color:#cbd5e1;
  class BC,CFTC,F13,F23 scr;
  class ARC,DB store;
  class EXP proc;
  class J json;`;

const FUTURES = `flowchart LR
  WPOLL["Acaphe poll · /15min (1-19h)<br/>acaphe.com"]
  W13["1.3 Daily OI · 02:00 M-F<br/>Barchart core-api"]
  ARC[("contract_prices_archive.json")]
  EXP{{"1.4 Export · 02:30"}}
  J_aca[/acaphe_live.json/]
  J_chain[/futures_chain.json/]
  J_oi[/oi_history.json/]
  J_fnd[/oi_fnd_chart.json/]
  quote{{Daily Live Quotes}}
  chain{{Futures Chain}}
  oi{{OI 7-day Table}}
  oifnd{{OI Evolution to FND}}
  WPOLL --> J_aca --> quote
  W13 --> ARC
  W13 --> EXP --> J_chain --> chain
  ARC --> J_oi --> oi
  ARC --> J_fnd --> oifnd
${DEFS}
  classDef vis fill:#2e1065,stroke:#8b5cf6,color:#ddd6fe;
  class WPOLL,W13 scr;
  class ARC store;
  class EXP proc;
  class J_aca,J_chain,J_oi,J_fnd json;
  class quote,chain,oi,oifnd vis;`;

const COT = `flowchart LR
  W13["1.3 Daily OI · 02:00 M-F<br/>Barchart core-api"]
  W23["2.3 COT + max-OI rebuild · Fri 20:00<br/>CFTC disagg report"]
  ARC[("contract_prices_archive.json<br/>5y per-contract OI+price · untouched")]
  DB[(Postgres)]
  EXP{{"1.4 Export · 02:30"}}
  J_cot[/cot.json · 312wk/]
  J_mac[/macro_cot.json/]
  J_fnd[/oi_fnd_chart.json/]
  J_oi[/oi_history.json<br/>14-day rolling slice of ARC (was 30)/]
  J_sig[/signals.json<br/>· quant + AGRO rows merged/]
  ip{{Industry Pulse}}
  sig{{"Signals · computed in-browser from cot.json<br/>+ /cot Telegram appends per-rule listing from signals.json"}}
  gau{{Gauges}}
  hm{{Heatmap}}
  flow{{Global Flow}}
  dp{{Dry Powder}}
  cyc{{Cycle Location}}
  rep{{"Report · backtest"}}
  oi{{"OI 14-day table · nearby-OI delta re-derived<br/>from per-contract oi_history.json (was buggy exch_oi_*)"}}
  oifnd{{OI Evolution to FND}}
  W13 --> ARC --> DB
  W23 --> DB --> EXP
  EXP --> J_cot
  EXP --> J_mac
  EXP --> J_sig
  ARC --> J_fnd
  ARC --> J_oi
  J_cot --> ip
  J_cot --> sig
  J_sig --> sig
  J_cot --> gau
  J_cot --> hm
  J_cot --> flow
  J_mac --> flow
  J_cot --> dp
  J_cot --> cyc
  J_cot --> rep
  J_oi --> oi
  J_cot --> oi
  J_fnd --> oifnd
${DEFS}
  classDef vis fill:#172554,stroke:#3b82f6,color:#bfdbfe;
  class W13,W23 scr;
  class ARC,DB store;
  class EXP proc;
  class J_cot,J_mac,J_fnd,J_oi,J_sig json;
  class ip,sig,gau,hm,flow,dp,cyc,rep,oi,oifnd vis;`;

const NEWS = `flowchart LR
  W11["1.1 News · 01:00<br/>RSS · B3 · CEPEA · Cooabriel · AJCA · World Bank"]
  WEVT["build_events_calendar.py · manual<br/>WASDE · ICE FND · Cecafé · ICO · VN Customs"]
  WHLTH["1.4 Export · 02:30<br/>per-scraper run timestamps"]
  DB[(Postgres · news_feed)]
  EXP{{"1.4 Export · 02:30"}}
  SEED_EV[("backend/seed/events.json<br/>(mirrored to /public/data)")]
  J_n[/news.json/]
  J_e[/events.json/]
  J_h[/health.json/]
  fresh{{"Freshness Grid — 26 scraper chips,<br/>today-pulse, grouped by category"}}
  cal{{"Upcoming Calendar — next 30d,<br/>ISO-week timeline, category icons"}}
  risk{{"Risk Radar — 15 watched terms<br/>last-7d vs prior-23d velocity ↑↑/↑/→/↓"}}
  hd{{"Headlines Digest — last 7d,<br/>OR-multi-select Focus chips (KC·RC·origins·Macro)"}}
  WHLTH --> J_h --> fresh
  WEVT --> SEED_EV --> J_e --> cal
  W11 --> DB --> EXP --> J_n
  J_n --> hd
  J_n --> risk
${DEFS}
  classDef vis fill:#1a1a2e,stroke:#a78bfa,color:#ddd6fe;
  class W11,WEVT,WHLTH scr;
  class DB,SEED_EV store;
  class EXP proc;
  class J_n,J_e,J_h json;
  class fresh,cal,risk,hd vis;`;

const FREIGHT = `flowchart LR
  W12["1.2 Freight · 02:00 daily<br/>Freightos containers"]
  WDRY["Yahoo dry-bulk<br/>(BDRY proxy)"]
  J_fr[/freight.json/]
  J_fe[/farmer_economics.json · fertilizer.dry_bulk/]
  ctx{{Freight Context Panel}}
  rate{{Rate Evolution + Spot table}}
  dry{{Dry Bulk Indicator}}
  W12 --> J_fr
  J_fr --> ctx
  J_fr --> rate
  WDRY --> J_fe --> dry
${DEFS}
  classDef vis fill:#082f49,stroke:#0ea5e9,color:#bae6fd;
  class W12,WDRY scr;
  class J_fr,J_fe json;
  class ctx,rate,dry vis;`;

const SUPPLY = `flowchart LR
  W17["1.7 Cecafe daily · 09:00<br/>B3 · cecafe.com.br"]
  W32["3.2 Cecafe export · 15th<br/>cecafe"]
  W331["3.3.1 CONAB · 12th<br/>conab.gov.br"]
  W332["3.3.2 BR Fertilizer · 12th<br/>Comex Stat"]
  W333["3.3.3 VN Fertilizer · 12th<br/>VN Customs"]
  W334["3.3.4 VN Coffee Exports · 12th<br/>VN Customs"]
  W335["3.3.5 Uganda UCDA · 14th<br/>ugandacoffee.go.ug"]
  WCNTRY["Origin supply<br/>ICO · USDA · customs<br/>(CO·VN·ET·HN·ID)"]
  WFERT["Fertilizers · UN Comtrade · World Bank"]
  WINTEL["manual intel"]
  WWX["weather-fetch · daily<br/>forecast.open-meteo.com<br/>P · Tmax/Tmin · ET₀ · ESSM"]
  WSPI["0.3 SPI baseline · one-shot<br/>archive.open-meteo.com 1995-24"]
  WSPEI["0.4 SPEI baseline · one-shot<br/>archive 1995-24 (P + ET₀)"]
  WVHI["0.5 NOAA STAR VHI · weekly<br/>get_TS_admin.php per province<br/>admin-1 text endpoint (no NetCDF)"]
  WENSO["NOAA ENSO ONI · monthly<br/>cpc.ncep.noaa.gov"]
  WENFC["ENSO forecast fallback chain<br/>IRI HTML → CPC discussion text<br/>9 rolling quarters · enso_forecast.py"]
  WBFL["0.6/0.7 One-shot backfills<br/>backfill_missing_fields.py · backfill_history_gap.py<br/>heals rain/ET₀/2025-gap from archive"]
  AGRO[["agronomic_alerts.py · end of 1.10<br/>IPHM rules: fungal rust · severe defoliation<br/>· brazil frost · blossom drop"]]
  DB[(Postgres)]
  EXP{{"1.4 Export · 02:30"}}
  SEED_SPI[("spi_30yr_baselines.json")]
  SEED_SPEI[("spei_30yr_baselines.json")]
  SEED_VHI[("vhi_province_ids.json<br/>34/34 NOAA GADM admin-1 IDs")]
  J_cecd[/cecafe_daily.json/]
  J_cec[/cecafe.json/]
  J_fe[/farmer_economics.json/]
  J_fsell[/farmer_selling_brazil.json/]
  J_vn[/vietnam_supply.json/]
  J_vnx[/vn_country_shares/]
  J_vnfe[/vn_farmer_economics/]
  J_vnwl[/vn_water_levels.json/]
  J_vnw[/vn_weather.json/]
  J_wx[/×7 origin weather.json<br/>+ spi_1/3 + spei_1/3/]
  J_vhi[/×7 vhi_{origin}.json<br/>weekly NOAA STAR VHI by province/]
  J_agro[/agronomic_alerts.json<br/>+ AGRO rows merged into signals.json/]
  J_co[/colombia_supply.json/]
  J_et[/ethiopia_supply.json/]
  J_hn[/honduras_supply.json/]
  J_id[/indonesia_supply.json/]
  J_ug[/uganda_supply.json/]
  J_ferts[/global_fertilizers.json/]
  J_intel[/manual_intel.json/]
  J_enso[/enso.json/]
  br{{BR Daily Registration}}
  mv{{BR Monthly Volume}}
  brexp{{BR Export Charts}}
  bfe{{BR Farmer Economics}}
  sell{{BR Farmer Selling}}
  cec{{BR Monthly Exports}}
  vnexp{{VN Export Explorer}}
  vndest{{VN Destination Estimate}}
  vnbal{{VN Balance Sheet}}
  vnfe{{VN Farmer Economics}}
  vnwl{{VN Water Levels}}
  vnw{{VN Weather}}
  wx{{Weather charts · rain · temp · cum · forecast}}
  soil{{Soil Moisture · ESSM}}
  drought{{"Drought + vegetation indices panel · SPI / SPEI / VHI columns"}}
  frost{{14-day Frost Risk grid · moved here from farmer-econ}}
  agroAlert{{"Agronomic alerts canonical · used by /map ticker + /signals merge"}}
  ensoSub{{ENSO subtab · forecast plume · analogs · risk map}}
  coexp{{Colombia}}
  et{{Ethiopia}}
  hn{{Honduras}}
  idn{{Indonesia}}
  ug{{Uganda}}
  fert{{Fertilizers}}
  intel{{Manual Intel}}
  W17 --> J_cecd
  J_cecd --> br
  J_cecd --> mv
  J_cecd --> brexp
  W32 --> J_cec --> cec
  W331 --> DB
  W332 --> DB
  W335 --> DB
  DB --> EXP
  W333 --> EXP
  W334 --> EXP
  WCNTRY --> EXP
  WFERT --> J_ferts
  WINTEL --> J_intel
  EXP --> J_fe
  EXP --> J_fsell
  EXP --> J_vn
  EXP --> J_vnx
  EXP --> J_vnfe
  EXP --> J_vnwl
  EXP --> J_vnw
  EXP --> J_enso
  WSPI -.->|one-shot CI| SEED_SPI --> WWX
  WSPEI -.->|one-shot CI| SEED_SPEI --> WWX
  WBFL -.->|one-shot CI| WWX
  WWX --> J_wx --> wx
  J_wx --> soil
  J_wx --> drought
  WVHI --> SEED_VHI --> J_vhi
  J_vhi --> drought
  J_wx --> AGRO
  J_vhi --> AGRO
  AGRO --> J_agro --> agroAlert
  J_fe --> frost
  WENSO --> J_enso --> ensoSub
  WENFC --> J_enso
  J_fe --> bfe
  J_fsell --> sell
  J_vn --> vnexp
  J_vn --> vnbal
  J_vnx --> vndest
  J_vnfe --> vnfe
  J_vnwl --> vnwl
  J_vnw --> vnw
  J_co --> coexp
  J_et --> et
  J_hn --> hn
  J_id --> idn
  J_ug --> ug
  J_ferts --> fert
  J_fe --> fert
  J_vn --> fert
  J_intel --> intel
${DEFS}
  classDef vis fill:#1a2e05,stroke:#84cc16,color:#d9f99d;
  class W17,W32,W331,W332,W333,W334,W335,WCNTRY,WFERT,WINTEL,WWX,WSPI,WSPEI,WVHI,WENSO,WENFC,WBFL scr;
  class DB,SEED_SPI,SEED_SPEI,SEED_VHI store;
  class EXP,AGRO proc;
  class J_cecd,J_cec,J_fe,J_fsell,J_vn,J_vnx,J_vnfe,J_vnwl,J_vnw,J_wx,J_vhi,J_agro,J_co,J_et,J_hn,J_id,J_ug,J_ferts,J_intel,J_enso json;
  class br,mv,brexp,bfe,sell,cec,vnexp,vndest,vnbal,vnfe,vnwl,vnw,wx,soil,drought,frost,agroAlert,ensoSub,coexp,et,hn,idn,ug,fert,intel vis;`;

const DEMAND = `flowchart LR
  W3B["1.3b Slow-data · 1st/mo<br/>ECF stocks · USDA PSD · AJCA · UCDA"]
  WPOP["Population/age · UN WPP · World Bank"]
  W41["4.1 Earnings · quarterly · filings"]
  W31["3.1 Kaffeesteuer · 1st/mo · DESTATIS"]
  WMIX["manual / various"]
  WICE_KCD["1.13 ICE Cert Stocks · daily 17:00<br/>Arabica xls (sheet 7)<br/>publicdocs/coffee_cert_stock_*.xls"]
  WICE_KCA["1.14 ICE Arabica Ageing · day-1/mo<br/>coffee_aging_YYYYMMDD.xls"]
  WICE_RC["ICE Robusta · daily 17:00<br/>stock_report_RC_*.csv (10:30-11:15 sweep)<br/>+ age_allowance + gradings + iss_recv"]
  WICE_SPA["ICE SPA API (fallback)<br/>POST marketdata/api/reports/142/data<br/>{KC | RC} → warehouse + total"]
  COH[["cohort_outflow.py<br/>per-cohort DNA from gradings<br/>+ DNA-coverage guard"]]
  EXP{{"1.4 Export · 02:30"}}
  J_stk[/demand_stocks.json/]
  J_earn[/earnings.json/]
  J_tax[/kaffeesteuer.json/]
  J_mix[/factory_mix.json/]
  J_csa[/certified_stocks_arabica.json<br/>+ ageing_report (year-bands)/]
  J_csr[/certified_stocks_robusta.json<br/>+ monthly.implied_outflow<br/>+ monthly.current_by_origin/]
  J_h[/health.json/]
  stk{{"ICE/ECF Stocks"}}
  ecf{{ECF Panel}}
  psd{{PSD Analytical}}
  jp{{"Japan / AJCA"}}
  age{{Age Cohort}}
  grow{{Growth Markets}}
  world{{World Consumption}}
  earn{{Roaster Earnings}}
  tax{{"Kaffeesteuer (DE tax)"}}
  mix{{Roasting Mix}}
  tiles{{4-tile header per contract}}
  period{{Period view drills · age-banded}}
  sysflow{{"System Flow · warehouses · in/out/transit · cohort outflow"}}
  fresh{{Freshness chip strip (per-feed)}}
  W3B --> EXP
  WPOP --> EXP
  EXP --> J_stk
  J_stk --> stk
  J_stk --> ecf
  J_stk --> psd
  J_stk --> jp
  J_stk --> age
  J_stk --> grow
  J_stk --> world
  W41 --> J_earn --> earn
  W31 --> J_tax --> tax
  WMIX --> J_mix --> mix
  WICE_KCD --> J_csa
  WICE_KCA --> J_csa
  WICE_RC --> J_csr
  WICE_RC --> COH --> J_csr
  WICE_SPA -.fallback / freshness probe.-> J_csa
  WICE_SPA -.fallback / freshness probe.-> J_csr
  J_csa --> tiles
  J_csr --> tiles
  J_csa --> period
  J_csr --> period
  J_csa --> sysflow
  J_csr --> sysflow
  J_h --> fresh
  J_csa --> fresh
  J_csr --> fresh
${DEFS}
  classDef vis fill:#451a03,stroke:#f59e0b,color:#fde68a;
  class W3B,WPOP,W41,W31,WMIX,WICE_KCD,WICE_KCA,WICE_RC,WICE_SPA scr;
  class COH proc;
  class EXP proc;
  class J_stk,J_earn,J_tax,J_mix,J_csa,J_csr,J_h json;
  class stk,ecf,psd,jp,age,grow,world,earn,tax,mix,tiles,period,sysflow,fresh vis;`;

const MACRO = `flowchart LR
  W19["1.9 Quant CCI · 21:30 M-F<br/>jsDelivr FX · yfinance"]
  W12["1.2 Freight · 02:00<br/>Freightos · Yahoo"]
  W23["2.3 COT · Fri 20:00 · CFTC"]
  WORIG["Origin prices (1.1) · 01:00<br/>BCB·giacaphe·FNC·IHCAFE·UCDA·ECX·CEPEA"]
  WCPI["Retail CPI · BLS · Eurostat · BCB"]
  W33["3.3.1–3.3.3 CONAB + Fertilizer · 12th<br/>conab.gov.br · Comex · VN Customs"]
  EXP{{"1.4 Export · 02:30"}}
  J_mac[/macro_cot.json/]
  J_q[/quant_report.json/]
  J_fx[/fx_history.json/]
  J_fr[/freight.json/]
  J_cpi[/retail_cpi.json/]
  J_fe[/farmer_economics.json/]
  J_orig[/origin_prices_history.json/]
  xc{{Cross-Commodity MM}}
  cci{{Coffee Currency Index}}
  fx{{FX Pair Time-Series}}
  fr{{Freight Context}}
  cpi{{Retail CPI}}
  fert{{Fertilizer Inputs}}
  orig{{Origin Prices}}
  W23 --> EXP
  WCPI --> EXP
  W33 --> EXP
  WORIG --> EXP
  EXP --> J_mac --> xc
  EXP --> J_cpi --> cpi
  EXP --> J_fe --> fert
  EXP --> J_orig --> orig
  W19 --> J_q --> cci
  W19 --> J_fx --> fx
  W12 --> J_fr --> fr
${DEFS}
  classDef vis fill:#042f2e,stroke:#14b8a6,color:#99f6e4;
  class W19,W12,W23,WORIG,WCPI,W33 scr;
  class EXP proc;
  class J_mac,J_q,J_fx,J_fr,J_cpi,J_fe,J_orig json;
  class xc,cci,fx,fr,cpi,fert,orig vis;`;

const NEWSMAP = `flowchart LR
  W22["2.2 Commodity prices · Tue 22:55<br/>Barchart"]
  WPOLL["Acaphe poll · /15min<br/>acaphe.com"]
  W11["1.1 News · 01:00<br/>RSS · B3 · CEPEA · Cooabriel · AJCA"]
  W32["3.2 Cecafe export · 15th"]
  W12["1.2 Freight · 02:00"]
  WCNTRY["Origin supply (VN ports)"]
  DB[(Postgres · news_feed)]
  EXP{{"1.4 Export · 02:30"}}
  SEED["seed/factories.json"]
  SUP[/supply JSONs · CO·VN·UG·BR·…/]
  J_lp[/latest_prices.json/]
  J_aca[/acaphe_live.json/]
  J_news[/news.json · static/]
  J_ctry[/countries.json · static from supply/]
  J_fact[/factories.json · static/]
  J_cec[/cecafe.json/]
  J_fr[/freight.json/]
  J_vnx[/vn_export_destination_port/]
  J_agro[/agronomic_alerts.json<br/>(produced end of 1.10 weather run)/]
  base{{Coffee Map base}}
  price{{Price labels}}
  country{{Country pins + intel}}
  factory{{Factory pins}}
  exports{{Exports overlay}}
  freight{{Freight overlay}}
  vnport{{VN port-flow arrows}}
  news{{"News Feed / Sidebar"}}
  ticker{{"Agronomic Threats Ticker — top overlay<br/>country chips, severity sort, click→region detail"}}
  W22 --> EXP --> J_lp --> price
  WPOLL --> J_aca --> price
  W11 --> DB --> EXP
  EXP --> J_news
  J_news --> country
  J_news --> news
  SUP --> J_ctry --> country
  SEED --> J_fact --> factory
  W32 --> J_cec --> exports
  W12 --> J_fr --> freight
  WCNTRY --> J_vnx --> vnport
  J_agro --> ticker
${DEFS}
  classDef vis fill:#500724,stroke:#ec4899,color:#fbcfe8;
  class W22,WPOLL,W11,W32,W12,WCNTRY,SEED,SUP scr;
  class DB store;
  class EXP proc;
  class J_lp,J_aca,J_news,J_ctry,J_fact,J_cec,J_fr,J_vnx,J_agro json;
  class base,price,country,factory,exports,freight,vnport,news,ticker vis;`;

const GLOBAL = `flowchart LR
  J_aca[/acaphe_live.json/]
  J_lp[/latest_prices.json/]
  J_orig[/origin_prices_history.json/]
  J_cot[/cot.json/]
  J_sig[/signals.json · quant + AGRO rows/]
  J_ev[/events.json · seed/]
  J_met[/origin weather JSON ×7 · drought gated by rain_hist_min/]
  J_sup[/×N _supply.json · per-region rain_mtd/hist/]
  J_fr[/freight.json/]
  J_q[/quant_report.json/]
  J_mac[/macro_cot.json/]
  J_news[(news_feed)]
  TICKER{{"Market Ticker — global band, every tab<br/>KC + RC live · FX"}}
  TG{{"Telegram morning brief · 03:00<br/>9 sections + 'Coming up · next 24h'<br/>weather alerts gated by seasonal baseline<br/>/cot appends per-rule signals listing"}}
  J_aca --> TICKER
  J_lp --> TICKER
  J_aca --> TG
  J_lp --> TG
  J_orig --> TG
  J_cot --> TG
  J_sig --> TG
  J_ev -->|next 24h| TG
  J_sup --> TG
  J_met --> TG
  J_fr --> TG
  J_q --> TG
  J_mac --> TG
  J_news --> TG
${DEFS}
  classDef vis fill:#083344,stroke:#22d3ee,color:#a5f3fc;
  class J_aca,J_lp,J_orig,J_cot,J_sig,J_ev,J_met,J_sup,J_fr,J_q,J_mac,J_news json;
  class TICKER,TG vis;`;

const TAB_DIAGRAMS: Array<{ title: string; chart: string }> = [
  { title: "News (Daily Brief)", chart: NEWS },
  { title: "Futures Exchange", chart: FUTURES },
  { title: "COT", chart: COT },
  { title: "Freight", chart: FREIGHT },
  { title: "Supply (incl. Weather + ENSO subtab)", chart: SUPPLY },
  { title: "Demand (incl. Certified Stocks)", chart: DEMAND },
  { title: "Macro", chart: MACRO },
  { title: "Map", chart: NEWSMAP },
  { title: "Global — Ticker & Telegram brief", chart: GLOBAL },
];

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
  { wf: "3.3.1 CONAB", output: "farmer_economics.json", component: "FarmerSellingPanel", visual: "Supply · Brazil Farmer Economics" },
  { wf: "3.3.2 BR Fertilizer", output: "farmer_economics.json", component: "FertilizerInputsPanel", visual: "Macro · Fertilizer Inputs (Brazil)" },
  { wf: "3.3.3 VN Fertilizer", output: "vn_fertilizer.json", component: "VnFarmerEconomics", visual: "Supply · VN Farmer Economics (fertilizer cost)" },
  { wf: "3.3.4 VN Coffee Exports", output: "vn_coffee_export.json → vietnam_supply.json", component: "VnExportExplorer · VnBalanceSheet", visual: "Supply · VN Export Explorer + Balance Sheet" },
  { wf: "3.3.5 Uganda UCDA", output: "uganda_supply.json", component: "UgandaTab", visual: "Supply · Uganda (exports, split, grades, destinations)" },
  { wf: "4.1 Earnings", output: "earnings.json", component: "EarningsTable", visual: "Demand · Roaster Earnings" },
  { wf: "various / manual", output: "factory_mix.json", component: "RoastingMixPanel", visual: "Demand · Roasting Mix" },
  { wf: "various / manual", output: "global_fertilizers.json", component: "FertilizersTab", visual: "Supply · Fertilizers" },
  { wf: "various / manual", output: "manual_intel.json", component: "ManualIntelPanel", visual: "Supply · Manual Intel" },
  { wf: "various / manual", output: "retail_cpi.json", component: "RetailCpiPanel", visual: "Macro · Retail CPI" },
  { wf: "various / manual", output: "origin_prices_history.json", component: "OriginPricesPanel", visual: "Macro · Origin Prices" },
  { wf: "various / manual", output: "*_supply.json (CO·ET·HN·ID)", component: "country tabs", visual: "Supply · country pages + Map (UG now via 3.3.5)" },
  // ── Added in the last 10 days ────────────────────────────────────────────
  { wf: "1.13 ICE Certified Stocks", output: "certified_stocks_arabica.json + …robusta.json", component: "CertifiedStocksPanel · CertifiedStocksSystemFlow", visual: "Demand · Tiles + Period view + System flow + Freshness chips" },
  { wf: "1.14 ICE Arabica Ageing (monthly)", output: "certified_stocks_arabica.json.ageing_report", component: "ArabicaPeriodTable", visual: "Demand · Stocks drill Age (0Y/1Y/2Y/3Y/>4Y) → Group → Origin" },
  { wf: "cohort_outflow (inline 1.13)", output: "certified_stocks_robusta.json.monthly.{implied_outflow, current_by_origin}", component: "CertifiedStocksSystemFlow", visual: "Demand · Robusta per-origin in/out/lost/transit (cohort DNA + coverage guard)" },
  { wf: "0.3 SPI baseline (one-shot)", output: "spi_30yr_baselines.json", component: "fetch_origin_weather + WeatherCharts", visual: "Supply · Weather · Drought Indices (SPI-1 / SPI-3)" },
  { wf: "0.4 SPEI baseline (one-shot)", output: "spei_30yr_baselines.json", component: "fetch_origin_weather + WeatherCharts", visual: "Supply · Weather · Drought Indices (SPEI = D vs 30y, D = P − ET₀)" },
  { wf: "/enso → /supply subtab", output: "enso.json", component: "SupplyEnsoTab", visual: "Supply · ENSO subtab (PhaseSummary + ForecastPlume + AnalogChart + RiskMap)" },
  { wf: "EnsoPanel + WeatherRiskPanel relocation", output: "farmer_economics.json {.enso, .weather}", component: "WeatherCharts (farmerEconomicsUrl)", visual: "Supply · Brazil · Weather subtab (was: Farmer Economics)" },
  { wf: "build_events_calendar.py", output: "events.json (seed + /public mirror)", component: "UpcomingCalendar", visual: "News · Coming up next 30 days (ISO-week timeline)" },
  { wf: "1.1 News (existing)", output: "news.json", component: "HeadlinesDigest + RiskRadar", visual: "News · Filtered headlines digest · keyword-velocity radar" },
  { wf: "1.4 Export (existing)", output: "health.json", component: "FreshnessGrid", visual: "News · 'What changed since yesterday' chip grid (26 feeds, today pulse)" },
  // ── Added this sprint (Phase 5 Path A + Sprint 2) ────────────────────────
  { wf: "0.5 NOAA STAR VHI (weekly, Sat 23:00)", output: "vhi_{origin}.json ×7", component: "WeatherCharts (VHI column in Drought + vegetation panel)", visual: "Supply · Weather · VHI chip per province · stress<40 / fair 40-60 / healthy>60" },
  { wf: "0.6 backfill_missing_fields (one-shot)", output: "weather_history/*.json (rain + et0 + tmean heal)", component: "(internal: unblocks SPEI emit when forecast endpoint truncates et0/rain)", visual: "—" },
  { wf: "0.7 backfill_history_gap (one-shot)", output: "weather_history/*.json (2025 gap fill)", component: "(internal: unblocks SPEI-3 by making seed↔history contiguous)", visual: "—" },
  { wf: "Agronomic Alert Engine (Phase 5 Path A · end of 1.10)", output: "agronomic_alerts.json + AGRO rows in signals.json", component: "AgronomicTicker", visual: "Map · Live Agronomic Threats top overlay · country chips · click→region detail" },
  { wf: "1.6 Morning Brief (Body-4)", output: "reads events.json", component: "telegram/handlers/brief.py::_upcoming_events_section", visual: "Telegram · 'Coming up · next 24h' block under weather" },
  { wf: "1.6 Morning Brief (Body-3)", output: "—", component: "telegram/handlers/brief.py::_weather_line", visual: "Telegram · drought alerts gated by rain_mtd_mm < rain_hist_min (seasonal baseline)" },
  { wf: "/cot Telegram command (Body-1)", output: "reads signals.json", component: "telegram/handlers/cot.py", visual: "Telegram · 'Signals (NY)/(LDN)' per-rule listing under position block · CRIT/ALERT/WARN/INFO" },
  { wf: "OI 14-day cap (Body-8)", output: "oi_history.json sliced to 14 days (was 30)", component: "OIHistoryTable", visual: "COT · OI 14-day table · contract_prices_archive.json (5y) untouched" },
  { wf: "COT Robusta nearby-OI fix (Body-7)", output: "—", component: "lib/cot/oiNearby.ts · Overview.tsx", visual: "COT · 'X k lots in nearby (N and U)' re-derived from per-contract oi_history.json (was 0.0 bug)" },
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
        <Card title="Architecture overview — the single-source view">
          <Mermaid chart={ARCHITECTURE} />
          <div className="text-[11px] text-slate-500 leading-relaxed mt-3 px-1">
            <p className="mb-1">
              <span className="text-amber-400">★ contract_prices_archive.json</span> is the single coffee
              OI+price source: one daily fetch (1.3) feeds it, and it fans out to the OI table, both
              OI→FND charts, and the Industry Pulse price (via the max-OI rebuild in 2.3).
            </p>
            <p>Symbol convention — FETCH=RM (Barchart) · STORE=RC (canonical) · DISPLAY=RM (OI table + FND chart).</p>
          </div>
        </Card>

        <p className="text-[11px] text-slate-500 px-1">
          One diagram per dashboard tab — source · frequency → store → JSON → visual.
        </p>
        {TAB_DIAGRAMS.map(({ title, chart }) => (
          <Card key={title} title={title}>
            <Mermaid chart={chart} />
          </Card>
        ))}

        <Card title="Per-workflow → exact dashboard visual">
          <WorkflowTable />
        </Card>
      </div>
    </div>
  );
}
