# Coffee Intel Map — Data Platform Map

_Last updated: 2026-05-20 (post archive-unification + true max-OI rebuild)_

## TODO / open items

- [ ] **8-day OI gap (2026-03-26 → 2026-04-05)** — between the bulk OI CSV's end
      (2026-03-25) and the live archive's start (~2026-04-06). Those COT-Tuesdays
      keep their pre-rebuild price. _User to supply the gap OI data; load with
      `load_contract_csv.py --kind oi`._
- [ ] (someday) Migrate FND chart + frontend `STATIC_SERIES` to RC so the
      DISPLAY=RM conversion can be dropped entirely (cosmetic; low priority).

---

## 1. The architecture in one picture

```mermaid
flowchart TD
    %% ---------- SOURCES ----------
    subgraph SRC[External sources]
        BC[Barchart core-api]
        CFTC[CFTC COT report]
        JSD[jsDelivr FX]
        ACA[acaphe / giacaphe / Cecafe / ICO ...]
    end

    %% ---------- FETCHERS ----------
    F13[["1.3 Daily OI Snapshot<br/>02:00 Mon-Fri"]]
    F23[["2.3 COT Scraper<br/>Fri 20:00"]]
    F19[["1.9 Quant CCI<br/>21:30 Mon-Fri"]]
    FPOLL[["Acaphe poll<br/>every 15m"]]
    FNEWS[["1.1/1.2/1.7/3.x<br/>news·freight·origin"]]

    %% ---------- CANONICAL STORE ----------
    ARC[("contract_prices_archive.json<br/>★ SINGLE coffee OI+price source<br/>date-keyed · RC canonical · 5y")]
    DB[(Postgres · 13 tables)]

    %% ---------- EXPORT ----------
    EXP[["1.4 Export & Publish<br/>01:30 daily + on-2.3"]]
    SIG[[export-signals.mjs]]

    %% ---------- PUBLISHED JSON ----------
    OIH[/oi_history.json · 30d view/]
    FND[/oi_fnd_chart.json/]
    COTJ[/cot.json · cot_recent.json/]
    MAC[/macro_cot.json/]
    SIGJ[/signals.json/]
    QJ[/quant_report.json · fx_history.json/]
    ACJ[/acaphe_live.json/]
    ORIG[/origin · supply · freight JSON/]

    %% ---------- VISUALS ----------
    V_IP{{COT · Industry Pulse<br/>price + PMPU + switch dots}}
    V_OI{{Futures · OI 7-day table}}
    V_FND{{COT · OI Evolution to FND}}
    V_SIG{{COT · Signals + gauges}}
    V_FLOW{{COT · Global Flow / Dry Powder / Cycle}}
    V_MAC{{Macro · cross-commodity MM}}
    V_CCI{{Macro · CCI + FX}}
    V_QUOTE{{Futures · daily quotes}}
    V_MAP{{Map · origin/supply}}
    V_TG{{Telegram morning brief}}

    %% ---------- EDGES: fetch ----------
    BC --> F13 --> ARC
    BC --> FPOLL --> ACJ
    CFTC --> F23
    JSD --> F19 --> QJ
    ACA --> FNEWS --> DB

    %% archive-derived
    ARC -->|derive 30d view| OIH
    ARC -->|FND export| FND
    ARC -->|rebuild max-OI<br/>in 2.3| DB

    %% COT scraper writes positions to DB
    F23 -->|positions| DB

    %% export
    DB --> EXP
    EXP --> COTJ
    EXP --> MAC
    EXP --> FND
    EXP --> ORIG
    COTJ --> SIG --> SIGJ

    %% JSON -> visuals
    COTJ --> V_IP
    COTJ --> V_SIG
    COTJ --> V_FLOW
    OIH --> V_OI
    FND --> V_FND
    MAC --> V_MAC
    SIGJ --> V_TG
    QJ --> V_CCI
    ACJ --> V_QUOTE
    ORIG --> V_MAP
```

---

## 2. Fetch layer (scheduled jobs)

