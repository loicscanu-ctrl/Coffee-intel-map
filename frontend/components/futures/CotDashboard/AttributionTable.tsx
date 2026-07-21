"use client";
import React from "react";
import { fmtAttr } from "@/lib/formatters";
import type { GlobalFlowMetrics } from "@/lib/pdf/types";
import { SECTOR_LABELS_ATTR, SECTOR_ORDER_ATTR } from "./constants";

function attrColor(n: number | null): string {
  if (n == null) return "#6b7280";
  return n >= 0 ? "#10b981" : "#ef4444";
}

// Adaptive price formatting — macro prices span $0.03 (corn/lb) to $4,000+ (gold/oz).
function fmtPx(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return v.toFixed(0);
  if (v >= 100)  return v.toFixed(1);
  if (v >= 10)   return v.toFixed(2);
  if (v >= 1)    return v.toFixed(3);
  return v.toFixed(4);
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtKLots(v: number): string {
  return v > 0 ? `${(v / 1000).toFixed(1)}k` : "—";
}

const OUTLIER_HINT =
  "Price moved >±50% vs the previous week — the signature of a corrupt feed " +
  "batch rather than a real market move. Verify the source before trusting " +
  "this row's exposure.";

export default function AttributionTable({ gfm }: { gfm: GlobalFlowMetrics }) {
  // Sort commodity rows: by sector order, then by absolute deltaB descending within sector
  const sortedRows = [...gfm.commodityTable].sort((a, b) => {
    const ai = SECTOR_ORDER_ATTR.indexOf(a.displaySector as (typeof SECTOR_ORDER_ATTR)[number]);
    const bi = SECTOR_ORDER_ATTR.indexOf(b.displaySector as (typeof SECTOR_ORDER_ATTR)[number]);
    if (ai !== bi) return ai - bi;
    return Math.abs(b.deltaB) - Math.abs(a.deltaB);
  });

  const headerCell = (align: "left" | "right" = "right"): React.CSSProperties => ({
    padding: "4px 8px", fontSize: 10, color: "#9ca3af", fontWeight: 600,
    textAlign: align, borderBottom: "1px solid #374151", whiteSpace: "nowrap",
  });
  const dataCell = (color: string, bold = false): React.CSSProperties => ({
    padding: "3px 8px", fontSize: 10, color, textAlign: "right",
    fontWeight: bold ? 700 : 400, fontFamily: "monospace",
  });
  const nameCell = (bold = false, color = "#e5e7eb"): React.CSSProperties => ({
    padding: "3px 8px 3px 16px", fontSize: 10, color, fontWeight: bold ? 700 : 400,
    textAlign: "left",
  });

  const grouped = SECTOR_ORDER_ATTR.map(sector => ({
    sector,
    label: SECTOR_LABELS_ATTR[sector],
    sd: gfm.sectorBreakdown.find(s => s.sector === sector) ?? null,
    rows: sortedRows.filter(r => r.displaySector === sector),
  })).filter(g => g.rows.length > 0);

  const dLbl = gfm.windowWeeks === 1 ? "WoW" : `Δ${gfm.windowWeeks}W`;
  const outliers = sortedRows.filter(r => r.priceOutlier);

  return (
    <div style={{ overflowX: "auto", marginTop: 4 }}>
      <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>
        Δ columns compare {gfm.date} vs {gfm.prevDate} ({gfm.windowWeeks}W window).
        {" "}Px = close price (USD, scraper-normalized units) · OI = total open interest (all participants).
      </div>
      {outliers.length > 0 && (
        <div style={{
          fontSize: 10, color: "#fbbf24", marginBottom: 6, padding: "4px 8px",
          background: "rgba(146,64,14,0.15)", border: "1px solid rgba(146,64,14,0.5)", borderRadius: 4,
        }}>
          ⚠ Possible price-feed outlier{outliers.length > 1 ? "s" : ""}:{" "}
          {outliers.map(o => o.name).join(", ")} — weekly price move &gt;±50%; verify before trusting exposure.
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ background: "#0f172a" }}>
            <th style={headerCell("left")}>Commodity</th>
            <th style={headerCell()}>Px</th>
            <th style={headerCell()}>Px {dLbl}</th>
            <th style={headerCell()}>OI kLots</th>
            <th style={headerCell()}>OI {dLbl}</th>
            <th style={headerCell()}>Gross $B</th>
            <th style={headerCell()}>Gross {dLbl} $B</th>
            <th style={headerCell()}>OI Δ</th>
            <th style={headerCell()}>Px Δ</th>
            <th style={headerCell()}>Net $B</th>
            <th style={headerCell()}>Net {dLbl} $B</th>
            <th style={headerCell()}>OI Δ</th>
            <th style={headerCell()}>Px Δ</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ sector, label, sd, rows: sectorRows }) => (
            <React.Fragment key={sector}>
              {sd && (
                <tr style={{ background: "#1e293b" }}>
                  <td style={{ ...nameCell(true, "#f9fafb"), paddingLeft: 8 }}>{label}</td>
                  {/* Px / OI are per-contract quantities — meaningless summed per sector */}
                  <td style={dataCell("#4b5563", true)} colSpan={4} />
                  <td style={dataCell(attrColor(sd.grossB), true)}>{fmtAttr(sd.grossB)}</td>
                  <td style={dataCell(attrColor(sd.deltaB), true)}>{fmtAttr(sd.deltaB)}</td>
                  <td style={dataCell(attrColor(sd.grossOiEffectB), true)}>{fmtAttr(sd.grossOiEffectB)}</td>
                  <td style={dataCell(attrColor(sd.grossPriceEffectB), true)}>{fmtAttr(sd.grossPriceEffectB)}</td>
                  <td style={dataCell(attrColor(sd.netB), true)}>{fmtAttr(sd.netB)}</td>
                  <td style={dataCell(attrColor(sd.netDeltaB), true)}>{fmtAttr(sd.netDeltaB)}</td>
                  <td style={dataCell(attrColor(sd.netOiEffectB), true)}>{fmtAttr(sd.netOiEffectB)}</td>
                  <td style={dataCell(attrColor(sd.netPriceEffectB), true)}>{fmtAttr(sd.netPriceEffectB)}</td>
                </tr>
              )}
              {sectorRows.map((row, idx) => (
                <tr key={row.symbol} style={{ background: idx % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={nameCell(row.isCoffee, row.isCoffee ? "#f59e0b" : "#d1d5db")}>
                    {row.isCoffee ? "► " : ""}{row.name}
                    {row.priceOutlier && (
                      <span title={OUTLIER_HINT} style={{ color: "#fbbf24", marginLeft: 4, cursor: "help" }}>⚠</span>
                    )}
                  </td>
                  <td style={dataCell(row.priceOutlier ? "#fbbf24" : "#d1d5db")}>{fmtPx(row.closePrice)}</td>
                  <td style={dataCell(row.priceOutlier ? "#fbbf24" : attrColor(row.priceDeltaPct))}>
                    {fmtPct(row.priceDeltaPct)}
                  </td>
                  <td style={dataCell("#d1d5db")}>{fmtKLots(row.oiTotal)}</td>
                  <td style={dataCell(attrColor(row.oiDeltaPct))}>{fmtPct(row.oiDeltaPct)}</td>
                  <td style={dataCell(attrColor(row.grossB))}>{fmtAttr(row.grossB)}</td>
                  <td style={dataCell(attrColor(row.deltaB))}>{fmtAttr(row.deltaB)}</td>
                  <td style={dataCell(attrColor(row.grossOiEffectB))}>{fmtAttr(row.grossOiEffectB)}</td>
                  <td style={dataCell(attrColor(row.grossPriceEffectB))}>{fmtAttr(row.grossPriceEffectB)}</td>
                  <td style={dataCell(attrColor(row.netB))}>{fmtAttr(row.netB)}</td>
                  <td style={dataCell(attrColor(row.netDeltaB))}>{fmtAttr(row.netDeltaB)}</td>
                  <td style={dataCell(attrColor(row.netOiEffectB))}>{fmtAttr(row.netOiEffectB)}</td>
                  <td style={dataCell(attrColor(row.netPriceEffectB))}>{fmtAttr(row.netPriceEffectB)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
