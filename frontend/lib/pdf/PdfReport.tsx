// frontend/lib/pdf/PdfReport.tsx
// NOTE: This file must only be imported via dynamic import() — never in SSR context.
import React from "react";
import {
  Document, Page, View, Text, Image,
} from "@react-pdf/renderer";
import { S, BRAND } from "./pdfStyles";
import type { ReportData, MarketMetrics } from "./types";
import {
  marketOverviewComment, industryCoverageComment,
  mmPositioningComment, obosComment,
  structuralComment, counterpartyComment,
  industryPulseComment, dryPowderComment,
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

function MetricRow({ label, value, flag, extraStyle }: { label: string; value: string; flag?: "red" | "green" | "amber"; extraStyle?: object }) {
  const valStyle = flag === "red" ? S.flagRed : flag === "green" ? S.flagGreen : flag === "amber" ? S.flagAmber : S.metricValue;
  const rowStyle = extraStyle ? [S.metricRow, extraStyle] : S.metricRow;
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
  const s  = (n: number, dec = 1) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(dec);
  const kl = (n: number) => `${s(n / 1000)}k lots`;

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
      <MetricRow label="Total OI change"    value={kl(m.oiChangeLots)}   extraStyle={mrStyle} />
      <MetricRow label="Nearby (M1+M2)"     value={kl(m.oiChangeNearby)} extraStyle={mrStyle} />
      <MetricRow label="Forward (M3+)"      value={kl(m.oiChangeForward)} extraStyle={mrStyle} />
      <MetricRow label="Price change"       value={`${s(m.priceChangePct)}% (${s(m.priceChangeAbs, 1)} ${m.priceUnit})`} extraStyle={mrStyle} />
      <MetricRow
        label="Front structure"
        value={`${m.structureType} · ${s(m.annualizedRollPct)}% ann.`}
        flag={m.structureType === "backwardation" && m.annualizedRollPct > 4.1 ? "green" : "amber"}
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

function ChartBlock({ title, src, comment }: { title: string; src: string | null; comment: string }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={S.subTitle}>{title}</Text>
      {src
        ? <Image style={S.chartImg} src={src} />
        : <View style={{ height: 80, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 8, color: "#94a3b8" }}>Chart unavailable</Text>
          </View>
      }
      <CommentBox text={comment} />
    </View>
  );
}

// ── Lot-size constants ────────────────────────────────────────────────────────
const NY_LOT_MT  = 17.009; // 37,500 lbs → MT
const LDN_LOT_MT = 10.0;   // 10 MT / lot

// ── Bullet helpers ────────────────────────────────────────────────────────────
function Bullet({ text }: { text: string }) {
  return (
    <View style={S.bulletRow}>
      <Text style={S.bulletDot}>•</Text>
      <Text style={S.bulletText}>{text}</Text>
    </View>
  );
}
// ── Page 1: Commodity breakdown table (all commodities, grouped by sector) ────
const SECTOR_LABELS: Record<string, string> = {
  energy: "Energy", metals: "Metals", grains: "Grains",
  meats: "Meats", softs: "Softs", micros: "Micros",
};
const SECTOR_ORDER = ["energy", "metals", "grains", "meats", "softs", "micros"];

function RankBars({ grossRank, netRank, shareRank }: { grossRank: number; netRank: number; shareRank: number }) {
  const bar = (rank: number) => {
    const pct = Math.max(0, Math.min(100, rank));
    const color = pct > 75 ? "#dc2626" : pct < 25 ? "#059669" : "#d97706";
    return (
      <View style={{ width: "100%", height: 2, backgroundColor: "#e2e8f0", borderRadius: 1, marginBottom: 1 }}>
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: 1 }} />
      </View>
    );
  };
  return (
    <View style={{ flex: 0.4, justifyContent: "center", paddingHorizontal: 2, paddingVertical: 2 }}>
      {bar(grossRank)}
      {bar(netRank)}
      {bar(shareRank)}
    </View>
  );
}

