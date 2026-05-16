// Auto-generated boundary file for the standalone HTML export.
// Contents are JSX-as-string compiled by Babel in the browser at runtime.
// See ../index.ts for the orchestrator.
/* eslint-disable */

export const JSX_COMPONENTS = `
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
  var _s3 = useState("net"); var mode = _s3[0]; var setMode = _s3[1];
  var weeks13 = data.slice(-13);
  var n = weeks13.length;

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

  function gv(d, field, mkt) { return (d[mkt] && d[mkt][field]) ? d[mkt][field] : 0; }

  var nyLsRows = lsFields.map(function(f) {
    return {
      label: f.label,
      color: HM_CAT_COLORS[f.label] || "#64748b",
      vals: weeks13.map(function(d) {
        if (mode === "long")  return gv(d, f.lf, "ny");
        if (mode === "short") return gv(d, f.sf, "ny");
        return gv(d, f.lf, "ny") - gv(d, f.sf, "ny");
      }),
    };
  });
  var ldnLsRows = lsFields.map(function(f) {
    return {
      label: f.label,
      color: HM_CAT_COLORS[f.label] || "#64748b",
      vals: weeks13.map(function(d) {
        if (mode === "long")  return gv(d, f.lf, "ldn");
        if (mode === "short") return gv(d, f.sf, "ldn");
        return gv(d, f.lf, "ldn") - gv(d, f.sf, "ldn");
      }),
    };
  });
  var nySpreadRows = spreadFields.map(function(f) {
    return { label: f.label, color: f.color, vals: weeks13.map(function(d) { return gv(d, f.key, "ny"); }) };
  });
  var ldnSpreadRows = spreadFields.map(function(f) {
    return { label: f.label, color: f.color, vals: weeks13.map(function(d) { return gv(d, f.key, "ldn"); }) };
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

  function renderCells(vals, isSpread) {
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    return (
      <div style={{ display:"grid", gridTemplateColumns:"repeat("+n+", 1fr)", gap:2 }}>
        {vals.map(function(val, wi) {
          var isLast = wi === n - 1;
          var range2 = isSpread ? (max-min) : mode==="net" ? Math.max(Math.abs(min),Math.abs(max)) : (max-min);
          var intensity = range2 > 0 ? (isSpread ? (val-min)/range2 : mode==="net" ? Math.abs(val)/range2 : (val-min)/range2) : 0;
          return (
            <div key={wi} title={weeks13[wi].date+": "+Math.round(val).toLocaleString()+" lots"}
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

  var dateRow = (
    <div style={{ display:"grid", gridTemplateColumns:"repeat("+n+", 1fr)", gap:2 }}>
      {weeks13.map(function(d, i) {
        return <div key={i} style={{ fontSize:9, color: i===n-1 ? "#a5b4fc" : "#475569", textAlign:"center" }}>{String(d.date).slice(5)}</div>;
      })}
    </div>
  );

  return (
    <React.Fragment>
      <SectionHeader icon="Grid" title="2. 13-Week Positioning Heatmap" subtitle="Weekly position levels by category. Color intensity = level within 13-week range. Purple outline = latest week." />
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
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
        <div style={{ display:"flex", gap:8, marginBottom:4 }}>
          <div style={{ width:72 }} />
          <div style={{ flex:1, fontSize:9, color:"#60a5fa", fontWeight:700, textAlign:"center" }}>KC · Arabica</div>
          <div style={{ width:9 }} />
          <div style={{ flex:1, fontSize:9, color:"#a78bfa", fontWeight:700, textAlign:"center" }}>RC · Robusta</div>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          <div style={{ width:72 }} />
          <div style={{ flex:1 }}>{dateRow}</div>
          <div style={{ width:9 }} />
          <div style={{ flex:1 }}>{dateRow}</div>
        </div>
        <div style={{ fontSize:10, color:"#475569", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>
          {mode === "net" ? "Net (L - S)" : mode === "long" ? "Longs" : "Shorts"}
        </div>
        {lsFields.map(function(f, idx) {
          return (
            <div key={f.label} style={{ display:"flex", gap:8, marginBottom:2 }}>
              <div style={{ width:72, fontSize:10, color:nyLsRows[idx].color, fontWeight:600, height:30, display:"flex", alignItems:"center" }}>{f.label}</div>
              <div style={{ flex:1 }}>{renderCells(nyLsRows[idx].vals, false)}</div>
              <div style={{ width:1, background:"#334155", margin:"0 4px" }} />
              <div style={{ flex:1 }}>{renderCells(ldnLsRows[idx].vals, false)}</div>
            </div>
          );
        })}
        <div style={{ borderTop:"1px dashed #334155", margin:"10px 0 6px" }}/>
        <div style={{ fontSize:10, color:"#475569", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>Spreading</div>
        {spreadFields.map(function(f, idx) {
          return (
            <div key={f.label} style={{ display:"flex", gap:8, marginBottom:2 }}>
              <div style={{ width:72, fontSize:10, color:f.color, fontWeight:600, height:30, display:"flex", alignItems:"center" }}>{f.label}</div>
              <div style={{ flex:1 }}>{renderCells(nySpreadRows[idx].vals, true)}</div>
              <div style={{ width:1, background:"#334155", margin:"0 4px" }} />
              <div style={{ flex:1 }}>{renderCells(ldnSpreadRows[idx].vals, true)}</div>
            </div>
          );
        })}
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

// ── Section 8: Signal Analysis ────────────────────────────────────────────────
var SIG_CATEGORY_ORDER = ["CP","CR","CI","ML","MS","MI","TC","MPI","MRI","CS","OB","SP"];
var SIG_CATEGORY_LABELS = {
  CP:"Producer Behavior", CR:"Roaster Behavior", CI:"Commercial Interaction",
  ML:"MM Longs", MS:"MM Shorts", MI:"MM Interaction", TC:"Trader Count",
  MPI:"MM x Producers", MRI:"MM x Roasters",
  CS:"Curve Structure", OB:"Overbought / Oversold", SP:"Spreading",
};
var SIG_ZONE_COLOR = {
  "strongly-bearish":"#ef4444", "bearish":"#f97316",
  "neutral":"#94a3b8", "bullish":"#22c55e", "strongly-bullish":"#10b981",
};
var SIG_ZONE_LABEL = {
  "strongly-bearish":"Strongly Bearish", "bearish":"Bearish",
  "neutral":"Neutral", "bullish":"Bullish", "strongly-bullish":"Strongly Bullish",
};
var SIG_SEV_STYLE = {
  none:  { background:"rgba(30,41,59,0.3)",   color:"#334155" },
  info:  { background:"rgba(51,65,85,0.6)",   color:"#94a3b8" },
  warn:  { background:"rgba(120,53,15,0.4)",  color:"#fbbf24" },
  alert: { background:"rgba(127,29,29,0.4)",  color:"#f87171" },
};

function sigScoreZone(s) {
  if (s <= -5) return "strongly-bearish";
  if (s <  -2) return "bearish";
  if (s <=  2) return "neutral";
  if (s <   5) return "bullish";
  return "strongly-bullish";
}
function sigComputeScores(signals) {
  var ny = 0, ldn = 0;
  signals.forEach(function(s) { if (s.market === "NY") ny += s.score; else ldn += s.score; });
  var clamp = function(n) { return Math.max(-10, Math.min(10, Math.round(n))); };
  return { scoreNY: clamp(ny), scoreLDN: clamp(ldn) };
}
function sigTopSeverity(sigs) {
  if (sigs.some(function(s) { return s.severity === "alert"; })) return "alert";
  if (sigs.some(function(s) { return s.severity === "warn";  })) return "warn";
  if (sigs.length > 0) return "info";
  return "none";
}
function sigCardStyle(sig) {
  if (sig.score > 0) {
    if (sig.severity === "alert") return { border:"1px solid rgba(34,197,94,0.6)",  background:"rgba(20,83,45,0.15)"  };
    if (sig.severity === "warn")  return { border:"1px solid rgba(34,197,94,0.4)",  background:"rgba(20,83,45,0.10)"  };
    return                               { border:"1px solid rgba(22,101,52,0.4)",  background:"rgba(20,83,45,0.05)"  };
  }
  if (sig.score < 0) {
    if (sig.severity === "alert") return { border:"1px solid rgba(239,68,68,0.5)", background:"rgba(127,29,29,0.10)" };
    if (sig.severity === "warn")  return { border:"1px solid rgba(239,68,68,0.3)", background:"rgba(127,29,29,0.08)" };
    return                               { border:"1px solid rgba(185,28,28,0.3)", background:"rgba(127,29,29,0.05)" };
  }
  if (sig.severity === "alert") return { border:"1px solid rgba(245,158,11,0.4)", background:"rgba(120,53,15,0.10)" };
  if (sig.severity === "warn")  return { border:"1px solid rgba(245,158,11,0.3)", background:"rgba(120,53,15,0.05)" };
  return                               { border:"1px solid rgba(100,116,139,0.5)", background:"rgba(30,41,59,0.30)" };
}
function sigDotColor(sig) {
  if (sig.score > 0) return sig.severity === "alert" ? "#4ade80" : "#22c55e";
  if (sig.score < 0) return sig.severity === "alert" ? "#f87171" : "#ef4444";
  return sig.severity === "alert" ? "#fbbf24" : sig.severity === "warn" ? "#f59e0b" : "#64748b";
}
function sigNameColor(sig) {
  if (sig.score > 0) return "#4ade80";
  if (sig.score < 0) return "#f87171";
  return sig.severity === "alert" ? "#fbbf24" : "#94a3b8";
}
function fmtSigScore(n) { return n > 0 ? "+"+n : String(n); }

function SigCompositeGauge({ label, score }) {
  var zone = sigScoreZone(score);
  var fill = Math.max(-10, Math.min(10, score));
  var fillPct = ((fill + 10) / 20) * 100;
  var color = SIG_ZONE_COLOR[zone];
  return (
    <div style={{ flex:1, minWidth:140, background:"rgba(30,41,59,0.5)", borderRadius:8, border:"1px solid rgba(51,65,85,0.5)", padding:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:10, fontFamily:"monospace", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</span>
        <span style={{ fontSize:11, fontWeight:700, color:color }}>{SIG_ZONE_LABEL[zone]}</span>
      </div>
      <div style={{ position:"relative", height:8, borderRadius:4, background:"#334155", overflow:"hidden" }}>
        <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"#64748b", zIndex:1 }} />
        {score >= 0 ? (
          <div style={{ position:"absolute", top:0, bottom:0, left:"50%", width:(fillPct-50)+"%", backgroundColor:color, borderRadius:"0 4px 4px 0" }} />
        ) : (
          <div style={{ position:"absolute", top:0, bottom:0, right:(100-fillPct)+"%", width:(50-fillPct)+"%", backgroundColor:color, borderRadius:"4px 0 0 4px" }} />
        )}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
        <span style={{ fontSize:9, color:"#334155", fontFamily:"monospace" }}>-10</span>
        <span style={{ fontSize:9, fontWeight:700, color:color, fontFamily:"monospace" }}>{score > 0 ? "+"+score : score}</span>
        <span style={{ fontSize:9, color:"#334155", fontFamily:"monospace" }}>+10</span>
      </div>
    </div>
  );
}

function SigHistoricalCols({ weeks, market }) {
  var n = weeks.length;
  return (
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ display:"grid", gap:2, gridTemplateColumns:"repeat("+n+", 1fr)" }}>
        {weeks.map(function(w) {
          return <div key={w.date} style={{ fontSize:8, fontFamily:"monospace", color:"#475569", textAlign:"center", overflow:"hidden", whiteSpace:"nowrap" }}>{String(w.date).slice(5)}</div>;
        })}
      </div>
      <div style={{ display:"grid", gap:2, gridTemplateColumns:"repeat("+n+", 1fr)" }}>
        {weeks.map(function(w) {
          var price = market === "NY" ? w.priceNY : w.priceLDN;
          return <div key={w.date} style={{ fontSize:8, fontFamily:"monospace", color:"rgba(251,191,36,0.8)", textAlign:"center", height:16, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", whiteSpace:"nowrap" }}>{price != null ? price.toFixed(0) : "-"}</div>;
        })}
      </div>
      {SIG_CATEGORY_ORDER.map(function(cat) {
        return (
          <div key={cat} style={{ display:"grid", gap:2, gridTemplateColumns:"repeat("+n+", 1fr)", marginTop:1 }}>
            {weeks.map(function(w) {
              var sigs = w.signals.filter(function(s) { return s.category === cat && s.market === market; });
              var sev = sigTopSeverity(sigs);
              var ss = Object.assign({ height:20, borderRadius:2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:700 }, SIG_SEV_STYLE[sev]);
              return (
                <div key={w.date} title={sigs.length ? sigs.length+" signal"+(sigs.length>1?"s":"") : "-"} style={ss}>
                  {sigs.length > 0 ? sigs.length : "\xB7"}
                </div>
              );
            })}
          </div>
        );
      })}
      <div style={{ display:"grid", gap:2, gridTemplateColumns:"repeat("+n+", 1fr)", marginTop:2 }}>
        {weeks.map(function(w) {
          var sc = market === "NY" ? w.scoreNY : w.scoreLDN;
          return (
            <div key={w.date} style={{ fontSize:8, fontFamily:"monospace", fontWeight:700, textAlign:"center", height:16, display:"flex", alignItems:"center", justifyContent:"center", color:SIG_ZONE_COLOR[sigScoreZone(sc)] }}>
              {fmtSigScore(sc)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignalsSection({ signals, historicalSignals }) {
  signals = signals || [];
  historicalSignals = historicalSignals || [];
  var _si = useState(false); var showInfo = _si[0]; var setShowInfo = _si[1];

  var alerts = signals.filter(function(s) { return s.severity === "alert"; }).length;
  var warns  = signals.filter(function(s) { return s.severity === "warn";  }).length;
  var infos  = signals.filter(function(s) { return s.severity === "info";  }).length;

  var scores = sigComputeScores(signals);
  var visible = showInfo ? signals : signals.filter(function(s) { return s.severity !== "info"; });
  var histWeeks = historicalSignals.slice(-8);

  function buildGroups(market) {
    return SIG_CATEGORY_ORDER
      .map(function(cat) {
        return { cat:cat, label:SIG_CATEGORY_LABELS[cat], sigs:visible.filter(function(s) { return s.category===cat && s.market===market; }) };
      })
      .filter(function(g) { return g.sigs.length > 0; });
  }
  var kcGroups = buildGroups("NY");
  var rcGroups = buildGroups("LDN");

  var COLS = [
    { mkt:"NY",  groups:kcGroups, title:"KC \xB7 Arabica", color:"#60a5fa" },
    { mkt:"LDN", groups:rcGroups, title:"RC \xB7 Robusta", color:"#a78bfa" },
  ];

  return (
    <div style={{ marginBottom:32 }}>
      <SectionHeader icon="Signals" title="1. Rule-Based Signal Analysis"
        subtitle="59 rules \xB7 proxies: pmpuShort = producers, pmpuLong = roasters \xB7 52-week percentiles" />

      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:12 }}>
        {alerts > 0 && <span style={{ padding:"2px 8px", borderRadius:9999, background:"rgba(127,29,29,0.4)", color:"#f87171", border:"1px solid rgba(185,28,28,0.4)", fontSize:10, fontWeight:500 }}>{alerts} alert{alerts!==1?"s":""}</span>}
        {warns  > 0 && <span style={{ padding:"2px 8px", borderRadius:9999, background:"rgba(120,53,15,0.4)", color:"#fbbf24", border:"1px solid rgba(180,83,9,0.4)",  fontSize:10, fontWeight:500 }}>{warns} warning{warns!==1?"s":""}</span>}
        {infos  > 0 && (
          <button onClick={function() { setShowInfo(function(v) { return !v; }); }}
            style={{ padding:"2px 8px", borderRadius:9999, border:"1px solid "+(showInfo?"#64748b":"#334155"), background:showInfo?"#334155":"rgba(30,41,59,0.6)", color:showInfo?"#e2e8f0":"#64748b", fontSize:10, fontWeight:500, cursor:"pointer" }}>
            {infos} info {showInfo ? "▲" : "▼"}
          </button>
        )}
        {signals.length === 0 && <span style={{ fontSize:10, color:"#64748b" }}>No signals triggered</span>}
      </div>

      <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:16 }}>
        <SigCompositeGauge label="KC \xB7 Arabica (NY)"  score={scores.scoreNY}  />
        <SigCompositeGauge label="RC \xB7 Robusta (LDN)" score={scores.scoreLDN} />
      </div>

      {histWeeks.length > 0 && (
        <div style={{ background:"rgba(30,41,59,0.3)", borderRadius:8, border:"1px solid rgba(51,65,85,0.5)", padding:12, marginBottom:16 }}>
          <div style={{ fontSize:10, color:"#64748b", fontWeight:500, marginBottom:12, textTransform:"uppercase", letterSpacing:"0.05em" }}>8-Week Signal History</div>
          <div style={{ display:"flex", gap:8, overflowX:"auto" }}>
            <div style={{ flexShrink:0, display:"flex", flexDirection:"column" }}>
              <div style={{ height:16 }} />
              <div style={{ height:16 }} />
              {SIG_CATEGORY_ORDER.map(function(cat) {
                return <div key={cat} style={{ height:20, marginTop:1, display:"flex", alignItems:"center" }}><span style={{ fontSize:8, color:"#64748b", whiteSpace:"nowrap", paddingRight:8 }}>{SIG_CATEGORY_LABELS[cat]}</span></div>;
              })}
              <div style={{ height:16, marginTop:2, display:"flex", alignItems:"center" }}><span style={{ fontSize:8, fontFamily:"monospace", color:"#475569", textTransform:"uppercase", paddingRight:8 }}>Score</span></div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:9, color:"#60a5fa", fontWeight:700, textAlign:"center", marginBottom:2 }}>KC \xB7 Arabica</div>
              <SigHistoricalCols weeks={histWeeks} market="NY" />
            </div>
            <div style={{ width:1, background:"rgba(51,65,85,0.5)", alignSelf:"stretch", margin:"0 4px" }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:9, color:"#a78bfa", fontWeight:700, textAlign:"center", marginBottom:2 }}>RC \xB7 Robusta</div>
              <SigHistoricalCols weeks={histWeeks} market="LDN" />
            </div>
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, alignItems:"start" }}>
        {COLS.map(function(col) {
          return (
            <div key={col.mkt}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:col.color, borderBottom:"1px solid rgba(51,65,85,0.4)", paddingBottom:4, marginBottom:12 }}>
                {col.title}
              </div>
              {col.groups.length === 0 && <div style={{ fontSize:10, color:"#475569" }}>No active signals</div>}
              {col.groups.map(function(g) {
                return (
                  <div key={g.cat} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                      <span style={{ fontSize:10, color:"#94a3b8", fontWeight:500 }}>{g.label}</span>
                      <div style={{ flex:1, height:1, background:"#1e293b" }} />
                      <span style={{ fontSize:10, color:"#475569" }}>{g.sigs.length}</span>
                    </div>
                    {g.sigs.map(function(sig) {
                      return (
                        <div key={sig.id} style={Object.assign({ display:"flex", gap:8, alignItems:"flex-start", padding:8, borderRadius:8, marginBottom:4 }, sigCardStyle(sig))}>
                          <div style={{ marginTop:4, width:8, height:8, borderRadius:"50%", flexShrink:0, backgroundColor:sigDotColor(sig) }} />
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:2 }}>
                              <span style={{ fontSize:11, fontWeight:700, color:sigNameColor(sig) }}>{sig.name}</span>
                              {sig.score !== 0 && (
                                <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700, marginLeft:"auto", color:sig.score>0?"#4ade80":"#f87171" }}>{fmtSigScore(sig.score)}</span>
                              )}
                            </div>
                            <p style={{ fontSize:10, color:"#94a3b8", lineHeight:1.5, margin:0 }}>{sig.text}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {signals.length === 0 && (
        <div style={{ textAlign:"center", color:"#475569", fontSize:12, padding:"32px 0" }}>
          No signals triggered.
        </div>
      )}
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

`;
