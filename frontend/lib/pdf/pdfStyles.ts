// frontend/lib/pdf/pdfStyles.ts
import { StyleSheet } from "@react-pdf/renderer";

export const BRAND = {
  amber:     "#d97706",
  dark:      "#111827",
  slate800:  "#1e293b",
  slate600:  "#475569",
  slate400:  "#94a3b8",
  slate200:  "#e2e8f0",
  white:     "#ffffff",
  green:     "#059669",
  red:       "#dc2626",
  orange:    "#ea580c",
};

export const S = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    paddingTop: 36, paddingBottom: 48,
    paddingLeft: 40, paddingRight: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1e293b",
  },

  // ── Header bar ──
  headerBar: {
    backgroundColor: BRAND.dark,
    marginHorizontal: -40,
    marginTop: -36,
    paddingHorizontal: 40,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  headerTitle:  { color: BRAND.amber, fontSize: 12, fontFamily: "Helvetica-Bold" },
  headerSub:    { color: BRAND.slate400, fontSize: 8 },

  // ── Section headings ──
  sectionTitle: {
    fontSize: 11, fontFamily: "Helvetica-Bold",
    color: BRAND.dark, borderBottomWidth: 1.5,
    borderBottomColor: BRAND.amber, paddingBottom: 3,
    marginBottom: 8,
  },
  subTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: BRAND.slate600, marginBottom: 4, marginTop: 6 },

  // ── Comment boxes ──
  commentBox: {
    backgroundColor: "#f8fafc",
    border: "1pt solid #e2e8f0",
    borderRadius: 3,
    padding: 7,
    marginTop: 6,
    marginBottom: 8,
  },
  commentText: { fontSize: 8, color: "#374151", lineHeight: 1.5 },
  commentSignal: { fontSize: 8, color: BRAND.amber, fontFamily: "Helvetica-Bold", lineHeight: 1.5 },

  // ── KPI pills ──
  kpiRow:   { flexDirection: "row", gap: 8, marginBottom: 12 },
  kpiPill:  { flex: 1, backgroundColor: BRAND.dark, borderRadius: 4, padding: "6 8", alignItems: "center" },
  kpiLabel: { fontSize: 7, color: BRAND.slate400, textTransform: "uppercase", marginBottom: 2 },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: BRAND.white },
  kpiSub:   { fontSize: 7, color: BRAND.slate600, marginTop: 1 },

  // ── 2-column layout ──
  row:      { flexDirection: "row", gap: 12 },
  col:      { flex: 1 },

  // ── Metric rows in deep dive ──
  metricRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  metricLabel: { fontSize: 8, color: BRAND.slate600 },
  metricValue: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.dark },
  metricUp:    { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.green },
  metricDown:  { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.red },

  // ── Risk flag ──
  flagOB: { fontSize: 8, color: BRAND.red,   fontFamily: "Helvetica-Bold" },
  flagOS: { fontSize: 8, color: BRAND.green, fontFamily: "Helvetica-Bold" },
  flagNeutral: { fontSize: 8, color: BRAND.slate600 },
  flagRed:   { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.red },
  flagGreen: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.green },
  flagAmber: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BRAND.amber },

  // ── Chart image ──
  chartImg:     { width: "100%", objectFit: "contain", marginVertical: 6 },
  chartCaption: { fontSize: 7.5, color: BRAND.slate400, marginTop: 2, marginBottom: 8, textAlign: "center" },
  noChart:    { width: "100%", height: 200, backgroundColor: "#f1f5f9", justifyContent: "center", alignItems: "center", marginBottom: 6 },
  noChartTxt: { fontSize: 8, color: BRAND.slate400 },

  // ── Tables ──
  tableWrap:    { marginVertical: 6, borderWidth: 0.5, borderColor: "#e2e8f0", borderRadius: 3 },
  tHeadRow:     { flexDirection: "row", backgroundColor: BRAND.dark, paddingVertical: 5, paddingHorizontal: 6 },
  tDataRow:     { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  tDataRowAlt:  { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  tHCell:       { fontSize: 7, fontFamily: "Helvetica-Bold", color: BRAND.amber },
  tHCellR:      { fontSize: 7, fontFamily: "Helvetica-Bold", color: BRAND.amber, textAlign: "right" },
  tCell:        { fontSize: 7.5, color: BRAND.dark },
  tCellR:       { fontSize: 7.5, color: BRAND.dark, textAlign: "right" },
  tCellPos:     { fontSize: 7.5, color: BRAND.green, textAlign: "right", fontFamily: "Helvetica-Bold" },
  tCellNeg:     { fontSize: 7.5, color: BRAND.red,   textAlign: "right", fontFamily: "Helvetica-Bold" },
  tTotalRow:    { flexDirection: "row", backgroundColor: BRAND.dark, paddingVertical: 4, paddingHorizontal: 6, borderTopWidth: 0.5, borderTopColor: BRAND.amber },

  // ── Bullets ──
  bulletRow:     { flexDirection: "row", marginBottom: 4 },
  bulletDot:     { fontSize: 8, color: BRAND.amber, marginRight: 5, width: 8 },
  bulletText:    { fontSize: 8, color: "#374151", flex: 1, lineHeight: 1.45 },
  bulletSubRow:  { flexDirection: "row", marginBottom: 3, marginLeft: 13 },
  bulletSubDot:  { fontSize: 7.5, color: BRAND.slate400, marginRight: 4 },
  bulletSubText: { fontSize: 7.5, color: BRAND.slate600, flex: 1, lineHeight: 1.4 },

  // ── Footer ──
  footer: {
    position: "absolute", bottom: 18, left: 40, right: 40,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 7, color: BRAND.slate400,
    borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 4,
  },
  footerTxt: { fontSize: 7, color: BRAND.slate400 },

  // ── Cover ──
  coverTitle:   { fontSize: 28, fontFamily: "Helvetica-Bold", color: BRAND.dark, marginBottom: 4 },
  coverWeek:    { fontSize: 14, color: BRAND.slate600, marginBottom: 2 },
  coverDate:    { fontSize: 10, color: BRAND.slate400, marginBottom: 24 },
  coverDivider: { height: 2, backgroundColor: BRAND.amber, marginBottom: 16 },

  // ── Disclaimer ──
  disclaimerTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BRAND.dark, marginBottom: 8 },
  disclaimerText:  { fontSize: 7.5, color: BRAND.slate600, lineHeight: 1.5, marginBottom: 6 },
});
