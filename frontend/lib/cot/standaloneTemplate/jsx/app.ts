// Auto-generated boundary file for the standalone HTML export.
// The exported App component is the root of the in-browser dashboard.
/* eslint-disable */

export const JSX_APP = `
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
