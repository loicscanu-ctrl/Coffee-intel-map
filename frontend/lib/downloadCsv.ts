// Tiny CSV writer for the data-map "Data downloads" section.
//
// Why not a library: a real CSV exporter is ~20 lines, and the only edge
// case that matters in practice is fields containing commas / quotes /
// newlines (escape via RFC-4180 double-quoting). UTF-8 BOM prefix is
// important — without it Excel on Windows opens non-Latin glyphs (VN
// Vietnamese names, PT diacritics) as mojibake.

const NEEDS_QUOTE = /[",\r\n]/;

function escapeCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && !Number.isFinite(v)) return "";
  const s = typeof v === "string" ? v : String(v);
  return NEEDS_QUOTE.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Union of every row's keys, in first-seen order. Stable header even if
// later rows have extra columns the first row didn't.
function collectColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  return cols;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = collectColumns(rows);
  const header = cols.map(escapeCell).join(",");
  const body = rows.map(r => cols.map(c => escapeCell(r[c])).join(",")).join("\r\n");
  return header + "\r\n" + body + "\r\n";
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  // BOM (﻿) so Excel opens UTF-8 cleanly — required for VN/PT/JA glyphs.
  const csv = "﻿" + rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
