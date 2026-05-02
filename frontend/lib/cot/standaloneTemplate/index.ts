/* eslint-disable */
// Generates a self-contained interactive HTML dashboard. The JSX inside the
// imported chunks is a plain string compiled by Babel in the browser — no
// TypeScript intelligence inside the strings.
//
// Split into three chunks for readability — at runtime they're concatenated
// into a single <script type="text/babel"> block, so Babel sees one program.

import { JSX_PREAMBLE } from "./jsx/preamble";
import { JSX_COMPONENTS } from "./jsx/components";
import { JSX_APP } from "./jsx/app";

export function buildStandaloneHtml(
  processed: any[],
  macroData: any[],
  globalFlowMetrics: any,
  dateStr: string,
  reactJs: string,
  reactDomJs: string,
  propTypesJs: string,
  rechartsJs: string,
  babelJs: string,
  appCss: string
): string {
  const safe = (obj: unknown) =>
    JSON.stringify(obj).replace(/<\/script>/gi, "<\\/script>");

  const bakedJson = safe({ processed, macroData, globalFlowMetrics });

  const jsx = JSX_PREAMBLE + JSX_COMPONENTS + JSX_APP;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>COT Dashboard — ${dateStr}</title>
<script>${reactJs}<\/script>
<script>${reactDomJs}<\/script>
<script>${propTypesJs}<\/script>
<script>${rechartsJs}<\/script>
<script>${babelJs}<\/script>
<style>
${appCss}
body { background:#020617; color:#f1f5f9; margin:0; padding:16px; }
::-webkit-scrollbar { width:8px; height:8px; }
::-webkit-scrollbar-track { background:#0f172a; }
::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
::-webkit-scrollbar-thumb:hover { background:#475569; }
</style>
</head>
<body>
<div id="root"></div>
<script>window.BAKED_DATA = ${bakedJson};<\/script>
<script type="text/babel">${jsx}<\/script>
</body>
</html>`;
}
