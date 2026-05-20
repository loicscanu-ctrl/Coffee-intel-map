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
  W13[/"1.3 Daily OI<br/>02:00 M-F"/]
  W23[/"2.3 COT + rebuild<br/>Fri 20:00"/]
  W19[/"1.9 Quant CCI"/]
  WPOLL[/"Acaphe poll 15m"/]
  W11[/"1.1 News"/]
  W12[/"1.2 Freight"/]
  W17[/"1.7 Cecafe daily"/]
  W22[/"2.2 Commodity prices"/]
  W3B[/"1.3b Slow-data"/]
  W31[/"3.1 Kaffeesteuer"/]
  W32[/"3.2 Cecafe export"/]
  W33[/"3.3 CONAB"/]
  W41[/"4.1 Earnings"/]
  W16[/"1.6 Morning brief"/]
  ARC[("contract_prices_archive.json<br/>single coffee OI+price")]
  subgraph COT["COT tab"]
    c_ip{{Industry Pulse: price + PMPU + switch dots}}
    c_sig{{Signals + gauges + heatmap}}
    c_flow{{Global Flow / Dry Powder / Cycle / Report}}
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
    m_fert{{Fertilizer Inputs / Origin Prices}}
  end
  subgraph DEM["Demand tab"]
    d_stk{{Stocks}}
    d_mix{{Roasting Mix}}
    d_earn{{Roaster Earnings}}
    d_tax{{Kaffeesteuer}}
  end
  subgraph SUP["Supply tab"]
    s_br{{Brazil Daily Registration}}
    s_farm{{Farmer Economics / Selling}}
    s_fert{{Fertilizers}}
    s_ctry{{Country pages}}
  end
  subgraph MAP["Map"]
    mp_px{{Price labels + ticker}}
    mp_exp{{Brazil exports}}
    mp_news{{News / country intel}}
  end
  TG{{Telegram brief}}
  W13 --> ARC
  ARC --> f_oi
  ARC --> c_oifnd
  ARC --> f_oifnd
  ARC -->|max-OI rebuild via 2.3| c_ip
  W23 --> c_ip
  W23 --> c_sig
  W23 --> c_flow
  W23 --> m_xc
  W23 --> TG
  W19 --> m_cci
  W19 --> m_fx
  WPOLL --> f_quote
  W12 --> m_fr
  W22 --> mp_px
  W3B --> d_stk
  W31 --> d_tax
  W41 --> d_earn
  W32 --> mp_exp
  W33 --> m_fert
  W33 --> s_farm
  W17 --> s_br
  W11 --> mp_news
  W16 --> TG
  W3B -.-> d_mix
  W33 -.-> s_fert
  W11 -.-> s_ctry`;

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
        <Card title="Workflow → dashboard visual">
          <Mermaid chart={WORKFLOW_TO_VISUAL} />
        </Card>
        <Card title="End-to-end architecture (fetch → store → publish → show)">
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
