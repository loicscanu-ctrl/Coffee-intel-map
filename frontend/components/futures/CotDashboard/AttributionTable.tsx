"use client";
import React from "react";
import type { GlobalFlowMetrics } from "@/lib/pdf/types";
import { SECTOR_LABELS_ATTR, SECTOR_ORDER_ATTR } from "./constants";

function fmtAttr(n: number | null): string {
  if (n == null) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "B";
}
function attrColor(n: number | null): string {
  if (n == null) return "#6b7280";
  return n >= 0 ? "#10b981" : "#ef4444";
}

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

  return (
    <div style={{ overflowX: "auto", marginTop: 4 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ background: "#0f172a" }}>
            <th style={headerCell("left")}>Commodity</th>
            <th style={headerCell()}>Gross $B</th>
            <th style={headerCell()}>Gross WoW $B</th>
            <th style={headerCell()}>OI Δ</th>
            <th style={headerCell()}>Px Δ</th>
            <th style={headerCell()}>Net $B</th>
            <th style={headerCell()}>Net WoW $B</th>
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
                  </td>
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