| WF | Name | Schedule (UTC) | Fetches | Lands in |
|---|---|---|---|---|
| **1.3** | Daily OI Snapshot | 02:00 Mon-Fri | KC+RM full chain (OI+price) | **`contract_prices_archive.json`** (+ derives `oi_history.json`) |
| 1.1 | Daily News | 01:00 daily | news + origin | DB |
| 1.2 | Freight | 02:00 daily | rates | DB |
| 1.4 | **Export & Publish** | 01:30 daily + on-2.3 | *(reads DB + archive)* | ~17 static JSON + signals |
| 1.5 | Check Scrapers Fresh | 07:00 daily | *(reads health.json)* | Telegram |
| 1.6 | Morning Brief | 03:00 daily | *(reads JSON)* | Telegram |
| 1.7 | Cecafe Daily | 09:00 daily | BR registrations | `cecafe_daily.json` |
| 1.9 | Quant CCI | 21:30 Mon-Fri | FX + Robusta factors | `quant_report.json`+`fx_history.json` |
| Acaphe | Live Quotes Poll | every 15m | live quotes | `acaphe_live.json` |
| 2.2 | Commodity Prices | Tue 22:55 | all-commodity prices | DB `commodity_prices` |
| **2.3** | COT Scraper **+ archive price rebuild** | Fri 20:00 | CFTC COT (all commodities + coffee) → DB; **then rebuild cot_weekly prices from archive (max-OI)** | DB |
| 3.1/3.2/3.3/4.1 | Kaffeesteuer / Cecafe / CONAB / Earnings | monthly+ | tax/exports/costs/earnings | DB / JSON |
| 0.1–0.4 | One-shot backfills | manual | *(archive loads, rebuilds)* | DB / archive |

**Retired:** ~~2.1 Tuesday Coffee Settlement Prices~~ — replaced by the archive rebuild step inside 2.3.

---

## 3. Storage & retention

| Store | Source | Retention |
|---|---|---|
| **`contract_prices_archive.json`** ★ | 1.3 daily + bulk CSV loads | **5y (1320d), auto-trim** |
| `oi_history.json` | **derived** from archive (30d view) | 30 days |
| `cot_weekly` (DB) | 2.3 positions + archive rebuild (prices) | permanent; prices now overwrite-from-archive |
| `commodity_cot` (DB) | 2.3 (all commodities) | permanent |
| `cot.json` | 1.4 from DB | full history |
| `cot_recent.json` | 1.4 | last 12 weeks |
| `signals.json` | export-signals.mjs | current + 8wk |
| `oi_fnd_chart.json` | 1.4 ← archive | cur+prev yr contracts, −45..0d |
| 11 other DB tables / ~30 JSON | various | permanent |

---

## 4. Visual → source (the "what feeds what")

### 4a. Per-workflow → exact dashboard visual

| Workflow | DB/JSON output | Component | Tab · Visual |
|---|---|---|---|
| **1.3 Daily OI** | `oi_history.json` | `OIHistoryTable` | **Futures · OI 7-day table** (+ COT §2) |
| | `oi_fnd_chart.json` | `OIFndChart` | **Futures + COT · OI Evolution to FND** |
| | archive→(2.3 rebuild)→`cot.json` price | `Step4IndustryPulse` | **COT · Industry Pulse — price line + switch dots** |
| **1.1 Daily News** | DB `news_feed` | `/api/news`, map labels | **Map · news labels / table**; Telegram news |
| | DB `country_intel` | `CoffeeMap` popups | **Map · country intel** |
| **1.2 Freight** | `freight.json` | `FreightContextPanel` | **Macro · Freight Context**; Telegram freight |
| **1.4 Export & Publish** | *(all static JSON)* | — | *plumbing — feeds every JSON-backed visual* |
| **1.5 Fresh check** | — | — | *Telegram alert only* |
| **1.6 Morning Brief** | reads `signals.json`,`events.json`,JSON | — | **Telegram brief** (the message itself) |
| **1.7 Cecafe Daily** | `cecafe_daily.json` | `DailyRegistration` | **Supply · Brazil · Daily Registration**; Telegram |
| **1.9 Quant CCI** | `quant_report.json` | `CurrencyIndexSection` | **Macro · Coffee Currency Index** |
| | `fx_history.json` | `FxTimeSeriesPanel` | **Macro · FX Pair Time-Series** |
| **Acaphe poll** | `acaphe_live.json` | `AcapheLiveQuotes` | **Futures · Daily Live Quotes** |
| **1.3b Slow-Data** (ECF·PSD·AJCA·UCDA) | `demand_stocks.json` | `StocksPanel` | **Demand · Stocks (ICE certified + PSD)** |
| **2.2 Commodity Prices** | DB `commodity_prices` → `latest_prices.json` | `CoffeeMap` | **Map · price labels + header ticker** |
| **2.3 COT Scraper + rebuild** | `cot.json` | `Step1/4/5/6/7/8` | **COT · Signals, Gauges, Heatmap, Global Flow, Industry Pulse (positions), Dry Powder, Cycle, Report** |
| | `macro_cot.json` | `CrossCommodityPanel` | **Macro · Cross-Commodity MM** |
| | `signals.json` | morning_brief | **Telegram · CoT signals** |
| | archive rebuild → `cot.json` price | `Step4IndustryPulse` | **COT · Industry Pulse price (true max-OI)** |
| **3.1 Kaffeesteuer** | `kaffeesteuer.json` | `KaffeesteuerChart` | **Demand · Kaffeesteuer (DE tax)** |
| **3.2 Cecafe Export** | `cecafe.json` | `CoffeeMap` | **Map · Brazil monthly exports** |
| **3.3 CONAB** | `farmer_economics.json` | `FertilizerInputsPanel` / `FarmerSellingPanel` | **Macro · Fertilizer Inputs** + **Supply · Farmer Economics** |
| **4.1 Earnings** | `earnings.json` | `EarningsTable` | **Demand · Roaster Earnings** |
| _various / manual_ | `factory_mix.json` | `RoastingMixPanel` | **Demand · Roasting Mix** |
| | `global_fertilizers.json` | `FertilizersTab` | **Supply · Fertilizers** |
| | `manual_intel.json` | `ManualIntelPanel` | **Supply · Manual Intel** |
| | `retail_cpi.json` | `RetailCpiPanel` | **Macro · Retail CPI** |
| | `origin_prices_history.json` | `OriginPricesPanel` | **Macro · Origin Prices** |
| | `farmer_selling_brazil.json` | `FarmerSellingPanel` | **Supply · Farmer Selling** |
| | `*_supply.json` (colombia/vietnam/…) | per-country tabs | **Supply · country pages**; **Map** |

