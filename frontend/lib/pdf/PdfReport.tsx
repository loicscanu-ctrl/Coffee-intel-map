"use client";
// frontend/lib/pdf/PdfReport.tsx
// NOTE: This file must only be imported via dynamic import() — never in SSR context.
import React from "react";
// Import via pdfEngine so the server webpack alias redirects it to the noop stub.
// Never import @react-pdf/renderer directly here — the server compiler traces
// through this file and would fail to resolve the browser-only package.
import {
  Document, Page, View, Text, Image,
} from "./pdfEngine";
import type { Style } from "@react-pdf/types";
import { S, BRAND } from "./pdfStyles";
import type { ReportData, MarketMetrics } from "./types";
import {
  marketOverviewComment, industryCoverageComment,
  mmPositioningComment, obosComment,
} from "./comments";
import type { GlobalFlowMetrics } from "./types";

// ── Shared micro-components ──────────────────────────────────────────────────

function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={S.headerBar}>
      <Text style={S.headerTitle}>☕ COFFEE INTEL — COT REPORT</Text>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={S.headerTitle}>{title}</Text>
        <Text style={S.headerSub}>{sub}</Text>
      </View>
    </View>
  );
}

function PageFooter({ page, total, date }: { page: number; total: number; date: string }) {
  return (
    <View style={S.footer}>
      <Text>Generated {date} · Data: CFTC, ICE Europe, yfinance</Text>
      <Text>Page {page} of {total}</Text>
    </View>
  );
}

function CommentBox({ text, isSignal = false, compact = false }: { text: string; isSignal?: boolean; compact?: boolean }) {
  const boxStyle = compact
    ? [S.commentBox, { padding: 4, marginTop: 3, marginBottom: 4 }]
    : S.commentBox;
  const txtStyle = compact
    ? [isSignal ? S.commentSignal : S.commentText, { fontSize: 7 }]
    : isSignal ? S.commentSignal : S.commentText;
  return (
    <View style={boxStyle}>
      <Text style={txtStyle}>{text}</Text>
    </View>
  );
}

function MetricRow({ label, value, flag, extraStyle }: { label: string; value: string; flag?: "red" | "green" | "amber"; extraStyle?: Style }) {
  const valStyle = flag === "red" ? S.flagRed : flag === "green" ? S.flagGreen : flag === "amber" ? S.flagAmber : S.metricValue;
  const rowStyle: Style | Style[] = extraStyle ? [S.metricRow, extraStyle] : S.metricRow;
  return (
    <View style={rowStyle}>
      <Text style={S.metricLabel}>{label}</Text>
      <Text style={valStyle}>{value}</Text>
    </View>
  );
}

function KpiPill({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={S.kpiPill}>
      <Text style={S.kpiLabel}>{label}</Text>
      <Text style={[S.kpiValue, color ? { color } : {}]}>{value}</Text>
      {sub && <Text style={S.kpiSub}>{sub}</Text>}
    </View>
  );
}

// ── Market deep-dive column (used for both NY and LDN) ───────────────────────