function CommodityTable({ g }: { g: GlobalFlowMetrics }) {
  const fB   = (n: number) => `$${Math.abs(n).toFixed(2)}B`;
  const dB   = (n: number) => `${n >= 0 ? "+" : "−"}${fB(n)}`;
  const dPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
  const dPp  = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}pp`;

  // Column flex values: name | gross | net | Δ | Δ% | share | Δshare | bars(G/N/S)
  const C = [1.8, 1.1, 1.0, 1.2, 0.7, 0.85, 0.8, 0.4];

  const hdrCell  = (flex: number) => [S.tHCellR, { flex }];
  const hdrCellL = (flex: number) => [S.tHCell,  { flex }];

  // Sector header row
  function SectorRow({ sd }: { sd: (typeof g.sectorBreakdown)[0] }) {
    return (
      <View style={{ flexDirection: "row", paddingVertical: 2, paddingHorizontal: 6, backgroundColor: "#1e293b", borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
        <Text style={[S.tHCell, { flex: C[0], textTransform: "capitalize" }]}>{SECTOR_LABELS[sd.sector]}</Text>
        <Text style={[S.tHCellR, { flex: C[1], fontSize: 6.5 }]}>{fB(sd.grossB)}</Text>
        <Text style={[sd.netB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[2], fontSize: 6.5, textAlign: "right", fontFamily: "Helvetica-Bold" }]}>{sd.netB >= 0 ? "+" : "−"}{fB(sd.netB)}</Text>
        <Text style={[sd.deltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[3], fontSize: 6.5, fontFamily: "Helvetica-Bold" }]}>{dB(sd.deltaB)}</Text>
        <Text style={[sd.deltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[4], fontSize: 6.5, fontFamily: "Helvetica-Bold" }]}>{dPct(sd.deltaPct)}</Text>
        <Text style={[S.tHCellR, { flex: C[5], fontSize: 6.5 }]}>{sd.shareOfTotalPct.toFixed(1)}%</Text>
        <Text style={[sd.shareDeltaPp >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[6], fontSize: 6.5, fontFamily: "Helvetica-Bold" }]}>{dPp(sd.shareDeltaPp)}</Text>
        <RankBars grossRank={sd.histRankGrossPct} netRank={sd.histRankNetPct} shareRank={sd.histRankSharePct} />
      </View>
    );
  }

  // Commodity row
  function CommodityRow_({ row, i }: { row: import("@/lib/pdf/types").CommodityRow; i: number }) {
    const bg = row.isCoffee ? "#fffbeb" : i % 2 === 0 ? "transparent" : "#f8fafc";
    const nameStyle = row.isCoffee
      ? [S.tCell, { flex: C[0], color: BRAND.amber, fontSize: 6.5, paddingLeft: 10 }]
      : [S.tCell, { flex: C[0], fontSize: 6.5, paddingLeft: 10 }];
    return (
      <View style={{ flexDirection: "row", paddingVertical: 1, paddingHorizontal: 6, backgroundColor: bg, borderBottomWidth: 0.3, borderBottomColor: "#e2e8f0" }}>
        <Text style={nameStyle}>{row.isCoffee ? "► " : ""}{row.name}</Text>
        <Text style={[S.tCellR, { flex: C[1], fontSize: 6.5 }]}>{fB(row.grossB)}</Text>
        <Text style={[row.netB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[2], fontSize: 6.5, textAlign: "right" }]}>{row.netB >= 0 ? "+" : "−"}{fB(row.netB)}</Text>
        <Text style={[row.deltaB >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[3], fontSize: 6.5 }]}>{dB(row.deltaB)}</Text>
        <Text style={[row.deltaPct >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[4], fontSize: 6.5 }]}>{dPct(row.deltaPct)}</Text>
        <Text style={[S.tCellR, { flex: C[5], fontSize: 6.5 }]}>{row.shareOfTotalPct.toFixed(1)}%</Text>
        <Text style={[row.shareDeltaPp >= 0 ? S.tCellPos : S.tCellNeg, { flex: C[6], fontSize: 6.5 }]}>{dPp(row.shareDeltaPp)}</Text>
        <RankBars grossRank={row.histRankGrossPct} netRank={row.histRankNetPct} shareRank={row.histRankSharePct} />
      </View>
    );
  }

  return (
    <View style={S.tableWrap}>
      {/* Table header */}
      <View style={[S.tHeadRow, { paddingVertical: 3 }]}>
        <Text style={hdrCellL(C[0])}>COMMODITY</Text>
        <Text style={hdrCell(C[1])}>GROSS $B</Text>
        <Text style={hdrCell(C[2])}>NET $B</Text>
        <Text style={hdrCell(C[3])}>WoW Δ</Text>
        <Text style={hdrCell(C[4])}>Δ %</Text>
        <Text style={hdrCell(C[5])}>SHARE %</Text>
        <Text style={hdrCell(C[6])}>Δ SHR</Text>
        <View style={{ flex: C[7], alignItems: "center" }}>
          <Text style={{ fontSize: 5, color: "#94a3b8", textAlign: "center" }}>5Y{"\n"}G/N/S</Text>
        </View>
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
      <View style={S.tTotalRow}>
        <Text style={[S.tHCell, { flex: C[0] }]}>TOTAL</Text>
        <Text style={[S.tHCellR, { flex: C[1] + C[2], fontSize: 6.5 }]}>${g.totalGrossB.toFixed(1)}B gross · ${g.netExpB.toFixed(1)}B net</Text>
        <Text style={[S.tHCellR, { flex: C[3], color: g.wowDeltaB >= 0 ? BRAND.green : BRAND.red, fontSize: 6.5 }]}>{g.wowDeltaB >= 0 ? "+" : "−"}${Math.abs(g.wowDeltaB).toFixed(2)}B</Text>
        <Text style={[S.tHCellR, { flex: C[4] + C[5] + C[6] + C[7], fontSize: 6.5 }]}>100% share</Text>
      </View>
    </View>
  );
}

// ── Page 1: Highlights with colored number spans ──────────────────────────────
function FlowAnalysis({ g }: { g: GlobalFlowMetrics }) {
  const G    = "#065f46";  // dark green
  const R    = "#7f1d1d";  // dark red
  const BOLD = "Helvetica-Bold";

  const cn  = (n: number): object => ({ color: n >= 0 ? G : R, fontFamily: BOLD });
  const fAbs = (n: number, dec = 2) => `$${Math.abs(n).toFixed(dec)}B`;
  const fPct = (n: number, dec = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(dec)}%`;
  const fPp  = (n: number)          => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}pp`;
  const fD   = (n: number, dec = 2) => `${n >= 0 ? "+" : "−"}${fAbs(n, dec)}`;

  const prevTotalB  = g.totalGrossB - g.wowDeltaB;
  const totalWoWPct = prevTotalB > 0 ? (g.wowDeltaB / prevTotalB) * 100 : 0;
  const prevNetB    = g.netExpB - g.wowDeltaNetB;
  const netWoWPct   = prevNetB !== 0 ? (g.wowDeltaNetB / Math.abs(prevNetB)) * 100 : 0;
  const softs       = g.sectorBreakdown.find(s => s.sector === "softs");
  const coffeePrevB = g.coffeeGrossB - g.coffeeDeltaB;
  const coffeePct   = coffeePrevB > 0 ? (g.coffeeDeltaB / coffeePrevB) * 100 : 0;
  const coffeePrevTotalB = g.totalGrossB - g.wowDeltaB;
  const coffeePrevShare  = coffeePrevTotalB > 0 ? ((g.coffeeGrossB - g.coffeeDeltaB) / coffeePrevTotalB) * 100 : 0;
  const coffeeShareDelta = g.coffeeSharePct - coffeePrevShare;
  const coffeeAsPctSofts = g.softsGrossB > 0 ? (g.coffeeGrossB / g.softsGrossB) * 100 : 0;
  const biggestSd = g.sectorBreakdown.find(s => s.sector === g.biggestMoverSector);
  const nyRow  = g.commodityTable.find(c => c.symbol === "arabica");
  const ldnRow = g.commodityTable.find(c => c.symbol === "robusta");
  const dir    = g.wowDeltaB >= 0 ? "expanded" : "contracted";

  return (
    <View style={[S.commentBox, { marginTop: 6 }]}>
      <Text style={[S.commentText, { fontFamily: BOLD, color: BRAND.dark, marginBottom: 4, fontSize: 8 }]}>HIGHLIGHTS</Text>

      {/* Bullet 1 — total gross */}
      <View style={S.bulletRow}>
        <Text style={S.bulletDot}>•</Text>
        <Text style={S.bulletText}>
          Speculative gross exposure {dir} by{" "}
          <Text style={cn(g.wowDeltaB)}>{fD(g.wowDeltaB)}</Text>{" "}
          (<Text style={cn(totalWoWPct)}>{fPct(totalWoWPct)}</Text>
          ) to <Text style={{ fontFamily: BOLD }}>${g.totalGrossB.toFixed(1)}B</Text> this week.
        </Text>
      </View>
      <View style={S.bulletSubRow}>
        <Text style={S.bulletSubDot}>*</Text>
        <Text style={S.bulletSubText}>
          Net exposure at <Text style={{ fontFamily: BOLD }}>${g.netExpB.toFixed(1)}B</Text>{" "}
          (<Text style={cn(g.wowDeltaNetB)}>{fD(g.wowDeltaNetB)}</Text> /{" "}
          <Text style={cn(netWoWPct)}>{fPct(netWoWPct)}</Text>)
        </Text>
      </View>
      <View style={S.bulletSubRow}>
        <Text style={S.bulletSubDot}>→</Text>
        <Text style={S.bulletSubText}>
          Biggest mover: {SECTOR_LABELS[g.biggestMoverSector] ?? g.biggestMoverSector}{" "}
          <Text style={cn(g.biggestMoverDeltaB)}>{fD(g.biggestMoverDeltaB)}</Text>{" "}
          (<Text style={cn(biggestSd?.deltaPct ?? 0)}>{fPct(biggestSd?.deltaPct ?? 0)}</Text>)
        </Text>
      </View>

      {/* Bullet 2 — softs */}
      <View style={S.bulletRow}>
        <Text style={S.bulletDot}>•</Text>
        <Text style={S.bulletText}>
          Softs sector share at <Text style={{ fontFamily: BOLD }}>{softs?.shareOfTotalPct.toFixed(1) ?? "—"}%</Text> of total gross{" "}
          (<Text style={cn(softs?.shareDeltaPp ?? 0)}>{fPp(softs?.shareDeltaPp ?? 0)}</Text>)
        </Text>
      </View>

      {/* Bullet 3 — coffee */}
      <View style={S.bulletRow}>
        <Text style={S.bulletDot}>•</Text>
        <Text style={S.bulletText}>
          Coffee (Arabica + Robusta) {g.coffeeDeltaB >= 0 ? "rose" : "fell"} by{" "}
          <Text style={cn(g.coffeeDeltaB)}>{fD(g.coffeeDeltaB)}</Text>{" "}
          (<Text style={cn(coffeePct)}>{fPct(coffeePct)}</Text>
          ), now <Text style={{ fontFamily: BOLD }}>${g.coffeeGrossB.toFixed(2)}B</Text>
        </Text>
      </View>
      <View style={S.bulletSubRow}>
        <Text style={S.bulletSubDot}>→</Text>
        <Text style={S.bulletSubText}>
          <Text style={cn(coffeeShareDelta)}>{g.coffeeSharePct.toFixed(2)}%</Text> of total speculative gross{" "}
          (<Text style={cn(coffeeShareDelta)}>{fPp(coffeeShareDelta)}</Text> WoW)
        </Text>
      </View>
      <View style={S.bulletSubRow}>
        <Text style={S.bulletSubDot}>→</Text>
        <Text style={S.bulletSubText}>
          <Text style={{ fontFamily: BOLD }}>{coffeeAsPctSofts.toFixed(1)}%</Text> of total soft complex
        </Text>
      </View>
      <View style={S.bulletSubRow}>
        <Text style={S.bulletSubDot}>*</Text>
        <Text style={S.bulletSubText}>Details of coffee speculative exposure evolution:</Text>
      </View>
      {nyRow && (
        <View style={[S.bulletSubRow, { marginLeft: 22 }]}>
          <Text style={S.bulletSubDot}>→</Text>
          <Text style={S.bulletSubText}>
            NY Arabica{" "}
            <Text style={cn(nyRow.deltaB)}>{fD(nyRow.deltaB)}</Text>{" "}
            (<Text style={cn(nyRow.deltaPct)}>{fPct(nyRow.deltaPct)}</Text>)
          </Text>
        </View>
      )}
      {ldnRow && (
        <View style={[S.bulletSubRow, { marginLeft: 22 }]}>
          <Text style={S.bulletSubDot}>→</Text>
          <Text style={S.bulletSubText}>
            LDN Robusta{" "}
            <Text style={cn(ldnRow.deltaB)}>{fD(ldnRow.deltaB)}</Text>{" "}
            (<Text style={cn(ldnRow.deltaPct)}>{fPct(ldnRow.deltaPct)}</Text>)
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Page 2: Coffee combined flow summary ──────────────────────────────────────
function CoffeeFlowSummary({ ny, ldn }: { ny: MarketMetrics; ldn: MarketMetrics }) {
  const nyMmNetLots  = ny.mmLongChangeLots  - ny.mmShortChangeLots;
  const ldnMmNetLots = ldn.mmLongChangeLots - ldn.mmShortChangeLots;
  const nyMmNetMT    = nyMmNetLots  * NY_LOT_MT;
  const ldnMmNetMT   = ldnMmNetLots * LDN_LOT_MT;
  const combinedMmMT = nyMmNetMT + ldnMmNetMT;

  // USD notional: NY ¢/lb × 22.046 = $/MT; LDN already $/MT
  const nyMmUSD  = (nyMmNetMT  * ny.price  * 22.046) / 1e6;  // $M
  const ldnMmUSD = (ldnMmNetMT * ldn.price)          / 1e6;  // $M
  const combUSD  = nyMmUSD + ldnMmUSD;

  // PMPU (producer hedge change, already in MT)
  const nyPmpuMT   = ny.producerMTWoW;
  const ldnPmpuMT  = ldn.producerMTWoW;
  const combPmpuMT = nyPmpuMT + ldnPmpuMT;

  const s    = (n: number) => n >= 0 ? "+" : "−";
  const fMT  = (mt: number) => `${s(mt)}${(Math.abs(mt)/1000).toFixed(1)}k MT`;
  const fUSD = (m:  number) => `${s(m)}$${Math.abs(m).toFixed(1)}M`;
  const fL   = (l:  number) => `${s(l)}${(Math.abs(l)/1000).toFixed(1)}k lots`;

  const aligned  = (ny.mmLong - ny.mmShort > 0) === (ldn.mmLong - ldn.mmShort > 0);
  const nyDir    = ny.mmLong  - ny.mmShort  > 0 ? "net long" : "net short";
  const ldnDir   = ldn.mmLong - ldn.mmShort > 0 ? "net long" : "net short";

  return (
    <View style={S.commentBox}>
      <Text style={[S.commentSignal, { marginBottom: 6 }]}>
        Both coffee contracts — MM net position {combinedMmMT >= 0 ? "increased" : "decreased"} by {(Math.abs(combinedMmMT)/1000).toFixed(1)}k MT equiv. ({fUSD(combUSD)}) combined
      </Text>
      <Bullet text={`MM net change: NY ${fL(nyMmNetLots)} (${fMT(nyMmNetMT)}, ${fUSD(nyMmUSD)}) · LDN ${fL(ldnMmNetLots)} (${fMT(ldnMmNetMT)}, ${fUSD(ldnMmUSD)})`} />
      <Bullet text={`Producer hedging (PMPU long Δ): NY ${fMT(nyPmpuMT)} · LDN ${fMT(ldnPmpuMT)} = combined ${fMT(combPmpuMT)}`} />
      <Bullet text={
        aligned
          ? `Directional alignment: both contracts ${nyDir} — signals agree.`
          : `Directional divergence: NY is ${nyDir}, LDN is ${ldnDir} — signals split.`
      } />
    </View>
  );
}

// ── Page 2: Coffee comparison table ───────────────────────────────────────────
function CoffeeComparisonTable({ ny, ldn }: { ny: MarketMetrics; ldn: MarketMetrics }) {
  const s1 = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
  const kL = (n: number) => `${n >= 0 ? "+" : "−"}${(Math.abs(n)/1000).toFixed(1)}k lots`;

  type Row = [string, string, string, boolean?]; // [label, NY, LDN, isAlt]
  const rows: Row[] = [
    ["Price",            `${ny.price.toFixed(1)} ${ny.priceUnit}`,
                         `${ldn.price.toFixed(0)} ${ldn.priceUnit}`],
    ["WoW Δ price",      `${s1(ny.priceChangePct)}% (${s1(ny.priceChangeAbs)} ${ny.priceUnit})`,
                         `${s1(ldn.priceChangePct)}% (${s1(ldn.priceChangeAbs)} ${ldn.priceUnit})`],
    ["OI change WoW",    kL(ny.oiChangeLots),  kL(ldn.oiChangeLots)],
    ["  Nearby (M1–M2)", kL(ny.oiChangeNearby), kL(ldn.oiChangeNearby)],
    ["  Forward (M3+)",  kL(ny.oiChangeForward), kL(ldn.oiChangeForward)],
    ["Front structure",
      `${ny.structureType === "backwardation" ? "Backwardation" : "Carry"} · ${s1(ny.annualizedRollPct)}% ann.`,
      `${ldn.structureType === "backwardation" ? "Backwardation" : "Carry"} · ${s1(ldn.annualizedRollPct)}% ann.`],
    ["MM Net (lots)",    kL(ny.mmLong - ny.mmShort),  kL(ldn.mmLong - ldn.mmShort)],
    ["MM Longs",         `${(ny.mmLong/1000).toFixed(1)}k (${kL(ny.mmLongChangeLots)} WoW)`,
                         `${(ldn.mmLong/1000).toFixed(1)}k (${kL(ldn.mmLongChangeLots)} WoW)`],
    ["MM Shorts",        `${(ny.mmShort/1000).toFixed(1)}k (${kL(ny.mmShortChangeLots)} WoW)`,
                         `${(ldn.mmShort/1000).toFixed(1)}k (${kL(ldn.mmShortChangeLots)} WoW)`],
    ["Funds maxed (L)",  `${ny.fundsMaxedLongPct.toFixed(1)}%`,  `${ldn.fundsMaxedLongPct.toFixed(1)}%`],
    ["PMPU Prod cov.",
      `${ny.producerCovPct.toFixed(0)}% · ${(ny.producerMT/1000).toFixed(0)}k MT (${s1(ny.producerMTWoW/1000)}k WoW)`,
      `${ldn.producerCovPct.toFixed(0)}% · ${(ldn.producerMT/1000).toFixed(0)}k MT (${s1(ldn.producerMTWoW/1000)}k WoW)`],
    ["PMPU Roaster cov.",
      `${ny.roasterCovPct.toFixed(0)}% · ${(ny.roasterMT/1000).toFixed(0)}k MT`,
      `${ldn.roasterCovPct.toFixed(0)}% · ${(ldn.roasterMT/1000).toFixed(0)}k MT`],
    ["OB/OS flag",
      ny.obosFlag  === "overbought" ? "⚠ OVERBOUGHT"  : ny.obosFlag  === "oversold" ? "⚠ OVERSOLD"  : "Neutral",
      ldn.obosFlag === "overbought" ? "⚠ OVERBOUGHT" : ldn.obosFlag === "oversold" ? "⚠ OVERSOLD" : "Neutral"],
    ["Price / OI rank",  `${ny.priceRank.toFixed(0)}th / ${ny.oiRank.toFixed(0)}th pctl`,
                         `${ldn.priceRank.toFixed(0)}th / ${ldn.oiRank.toFixed(0)}th pctl`],
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
  const totalPages = 6;

  return (
    <Document
      title={`COT Report — Week ${d.weekNumber}/${d.year}`}
      author="Coffee Intel Map"
      subject="Weekly Commitments of Traders"
    >

      {/* ── Page 1: Cover + Global Money Flow ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="GLOBAL MONEY FLOW" sub={header} />

        {/* Cover block */}
        <View style={{ marginBottom: 8 }}>
          <Text style={[S.coverTitle, { fontSize: 18 }]}>COT Weekly</Text>
          <Text style={S.coverWeek}>Week {d.weekNumber}/{d.year}</Text>
          <Text style={S.coverDate}>As per positioning of {d.cotDate}</Text>
          <View style={S.coverDivider} />
        </View>

        {/* KPIs */}
        <View style={[S.kpiRow, { marginBottom: 6 }]}>
          <KpiPill label="Total Gross" value={`$${d.globalFlow.totalGrossB.toFixed(1)}B`} sub={`${d.globalFlow.wowDeltaB >= 0 ? "+" : ""}${d.globalFlow.wowDeltaB.toFixed(1)}B WoW`} color={d.globalFlow.wowDeltaB >= 0 ? BRAND.green : BRAND.red} />
          <KpiPill label="Net Exposure" value={`$${d.globalFlow.netExpB.toFixed(1)}B`} />
          <KpiPill label="Softs Share" value={`${d.globalFlow.softSharePct.toFixed(1)}%`} />
          <KpiPill label="Coffee Share" value={`${d.globalFlow.coffeeSharePct.toFixed(1)}%`} sub={`${d.globalFlow.coffeeDeltaB >= 0 ? "+" : ""}${d.globalFlow.coffeeDeltaB.toFixed(1)}B WoW`} />
        </View>

        {/* Commodity breakdown table */}
        <Text style={[S.subTitle, { marginTop: 2, marginBottom: 4 }]}>COMMODITY BREAKDOWN — WEEK-ON-WEEK · 5Y RANGE BARS: GREEN=UNDERINVESTED · RED=OVERINVESTED</Text>
        <CommodityTable g={d.globalFlow} />

        {/* Highlights */}
        <FlowAnalysis g={d.globalFlow} />

        <PageFooter page={1} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 2: Coffee Combined Overview ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="COFFEE OVERVIEW" sub={header} />
        <Text style={S.sectionTitle}>Coffee — Combined NY + LDN</Text>

        <View style={S.kpiRow}>
          <KpiPill label="NY OI Rank"  value={`${d.coffeeOverview.nyCombinedOiRank.toFixed(0)}th pctl`}  color={d.coffeeOverview.nyCombinedOiRank  > 75 ? BRAND.red : d.coffeeOverview.nyCombinedOiRank  < 25 ? BRAND.green : BRAND.white} />
          <KpiPill label="LDN OI Rank" value={`${d.coffeeOverview.ldnCombinedOiRank.toFixed(0)}th pctl`} color={d.coffeeOverview.ldnCombinedOiRank > 75 ? BRAND.red : d.coffeeOverview.ldnCombinedOiRank < 25 ? BRAND.green : BRAND.white} />
          <KpiPill label="Combined Net" value={`${(d.coffeeOverview.combinedNetLots / 1000).toFixed(1)}k lots`} color={d.coffeeOverview.combinedNetLots >= 0 ? BRAND.green : BRAND.red} />
          <KpiPill label="Alignment" value={d.coffeeOverview.alignedDirection ? "✓ Aligned" : "⚠ Diverging"} color={d.coffeeOverview.alignedDirection ? BRAND.green : BRAND.amber} />
        </View>

        {/* Combined flow summary with bullets */}
        <CoffeeFlowSummary ny={d.ny} ldn={d.ldn} />

        {/* Side-by-side comparison table */}
        <Text style={S.subTitle}>FULL BREAKDOWN — NY ARABICA vs LDN ROBUSTA</Text>
        <CoffeeComparisonTable ny={d.ny} ldn={d.ldn} />

        <Text style={{ fontSize: 7, color: BRAND.slate400, marginTop: 8 }}>
          → Deep-dive analysis per market on following pages
        </Text>

        <PageFooter page={2} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 3: Deep Dive — NY Arabica (left) + LDN Robusta (right) ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="MARKET DEEP DIVE" sub={header} />
        <View style={[S.row, { gap: 14 }]}>
          <MarketColumn m={d.ny}  compact />
          <MarketColumn m={d.ldn} compact />
        </View>
        <PageFooter page={3} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 4: Charts — Structural + Counterparty (cols), Industry Pulse (full) ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="MARKET STRUCTURE CHARTS" sub={header} />
        <View style={[S.row, { gap: 12 }]}>
          <View style={S.col}>
            <ChartBlock
              title="Structural Integrity — OI by Category"
              src={d.charts.structural}
              comment={structuralComment(d.ny, d.ldn)}
            />
          </View>
          <View style={S.col}>
            <ChartBlock
              title="Counterparty — Liquidity Handshake"
              src={d.charts.counterparty}
              comment={counterpartyComment(d.ny, d.ldn)}
            />
          </View>
        </View>
        <ChartBlock
          title="Industry Pulse — PMPU Gross Long & Short (NY + LDN)"
          src={d.charts.industryPulse}
          comment={industryPulseComment(d.ny, d.ldn)}
        />
        <PageFooter page={4} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 5: Positioning — Dry Powder (left) + OB/OS Matrix (right) ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="POSITIONING INDICATORS" sub={header} />
        <View style={[S.row, { gap: 12 }]}>
          <View style={S.col}>
            <ChartBlock
              title="Dry Powder Indicator"
              src={d.charts.dryPowder}
              comment={dryPowderComment(d.ny, d.ldn)}
            />
          </View>
          <View style={S.col}>
            <ChartBlock
              title="Cycle Location — OB/OS Matrix"
              src={d.charts.obosMatrix}
              comment={`NY: ${d.ny.obosFlag} (price ${d.ny.priceRank.toFixed(0)}th, OI ${d.ny.oiRank.toFixed(0)}th). LDN: ${d.ldn.obosFlag} (price ${d.ldn.priceRank.toFixed(0)}th, OI ${d.ldn.oiRank.toFixed(0)}th).`}
            />
          </View>
        </View>
        <PageFooter page={5} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 6: Disclaimer ── */}
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
          Funds % maxed: current MM position as % of 52-week maximum.{"\n"}
          Front roll: annualised spread between M1 and M2 contract, sign convention: positive = backwardation (roll income).{"\n"}
          Coverage %: PMPU position normalised on 52-week min/max range.
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
        <PageFooter page={6} total={totalPages} date={ts} />
      </Page>

    </Document>
  );
}
