// frontend/lib/pdf/PdfReport.tsx
// NOTE: This file must only be imported via dynamic import() — never in SSR context.
import React from "react";
import {
  Document, Page, View, Text, Image,
} from "@react-pdf/renderer";
import { S, BRAND } from "./pdfStyles";
import type { ReportData, MarketMetrics } from "./types";
import {
  globalFlowComment, coffeeOverviewComment,
  marketOverviewComment, industryCoverageComment,
  mmPositioningComment, obosComment,
  structuralComment, counterpartyComment,
  industryPulseComment, dryPowderComment,
} from "./comments";

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

function CommentBox({ text, isSignal = false }: { text: string; isSignal?: boolean }) {
  return (
    <View style={S.commentBox}>
      <Text style={isSignal ? S.commentSignal : S.commentText}>{text}</Text>
    </View>
  );
}

function MetricRow({ label, value, flag }: { label: string; value: string; flag?: "red" | "green" | "amber" }) {
  const style = flag === "red" ? S.flagRed : flag === "green" ? S.flagGreen : flag === "amber" ? S.flagAmber : S.metricValue;
  return (
    <View style={S.metricRow}>
      <Text style={S.metricLabel}>{label}</Text>
      <Text style={style}>{value}</Text>
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

function MarketColumn({ m }: { m: MarketMetrics }) {
  const s = (n: number, dec = 1) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(dec);
  const kl = (n: number) => `${s(n / 1000)}k lots`;

  return (
    <View style={S.col}>
      <Text style={S.sectionTitle}>{m.market}</Text>

      {/* Overview */}
      <Text style={S.subTitle}>OVERVIEW</Text>
      <MetricRow label="Total OI change"   value={kl(m.oiChangeLots)} />
      <MetricRow label="  → Nearby (M1+M2)" value={kl(m.oiChangeNearby)} />
      <MetricRow label="  → Forward (M3+)"  value={kl(m.oiChangeForward)} />
      <MetricRow label="Price change"       value={`${s(m.priceChangePct)}% (${s(m.priceChangeAbs, 1)} ${m.priceUnit})`} />
      <MetricRow
        label="Front structure"
        value={`${m.structureType} · roll ${s(m.annualizedRollPct)}% (RFR 4.1%)`}
        flag={m.structureType === "backwardation" && m.annualizedRollPct > 4.1 ? "green" : "amber"}
      />
      <CommentBox text={marketOverviewComment(m)} />

      {/* Industry */}
      <Text style={S.subTitle}>INDUSTRY COVERAGE</Text>
      <MetricRow label="Producers (PMPU Long)" value={`${m.producerCovPct.toFixed(1)}% · ${(m.producerMT/1000).toFixed(0)}k MT`} />
      <MetricRow label="  WoW"                  value={`${s(m.producerMTWoW/1000)}k MT`} />
      <MetricRow label="Roasters (PMPU Short)"  value={`${m.roasterCovPct.toFixed(1)}% · ${(m.roasterMT/1000).toFixed(0)}k MT`} />
      <MetricRow label="  WoW"                  value={`${s(m.roasterMTWoW/1000)}k MT`} />
      <CommentBox text={industryCoverageComment(m)} />

      {/* MM Positioning */}
      <Text style={S.subTitle}>MANAGED MONEY</Text>
      <MetricRow label="MM Longs"  value={`${(m.mmLong/1000).toFixed(1)}k (${s(m.mmLongChangeLots/1000)}k / ${s(m.mmLongChangePct)}%)`} />
      <MetricRow label="MM Shorts" value={`${(m.mmShort/1000).toFixed(1)}k (${s(m.mmShortChangeLots/1000)}k / ${s(m.mmShortChangePct)}%)`} />
      <MetricRow label="Funds maxed (longs)"  value={`${m.fundsMaxedLongPct.toFixed(1)}%`}  flag={m.fundsMaxedLongPct  > 80 ? "red" : undefined} />
      <MetricRow label="Funds maxed (shorts)" value={`${m.fundsMaxedShortPct.toFixed(1)}%`} flag={m.fundsMaxedShortPct > 80 ? "red" : undefined} />
      <CommentBox text={mmPositioningComment(m)} />

      {/* Risk flags */}
      <Text style={S.subTitle}>RISK FLAGS</Text>
      <MetricRow
        label="OB/OS"
        value={m.obosFlag === "overbought" ? "⚠ OVERBOUGHT" : m.obosFlag === "oversold" ? "⚠ OVERSOLD" : "Neutral"}
        flag={m.obosFlag !== "neutral" ? "red" : "green"}
      />
      <MetricRow label="  Price rank"  value={`${m.priceRank.toFixed(1)}th pctl`} />
      <MetricRow label="  OI rank"     value={`${m.oiRank.toFixed(1)}th pctl`} />
      <MetricRow
        label="Position mismatch"
        value={m.positionMismatch ? "⚠ YES" : "None"}
        flag={m.positionMismatch ? "red" : "green"}
      />
      <MetricRow
        label="MM concentration"
        value={`${m.mmConcentrationPct.toFixed(1)}% of OI`}
        flag={m.mmConcentrationPct > 40 ? "amber" : undefined}
      />
      <CommentBox text={obosComment(m)} isSignal />

      {/* Counterparty */}
      <Text style={S.subTitle}>COUNTERPARTY (WoW ΔLOTS)</Text>
      {(["pmpu","sd","mm","or","nr"] as const).map(cat => {
        const longV  = (m.cp.longs  as any)[cat] ?? 0;
        const shortV = (m.cp.shorts as any)[cat] ?? 0;
        if (longV === 0 && shortV === 0) return null;
        const labels: Record<string, string> = { pmpu: "PMPU", sd: "Swap Dealers", mm: "Managed Money", or: "Other Rep.", nr: "Non-Rep." };
        return (
          <MetricRow
            key={cat}
            label={labels[cat]}
            value={`L: ${s(longV/1000)}k  |  S: ${s(shortV/1000)}k`}
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

// ── Main document ─────────────────────────────────────────────────────────────

export function CotPdfReport({ d }: { d: ReportData }) {
  const ts = d.generatedAt.slice(0, 10);
  const header = `Week ${d.weekNumber}/${d.year} · ${d.cotDate}`;
  const totalPages = 7;

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
        <View style={{ marginBottom: 16 }}>
          <Text style={S.coverTitle}>COT Weekly</Text>
          <Text style={S.coverWeek}>Week {d.weekNumber}/{d.year}</Text>
          <Text style={S.coverDate}>As per positioning of {d.cotDate}</Text>
          <View style={S.coverDivider} />
        </View>

        {/* KPIs */}
        <View style={S.kpiRow}>
          <KpiPill label="Total Gross" value={`$${d.globalFlow.totalGrossB.toFixed(1)}B`} sub={`${d.globalFlow.wowDeltaB >= 0 ? "+" : ""}${d.globalFlow.wowDeltaB.toFixed(1)}B WoW`} color={d.globalFlow.wowDeltaB >= 0 ? BRAND.green : BRAND.red} />
          <KpiPill label="Net Exposure" value={`$${d.globalFlow.netExpB.toFixed(1)}B`} />
          <KpiPill label="Softs Share" value={`${d.globalFlow.softSharePct.toFixed(1)}%`} />
          <KpiPill label="Coffee Share" value={`${d.globalFlow.coffeeSharePct.toFixed(1)}%`} sub={`${d.globalFlow.coffeeDeltaB >= 0 ? "+" : ""}${d.globalFlow.coffeeDeltaB.toFixed(1)}B WoW`} />
        </View>

        {/* Chart */}
        {d.charts.globalFlow && <Image style={S.chartImg} src={d.charts.globalFlow} />}

        {/* Comments */}
        <CommentBox text={globalFlowComment(d.globalFlow)} />

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

        <CommentBox text={coffeeOverviewComment(d.ny, d.ldn)} isSignal />

        {/* Preview rows for each market */}
        <View style={[S.row, { marginTop: 12 }]}>
          {[d.ny, d.ldn].map(m => (
            <View key={m.market} style={S.col}>
              <Text style={S.sectionTitle}>{m.market}</Text>
              <MetricRow label="OI change"      value={`${(m.oiChangeLots >= 0 ? "+" : "−")}${Math.abs(m.oiChangeLots/1000).toFixed(1)}k lots`} />
              <MetricRow label="Price change"   value={`${m.priceChangePct >= 0 ? "+" : "−"}${Math.abs(m.priceChangePct).toFixed(1)}%`} />
              <MetricRow label="Front structure" value={m.structureType} flag={m.structureType === "backwardation" ? "green" : "amber"} />
              <MetricRow label="MM net"          value={`${((m.mmLong - m.mmShort) >= 0 ? "+" : "−")}${Math.abs((m.mmLong - m.mmShort)/1000).toFixed(1)}k lots`} />
              <MetricRow label="OB/OS"           value={m.obosFlag} flag={m.obosFlag === "overbought" ? "red" : m.obosFlag === "oversold" ? "green" : undefined} />
            </View>
          ))}
        </View>

        <Text style={{ fontSize: 7, color: BRAND.slate400, marginTop: 12 }}>
          → Full breakdown on following pages
        </Text>

        <PageFooter page={2} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 3: Arabica (NY) Deep Dive ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="NY ARABICA" sub={header} />
        <MarketColumn m={d.ny} />
        <PageFooter page={3} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 4: Robusta (LDN) Deep Dive ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="LDN ROBUSTA" sub={header} />
        <MarketColumn m={d.ldn} />
        <PageFooter page={4} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 5: Charts — Structural, Counterparty, Industry ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="MARKET STRUCTURE CHARTS" sub={header} />
        <ChartBlock
          title="Structural Integrity — OI Composition by Category"
          src={d.charts.structural}
          comment={structuralComment(d.ny, d.ldn)}
        />
        <ChartBlock
          title="Counterparty Mapping — Liquidity Handshake"
          src={d.charts.counterparty}
          comment={counterpartyComment(d.ny, d.ldn)}
        />
        <ChartBlock
          title="Industry Pulse — PMPU Gross Long & Short"
          src={d.charts.industryPulse}
          comment={industryPulseComment(d.ny, d.ldn)}
        />
        <PageFooter page={5} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 6: Charts — Dry Powder, OB/OS ── */}
      <Page size="A4" style={S.page}>
        <PageHeader title="POSITIONING INDICATORS" sub={header} />
        <View style={S.row}>
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
        <PageFooter page={6} total={totalPages} date={ts} />
      </Page>

      {/* ── Page 7: Disclaimer ── */}
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
        <PageFooter page={7} total={totalPages} date={ts} />
      </Page>

    </Document>
  );
}