function MarketColumn({ m, compact = false }: { m: MarketMetrics; compact?: boolean }) {
  const s   = (n: number, dec = 1) => (n >= 0 ? "+" : "-") + Math.abs(n).toFixed(dec);
  const kl  = (n: number) => `${s(n / 1000)}k lots`;
  const klN = (n: number | null) => n === null ? "N/A" : kl(n);

  const subTitleStyle = compact
    ? [S.subTitle, { marginTop: 3, marginBottom: 2 }]
    : S.subTitle;
  const mrStyle = compact
    ? { paddingVertical: 1 as any }
    : undefined;

  return (
    <View style={S.col}>
      <Text style={S.sectionTitle}>{m.market}</Text>

      {/* Overview */}
      <Text style={subTitleStyle}>OVERVIEW</Text>
      <MetricRow label="Total OI change"    value={kl(m.oiChangeLots)}    extraStyle={mrStyle} />
      <MetricRow label="Nearby (M1+M2)"     value={klN(m.oiChangeNearby)} extraStyle={mrStyle} />
      <MetricRow label="Forward (M3+)"      value={klN(m.oiChangeForward)} extraStyle={mrStyle} />
      <MetricRow label="Price change"       value={`${s(m.priceChangePct)}% (${s(m.priceChangeAbs, 1)} ${m.priceUnit})`} extraStyle={mrStyle} />
      <MetricRow
        label="Front structure"
        value={m.structureType === null ? "N/A" : `${m.structureType} · ${s(m.structureValue!, 2)} ${m.priceUnit} · ${s(m.annualizedRollPct!)}% ann.`}
        flag={m.structureType === "backwardation" && (m.annualizedRollPct ?? 0) > 4.1 ? "green" : "amber"}
        extraStyle={mrStyle}
      />
      <CommentBox text={marketOverviewComment(m)} compact={compact} />

      {/* Industry */}
      <Text style={subTitleStyle}>INDUSTRY COVERAGE</Text>
      <MetricRow label="Producers (PMPU L)" value={`${m.producerCovPct.toFixed(1)}% · ${(m.producerMT/1000).toFixed(0)}k MT`} extraStyle={mrStyle} />
      <MetricRow label="  WoW"              value={`${s(m.producerMTWoW/1000)}k MT`} extraStyle={mrStyle} />
      <MetricRow label="Roasters (PMPU S)"  value={`${m.roasterCovPct.toFixed(1)}% · ${(m.roasterMT/1000).toFixed(0)}k MT`} extraStyle={mrStyle} />
      <MetricRow label="  WoW"              value={`${s(m.roasterMTWoW/1000)}k MT`} extraStyle={mrStyle} />
      <CommentBox text={industryCoverageComment(m)} compact={compact} />

      {/* MM Positioning */}
      <Text style={subTitleStyle}>MANAGED MONEY</Text>
      <MetricRow label="MM Longs"  value={`${(m.mmLong/1000).toFixed(1)}k (${s(m.mmLongChangeLots/1000)}k / ${s(m.mmLongChangePct)}%)`} extraStyle={mrStyle} />
      <MetricRow label="MM Shorts" value={`${(m.mmShort/1000).toFixed(1)}k (${s(m.mmShortChangeLots/1000)}k / ${s(m.mmShortChangePct)}%)`} extraStyle={mrStyle} />
      <MetricRow label="Funds maxed (L)"  value={`${m.fundsMaxedLongPct.toFixed(1)}%`}  flag={m.fundsMaxedLongPct  > 80 ? "red" : undefined} extraStyle={mrStyle} />
      <MetricRow label="Funds maxed (S)"  value={`${m.fundsMaxedShortPct.toFixed(1)}%`} flag={m.fundsMaxedShortPct > 80 ? "red" : undefined} extraStyle={mrStyle} />
      <CommentBox text={mmPositioningComment(m)} compact={compact} />

      {/* Risk flags */}
      <Text style={subTitleStyle}>RISK FLAGS</Text>
      <MetricRow
        label="OB/OS"
        value={m.obosFlag === "overbought" ? "⚠ OVERBOUGHT" : m.obosFlag === "oversold" ? "⚠ OVERSOLD" : "Neutral"}
        flag={m.obosFlag !== "neutral" ? "red" : "green"}
        extraStyle={mrStyle}
      />
      <MetricRow label="Price rank"  value={`${m.priceRank.toFixed(1)}th pctl`} extraStyle={mrStyle} />
      <MetricRow label="OI rank"     value={`${m.oiRank.toFixed(1)}th pctl`}    extraStyle={mrStyle} />
      <MetricRow
        label="Pos. mismatch"
        value={m.positionMismatch ? "⚠ YES" : "None"}
        flag={m.positionMismatch ? "red" : "green"}
        extraStyle={mrStyle}
      />
      <MetricRow
        label="MM concentration"
        value={`${m.mmConcentrationPct.toFixed(1)}% of OI`}
        flag={m.mmConcentrationPct > 40 ? "amber" : undefined}
        extraStyle={mrStyle}
      />
      <CommentBox text={obosComment(m)} isSignal compact={compact} />

      {/* Counterparty */}
      <Text style={subTitleStyle}>COUNTERPARTY (WoW Δ)</Text>
      {(["pmpu","sd","mm","or","nr"] as const).map(cat => {
        const longV  = (m.cp.longs  as any)[cat] ?? 0;
        const shortV = (m.cp.shorts as any)[cat] ?? 0;
        if (longV === 0 && shortV === 0) return null;
        const labels: Record<string, string> = { pmpu: "PMPU", sd: "Swap Dealers", mm: "Mng. Money", or: "Other Rep.", nr: "Non-Rep." };
        return (
          <MetricRow
            key={cat}
            label={labels[cat]}
            value={`L: ${s(longV/1000)}k  S: ${s(shortV/1000)}k`}
            extraStyle={mrStyle}
          />
        );
      })}
    </View>
  );
}

// ── Chart page helper ─────────────────────────────────────────────────────────

function ChartBlock({ title, src, comment, compact = false }: { title: string; src: string | null; comment: string; compact?: boolean }) {
  const imgStyle = compact ? [S.chartImg, { maxHeight: 120 }] : S.chartImg;
  return (
    <View style={{ marginBottom: compact ? 6 : 16 }}>
      <Text style={[S.subTitle, compact ? { marginTop: 2, marginBottom: 2, fontSize: 7 } : {}]}>{title}</Text>
      {src
        ? <Image style={imgStyle as any} src={src} />
        : <View style={{ height: compact ? 60 : 80, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 8, color: "#94a3b8" }}>Chart unavailable</Text>
          </View>
      }
      <CommentBox text={comment} compact={compact} />
    </View>
  );
}

// ── Lot-size constants ────────────────────────────────────────────────────────
const NY_LOT_MT  = 17.009; // 37,500 lbs → MT
const LDN_LOT_MT = 10.0;   // 10 MT / lot

// ── Page 1: Commodity breakdown table (all commodities, grouped by sector) ────
const SECTOR_LABELS: Record<string, string> = {
  energy: "Energy", metals: "Metals", grains: "Grains",
  meats: "Meats", softs: "Softs", micros: "Micros",
};
const SECTOR_ORDER = ["energy", "metals", "grains", "meats", "softs", "micros"];