### 4c. Full pipeline (exhaustive) — every source · frequency → store → JSON → visual → Telegram

```mermaid
flowchart LR
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

  %% ================= MAP =================
  subgraph MAP["Map / News & Intel"]
    mp_map{{CoffeeMap: price·exports·freight·VN-port layers}}
    mp_tick{{Market Ticker}}
    mp_news{{News Feed + country intel}}
  end

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
  J_lp --> mp_map
  J_cec --> mp_map
  J_fr --> mp_map
  J_vnx --> mp_map
  J_lp --> mp_tick
  J_aca --> mp_tick
  J_news --> mp_news

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
  J_news -->|news| TG
```

### 4b. By dashboard tab (reverse view)

- **COT** (`/cot`): Industry Pulse, Signals, Gauges, Heatmap, Global Flow, Dry Powder, Cycle, Report ← `cot.json` + `signals.json`; OI 7-day + OI→FND ← archive.
- **Futures** (`/futures`): daily quotes ← `acaphe_live.json`; chain ← `futures_chain.json`; OI table ← `oi_history.json`; OI→FND ← `oi_fnd_chart.json`.
- **Macro** (`/macro`): CCI ← `quant_report.json`; FX ← `fx_history.json`; cross-commodity MM ← `macro_cot.json`; freight ← `freight.json`; retail CPI ← `retail_cpi.json`; fertilizer inputs/origin prices ← `farmer_economics.json`/`origin_prices_history.json`.
- **Demand** (`/demand`): stocks ← `demand_stocks.json`; roasting mix ← `factory_mix.json`; earnings ← `earnings.json`; DE tax ← `kaffeesteuer.json`.
- **Supply** (`/supply`): Brazil daily reg ← `cecafe_daily.json`; fertilizers ← `global_fertilizers.json`; farmer economics ← `farmer_*`; manual intel ← `manual_intel.json`; country pages ← `*_supply.json`.
- **Map** (`/map`): price labels ← `latest_prices.json`; exports ← `cecafe.json`; intel/news ← `/api/news`+`country_intel`.



---

## 5. Key design properties (post-redesign)

- **One coffee data source.** All coffee OI + price flows from the single daily
  fetch (1.3) into the archive. The OI table, FND chart, Industry Pulse price,
  and switch markers all derive from it. No parallel Tuesday fetch, no
  Stooq/yfinance continuous-feed exposure.
- **Symbol convention, one layer** (`backend/scraper/symbols.py`):
  FETCH=RM (Barchart) · STORE=RC (canonical) · DISPLAY=RM (OI table + FND chart).
- **Price/label can't disagree.** Both come from the same archive cell, chosen
  by max-OI per COT-Tuesday.
- **Single DB→JSON sync point**: the export job (1.4). No-op commits are skipped.
- **Reversibility**: every price rebuild archives originals to
  `cot_weekly_price_archive`.
