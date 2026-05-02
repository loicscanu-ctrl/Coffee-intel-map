// Auto-generated boundary file for the standalone HTML export.
// Contents are JSX-as-string compiled by Babel in the browser at runtime.
// See ../index.ts for the orchestrator.
/* eslint-disable */

export const JSX_PREAMBLE = `
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

`;