function CommodityTable({ g }: { g: GlobalFlowMetrics }) {
  const fB   = (n: number) => `$${Math.abs(n).toFixed(2)}B`;
  const dB   = (n: number) => `${n >= 0 ? "+" : "-"}${fB(n)}`;
  const dPct = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}%`;
  const dPp  = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)}pp`;

  // 14 columns: [0]name [1]grossB [2]grsWoW [3]grossOiΔ [4]grossPxΔ [5]grs%
  //             [6]netB  [7]netWoW [8]netOiΔ  [9]netPxΔ  [10]net%
  //             [11]share% [12]Δshr [13]G/N/S bars
  const C = [1.2, 0.75, 0.70, 0.60, 0.60, 0.50, 0.75, 0.70, 0.60, 0.60, 0.50, 0.65, 0.50, 0.50];
  const FS = 6;  // uniform font size for data cells

  const hR  = (flex: number) => [S.tHCellR, { flex, fontSize: FS }];
  const hL  = (flex: number) => [S.tHCell,  { flex, fontSize: FS }];
  const pos = (flex: number) => [S.tCellPos, { flex, fontSize: FS }];
  const neg = (flex: number) => [S.tCellNeg, { flex, fontSize: FS }];
  const neu = (flex: number) => [S.tCellR,   { flex, fontSize: FS }];
  const sgn = (v: number, flex: number) => v >= 0 ? pos(flex) : neg(flex);

  // Null-safe formatter: null → "—"
  const dBN = (n: number | null): string => n == null ? "—" : dB(n);
  // Null-safe style: null → neutral grey, otherwise sign-colored
  const sgnN = (v: number | null, flex: number) => v == null ? neu(flex) : sgn(v, flex);
  // Null-safe style with bold font (for sector rows)
  const sgnNB = (v: number | null, flex: number) =>
    v == null
      ? [S.tCellR, { flex, fontSize: FS, fontFamily: "Helvetica-Bold" }]
      : v >= 0
        ? [S.tCellPos, { flex, fontSize: FS, fontFamily: "Helvetica-Bold" }]
        : [S.tCellNeg, { flex, fontSize: FS, fontFamily: "Helvetica-Bold" }];

  // G/N/S stacked-bar cell: three unlabelled bars (Gross / Net / Share 5Y rank)
  const rankCell = (gross: number, net: number, share: number) => {
    const bar = (rank: number) => {
      const pct = Math.max(0, Math.min(100, rank));
      const col = pct > 75 ? "#dc2626" : pct < 25 ? "#059669" : "#d97706";
      return (
        <View style={{ height: 2, backgroundColor: "#e2e8f0", borderRadius: 1, marginBottom: 1 }}>
          <View style={{ width: `${pct}%`, height: "100%", backgroundColor: col, borderRadius: 1 }} />
        </View>
      );
    };
    return (
      <View style={{ flex: C[13], flexDirection: "column", justifyContent: "center", paddingHorizontal: 4 }}>
        {bar(gross)}
        {bar(net)}
        {bar(share)}
      </View>
    );
  };

  // Sector header row
  function SectorRow({ sd }: { sd: (typeof g.sectorBreakdown)[0] }) {
    return (
      <View style={{ flexDirection: "row", paddingVertical: 1, paddingHorizontal: 6, backgroundColor: "#1e293b", borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
        <Text style={[S.tHCell, { flex: C[0], fontSize: FS, textTransform: "capitalize" }]}>{SECTOR_LABELS[sd.sector]}</Text>
        <Text style={[S.tHCellR, { flex: C[1], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{fB(sd.grossB)}</Text>
        <Text style={[sd.deltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[2], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dB(sd.deltaB)}</Text>
        <Text style={sgnNB(sd.grossOiEffectB, C[3])}>{dBN(sd.grossOiEffectB)}</Text>
        <Text style={sgnNB(sd.grossPriceEffectB, C[4])}>{dBN(sd.grossPriceEffectB)}</Text>
        <Text style={[sd.deltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[5], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dPct(sd.deltaPct)}</Text>
        <Text style={[sd.netB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[6], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{sd.netB >= 0 ? "+" : "-"}{fB(sd.netB)}</Text>
        <Text style={[sd.netDeltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[7], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dB(sd.netDeltaB)}</Text>
        <Text style={sgnNB(sd.netOiEffectB, C[8])}>{dBN(sd.netOiEffectB)}</Text>
        <Text style={sgnNB(sd.netPriceEffectB, C[9])}>{dBN(sd.netPriceEffectB)}</Text>
        <Text style={[sd.netDeltaPct >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[10], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dPct(sd.netDeltaPct)}</Text>
        <Text style={[S.tHCellR, { flex: C[11], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{sd.shareOfTotalPct.toFixed(1)}%</Text>
        <Text style={[sd.shareDeltaPp >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[12], fontSize: FS, fontFamily: "Helvetica-Bold" }]}>{dPp(sd.shareDeltaPp)}</Text>
        {rankCell(sd.histRankGrossPct, sd.histRankNetPct, sd.histRankSharePct)}
      </View>
    );
  }

  // Commodity row
  function CommodityRow_({ row, i }: { row: import("@/lib/pdf/types").CommodityRow; i: number }) {
    const bg = row.isCoffee ? "#fffbeb" : i % 2 === 0 ? "transparent" : "#f8fafc";
    const nameStyle = row.isCoffee
      ? [S.tCell, { flex: C[0], color: BRAND.amber, fontSize: FS, paddingLeft: 10 }]
      : [S.tCell, { flex: C[0], fontSize: FS, paddingLeft: 10 }];
    return (
      <View style={{ flexDirection: "row", paddingVertical: 0.5, paddingHorizontal: 6, backgroundColor: bg, borderBottomWidth: 0.3, borderBottomColor: "#e2e8f0" }}>
        <Text style={nameStyle}>{row.isCoffee ? "► " : ""}{row.name}</Text>
        <Text style={neu(C[1])}>{fB(row.grossB)}</Text>
        <Text style={sgn(row.deltaB, C[2])}>{dB(row.deltaB)}</Text>
        <Text style={sgnN(row.grossOiEffectB, C[3])}>{dBN(row.grossOiEffectB)}</Text>
        <Text style={sgnN(row.grossPriceEffectB, C[4])}>{dBN(row.grossPriceEffectB)}</Text>
        <Text style={sgn(row.deltaPct, C[5])}>{dPct(row.deltaPct)}</Text>
        <Text style={[row.netB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[6], fontSize: FS }]}>{row.netB >= 0 ? "+" : "-"}{fB(row.netB)}</Text>
        <Text style={sgn(row.netDeltaB, C[7])}>{dB(row.netDeltaB)}</Text>
        <Text style={sgnN(row.netOiEffectB, C[8])}>{dBN(row.netOiEffectB)}</Text>
        <Text style={sgnN(row.netPriceEffectB, C[9])}>{dBN(row.netPriceEffectB)}</Text>
        <Text style={sgn(row.netDeltaPct, C[10])}>{dPct(row.netDeltaPct)}</Text>
        <Text style={neu(C[11])}>{row.shareOfTotalPct.toFixed(1)}%</Text>
        <Text style={sgn(row.shareDeltaPp, C[12])}>{dPp(row.shareDeltaPp)}</Text>
        {rankCell(row.histRankGrossPct, row.histRankNetPct, row.histRankSharePct)}
      </View>
    );
  }

  return (
    <View style={[S.tableWrap, { marginVertical: 3 }]}>
      {/* Table header */}
      <View style={[S.tHeadRow, { paddingVertical: 2 }]}>
        <Text style={hL(C[0])}>COMMODITY</Text>
        <Text style={hR(C[1])}>GROSS $B</Text>
        <Text style={hR(C[2])}>GRS WoW</Text>
        <Text style={hR(C[3])}>OI Δ</Text>
        <Text style={hR(C[4])}>Px Δ</Text>
        <Text style={hR(C[5])}>GRS %</Text>
        <Text style={hR(C[6])}>NET $B</Text>
        <Text style={hR(C[7])}>NET WoW</Text>
        <Text style={hR(C[8])}>OI Δ</Text>
        <Text style={hR(C[9])}>Px Δ</Text>
        <Text style={hR(C[10])}>NET %</Text>
        <Text style={hR(C[11])}>SHARE %</Text>
        <Text style={hR(C[12])}>Δ SHR</Text>
        <Text style={hR(C[13])}>G/N/S</Text>
      </View>

      {/* Sector groups */}
      {SECTOR_ORDER.map(sector => {
        const sd = g.sectorBreakdown.find(s => s.sector === sector);
        const rows = g.commodityTable.filter(c => c.displaySector === sector);
        if (!sd || rows.length === 0) return null;
        return (
          <React.Fragment key={sector}>
            <SectorRow sd={sd} />
            {rows.map((row, i) => <CommodityRow_ key={row.symbol} row={row} i={i} />)}
          </React.Fragment>
        );
      })}

      {/* Total row */}
      {(() => {
        const nonNull = (field: "grossOiEffectB" | "grossPriceEffectB" | "netOiEffectB" | "netPriceEffectB") => {
          const vals = g.sectorBreakdown.map(s => s[field]).filter((v): v is number => v !== null);
          return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0);
        };
        const gOi  = nonNull("grossOiEffectB");
        const gPx  = nonNull("grossPriceEffectB");
        const nOi  = nonNull("netOiEffectB");
        const nPx  = nonNull("netPriceEffectB");
        return (
          <View style={S.tTotalRow}>
            <Text style={[S.tHCell, { flex: C[0], fontSize: FS }]}>TOTAL</Text>
            <Text style={[S.tHCellR, { flex: C[1], fontSize: FS }]}>${g.totalGrossB.toFixed(1)}B</Text>
            <Text style={[S.tHCellR, { flex: C[2], fontSize: FS, color: g.wowDeltaB >= 0 ? BRAND.green : BRAND.red }]}>{g.wowDeltaB >= 0 ? "+" : "-"}${Math.abs(g.wowDeltaB).toFixed(2)}B</Text>
            <Text style={sgnNB(gOi, C[3])}>{dBN(gOi)}</Text>
            <Text style={sgnNB(gPx, C[4])}>{dBN(gPx)}</Text>
            <Text style={[S.tHCellR, { flex: C[5], fontSize: FS }]}> </Text>
            <Text style={[S.tHCellR, { flex: C[6], fontSize: FS }]}>${g.netExpB.toFixed(1)}B</Text>
            <Text style={[S.tHCellR, { flex: C[7], fontSize: FS, color: g.wowDeltaNetB >= 0 ? BRAND.green : BRAND.red }]}>{g.wowDeltaNetB >= 0 ? "+" : "-"}${Math.abs(g.wowDeltaNetB).toFixed(2)}B</Text>
            <Text style={sgnNB(nOi, C[8])}>{dBN(nOi)}</Text>
            <Text style={sgnNB(nPx, C[9])}>{dBN(nPx)}</Text>
            <Text style={[S.tHCellR, { flex: C[10], fontSize: FS }]}> </Text>
            <Text style={[S.tHCellR, { flex: C[11] + C[12], fontSize: FS }]}>100% share</Text>
          </View>
        );
      })()}
    </View>
  );
}

// ── Page 1: Highlights — 2×2 grid of boxes ────────────────────────────────────
function FlowAnalysis({ g }: { g: GlobalFlowMetrics }) {
  const G    = "#065f46";
  const R    = "#7f1d1d";
  const BOLD = "Helvetica-Bold";

  const cn   = (n: number): Style => ({ color: n >= 0 ? G : R, fontFamily: BOLD });
  const fD   = (n: number, dec = 2) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(dec)}B`;
  const fPct = (n: number)          => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}%`;
  const fB   = (n: number, dec = 1) => `$${Math.abs(n).toFixed(dec)}B`;

  const prevTotalB = g.totalGrossB - g.wowDeltaB;
  const totalPct   = prevTotalB > 0 ? (g.wowDeltaB / prevTotalB) * 100 : 0;
  const prevNetB   = g.netExpB - g.wowDeltaNetB;
  const netPct     = prevNetB !== 0 ? (g.wowDeltaNetB / Math.abs(prevNetB)) * 100 : 0;
  const dir        = (n: number) => n >= 0 ? "expanded" : "contracted";

  const top3Gross = [...g.commodityTable].sort((a, b) => Math.abs(b.deltaB)    - Math.abs(a.deltaB)).slice(0, 3);
  const top3Net   = [...g.commodityTable].sort((a, b) => Math.abs(b.netDeltaB) - Math.abs(a.netDeltaB)).slice(0, 3);

  const softsSd  = g.sectorBreakdown.find(s => s.sector === "softs");
  const softsComs  = g.commodityTable.filter(c => c.displaySector === "softs");
  const coffeeComs = softsComs.filter(c => c.isCoffee);
  const nonCoffee  = softsComs.filter(c => !c.isCoffee);
  const ncByGross  = [...nonCoffee].sort((a, b) => Math.abs(b.deltaB)    - Math.abs(a.deltaB));
  const ncByNet    = [...nonCoffee].sort((a, b) => Math.abs(b.netDeltaB) - Math.abs(a.netDeltaB));

  const T  = { fontSize: 6.5, lineHeight: 1.3 };
  const ST = { fontSize: 6.0, lineHeight: 1.3 };
  const bs = { marginBottom: 1 };

  const subRow = (key: string, label: string, deltaB: number, pct: number) => (
    <View key={key} style={[S.bulletSubRow, bs, { marginLeft: 8 }]}>
      <Text style={[S.bulletSubDot, { fontSize: 6 }]}>·</Text>
      <Text style={[S.bulletSubText, ST]}>
        {label}: <Text style={cn(deltaB)}>{fD(deltaB)}</Text>
        {" "}(<Text style={cn(pct)}>{fPct(pct)}</Text>)
      </Text>
    </View>
  );

  const boxStyle = {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 0.5,
    borderColor: "#e2e8f0",
    borderRadius: 3,
    padding: 5,
  };
  const boxTitle = {
    fontSize: 6,
    fontFamily: BOLD,
    color: BRAND.slate600,
    textTransform: "uppercase" as const,
    marginBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 2,
  };

  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={[S.subTitle, { marginTop: 0, marginBottom: 3, fontSize: 7 }]}>HIGHLIGHTS ON SPECULATIVE EXPOSURE</Text>

      {/* Row 1: Total Gross | Total Net */}
      <View style={{ flexDirection: "row", gap: 5, marginBottom: 5 }}>
        {/* Box 1 — Total Gross */}
        <View style={boxStyle}>
          <Text style={boxTitle}>Total Gross</Text>
          <Text style={T}>
            {dir(g.wowDeltaB)} to <Text style={{ fontFamily: BOLD }}>{fB(g.totalGrossB)}</Text>{"  "}
            <Text style={cn(g.wowDeltaB)}>{fD(g.wowDeltaB)}</Text>
            {" "}(<Text style={cn(totalPct)}>{fPct(totalPct)}</Text>)
          </Text>
          <View style={[S.bulletSubRow, bs, { marginTop: 2, marginLeft: 0 }]}>
            <Text style={[S.bulletSubText, ST]}>Biggest gross movers:</Text>
          </View>
          {top3Gross.map(c => subRow(c.symbol, c.name, c.deltaB, c.deltaPct))}
        </View>

        {/* Box 2 — Total Net */}
        <View style={boxStyle}>
          <Text style={boxTitle}>Total Net</Text>
          <Text style={T}>
            at <Text style={{ fontFamily: BOLD }}>{fB(g.netExpB)}</Text>{"  "}
            <Text style={cn(g.wowDeltaNetB)}>{fD(g.wowDeltaNetB)}</Text>
            {" "}(<Text style={cn(netPct)}>{fPct(netPct)}</Text>)
          </Text>
          <View style={[S.bulletSubRow, bs, { marginTop: 2, marginLeft: 0 }]}>
            <Text style={[S.bulletSubText, ST]}>Biggest net movers:</Text>
          </View>
          {top3Net.map(c => subRow(c.symbol + "_net", c.name, c.netDeltaB, c.netDeltaPct))}
        </View>
      </View>

      {/* Row 2: Softs Gross | Softs Net */}
      {softsSd && (
        <View style={{ flexDirection: "row", gap: 5 }}>
          {/* Box 3 — Softs Gross */}
          <View style={boxStyle}>
            <Text style={boxTitle}>Softs Gross</Text>
            <Text style={T}>
              {dir(softsSd.deltaB)} to <Text style={{ fontFamily: BOLD }}>{fB(softsSd.grossB)}</Text>{"  "}
              <Text style={cn(softsSd.deltaB)}>{fD(softsSd.deltaB)}</Text>
              {" "}(<Text style={cn(softsSd.deltaPct)}>{fPct(softsSd.deltaPct)}</Text>)
            </Text>
            <View style={[S.bulletSubRow, bs, { marginTop: 2, marginLeft: 0 }]}>
              <Text style={[S.bulletSubText, ST]}>Movers:</Text>
            </View>
            {coffeeComs.map(c => subRow(c.symbol, c.name, c.deltaB, c.deltaPct))}
            {ncByGross[0] && subRow(ncByGross[0].symbol + "_nc", ncByGross[0].name, ncByGross[0].deltaB, ncByGross[0].deltaPct)}
          </View>

          {/* Box 4 — Softs Net */}
          <View style={boxStyle}>
            <Text style={boxTitle}>Softs Net</Text>
            <Text style={T}>
              at <Text style={{ fontFamily: BOLD }}>{softsSd.netB >= 0 ? "" : "-"}{fB(softsSd.netB)}</Text>{"  "}
              <Text style={cn(softsSd.netDeltaB)}>{fD(softsSd.netDeltaB)}</Text>
              {" "}(<Text style={cn(softsSd.netDeltaPct)}>{fPct(softsSd.netDeltaPct)}</Text>)
            </Text>
            <View style={[S.bulletSubRow, bs, { marginTop: 2, marginLeft: 0 }]}>
              <Text style={[S.bulletSubText, ST]}>Movers:</Text>
            </View>
            {coffeeComs.map(c => subRow(c.symbol + "_net", c.name, c.netDeltaB, c.netDeltaPct))}
            {ncByNet[0] && subRow(ncByNet[0].symbol + "_ncnet", ncByNet[0].name, ncByNet[0].netDeltaB, ncByNet[0].netDeltaPct)}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Counterparty mapping block (replaces COT disagg tables on page 3) ─────────
function CounterpartyMapBlock({ ny, ldn }: { ny: MarketMetrics; ldn: MarketMetrics }) {
  const fmtN = (n: number) => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fmtD = (n: number) => `${n >= 0 ? "+" : "-"}${fmtN(n)}`;
  const FS     = 5.5;
  const FS_H   = 6.0;

  const CATS = [
    { key: "pmpu",  label: "PMPU",        color: "#3b82f6" },
    { key: "swap",  label: "Swap Dealers", color: "#10b981" },
    { key: "mm",    label: "Mng. Money",   color: "#f59e0b" },
    { key: "other", label: "Other Rept.",  color: "#94a3b8" },
    { key: "nr",    label: "Non-Rep.",     color: "#64748b" },
  ] as const;

  function MarketBlock({ m, label }: { m: MarketMetrics; label: string }) {
    const c           = m.cats;
    const totalLong   = CATS.reduce((s, cat) => s + ((c as any)[cat.key]?.long  ?? 0), 0);
    const totalShort  = CATS.reduce((s, cat) => s + ((c as any)[cat.key]?.short ?? 0), 0);
    const totalSpread = (c.swap.spread ?? 0) + (c.mm.spread ?? 0) + (c.other.spread ?? 0);

    const renderSide = (side: "long" | "short", total: number, title: string) => {
      const dKey = side === "long" ? "dLong" : "dShort";
      const rows = CATS.map(cat => ({
        ...cat,
        val:   (c as any)[cat.key]?.[side]  ?? 0,
        delta: (c as any)[cat.key]?.[dKey]  ?? 0,
      })).filter(r => r.val > 0);
      return (
        <View style={{ marginBottom: 5 }}>
          <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingBottom: 1, marginBottom: 2 }}>
            <Text style={{ flex: 1, fontSize: FS_H, fontFamily: "Helvetica-Bold", color: BRAND.slate600 }}>{title}</Text>
            <Text style={{ fontSize: FS_H, fontFamily: "Helvetica-Bold", color: BRAND.dark }}>{fmtN(total)}</Text>
          </View>
          {rows.map(row => {
            const pct = total > 0 ? Math.max(0, Math.min(100, (row.val / total) * 100)) : 0;
            return (
              <View key={row.key} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                <Text style={{ width: 52, fontSize: FS, color: row.color }}>{row.label}</Text>
                <View style={{ flex: 1, height: 5, backgroundColor: "#f1f5f9", borderRadius: 1, marginRight: 4 }}>
                  <View style={{ height: 5, width: `${pct}%` as any, backgroundColor: row.color, borderRadius: 1, opacity: 0.8 }} />
                </View>
                <Text style={{ width: 34, fontSize: FS, color: BRAND.dark, textAlign: "right" }}>{fmtN(row.val)}</Text>
                <Text style={{ width: 32, fontSize: FS, color: row.delta >= 0 ? BRAND.green : BRAND.red, textAlign: "right" }}>{fmtD(row.delta)}</Text>
              </View>
            );
          })}
        </View>
      );
    };

    const spreadRows = [
      { key: "swap",  label: "Swap Dealers", color: "#10b981", val: c.swap.spread  ?? 0, delta: c.swap.dSpread  ?? 0 },
      { key: "mm",    label: "Mng. Money",   color: "#f59e0b", val: c.mm.spread    ?? 0, delta: c.mm.dSpread    ?? 0 },
      { key: "other", label: "Other Rept.",  color: "#94a3b8", val: c.other.spread ?? 0, delta: c.other.dSpread ?? 0 },
    ].filter(r => r.val > 0);

    return (
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold", color: BRAND.amber, marginBottom: 1 }}>{label}</Text>
        <Text style={{ fontSize: FS, color: BRAND.slate400, marginBottom: 4 }}>Report: {m.date} · Total OI: {fmtN(c.oi)}</Text>
        {renderSide("long",  totalLong,  "LONGS")}
        {renderSide("short", totalShort, "SHORTS")}
        {spreadRows.length > 0 && (
          <View>
            <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingBottom: 1, marginBottom: 2 }}>
              <Text style={{ flex: 1, fontSize: FS_H, fontFamily: "Helvetica-Bold", color: BRAND.slate600 }}>SPREADING</Text>
              <Text style={{ fontSize: FS_H, fontFamily: "Helvetica-Bold", color: BRAND.dark }}>{fmtN(totalSpread)}</Text>
            </View>
            {spreadRows.map(row => (
              <View key={row.key} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                <Text style={{ width: 52, fontSize: FS, color: row.color }}>{row.label}</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ width: 34, fontSize: FS, color: BRAND.dark, textAlign: "right" }}>{fmtN(row.val)}</Text>
                <Text style={{ width: 32, fontSize: FS, color: row.delta >= 0 ? BRAND.green : BRAND.red, textAlign: "right" }}>{fmtD(row.delta)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
      <MarketBlock m={ldn} label="ICE Counterparty — Robusta (London)" />
      <View style={{ width: 0.5, backgroundColor: "#e2e8f0" }} />
      <MarketBlock m={ny}  label="CFTC Counterparty — Arabica (NY)" />
    </View>
  );
}

// ── Page 3: Coffee comparison table ───────────────────────────────────────────
function CoffeeComparisonTable({ ny, ldn }: { ny: MarketMetrics; ldn: MarketMetrics }) {
  const s1  = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}`;
  const kL  = (n: number) => `${n >= 0 ? "+" : "-"}${(Math.abs(n)/1000).toFixed(1)}k lots`;
  const kLN = (n: number | null) => n === null ? "N/A" : kL(n);

  type Row = [string, string, string, boolean?]; // [label, NY, LDN, isAlt]
  const rows: Row[] = [
    ["Price",            `${ny.price.toFixed(1)} ${ny.priceUnit}`,
                         `${ldn.price.toFixed(0)} ${ldn.priceUnit}`],
    ["WoW Δ price",      `${s1(ny.priceChangePct)}% (${s1(ny.priceChangeAbs)} ${ny.priceUnit})`,
                         `${s1(ldn.priceChangePct)}% (${s1(ldn.priceChangeAbs)} ${ldn.priceUnit})`],
    ["OI change WoW",    kL(ny.oiChangeLots),   kL(ldn.oiChangeLots)],
    ["  Nearby (M1–M2)", kLN(ny.oiChangeNearby), kLN(ldn.oiChangeNearby)],
    ["  Forward (M3+)",  kLN(ny.oiChangeForward), kLN(ldn.oiChangeForward)],
    ["Front structure",
      ny.structureType  === null ? "N/A" : `${ny.structureType  === "backwardation" ? "Backwardation" : "Carry"} · ${s1(ny.structureValue!)} ${ny.priceUnit} · ${s1(ny.annualizedRollPct!)}% ann.`,
      ldn.structureType === null ? "N/A" : `${ldn.structureType === "backwardation" ? "Backwardation" : "Carry"} · ${s1(ldn.structureValue!)} ${ldn.priceUnit} · ${s1(ldn.annualizedRollPct!)}% ann.`],
    ["MM Net (lots)",    kL(ny.mmLong - ny.mmShort),  kL(ldn.mmLong - ldn.mmShort)],
    ["Funds maxed (L)",  `${ny.fundsMaxedLongPct.toFixed(1)}%`,  `${ldn.fundsMaxedLongPct.toFixed(1)}%`],
    ["OB/OS flag",
      ny.obosFlag  === "overbought" ? "⚠ OVERBOUGHT"  : ny.obosFlag  === "oversold" ? "⚠ OVERSOLD"  : "Neutral",
      ldn.obosFlag === "overbought" ? "⚠ OVERBOUGHT" : ldn.obosFlag === "oversold" ? "⚠ OVERSOLD" : "Neutral"],
    ["MM concentration", `${ny.mmConcentrationPct.toFixed(1)}% of OI`,
                         `${ldn.mmConcentrationPct.toFixed(1)}% of OI`],
  ];

  const obosColor = (flag: string) =>
    flag === "overbought" ? BRAND.red : flag === "oversold" ? BRAND.green : BRAND.dark;

  return (
    <View style={[S.tableWrap, { marginTop: 8 }]}>
      <View style={S.tHeadRow}>
        <Text style={[S.tHCell,  { flex: 2 }]}> </Text>
        <Text style={[S.tHCell,  { flex: 3, textAlign: "center" }]}>NY ARABICA (ICE US)</Text>
        <Text style={[S.tHCell,  { flex: 3, textAlign: "center" }]}>LDN ROBUSTA (ICE EU)</Text>
      </View>
      {rows.map(([label, nyVal, ldnVal], i) => {
        const isObos = label === "OB/OS flag";
        return (
          <View key={label} style={i % 2 === 0 ? S.tDataRow : S.tDataRowAlt}>
            <Text style={[S.tCell, { flex: 2, color: BRAND.slate600 }]}>{label}</Text>
            <Text style={[S.tCell, { flex: 3, color: isObos ? obosColor(ny.obosFlag) : BRAND.dark, fontFamily: isObos ? "Helvetica-Bold" : "Helvetica" }]}>{nyVal}</Text>
            <Text style={[S.tCell, { flex: 3, color: isObos ? obosColor(ldn.obosFlag) : BRAND.dark, fontFamily: isObos ? "Helvetica-Bold" : "Helvetica" }]}>{ldnVal}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Main document ─────────────────────────────────────────────────────────────

export function CotPdfReport({ d }: { d: ReportData }) {
  const ts = d.generatedAt.slice(0, 10);
  const header = `Week ${d.weekNumber}/${d.year} · ${d.cotDate}`;
  const totalPages = 4;

  return (
    <Document
      title={`COT Report — Week ${d.weekNumber}/${d.year}`}
      author="Coffee Intel Map"
      subject="Weekly Commitments of Traders"
    >

      {/* ── Page 1: Cover + Global Money Flow ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="GLOBAL MONEY FLOW" sub={header} />

        {/* Compact cover strip */}
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <Text style={{ fontSize: 15, fontFamily: "Helvetica-Bold", color: BRAND.dark }}>COT Weekly</Text>
          <Text style={{ fontSize: 8, color: BRAND.slate400 }}>Week {d.weekNumber}/{d.year} · As per positioning of {d.cotDate}</Text>
        </View>
        <View style={{ height: 1.5, backgroundColor: BRAND.amber, marginBottom: 5 }} />

        {/* KPIs */}
        <View style={[S.kpiRow, { marginBottom: 5 }]}>
          <KpiPill label="Total Gross" value={`$${d.globalFlow.totalGrossB.toFixed(1)}B`} sub={`${d.globalFlow.wowDeltaB >= 0 ? "+" : ""}${d.globalFlow.wowDeltaB.toFixed(1)}B WoW`} color={d.globalFlow.wowDeltaB >= 0 ? BRAND.green : BRAND.red} />
          <KpiPill label="Net Exposure" value={`$${d.globalFlow.netExpB.toFixed(1)}B`} />
          <KpiPill label="Softs Share" value={`${d.globalFlow.softSharePct.toFixed(1)}%`} />
          <KpiPill label="Coffee Share" value={`${d.globalFlow.coffeeSharePct.toFixed(1)}%`} sub={`${d.globalFlow.coffeeDeltaB >= 0 ? "+" : ""}${d.globalFlow.coffeeDeltaB.toFixed(1)}B WoW`} />
        </View>

        {/* Highlights — 2×2 grid (full width) */}
        <FlowAnalysis g={d.globalFlow} />

        {/* Commodity breakdown table — full width */}
        <Text style={[S.subTitle, { marginTop: 2, marginBottom: 3, fontSize: 7 }]}>COMMODITY BREAKDOWN — WEEK-ON-WEEK · 5Y RANGE BARS: GREEN=UNDERINVESTED · RED=OVERINVESTED</Text>
        <CommodityTable g={d.globalFlow} />

        <PageFooter page={1} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 2: Global Flow Charts ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="GLOBAL MONEY FLOW — CHARTS" sub={header} />

        <ChartBlock compact
          title="TOTAL GROSS MM EXPOSURE BY SECTOR (USD bn)"
          src={d.charts.macroGross}
          comment="Stacked area chart showing total speculative gross exposure across all commodity sectors. Tracks cumulative MM long + short capital deployed over time."
        />
        <ChartBlock compact
          title="NET MM EXPOSURE BY SECTOR (USD bn)"
          src={d.charts.macroNet}
          comment="Net speculative positioning (longs minus shorts) stacked by sector. Positive = net long bias; negative = net short. Reflects directional conviction of Managed Money."
        />
        <ChartBlock compact
          title="NET MM EXPOSURE — SOFTS BY CONTRACT (USD bn)"
          src={d.charts.softsContract}
          comment="Net MM positioning broken down by individual soft commodity contract. Highlights relative positioning in Arabica, Robusta, Sugar, Cocoa, Cotton and OJ."
        />

        <PageFooter page={2} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 3: Coffee Combined Overview ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="COFFEE OVERVIEW" sub={header} />
        <Text style={S.sectionTitle}>Coffee — Combined NY + LDN</Text>

        {(() => {
          // Combined speculative net in USD ($M)
          const combinedNetUSD =
            (d.ny.mmLong  - d.ny.mmShort)  * NY_LOT_MT  * d.ny.price  * 22.046 / 1e6 +
            (d.ldn.mmLong - d.ldn.mmShort) * LDN_LOT_MT * d.ldn.price           / 1e6;
          const absM = Math.abs(combinedNetUSD);
          const netUSDStr = absM >= 1000
            ? `${combinedNetUSD >= 0 ? "+" : "-"}$${(absM / 1000).toFixed(1)}B`
            : `${combinedNetUSD >= 0 ? "+" : "-"}$${absM.toFixed(0)}M`;
          // Industry coverage: combined PMPU gross long (producers)
          const industryLongMT = (d.ny.producerMT + d.ldn.producerMT) / 1000;
          return (
            <View style={S.kpiRow}>
              <KpiPill label="NY OI Rank"  value={`${d.coffeeOverview.nyCombinedOiRank.toFixed(0)}th pctl`}  color={d.coffeeOverview.nyCombinedOiRank  > 75 ? BRAND.red : d.coffeeOverview.nyCombinedOiRank  < 25 ? BRAND.green : BRAND.white} />
              <KpiPill label="LDN OI Rank" value={`${d.coffeeOverview.ldnCombinedOiRank.toFixed(0)}th pctl`} color={d.coffeeOverview.ldnCombinedOiRank > 75 ? BRAND.red : d.coffeeOverview.ldnCombinedOiRank < 25 ? BRAND.green : BRAND.white} />
              <KpiPill label="Combined spec. net" value={netUSDStr} color={combinedNetUSD >= 0 ? BRAND.green : BRAND.red} />
              <KpiPill label="Industry coverage" value={`${industryLongMT.toFixed(0)}k MT`} />
            </View>
          );
        })()}

        {/* Counterparty mapping — replaces disagg tables */}
        <CounterpartyMapBlock ny={d.ny} ldn={d.ldn} />

        {/* Side-by-side comparison table */}
        <Text style={S.subTitle}>FULL BREAKDOWN — NY ARABICA vs LDN ROBUSTA</Text>
        <CoffeeComparisonTable ny={d.ny} ldn={d.ldn} />

        <Text style={{ fontSize: 7, color: BRAND.slate400, marginTop: 8 }}>
          → Deep-dive analysis per market on following page
        </Text>

        <PageFooter page={3} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 4: Deep Dive — NY Arabica (left) + LDN Robusta (right) ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="MARKET DEEP DIVE" sub={header} />
        <View style={[S.row, { gap: 14 }]}>
          <MarketColumn m={d.ny}  compact />
          <MarketColumn m={d.ldn} compact />
        </View>
        <PageFooter page={4} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 5: Disclaimer ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="DISCLAIMER" sub={header} />
        <Text style={S.disclaimerTitle}>Data Sources & Methodology</Text>
        <Text style={S.disclaimerText}>
          COT data sourced from the U.S. Commodity Futures Trading Commission (CFTC) disaggregated
          reports and ICE Europe equivalent filings. NY Arabica refers to Coffee C futures (ICE US).
          LDN Robusta refers to Robusta Coffee futures (ICE Europe). Data as of the COT report date
          (Tuesday close). Published weekly by CFTC, typically available the following Friday.
        </Text>
        <Text style={S.disclaimerTitle}>Definitions</Text>
        <Text style={S.disclaimerText}>
          MM (Managed Money): speculative fund participants.{"\n"}
          PMPU (Producer/Merchant/Processor/User): commercial participants hedging physical exposure.{"\n"}
          SD (Swap Dealers): financial intermediaries.{"\n"}
          OR (Other Reportables): other large reportable traders.{"\n"}
          NR (Non-Reportables): small traders below reporting threshold.{"\n"}
          Funds % maxed: current MM position as % of 10-year maximum.{"\n"}
          Front roll: annualised spread between M1 and M2 contract, sign convention: positive = backwardation (roll income).{"\n"}
          Coverage %: PMPU position normalised on 10-year min/max range. Price/OI rank: 5-year percentile.
        </Text>
        <Text style={S.disclaimerTitle}>Disclaimer</Text>
        <Text style={S.disclaimerText}>
          This report is generated automatically from public data for informational purposes only.
          It does not constitute investment advice. Past positioning is not indicative of future
          price movements. Coffee Intel Map and its contributors accept no liability for decisions
          made based on this report.
        </Text>
        <Text style={[S.disclaimerText, { marginTop: 16, color: BRAND.slate400 }]}>
          Generated: {d.generatedAt} · Coffee Intel Map
        </Text>
        <PageFooter page={4} total={totalPages} date={ts} />
      </Page>

    </Document>
  );
}
