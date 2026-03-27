/* eslint-disable */
// This file generates a self-contained interactive HTML dashboard.
// The JSX inside is a plain string compiled by Babel in the browser — no TypeScript.

export function buildStandaloneHtml(
  processed: any[],
  macroData: any[],
  globalFlowMetrics: any,
  dateStr: string,
  reactJs: string,
  reactDomJs: string,
  propTypesJs: string,
  rechartsJs: string,
  babelJs: string,
  appCss: string
): string {
  const safe = (obj: unknown) =>
    JSON.stringify(obj).replace(/<\/script>/gi, "<\\/script>");

  const bakedJson = safe({ processed, macroData, globalFlowMetrics });

  // ── JSX component (no TypeScript, no template literals, no imports) ──────────
  const jsx = `
const { useState, useMemo } = React;
const {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart,
  ScatterChart, Scatter, Cell, PieChart, Pie, ReferenceLine, ReferenceArea, Label
} = Recharts;

// ── Constants ─────────────────────────────────────────────────────────────────
const ARABICA_MT_FACTOR   = 17.01;
const ROBUSTA_MT_FACTOR   = 10.00;
const CENTS_LB_TO_USD_TON = 22.0462;

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS = {
  Globe:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Users:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Factory:  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>,
  Droplets: <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7 2.9 7 2.9s-2.29 6.16-3.29 7.16C2.57 11.01 2 12.11 2 13.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 1 14 8c2 2 3 4.8 3 6.5s-1.8 3.5-4 3.5-4-1.5-4-3.5"/></svg>,
  Scale:    <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>,
  Grid:     <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  Sliders:  <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
};

// ── Sectors ───────────────────────────────────────────────────────────────────
const SECTORS = ["energy","metals","grains","meats","softs","micros"];
const SECTOR_COLORS = { energy:"#f97316", metals:"#6366f1", grains:"#f59e0b", meats:"#ef4444", softs:"#10b981", micros:"#8b5cf6" };
const ENERGY_SYMBOLS = new Set(["wti","brent","natgas","heating_oil","rbob","lsgo"]);

const SOFT_SYMBOLS = [
  { key:"arabica",     label:"Arabica Coffee",  color:"#f59e0b" },
  { key:"robusta",     label:"Robusta Coffee",  color:"#78350f" },
  { key:"sugar11",     label:"Sugar No. 11",    color:"#a3e635" },
  { key:"white_sugar", label:"White Sugar",     color:"#d1fae5" },
  { key:"cotton",      label:"Cotton",          color:"#60a5fa" },
  { key:"cocoa_ny",    label:"Cocoa NY",        color:"#a78bfa" },
  { key:"cocoa_ldn",   label:"Cocoa London",    color:"#7c3aed" },
  { key:"oj",          label:"Orange Juice",    color:"#fb923c" },
];

const CAT_ITEMS = [
  { k:"pmpu",   l:"PMPU",          c:"#3b82f6" },
  { k:"mm",     l:"Managed Money", c:"#f59e0b" },
  { k:"swap",   l:"Swap/Index",    c:"#10b981" },
  { k:"other",  l:"Other Rept",    c:"#64748b" },
  { k:"nonrep", l:"Non Rept",      c:"#94a3b8" },
];
const CHART_STYLE = { backgroundColor:"#0f172a", borderColor:"#334155" };
var HM_CAT_COLORS = { "PMPU":"#92400e", "Swap":"#10b981", "MM":"#1e40af", "Other Rpt":"#38bdf8", "Non-Rep":"#64748b" };
const SECTOR_ORDER_ATTR = ["energy","metals","grains","meats","softs","micros"];
const SECTOR_LABELS_ATTR = { energy:"Energy", metals:"Metals", grains:"Grains", meats:"Meats", softs:"Softs", micros:"Micros" };

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAttr(n) { if (n == null) return "—"; return (n >= 0 ? "+" : "") + n.toFixed(2) + "B"; }
function attrColor(n) { if (n == null) return "#6b7280"; return n >= 0 ? "#10b981" : "#ef4444"; }

function transformMacroData(weeks, mode) {
  return weeks.map(function(week) {
    var sectorTotals = { energy:0, metals:0, grains:0, meats:0, softs:0, micros:0 };
    var coffeeGross = 0, totalGross = 0, hasCoffeePrice = true;
    for (var i = 0; i < week.commodities.length; i++) {
      var c = week.commodities[i];
      var g = c.gross_exposure_usd, n = c.net_exposure_usd;
      var val = mode === "gross" ? g : mode === "gross_long" ? (g != null && n != null ? (g+n)/2 : null) : mode === "gross_short" ? (g != null && n != null ? (g-n)/2 : null) : n;
      if (val == null) continue;
      var valB = val / 1e9;
      var displaySector = c.sector === "hard" ? (ENERGY_SYMBOLS.has(c.symbol) ? "energy" : "metals") : c.sector;
      if (sectorTotals[displaySector] !== undefined) sectorTotals[displaySector] += valB;
      if (c.symbol === "arabica" || c.symbol === "robusta") {
        if (c.gross_exposure_usd == null) hasCoffeePrice = false; else coffeeGross += c.gross_exposure_usd;
      }
      if (c.gross_exposure_usd != null) totalGross += c.gross_exposure_usd;
    }
    return {
      date: week.date,
      energy: sectorTotals.energy||0, metals: sectorTotals.metals||0,
      grains: sectorTotals.grains||0, meats: sectorTotals.meats||0,
      softs: sectorTotals.softs||0, micros: sectorTotals.micros||0,
      coffeeShare: (hasCoffeePrice && totalGross > 0) ? (coffeeGross/totalGross)*100 : null,
    };
  }).filter(function(row) {
    return Math.abs(row.energy)+Math.abs(row.metals)+Math.abs(row.grains)+Math.abs(row.meats)+Math.abs(row.softs)+Math.abs(row.micros) > 0;
  });
}

function softChartDataFn(macroData, macroToggle) {
  return macroData.map(function(week) {
    var row = { date: week.date };
    SOFT_SYMBOLS.forEach(function(sym) {
      var c = week.commodities.find(function(x) { return x.symbol === sym.key; });
      if (!c) { row[sym.key] = 0; return; }
      var g = c.gross_exposure_usd, n = c.net_exposure_usd;
      var val = macroToggle === "gross" ? g : macroToggle === "gross_long" ? (g!=null&&n!=null?(g+n)/2:null) : macroToggle === "gross_short" ? (g!=null&&n!=null?(g-n)/2:null) : n;
      row[sym.key] = val != null ? val/1e9 : 0;
    });
    return row;
  }).filter(function(row) { return SOFT_SYMBOLS.some(function(s) { return Math.abs(row[s.key]) > 0; }); });
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-5 border-b border-slate-800 pb-3">
      <div className="p-2 bg-slate-800 rounded-lg border border-slate-700 text-amber-500 shrink-0">{ICONS[icon]}</div>
      <div>
        <h3 className="text-base font-bold text-slate-100">{title}</h3>
        <p className="text-xs text-slate-400 max-w-xl">{subtitle}</p>
      </div>
    </div>
  );
}

function CatToggles({ cats, set, items }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {items.map(function(cat) {
        return (
          <button key={cat.k} onClick={function() { set(cat.k); }}
            className={"flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase transition-all " + (cats[cat.k] ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-transparent border-slate-800 text-slate-600")}>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cats[cat.k] ? cat.c : "transparent", border: cats[cat.k] ? "none" : ("1px solid " + cat.c) }} />
            {cat.l}
          </button>
        );
      })}
    </div>
  );
}

var CP_CATS = [
  { name:"PMPU",      longF:"pmpuLong",    shortF:"pmpuShort",    longC:"#92400e", shortC:"#92400e" },
  { name:"Swap",      longF:"swapLong",    shortF:"swapShort",    longC:"#10b981", shortC:"#10b981" },
  { name:"MM",        longF:"mmLong",      shortF:"mmShort",      longC:"#1e40af", shortC:"#1e40af" },
  { name:"Other Rpt", longF:"otherLong",   shortF:"otherShort",   longC:"#38bdf8", shortC:"#38bdf8" },
  { name:"Non-Rep",   longF:"nonRepLong",  shortF:"nonRepShort",  longC:"#64748b", shortC:"#64748b" },
];
var CP_SPREADS = [
  { name:"MM",    f:"mmSpread",    color:"#f59e0b" },
  { name:"Swap",  f:"swapSpread",  color:"#10b981" },
  { name:"Other", f:"otherSpread", color:"#64748b" },
];

// ── Section 2: 13-Week Heatmap ────────────────────────────────────────────────
function CotHeatmap({ data }) {
  var _s2 = useState("ny"); var market = _s2[0]; var setMarket = _s2[1];
  var _s3 = useState("net"); var mode = _s3[0]; var setMode = _s3[1];
  var weeks13 = data.slice(-13);

  var lsFields = [
    { label:"PMPU",      lf:"pmpuLong",   sf:"pmpuShort"   },
    { label:"Swap",      lf:"swapLong",   sf:"swapShort"   },
    { label:"MM",        lf:"mmLong",     sf:"mmShort"     },
    { label:"Other Rpt", lf:"otherLong",  sf:"otherShort"  },
    { label:"Non-Rep",   lf:"nonRepLong", sf:"nonRepShort" },
  ];
  var spreadFields = [
    { label:"MM Spr",    key:"mmSpread",    color:"#a78bfa" },
    { label:"Swap Spr",  key:"swapSpread",  color:"#34d399" },
    { label:"Other Spr", key:"otherSpread", color:"#67e8f9" },
  ];

  function gv(d, field) { return (d[market] && d[market][field]) ? d[market][field] : 0; }

  var lsRows = lsFields.map(function(f) {
    return {
      label: f.label,
      color: HM_CAT_COLORS[f.label] || "#64748b",
      vals: weeks13.map(function(d) {
        if (mode === "long")  return gv(d, f.lf);
        if (mode === "short") return gv(d, f.sf);
        return gv(d, f.lf) - gv(d, f.sf);
      }),
    };
  });
  var spreadRows = spreadFields.map(function(f) {
    return { label: f.label, color: f.color, vals: weeks13.map(function(d) { return gv(d, f.key); }) };
  });

  function cellBg(val, min, max, isSpread) {
    if (max === min) return "#1e293b";
    if (isSpread) {
      var t = (val - min) / (max - min);
      return "rgba(167,139,250," + (0.12 + t * 0.65).toFixed(2) + ")";
    }
    if (mode === "net") {
      var range = Math.max(Math.abs(min), Math.abs(max));
      if (!range) return "#1e293b";
      var t2 = val / range;
      if (t2 >= 0) return "rgba(34,197,94," + (0.1 + t2 * 0.6).toFixed(2) + ")";
      return "rgba(239,68,68," + (0.1 + (-t2) * 0.6).toFixed(2) + ")";
    }
    var t3 = (val - min) / (max - min);
    return "rgba(99,102,241," + (0.1 + t3 * 0.65).toFixed(2) + ")";
  }

  function renderRow(row, isSpread) {
    var min = Math.min.apply(null, row.vals);
    var max = Math.max.apply(null, row.vals);
    return (
      <div key={row.label} style={{ display:"grid", gridTemplateColumns:"72px repeat(" + weeks13.length + ", 1fr)", gap:2, marginBottom:2 }}>
        <div style={{ fontSize:10, color:row.color, fontWeight:600, display:"flex", alignItems:"center" }}>{row.label}</div>
        {row.vals.map(function(val, wi) {
          var isLast = wi === weeks13.length - 1;
          var range2 = isSpread ? (max - min) : mode === "net" ? Math.max(Math.abs(min), Math.abs(max)) : (max - min);
          var intensity = range2 > 0 ? (isSpread ? (val-min)/range2 : mode === "net" ? Math.abs(val)/range2 : (val-min)/range2) : 0;
          return (
            <div key={wi} title={row.label + " " + weeks13[wi].date + ": " + Math.round(val).toLocaleString() + " lots"}
              style={{
                background: cellBg(val, min, max, isSpread),
                borderRadius:3, height:30, display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:9, color: intensity > 0.4 ? "rgba(255,255,255,0.9)" : "#475569",
                fontWeight: isLast ? 700 : 400,
                outline: isLast ? "2px solid #6366f1" : "none",
                outlineOffset: "-1px",
              }}>
              {Math.abs(val) >= 1000 ? (Math.abs(val)/1000).toFixed(0)+"k" : Math.round(val)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <React.Fragment>
      <SectionHeader icon="Grid" title="2. 13-Week Positioning Heatmap" subtitle="Weekly position levels by category. Color intensity = level within each row's own 13-week range. Purple outline = latest week." />
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:4, background:"#0f172a", padding:4, borderRadius:8, border:"1px solid #1e293b" }}>
          {["ny","ldn"].map(function(m) {
            return (
              <button key={m} onClick={function(){ setMarket(m); }}
                style={{ padding:"6px 12px", borderRadius:4, fontSize:11, fontWeight:700, cursor:"pointer", border:"none",
                  background: market===m ? "#1e293b" : "transparent",
                  color: market===m ? "#fbbf24" : "#64748b" }}>
                {m === "ny" ? "NY Arabica" : "LDN Robusta"}
              </button>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:4, background:"#0f172a", padding:4, borderRadius:8, border:"1px solid #1e293b" }}>
          {["net","long","short"].map(function(m) {
            return (
              <button key={m} onClick={function(){ setMode(m); }}
                style={{ padding:"6px 12px", borderRadius:4, fontSize:11, fontWeight:700, cursor:"pointer", border:"none", textTransform:"uppercase",
                  background: mode===m ? "#1e293b" : "transparent",
                  color: mode===m ? "#fbbf24" : "#64748b" }}>
                {m === "net" ? "Net" : m === "long" ? "Longs" : "Shorts"}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:16, overflowX:"auto" }}>
        <div style={{ display:"grid", gridTemplateColumns:"72px repeat("+weeks13.length+", 1fr)", gap:2, marginBottom:2 }}>
          <div/>
          {weeks13.map(function(d,i) {
            return <div key={i} style={{ fontSize:9, color: i===weeks13.length-1 ? "#a5b4fc" : "#475569", textAlign:"center" }}>{String(d.date).slice(5)}</div>;
          })}
        </div>
        <div style={{ fontSize:10, color:"#475569", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>
          {mode === "net" ? "Net (L - S)" : mode === "long" ? "Longs" : "Shorts"}
        </div>
        {lsRows.map(function(row) { return renderRow(row, false); })}
        <div style={{ borderTop:"1px dashed #334155", margin:"10px 0 6px" }}/>
        <div style={{ fontSize:10, color:"#475569", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>Spreading</div>
        {spreadRows.map(function(row) { return renderRow(row, true); })}
        <div style={{ fontSize:9, color:"#334155", marginTop:8 }}>Hover for exact lots · Colors normalized per row · Purple = latest week</div>
      </div>
    </React.Fragment>
  );
}

// ── Section 3: 52-Week Positioning Gauges ────────────────────────────────────
function CotGauges({ data }) {
  var _s2 = useState("ny"); var market = _s2[0]; var setMarket = _s2[1];
  var hist52 = data.slice(-52);
  var curr = hist52[hist52.length - 1];
  var prev = hist52.length >= 2 ? hist52[hist52.length - 2] : null;

  function mkRow(label, cat, field, isSpread) {
    var vals = hist52.map(function(d) { return (d[market] && d[market][field]) ? d[market][field] : 0; });
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var cv = curr[market] && curr[market][field] ? curr[market][field] : 0;
    var pv = prev && prev[market] && prev[market][field] ? prev[market][field] : cv;
    return { label:label, color: HM_CAT_COLORS[cat] || "#64748b", curr:cv, prev:pv, min:min, max:max,
      pct: max > min ? (cv - min) / (max - min) * 100 : 50, isSpread:isSpread };
  }

  var longRows  = [
    mkRow("PMPU Long",    "PMPU",      "pmpuLong",   false),
    mkRow("Swap Long",    "Swap",      "swapLong",   false),
    mkRow("MM Long",      "MM",        "mmLong",     false),
    mkRow("Other Long",   "Other Rpt", "otherLong",  false),
    mkRow("Non-Rep Long", "Non-Rep",   "nonRepLong", false),
  ];
  var shortRows = [
    mkRow("PMPU Short",    "PMPU",      "pmpuShort",   false),
    mkRow("Swap Short",    "Swap",      "swapShort",   false),
    mkRow("MM Short",      "MM",        "mmShort",     false),
    mkRow("Other Short",   "Other Rpt", "otherShort",  false),
    mkRow("Non-Rep Short", "Non-Rep",   "nonRepShort", false),
  ];
  var spreadRows = [
    mkRow("MM Spread",    "MM",        "mmSpread",    true),
    mkRow("Swap Spread",  "Swap",      "swapSpread",  true),
    mkRow("Other Spread", "Other Rpt", "otherSpread", true),
  ];

  var extremes = longRows.concat(shortRows).filter(function(r) { return r.pct >= 80 || r.pct <= 20; });

  function pctColor(pct) {
    if (pct >= 80) return "#ef4444";
    if (pct >= 60) return "#f97316";
    if (pct <= 20) return "#22c55e";
    if (pct <= 40) return "#84cc16";
    return "#94a3b8";
  }
  function fmtLot(v) { return Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+"k" : String(Math.round(v)); }

  function renderGauge(r) {
    var pct = Math.max(0, Math.min(100, r.pct));
    var prevPct = r.max > r.min ? Math.max(0, Math.min(100, (r.prev - r.min) / (r.max - r.min) * 100)) : 50;
    var delta = r.curr - r.prev;
    var color = r.isSpread ? "#a78bfa" : pctColor(pct);
    return (
      <div key={r.label} style={{ marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, alignItems:"baseline" }}>
          <span style={{ fontSize:11, color:r.color, fontWeight:600 }}>{r.label}</span>
          <span style={{ fontSize:10, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ color:"#475569" }}>{fmtLot(r.curr)}</span>
            <span style={{ color:color, fontWeight:600 }}>{Math.round(pct)}th</span>
            <span style={{ color: delta >= 0 ? "#22c55e" : "#ef4444", fontSize:9 }}>
              {delta >= 0 ? "▲" : "▼"} {fmtLot(Math.abs(delta))}
            </span>
          </span>
        </div>
        <div style={{ position:"relative", height:11, background:"#1e293b", borderRadius:6 }}>
          <div style={{ position:"absolute", left:0, top:0, height:"100%", width:pct+"%", background:color, borderRadius:6, opacity:0.28 }}/>
          <div style={{ position:"absolute", top:1, left:"calc("+prevPct+"% - 1px)", width:2, height:9, background:"#60a5fa", borderRadius:1, opacity:0.6 }}/>
          <div style={{ position:"absolute", top:0.5, left:"calc("+pct+"% - 5px)", width:10, height:10, background:color, borderRadius:"50%", border:"2px solid #0f172a", boxShadow:"0 0 4px "+color+"80" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:2 }}>
          <span style={{ fontSize:9, color:"#334155" }}>{fmtLot(r.min)}</span>
          <span style={{ fontSize:9, color:"#334155" }}>{fmtLot(r.max)}</span>
        </div>
      </div>
    );
  }

  return (
    <React.Fragment>
      <SectionHeader icon="Sliders" title="3. 52-Week Positioning Gauges" subtitle="Current level vs. 52-week range. Colored dot = current week, blue tick = previous week. Red ≥80th pct · Green ≤20th." />
      <div style={{ display:"flex", gap:4, background:"#0f172a", padding:4, borderRadius:8, border:"1px solid #1e293b", marginBottom:16, width:"fit-content" }}>
        {["ny","ldn"].map(function(m) {
          return (
            <button key={m} onClick={function(){ setMarket(m); }}
              style={{ padding:"6px 12px", borderRadius:4, fontSize:11, fontWeight:700, cursor:"pointer", border:"none",
                background: market===m ? "#1e293b" : "transparent",
                color: market===m ? "#fbbf24" : "#64748b" }}>
              {m === "ny" ? "NY Arabica" : "LDN Robusta"}
            </button>
          );
        })}
      </div>
      {extremes.length > 0 && (
        <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:"8px 16px", marginBottom:16, display:"flex", flexWrap:"wrap", gap:12 }}>
          <span style={{ fontSize:10, color:"#64748b", fontWeight:600, alignSelf:"center", textTransform:"uppercase", letterSpacing:"0.05em" }}>Extremes:</span>
          {extremes.map(function(r) {
            return <span key={r.label} style={{ fontSize:11, color:pctColor(r.pct) }}>{r.label} {Math.round(r.pct)}th</span>;
          })}
        </div>
      )}
      <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:16 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 32px" }}>
          <div>
            <div style={{ fontSize:10, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:12 }}>Longs</div>
            {longRows.map(renderGauge)}
          </div>
          <div>
            <div style={{ fontSize:10, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:12 }}>Shorts</div>
            {shortRows.map(renderGauge)}
          </div>
        </div>
        <div style={{ borderTop:"1px dashed #334155", marginTop:16, paddingTop:14 }}>
          <div style={{ fontSize:10, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:12 }}>Spreading positions</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0 32px" }}>
            {spreadRows.map(renderGauge)}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

function RadialCounterparty({ latest, prev1, prev4, market, unit }) {
  var mtFactor = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
  var usdPerMT = market === "ny" ? latest.priceNY * CENTS_LB_TO_USD_TON : latest.priceLDN;
  var cv = function(row, field) {
    var obj = (row && row[market]) ? row[market] : {};
    var contracts = Array.isArray(field)
      ? field.reduce(function(s,f) { return s + (obj[f] || 0); }, 0)
      : (obj[field] || 0);
    if (unit === "contracts") return contracts;
    var mt = contracts * mtFactor;
    return unit === "mt" ? mt : mt * usdPerMT;
  };
  var gs = function(row, f) { return (row && row[market] && row[market][f]) ? row[market][f] : 0; };
  var fmtVal = function(v) {
    if (unit === "usd") return "$" + (v/1e9).toFixed(2) + "B";
    if (unit === "mt")  return (v/1000).toFixed(0) + "k MT";
    return (v/1000).toFixed(0) + "k lots";
  };
  var fmtDelta = function(v) {
    var sign = v >= 0 ? "+" : "";
    if (unit === "usd") return sign + "$" + (v/1e6).toFixed(0) + "M";
    if (unit === "mt")  return sign + (v/1000).toFixed(1) + "k";
    return sign + (v/1000).toFixed(1) + "k";
  };
  var dc = function(v, invert) {
    if (v == null) return "text-slate-600";
    if (v === 0)   return "text-slate-500";
    return (invert ? v < 0 : v > 0) ? "text-emerald-400" : "text-red-400";
  };
  var tooltipStyle = { backgroundColor:"#0f172a", borderColor:"#334155", borderRadius:"8px" };
  var longData  = CP_CATS.map(function(c) { return { name: c.name + " Long",  value: cv(latest, c.longF),  fill: c.longC  }; });
  var shortData = CP_CATS.map(function(c) { return { name: c.name + " Short", value: cv(latest, c.shortF), fill: c.shortC }; });
  var pieData   = longData.concat(shortData);
  var totalLong = longData.reduce(function(s,d) { return s+d.value; }, 0);
  var oiTotal   = (market === "ny" ? latest.oiNY : latest.oiLDN) || 0;
  var totalSpread     = CP_SPREADS.reduce(function(s,c) { return s+gs(latest,c.f); }, 0);
  var prevTotalSpread = prev1 ? CP_SPREADS.reduce(function(s,c) { return s+gs(prev1,c.f); }, 0) : null;
  var spreadWow       = prevTotalSpread != null ? totalSpread - prevTotalSpread : null;
  return (
    <div>
      {/* Combined half/half donut: longs on left, shorts on right */}
      <div style={{ position:"relative", height:220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" startAngle={90} endAngle={450}
              innerRadius={46} outerRadius={82} paddingAngle={1} dataKey="value">
              {pieData.map(function(entry, i) { return <Cell key={i} fill={pieData[i].fill} stroke="rgba(0,0,0,0)" />; })}
              <Label value={fmtVal(totalLong)} position="center" fill="#f1f5f9" fontSize={11} fontWeight="bold" dy={-7} />
              <Label value={"OI: " + (oiTotal/1000).toFixed(0) + "k"} position="center" fill="#94a3b8" fontSize={9} dy={7} />
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ fontSize:10 }} formatter={function(v,name) { return [fmtVal(Number(v)), name]; }} />
          </PieChart>
        </ResponsiveContainer>
        <span style={{ position:"absolute", top:"50%", left:4, transform:"translateY(-50%)", fontSize:8, fontWeight:700, color:"#34d399", textTransform:"uppercase" }}>← L</span>
        <span style={{ position:"absolute", top:"50%", right:4, transform:"translateY(-50%)", fontSize:8, fontWeight:700, color:"#f87171", textTransform:"uppercase" }}>S →</span>
      </div>

      {/* Delta table */}
      <div style={{ marginTop:4 }}>
        <div style={{ display:"grid", gridTemplateColumns:"auto 1fr 1fr 1fr 1fr", gap:4, paddingBottom:4, borderBottom:"1px solid #334155" }}>
          <span></span>
          <span style={{ fontSize:8, color:"#166534", fontWeight:700, textAlign:"center", textTransform:"uppercase" }}>L 1W</span>
          <span style={{ fontSize:8, color:"#166534", fontWeight:700, textAlign:"center", textTransform:"uppercase" }}>L 4W</span>
          <span style={{ fontSize:8, color:"#991b1b", fontWeight:700, textAlign:"center", textTransform:"uppercase" }}>S 1W</span>
          <span style={{ fontSize:8, color:"#991b1b", fontWeight:700, textAlign:"center", textTransform:"uppercase" }}>S 4W</span>
        </div>
        {CP_CATS.map(function(cat) {
          var ld1 = prev1 ? cv(latest,cat.longF)  - cv(prev1,cat.longF)  : null;
          var ld4 = prev4 ? cv(latest,cat.longF)  - cv(prev4,cat.longF)  : null;
          var sd1 = prev1 ? cv(latest,cat.shortF) - cv(prev1,cat.shortF) : null;
          var sd4 = prev4 ? cv(latest,cat.shortF) - cv(prev4,cat.shortF) : null;
          return (
            <div key={cat.name} style={{ display:"grid", gridTemplateColumns:"auto 1fr 1fr 1fr 1fr", gap:4, padding:"2px 0", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:4, paddingRight:8 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", backgroundColor:cat.longC, flexShrink:0 }} />
                <span style={{ fontSize:8, color:"#94a3b8" }}>{cat.name}</span>
              </div>
              <span className={"text-[9px] font-semibold text-center tabular-nums " + dc(ld1)}>{ld1==null?"—":fmtDelta(ld1)}</span>
              <span className={"text-[9px] font-semibold text-center tabular-nums " + dc(ld4)}>{ld4==null?"—":fmtDelta(ld4)}</span>
              <span className={"text-[9px] font-semibold text-center tabular-nums " + dc(sd1,true)}>{sd1==null?"—":fmtDelta(sd1)}</span>
              <span className={"text-[9px] font-semibold text-center tabular-nums " + dc(sd4,true)}>{sd4==null?"—":fmtDelta(sd4)}</span>
            </div>
          );
        })}
      </div>

      {/* Spreading section */}
      <div style={{ marginTop:12, paddingTop:8, borderTop:"1px solid #334155" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontSize:9, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.08em" }}>Spreading</span>
          <span style={{ fontSize:9, color:"#64748b" }}>
            {(totalSpread/1000).toFixed(1)}k lots
            {spreadWow != null && (
              <span style={{ marginLeft:4, fontWeight:700, color: spreadWow>0?"#34d399":spreadWow<0?"#f87171":"#64748b" }}>
                ({spreadWow>=0?"+":""}{(spreadWow/1000).toFixed(1)}k WoW)
              </span>
            )}
          </span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"auto 1fr 1fr", gap:4, paddingBottom:4, borderBottom:"1px solid #334155" }}>
          <span></span>
          <span style={{ fontSize:8, color:"#64748b", fontWeight:700, textAlign:"center", textTransform:"uppercase" }}>Lots</span>
          <span style={{ fontSize:8, color:"#64748b", fontWeight:700, textAlign:"center", textTransform:"uppercase" }}>WoW</span>
        </div>
        {CP_SPREADS.map(function(cat) {
          var cur = gs(latest, cat.f);
          var wow = prev1 ? cur - gs(prev1, cat.f) : null;
          return (
            <div key={cat.name} style={{ display:"grid", gridTemplateColumns:"auto 1fr 1fr", gap:4, padding:"2px 0", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", backgroundColor:cat.color, flexShrink:0 }} />
                <span style={{ fontSize:8, color:"#94a3b8" }}>{cat.name}</span>
              </div>
              <span style={{ fontSize:9, color:"#cbd5e1", textAlign:"center", fontVariantNumeric:"tabular-nums" }}>{(cur/1000).toFixed(1)}k</span>
              <span style={{ fontSize:9, textAlign:"center", fontVariantNumeric:"tabular-nums", color: wow==null?"#475569":wow>0?"#34d399":wow<0?"#f87171":"#64748b" }}>
                {wow==null?"—":(wow>=0?"+":"")+(wow/1000).toFixed(1)+"k"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttributionTable({ gfm }) {
  if (!gfm) return <p style={{ color:"#6b7280", fontSize:12 }}>Attribution data not available.</p>;
  var headerCell = function(align) { return { padding:"4px 8px", fontSize:10, color:"#9ca3af", fontWeight:600, textAlign:align||"right", borderBottom:"1px solid #374151", whiteSpace:"nowrap" }; };
  var dataCell = function(color, bold) { return { padding:"3px 8px", fontSize:10, color:color, textAlign:"right", fontWeight:bold?700:400, fontFamily:"monospace" }; };
  var nameCell = function(bold, color) { return { padding:"3px 8px 3px 16px", fontSize:10, color:color||"#e5e7eb", fontWeight:bold?700:400, textAlign:"left" }; };
  var sortedRows = (gfm.commodityTable||[]).slice().sort(function(a,b) {
    var ai = SECTOR_ORDER_ATTR.indexOf(a.displaySector), bi = SECTOR_ORDER_ATTR.indexOf(b.displaySector);
    if (ai !== bi) return ai - bi;
    return Math.abs(b.deltaB) - Math.abs(a.deltaB);
  });
  var grouped = SECTOR_ORDER_ATTR.map(function(sector) {
    return {
      sector: sector, label: SECTOR_LABELS_ATTR[sector],
      sd: (gfm.sectorBreakdown||[]).find(function(s) { return s.sector === sector; }) || null,
      rows: sortedRows.filter(function(r) { return r.displaySector === sector; }),
    };
  }).filter(function(g) { return g.rows.length > 0; });
  return (
    <div style={{ overflowX:"auto", marginTop:4 }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
        <thead>
          <tr style={{ background:"#0f172a" }}>
            <th style={headerCell("left")}>Commodity</th>
            <th style={headerCell()}>Gross $B</th><th style={headerCell()}>WoW $B</th>
            <th style={headerCell()}>OI Δ</th><th style={headerCell()}>Px Δ</th>
            <th style={headerCell()}>Net $B</th><th style={headerCell()}>Net WoW</th>
            <th style={headerCell()}>OI Δ</th><th style={headerCell()}>Px Δ</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(function(g) {
            return (
              <React.Fragment key={g.sector}>
                {g.sd && (
                  <tr style={{ background:"#1e293b" }}>
                    <td style={Object.assign({}, nameCell(true,"#f9fafb"), { paddingLeft:8 })}>{g.label}</td>
                    <td style={dataCell(attrColor(g.sd.grossB),true)}>{fmtAttr(g.sd.grossB)}</td>
                    <td style={dataCell(attrColor(g.sd.deltaB),true)}>{fmtAttr(g.sd.deltaB)}</td>
                    <td style={dataCell(attrColor(g.sd.grossOiEffectB),true)}>{fmtAttr(g.sd.grossOiEffectB)}</td>
                    <td style={dataCell(attrColor(g.sd.grossPriceEffectB),true)}>{fmtAttr(g.sd.grossPriceEffectB)}</td>
                    <td style={dataCell(attrColor(g.sd.netB),true)}>{fmtAttr(g.sd.netB)}</td>
                    <td style={dataCell(attrColor(g.sd.netDeltaB),true)}>{fmtAttr(g.sd.netDeltaB)}</td>
                    <td style={dataCell(attrColor(g.sd.netOiEffectB),true)}>{fmtAttr(g.sd.netOiEffectB)}</td>
                    <td style={dataCell(attrColor(g.sd.netPriceEffectB),true)}>{fmtAttr(g.sd.netPriceEffectB)}</td>
                  </tr>
                )}
                {g.rows.map(function(row, idx) {
                  return (
                    <tr key={row.symbol} style={{ background: idx%2===0?"transparent":"#0f172a" }}>
                      <td style={nameCell(row.isCoffee, row.isCoffee?"#f59e0b":"#d1d5db")}>{row.isCoffee?"► ":""}{row.name}</td>
                      <td style={dataCell(attrColor(row.grossB))}>{fmtAttr(row.grossB)}</td>
                      <td style={dataCell(attrColor(row.deltaB))}>{fmtAttr(row.deltaB)}</td>
                      <td style={dataCell(attrColor(row.grossOiEffectB))}>{fmtAttr(row.grossOiEffectB)}</td>
                      <td style={dataCell(attrColor(row.grossPriceEffectB))}>{fmtAttr(row.grossPriceEffectB)}</td>
                      <td style={dataCell(attrColor(row.netB))}>{fmtAttr(row.netB)}</td>
                      <td style={dataCell(attrColor(row.netDeltaB))}>{fmtAttr(row.netDeltaB)}</td>
                      <td style={dataCell(attrColor(row.netOiEffectB))}>{fmtAttr(row.netOiEffectB)}</td>
                      <td style={dataCell(attrColor(row.netPriceEffectB))}>{fmtAttr(row.netPriceEffectB)}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  var baked              = window.BAKED_DATA;
  var data               = baked.processed;
  var macroData          = baked.macroData;
  var globalFlowMetrics  = baked.globalFlowMetrics;
  var recent52           = data.slice(-52);
  var latest             = data[data.length - 1];
  var prev1              = data.length >= 2 ? data[data.length - 2] : null;
  var prev4              = data.length >= 5 ? data[data.length - 5] : null;

  // ── State ──────────────────────────────────────────────────────────────────
  var macroToggleState   = useState("gross");
  var macroToggle        = macroToggleState[0]; var setMacroToggle = macroToggleState[1];
  var step1ViewState     = useState("chart");
  var step1View          = step1ViewState[0]; var setStep1View = step1ViewState[1];
  var cpUnitState        = useState("contracts");
  var cpUnit             = cpUnitState[0]; var setCpUnit = cpUnitState[1];
  var dpCatsState        = useState({ pmpu:false, mm:true, swap:false, other:false, nonrep:false });
  var dpCats             = dpCatsState[0]; var setDpCats = dpCatsState[1];

  // ── Macro chart data ───────────────────────────────────────────────────────
  var macroChartData = useMemo(function() { return transformMacroData(macroData, macroToggle); }, [macroToggle]);

  var macroNetSplitData = useMemo(function() {
    if (macroToggle !== "net") return null;
    return macroChartData.map(function(row) {
      var result = { date: row.date };
      SECTORS.forEach(function(s) {
        var v = row[s];
        result[s+"_pos"] = v > 0 ? v : 0;
        result[s+"_neg"] = v < 0 ? v : 0;
      });
      return result;
    });
  }, [macroChartData, macroToggle]);

  var macroYDomain = useMemo(function() {
    if (macroToggle !== "net" || !macroChartData.length) return undefined;
    var allVals = macroChartData.reduce(function(acc, d) {
      SECTORS.forEach(function(s) { acc.push(d[s]); });
      return acc;
    }, []);
    var mn = Math.min.apply(null, allVals), mx = Math.max.apply(null, allVals);
    var pad = Math.max(Math.abs(mn), Math.abs(mx)) * 0.15;
    return [+(mn-pad).toFixed(2), +(mx+pad).toFixed(2)];
  }, [macroChartData, macroToggle]);

  var macroKpis = useMemo(function() {
    if (!macroData.length) return null;
    var weekTotals = function(week) {
      var g = 0, n = 0;
      week.commodities.forEach(function(c) { g += c.gross_exposure_usd||0; n += c.net_exposure_usd||0; });
      return { gross:g, net:n };
    };
    var cur  = weekTotals(macroData[macroData.length-1]);
    var prev = macroData.length >= 2 ? weekTotals(macroData[macroData.length-2]) : null;
    return {
      totalGross: cur.gross, netExp: cur.net,
      grossWoW: prev ? cur.gross-prev.gross : null,
      netWoW:   prev ? cur.net-prev.net     : null,
      date: macroData[macroData.length-1].date,
    };
  }, []);

  // ── Soft chart data ────────────────────────────────────────────────────────
  var softBase = useMemo(function() { return softChartDataFn(macroData, macroToggle); }, [macroToggle]);

  var softNetSplit = useMemo(function() {
    if (macroToggle !== "net") return null;
    return softBase.map(function(row) {
      var r = { date: row.date };
      SOFT_SYMBOLS.forEach(function(s) {
        var v = row[s.key];
        r[s.key+"_pos"] = v > 0 ? v : 0;
        r[s.key+"_neg"] = v < 0 ? v : 0;
      });
      return r;
    });
  }, [softBase, macroToggle]);

  var softYDomain = useMemo(function() {
    if (macroToggle !== "net") return undefined;
    var vals = softBase.reduce(function(acc, row) { SOFT_SYMBOLS.forEach(function(s) { acc.push(row[s.key]); }); return acc; }, []);
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pad = Math.max(Math.abs(mn), Math.abs(mx)) * 0.15;
    return [+(mn-pad).toFixed(2), +(mx+pad).toFixed(2)];
  }, [softBase, macroToggle]);

  var weeklyChangeData = useMemo(function() {
    if (macroChartData.length < 2) return [];
    return macroChartData.slice(1).map(function(row, i) {
      var prev = macroChartData[i];
      return { date:row.date, energy:row.energy-prev.energy, metals:row.metals-prev.metals, grains:row.grains-prev.grains, meats:row.meats-prev.meats, softs:row.softs-prev.softs, micros:row.micros-prev.micros };
    });
  }, [macroChartData]);

  var softWeeklyChange = useMemo(function() {
    if (softBase.length < 2) return [];
    return softBase.slice(1).map(function(row, i) {
      var prev = softBase[i];
      var r = { date: row.date };
      SOFT_SYMBOLS.forEach(function(s) { r[s.key] = row[s.key] - prev[s.key]; });
      return r;
    });
  }, [softBase]);

  // ── Dry Powder ─────────────────────────────────────────────────────────────
  var processedDpData = useMemo(function() {
    var compute = function(market) {
      var byTf = { historical:[], year:[], recent_4:[], recent_1:[], current:[] };
      var mt = market === "ny" ? ARABICA_MT_FACTOR : ROBUSTA_MT_FACTOR;
      data.forEach(function(d) {
        var trL = market === "ny" ? d.tradersNY : d.tradersLDN;
        var trS = market === "ny" ? d.tradersNY_short : d.tradersLDN_short;
        var dpLong=0, dpShort=0, dpTradersLong=0, dpTradersShort=0;
        Object.keys(dpCats).forEach(function(cat) {
          if (!dpCats[cat]) return;
          var oiKey = cat === "nonrep" ? "nonRep" : cat;
          dpLong         += (d[market][oiKey+"Long"]  || 0) * mt;
          dpShort        += (d[market][oiKey+"Short"] || 0) * mt;
          dpTradersLong  += (trL && trL[cat]) ? trL[cat] : 0;
          dpTradersShort += (trS && trS[cat]) ? trS[cat] : 0;
        });
        var tf = d.timeframe;
        if (byTf[tf]) {
          if (dpTradersLong  > 0) byTf[tf].push({ date:d.date, traders:dpTradersLong,  oi:dpLong   });
          if (dpTradersShort > 0) byTf[tf].push({ date:d.date, traders:dpTradersShort, oi:-dpShort });
        }
      });
      return byTf;
    };
    return { ny: compute("ny"), ldn: compute("ldn") };
  }, [dpCats]);

  var dpDomain = useMemo(function() {
    var calc = function(byTf) {
      var all = [].concat.apply([], Object.values(byTf));
      if (!all.length) return { x:[0,1000], y:[-5000000,5000000] };
      var tVals = all.map(function(p) { return p.traders; }).filter(function(v) { return v>0; });
      var oVals = all.map(function(p) { return p.oi; });
      var tMin = tVals.length ? Math.min.apply(null,tVals) : 0;
      var tMax = tVals.length ? Math.max.apply(null,tVals) : 1000;
      var oMin = oVals.length ? Math.min.apply(null,oVals) : -5000000;
      var oMax = oVals.length ? Math.max.apply(null,oVals) : 5000000;
      var tPad = (tMax-tMin)*0.1||10;
      var oPad = Math.max(Math.abs(oMax),Math.abs(oMin))*0.1;
      return { x:[Math.floor(tMin-tPad), Math.ceil(tMax+tPad)], y:[Math.floor(oMin<0?oMin*1.1:oMin-oPad), Math.ceil(oMax>0?oMax*1.1:oMax+oPad)] };
    };
    return { ny: calc(processedDpData.ny), ldn: calc(processedDpData.ldn) };
  }, [processedDpData]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  var fmtB   = function(v) { return (v<0?"-$":"$") + Math.abs(v/1e9).toFixed(1)+"B"; };
  var fmtWoW = function(v) { return v==null?"—":((v>=0?"+":"-")+"$"+Math.abs(v/1e9).toFixed(2)+"B"); };
  var mtFmt  = function(v) { return (v/1000).toFixed(0)+"k"; };

  var macroModeLabels = { gross:"Total Gross", gross_long:"Gross Long", gross_short:"Gross Short", net:"Net Exposure" };

  // ── Cycle helpers ──────────────────────────────────────────────────────────
  var cycleColor = function(d, market) {
    if (d.timeframe==="current")  return market==="ny"?"#ef4444":"#3b82f6";
    if (d.timeframe==="recent_1") return "#f97316";
    if (d.timeframe==="recent_4") return "#eab308";
    return "#64748b";
  };
  var cycleOpacity = function(d) {
    if (d.timeframe==="current")  return 1.0;
    if (d.timeframe==="recent_1") return 0.85;
    if (d.timeframe==="recent_4") return 0.75;
    if (d.timeframe==="year")     return 0.25;
    return 0.12;
  };
  var nyPts  = recent52.map(function(d) { return { x:d.oiRank,    y:d.priceRank,    timeframe:d.timeframe, date:d.date }; });
  var ldnPts = recent52.map(function(d) { return { x:d.oiRankLDN, y:d.priceRankLDN, timeframe:d.timeframe, date:d.date }; });

  // ── Industry helpers ───────────────────────────────────────────────────────
  var mkIndustryChart = function(market) {
    var longKey  = market==="ny" ? "pmpuLongMT_NY"  : "pmpuLongMT_LDN";
    var shortKey = market==="ny" ? "pmpuShortMT_NY" : "pmpuShortMT_LDN";
    var priceKey = market==="ny" ? "priceNY"        : "priceLDN";
    var prices   = recent52.map(function(d) { return d[priceKey]; }).filter(function(v) { return v>0; });
    var priceDomain = prices.length ? [Math.floor(Math.min.apply(null,prices)/100)*100, Math.ceil(Math.max.apply(null,prices)/100)*100] : [0,500];
    var mtVals = recent52.reduce(function(acc,d) { acc.push(d[longKey],d[shortKey]); return acc; }, []).filter(function(v) { return v>0; });
    var mtDomain = mtVals.length ? [Math.floor(Math.min.apply(null,mtVals)/1000)*1000, Math.ceil(Math.max.apply(null,mtVals)/1000)*1000] : [0,100000];
    var deltaData = recent52.slice(1).map(function(d,i) {
      return { date:d.date, deltaLong:d[longKey]-recent52[i][longKey], deltaShort:d[shortKey]-recent52[i][shortKey], efpMT:market==="ny"?d.efpMT:0 };
    });
    return (
      <div>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[300px] mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={recent52}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={function(v) { return v.slice(5); }} />
              <YAxis yAxisId="left" stroke="#475569" fontSize={10} tickFormatter={mtFmt} domain={mtDomain} label={{ value:"MT", angle:-90, position:"insideLeft", offset:10, fill:"#475569", fontSize:9 }} />
              <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} domain={priceDomain} />
              <Tooltip contentStyle={CHART_STYLE} formatter={function(v,name) { return [name==="Price"?Number(v).toFixed(0):((Number(v)/1000).toFixed(1)+"k MT"), name]; }} />
              <Legend wrapperStyle={{ fontSize:10 }} />
              <Area yAxisId="left" type="monotone" dataKey={longKey}  name="Industry Long"  stroke="#10b981" fill="#10b981" fillOpacity={0.3} strokeWidth={2} dot={false} />
              <Area yAxisId="left" type="monotone" dataKey={shortKey} name="Industry Short" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey={priceKey} name="Price" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={deltaData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#475569" fontSize={10} tickFormatter={function(v) { return v.slice(5); }} />
              <YAxis stroke="#475569" fontSize={10} tickFormatter={mtFmt} label={{ value:"MT", angle:-90, position:"insideLeft", offset:10, fill:"#475569", fontSize:9 }} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <Tooltip contentStyle={CHART_STYLE} formatter={function(v,name) { return [(Number(v)/1000).toFixed(1)+"k MT", name]; }} />
              <Legend wrapperStyle={{ fontSize:10 }} />
              <Bar dataKey="deltaLong"  name="Δ Long (wk)"  fill="#10b981" opacity={0.8} barSize={4} />
              <Bar dataKey="deltaShort" name="Δ Short (wk)" fill="#3b82f6" opacity={0.8} barSize={4} />
              {market==="ny" && <Line type="monotone" dataKey="efpMT" name="EFP Physical" stroke="#f59e0b" strokeWidth={1.5} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  var mkScatter = function(market) {
    var d   = processedDpData[market];
    var dom = dpDomain[market];
    var legendContent = function(props) {
      var items = ((props.payload)||[]).slice().reverse();
      return (
        <div style={{ display:"flex", justifyContent:"center", gap:16, fontSize:10, paddingTop:8 }}>
          {items.map(function(e, i) { return (
            <span key={i} style={{ display:"flex", alignItems:"center", gap:5, color:"#94a3b8" }}>
              <span style={{ width:8, height:8, borderRadius:"50%", backgroundColor:e.color, display:"inline-block" }} />
              {e.value}
            </span>
          ); })}
        </div>
      );
    };
    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top:20, right:30, bottom:30, left:50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis type="number" dataKey="traders" name="# traders" stroke="#475569" fontSize={10} domain={dom.x} label={{ value:"# traders", position:"insideBottom", offset:-10, fill:"#475569", fontSize:10 }} />
            <YAxis type="number" dataKey="oi" name="OI" stroke="#475569" fontSize={10} domain={dom.y} tickFormatter={function(v) { return (v/1000).toFixed(0)+"k"; }} label={{ value:"OI (k MT)", angle:-90, position:"insideLeft", offset:-10, fill:"#475569", fontSize:10 }} />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1} strokeDasharray="4 4" />
            <Tooltip cursor={{ strokeDasharray:"3 3" }} contentStyle={CHART_STYLE} formatter={function(v,name) { return name==="# traders" ? [Math.round(Number(v)).toString(), name] : [(Number(v)/1000).toFixed(1)+"k MT", name]; }} />
            <Legend wrapperStyle={{ fontSize:10, paddingTop:8 }} content={legendContent} />
            <Scatter name="Historic"   data={d.historical} fill="#bfdbfe" fillOpacity={0.18} size={12}  />
            <Scatter name="Prior Y"    data={d.year}       fill="#3b82f6" fillOpacity={0.45} size={28}  />
            <Scatter name="Prior 4W"   data={d.recent_4}   fill="#eab308" fillOpacity={0.9}  size={78}  />
            <Scatter name="Prior week" data={d.recent_1}   fill="#c2410c" fillOpacity={1.0}  size={154} />
            <Scatter name="Last CoT"   data={d.current}    fill="#ef4444" fillOpacity={1.0}  size={314} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  var mkCycle = function(pts, market) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top:20, right:30, bottom:20, left:30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis type="number" dataKey="x" domain={[0,100]} stroke="#475569" fontSize={10} label={{ value:"Net Positioning Rank (%)", position:"bottom", offset:0, fill:"#475569", fontSize:10 }} />
            <YAxis type="number" dataKey="y" domain={[0,100]} stroke="#475569" fontSize={10} label={{ value:"Price Rank (%)", angle:-90, position:"insideLeft", fill:"#475569", fontSize:10 }} />
            <ReferenceArea x1={0}  x2={25}  y1={0}  y2={25}  fill="#10b981" fillOpacity={0.08} stroke="#10b981" strokeOpacity={0.25} label={{ value:"OVERSOLD",   position:"insideTopRight",   fill:"#10b981", fontSize:9, fontWeight:"bold" }} />
            <ReferenceArea x1={75} x2={100} y1={75} y2={100} fill="#ef4444" fillOpacity={0.08} stroke="#ef4444" strokeOpacity={0.25} label={{ value:"OVERBOUGHT", position:"insideBottomLeft", fill:"#ef4444", fontSize:9, fontWeight:"bold" }} />
            <ReferenceLine x={50} stroke="#475569" strokeDasharray="5 5" />
            <ReferenceLine y={50} stroke="#475569" strokeDasharray="5 5" />
            <Tooltip cursor={{ strokeDasharray:"3 3" }} contentStyle={CHART_STYLE}
              formatter={function(v,_,props) { return [Number(v).toFixed(1)+"%", props.name]; }}
              labelFormatter={function(_,payload) { return payload && payload[0] ? payload[0].payload.date : ""; }} />
            <Scatter name={market==="ny"?"NY Arabica":"LDN Robusta"} data={pts}>
              {pts.map(function(d, i) { return <Cell key={i} fill={cycleColor(d,market)} fillOpacity={cycleOpacity(d)} />; })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  var NAV = [
    { id:"section-1", icon:"Globe",    label:"Flow"       },
    { id:"section-2", icon:"Grid",     label:"Heatmap"    },
    { id:"section-3", icon:"Sliders",  label:"Gauges"     },
    { id:"section-4", icon:"Factory",  label:"Industry"   },
    { id:"section-5", icon:"Droplets", label:"Dry Powder" },
    { id:"section-6", icon:"Scale",    label:"Cycle"      },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8" style={{ maxWidth:"1400px", margin:"0 auto" }}>

      {/* Sticky Nav */}
      <div className="flex items-center gap-1 flex-wrap border-b border-slate-700 pb-2 sticky top-0 z-10 bg-gray-900 pt-2" style={{ paddingLeft:0 }}>
        {NAV.map(function(s) {
          return (
            <button key={s.id} onClick={function() { var el=document.getElementById(s.id); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors text-slate-400 hover:text-amber-400 hover:bg-slate-800">
              <span className="text-slate-500">{ICONS[s.icon]}</span>
              {s.label}
            </button>
          );
        })}
        <span className="ml-auto text-[10px] text-slate-600 font-mono pr-2">
          NY {latest.priceNY.toFixed(2)}¢ · LDN \${latest.priceLDN.toFixed(0)}
        </span>
      </div>

      {/* ── Section 1: Global Money Flow ─────────────────────────────────────── */}
      <div id="section-1">
        <SectionHeader icon="Globe" title="1. Global Money Flow" subtitle="MM speculative exposure across 28 commodity markets (CFTC + ICE Europe). Toggle metric below." />

        {/* Mode toggles */}
        <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
          {(["chart","table"]).map(function(v) {
            return (
              <button key={v} onClick={function() { setStep1View(v); }}
                style={{ padding:"4px 12px", borderRadius:4, border:"1px solid #374151", background:step1View===v?"#065f46":"#1f2937", color:"#f9fafb", cursor:"pointer", fontSize:12 }}>
                {v==="chart"?"Chart":"Attribution Table"}
              </button>
            );
          })}
          <span style={{ width:1, height:20, background:"#374151", margin:"0 4px" }} />
          {(["gross","gross_long","gross_short","net"]).map(function(m) {
            return (
              <button key={m} onClick={function() { setMacroToggle(m); }}
                style={{ padding:"4px 12px", borderRadius:4, border:"1px solid #374151", background:macroToggle===m?"#4f46e5":"#1f2937", color:"#f9fafb", cursor:"pointer", fontSize:12 }}>
                {macroModeLabels[m]}
              </button>
            );
          })}
        </div>

        {/* KPI tiles */}
        {macroKpis && (
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            {[
              { label:"Gross Exposure",     value:fmtB(macroKpis.totalGross),  color:"#f9fafb" },
              { label:"Gross Exposure WoW", value:fmtWoW(macroKpis.grossWoW), color:macroKpis.grossWoW==null?"#6b7280":macroKpis.grossWoW>=0?"#10b981":"#ef4444" },
              { label:"Net Exposure",       value:fmtB(macroKpis.netExp),      color:macroKpis.netExp>=0?"#10b981":"#ef4444" },
              { label:"Net Exposure WoW",   value:fmtWoW(macroKpis.netWoW),   color:macroKpis.netWoW==null?"#6b7280":macroKpis.netWoW>=0?"#10b981":"#ef4444" },
            ].map(function(k) {
              return (
                <div key={k.label} style={{ flex:"1 1 140px", background:"#111827", border:"1px solid #1f2937", borderRadius:8, padding:"10px 14px" }}>
                  <div style={{ fontSize:10, color:"#6b7280", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>{k.label}</div>
                  <div style={{ fontSize:18, fontWeight:700, color:k.color, fontFamily:"monospace" }}>{k.value}</div>
                  <div style={{ fontSize:9, color:"#4b5563", marginTop:2 }}>{macroKpis.date}</div>
                </div>
              );
            })}
          </div>
        )}

        {step1View==="chart" && macroChartData.length>0 && (
          <div>
            {/* Panel A — MM Exposure by Sector */}
            <div style={{ marginBottom:8 }}><span style={{ fontSize:12, color:"#9ca3af" }}>MM Exposure by Sector (USD bn)</span></div>
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom:16 }}>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={macroToggle==="net"&&macroNetSplitData?macroNetSplitData:macroChartData} margin={{ top:4, right:16, bottom:0, left:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return v.slice(0,7); }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return (v<0?"-$":"$")+Math.abs(v).toFixed(0)+"B"; }} width={52} domain={macroYDomain} />
                  {macroToggle==="net" && <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />}
                  <Tooltip contentStyle={{ background:"#111827", border:"1px solid #374151", fontSize:11 }}
                    formatter={function(v,name) { return [(v<0?"-$":"$")+Math.abs(v).toFixed(1)+"B", name]; }}
                    labelFormatter={function(l) { return "Week: "+l; }} />
                  <Legend wrapperStyle={{ fontSize:11 }} />
                  {macroToggle==="net" ? (
                    SECTORS.reduce(function(acc, sector) {
                      var label = sector==="energy"?"Energies":sector==="metals"?"Metals":(sector.charAt(0).toUpperCase()+sector.slice(1));
                      acc.push(<Area key={sector+"_pos"} type="monotone" dataKey={sector+"_pos"} stackId="pos" name={label} stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]} fillOpacity={0.6} dot={false} />);
                      acc.push(<Area key={sector+"_neg"} type="monotone" dataKey={sector+"_neg"} stackId="neg" name={sector+"_neg"} stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]} fillOpacity={0.6} dot={false} legendType="none" />);
                      return acc;
                    }, [])
                  ) : (
                    SECTORS.map(function(sector) {
                      var label = sector==="energy"?"Energies":sector==="metals"?"Metals":(sector.charAt(0).toUpperCase()+sector.slice(1));
                      return <Area key={sector} type="monotone" dataKey={sector} stackId="1" name={label} stroke={SECTOR_COLORS[sector]} fill={SECTOR_COLORS[sector]} fillOpacity={0.6} dot={false} />;
                    })
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Panel B — Weekly Change by Sector */}
            {weeklyChangeData.length>0 && (
              <div>
                <div style={{ marginBottom:6 }}><span style={{ fontSize:12, color:"#9ca3af" }}>Weekly Change by Sector (USD bn)</span></div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom:16 }}>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={weeklyChangeData} margin={{ top:4, right:16, bottom:0, left:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return v.slice(0,7); }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return (v<0?"-$":"$")+Math.abs(v).toFixed(1)+"B"; }} width={52} />
                      <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
                      <Tooltip contentStyle={{ background:"#111827", border:"1px solid #374151", fontSize:11 }}
                        formatter={function(v,name) { return [(v<0?"-$":"$")+Math.abs(v).toFixed(2)+"B", name]; }}
                        labelFormatter={function(l) { return "Week: "+l; }} />
                      <Legend wrapperStyle={{ fontSize:11 }} />
                      {SECTORS.map(function(sector) {
                        var label = sector==="energy"?"Energies":sector==="metals"?"Metals":(sector.charAt(0).toUpperCase()+sector.slice(1));
                        return <Bar key={sector} dataKey={sector} stackId="1" name={label} fill={SECTOR_COLORS[sector]} />;
                      })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Panel C — Softs by Contract */}
            {softBase.length>0 && (
              <div>
                <div style={{ marginBottom:8, marginTop:8 }}><span style={{ fontSize:12, color:"#9ca3af" }}>MM Exposure — Softs by Contract (USD bn)</span></div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl" style={{ marginBottom:16 }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={macroToggle==="net"&&softNetSplit?softNetSplit:softBase} margin={{ top:4, right:16, bottom:0, left:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return v.slice(0,7); }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return (v<0?"-$":"$")+Math.abs(v).toFixed(2)+"B"; }} width={58} domain={softYDomain} />
                      {macroToggle==="net" && <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />}
                      <Tooltip contentStyle={{ background:"#111827", border:"1px solid #374151", fontSize:11 }}
                        formatter={function(v,name) { return [(v<0?"-$":"$")+Math.abs(v).toFixed(2)+"B", name]; }}
                        labelFormatter={function(l) { return "Week: "+l; }} />
                      <Legend wrapperStyle={{ fontSize:10 }} />
                      {macroToggle==="net" ? (
                        SOFT_SYMBOLS.reduce(function(acc,s) {
                          acc.push(<Area key={s.key+"_pos"} type="monotone" dataKey={s.key+"_pos"} stackId="pos" name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} />);
                          acc.push(<Area key={s.key+"_neg"} type="monotone" dataKey={s.key+"_neg"} stackId="neg" name={s.key+"_neg"} stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} legendType="none" />);
                          return acc;
                        }, [])
                      ) : (
                        SOFT_SYMBOLS.map(function(s) { return <Area key={s.key} type="monotone" dataKey={s.key} stackId="1" name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.7} dot={false} />; })
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Panel D — Weekly Change Softs */}
            {softWeeklyChange.length>0 && (
              <div>
                <div style={{ marginBottom:6 }}><span style={{ fontSize:12, color:"#9ca3af" }}>Weekly Change — Softs by Contract (USD bn)</span></div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={softWeeklyChange} margin={{ top:4, right:16, bottom:0, left:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return v.slice(0,7); }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize:10, fill:"#9ca3af" }} tickFormatter={function(v) { return (v<0?"-$":"$")+Math.abs(v).toFixed(2)+"B"; }} width={58} />
                      <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
                      <Tooltip contentStyle={{ background:"#111827", border:"1px solid #374151", fontSize:11 }}
                        formatter={function(v,name) { return [Math.abs(v)<0.0001?null:((v<0?"-$":"$")+Math.abs(v).toFixed(2)+"B"), name]; }}
                        labelFormatter={function(l) { return "Week: "+l; }} />
                      <Legend wrapperStyle={{ fontSize:10 }} />
                      {SOFT_SYMBOLS.map(function(s) { return <Bar key={s.key} dataKey={s.key} stackId="1" name={s.label} fill={s.color} />; })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}

        {step1View==="table" && (
          <div style={{ background:"#0f172a", border:"1px solid #1e293b", padding:16, borderRadius:12 }}>
            <AttributionTable gfm={globalFlowMetrics} />
          </div>
        )}
      </div>

      {/* ── Section 2: Heatmap ───────────────────────────────────────────────── */}
      <div id="section-2">
        <CotHeatmap data={data} />
      </div>

      {/* ── Section 3: Gauges ────────────────────────────────────────────────── */}
      <div id="section-3">
        <CotGauges data={data} />
      </div>

      {/* ── Section 4: Industry Pulse ─────────────────────────────────────────── */}
      <div id="section-4">
        <SectionHeader icon="Factory" title="4. Industry Pulse (Metric Tons)" subtitle="PMPU Gross Long & Short vs Price. Bottom: weekly position changes (NY includes EFP physical delivery)." />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
            {mkIndustryChart("ny")}
          </div>
          <div>
            <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
            {mkIndustryChart("ldn")}
          </div>
        </div>
      </div>

      {/* ── Section 5: Dry Powder ─────────────────────────────────────────────── */}
      <div id="section-5">
        <SectionHeader icon="Droplets" title="5. Dry Powder Indicator" subtitle="Gross Long OI (positive) and Gross Short OI (negative) vs number of traders. Color = recency." />
        <div className="flex items-center gap-3 mb-4">
          <CatToggles cats={dpCats} set={function(k) { setDpCats(function(p) { var n=Object.assign({},p); n[k]=!n[k]; return n; }); }} items={CAT_ITEMS} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
            {mkScatter("ny")}
          </div>
          <div>
            <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
            {mkScatter("ldn")}
          </div>
        </div>
      </div>

      {/* ── Section 6: Cycle Location ─────────────────────────────────────────── */}
      <div id="section-6">
        <SectionHeader icon="Scale" title="6. Cycle Location (OB/OS Matrix)" subtitle="X = MM Net Positioning 5Y rank · Y = Price 5Y rank · Red=last week · Orange=prior · Yellow=prior 4W · Grey=history." />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2 text-center">NY Arabica</p>
            {mkCycle(nyPts, "ny")}
          </div>
          <div>
            <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2 text-center">LDN Robusta</p>
            {mkCycle(ldnPts, "ldn")}
          </div>
        </div>
      </div>

    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding:32, fontFamily:"monospace", color:"#ef4444", background:"#0f172a", borderRadius:12, margin:32 }}>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:12 }}>Dashboard render error</div>
          <pre style={{ fontSize:12, whiteSpace:"pre-wrap", color:"#fca5a5" }}>{String(this.state.error)}</pre>
          <pre style={{ fontSize:11, color:"#64748b", marginTop:8 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary><App /></ErrorBoundary>
);
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>COT Dashboard — ${dateStr}</title>
<script>${reactJs}<\/script>
<script>${reactDomJs}<\/script>
<script>${propTypesJs}<\/script>
<script>${rechartsJs}<\/script>
<script>${babelJs}<\/script>
<style>
${appCss}
body { background:#020617; color:#f1f5f9; margin:0; padding:16px; }
::-webkit-scrollbar { width:8px; height:8px; }
::-webkit-scrollbar-track { background:#0f172a; }
::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
::-webkit-scrollbar-thumb:hover { background:#475569; }
</style>
</head>
<body>
<div id="root"></div>
<script>window.BAKED_DATA = ${bakedJson};<\/script>
<script type="text/babel">${jsx}<\/script>
</body>
</html>`;
}
