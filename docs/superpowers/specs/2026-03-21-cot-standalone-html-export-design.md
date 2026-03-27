# COT Dashboard — Standalone Interactive HTML Export

**Date:** 2026-03-21
**Status:** Approved

---

## Goal

When the user clicks "Download HTML" in the COT dashboard, the browser downloads a single `.html` file that:
- Opens in any browser with no server running
- Contains all real COT data baked in at download time
- Is fully interactive: chart hover tooltips, toggle buttons, section nav all work
- Looks and behaves exactly like the live app

---

## Architecture

### Single-file structure

```
COT-Dashboard.html
├── <head>
│   ├── CDN: Tailwind CSS (script tag)
│   ├── CDN: React 18 UMD production
│   ├── CDN: ReactDOM 18 UMD production
│   ├── CDN: prop-types (Recharts dependency)
│   ├── CDN: Recharts 2.1.9 UMD
│   ├── CDN: @babel/standalone (JSX compilation)
│   └── <style> base styles (dark background, scrollbar)
├── <body>
│   ├── <div id="root" />
│   └── <script type="text/babel">
│       ├── window.BAKED_DATA = { processed: [...], macroData: [...] }
│       ├── Constants (ARABICA_MT_FACTOR, etc.)
│       ├── Helper functions (formatters, transformers)
│       ├── Inline SVG icons (replacing lucide-react)
│       ├── Shared sub-components (SectionHeader, chart wrappers)
│       ├── App() — main component with all state and sections
│       └── ReactDOM.createRoot(...).render(<App />)
```

### Data layer

- At download time, `generateStandaloneHtml(processedData, macroData)` is called inside `CotDashboard.tsx`
- `processedData` = the already-transformed array (output of `transformApiData(cotRows)`) — the full history used to render `recent52` and rolling ranks
- `macroData` = `MacroCotWeek[]` from the macro-cot API
- Both are serialized via `JSON.stringify` and injected as `window.BAKED_DATA`
- No API calls made from the standalone file — all data is static

### Library embedding strategy

At download time, the app fetches all JS libraries from CDN and inlines them directly into the HTML file. The user's internet is used **once** (when clicking Download). The resulting file requires **no internet to open** — ever.

| Library | Fetch URL | Raw size (approx) |
|---|---|---|
| React 18.2.0 | `https://unpkg.com/react@18.2.0/umd/react.production.min.js` | ~45KB |
| ReactDOM 18.2.0 | `https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js` | ~130KB |
| prop-types 15.8.1 | `https://unpkg.com/prop-types@15.8.1/prop-types.min.js` | ~6KB |
| Recharts 2.1.9 | `https://unpkg.com/recharts@2.1.9/umd/Recharts.js` | ~500KB |
| @babel/standalone | `https://unpkg.com/@babel/standalone/babel.min.js` | ~1.7MB |
| Tailwind CSS | Fetched from app's own compiled `/_next/static/css/*.css` at download time | ~50–100KB |

**Tailwind:** Do NOT use Tailwind Play CDN. Instead fetch the app's own compiled CSS from `document.querySelectorAll('link[rel="stylesheet"]')` at download time and inline as `<style>` tags. This captures only the classes actually used.

**Total JS payload embedded:** ~2.4MB
**Total file size with data:** ~2.5–3MB
**Open time:** ~1–2s (Babel compiles JSX once on open, then charts render immediately)
**Loading state:** Show "Generating…" on the button while fetching libraries. Show an alert if any fetch fails.

### Data safety

When injecting `cotRows` / `macroData` as JSON into the `<script>` block, escape all `</script>` occurrences in the serialized string:
```ts
const safe = (obj: unknown) => JSON.stringify(obj).replace(/<\/script>/gi, '<\\/script>');
```

### Filename

Downloaded file is named `COT-Dashboard-YYYY-MM-DD.html` using today's date, so users can distinguish versions.

### Download trigger

Use `URL.createObjectURL(blob)` + programmatic `<a>` click + `URL.revokeObjectURL`. Standard modern browser approach, no polyfill needed.

---

## Component structure

Sections rendered vertically (no tab switching — all always visible, scroll to navigate):

| # | Section | Chart layout |
|---|---|---|
| 1 | Global Money Flow | Single full-width chart |
| 2 | Counterparty Mapping | NY left / LDN right |
| 3 | Industry Pulse | NY left / LDN right |
| 4 | Dry Powder | NY left / LDN right |
| 5 | Cycle Location | NY left / LDN right |

Sticky top nav with anchor-scroll to each section.

### State preserved in standalone file

- Market toggles (NY Arabica / LDN Robusta)
- Category filters (PMPU, MM, Swap, Other, Non-Rep)
- Flow series toggles
- All computed via `useMemo` from `BAKED_DATA`

---

## Export mechanism

In `CotDashboard.tsx`:

```typescript
function generateStandaloneHtml(processedData: any[], macroData: MacroCotWeek[]): string {
  const baked = JSON.stringify({ processed: processedData, macroData });
  return `<!DOCTYPE html>...<script type="text/babel">
    window.BAKED_DATA = ${baked};
    // full component code
  <\/script>`;
}

// In the download button handler:
const html = generateStandaloneHtml(data, macroData); // data = full processed array
const blob = new Blob([html], { type: "text/html;charset=utf-8" });
// trigger download
```

---

## What is NOT included

- Navigation to other app pages (Futures, Macro tabs)
- Live data refresh
- Backend connectivity
- Print/PDF export

---

## Component code strategy

The standalone component code lives in a dedicated file:
`frontend/lib/cot/standaloneTemplate.ts`

This file exports a function `buildStandaloneScript(baked: string): string` that returns the full JSX component as a string (no TypeScript types — plain JSX compatible with Babel standalone). It mirrors the current `CotDashboard.tsx` logic but reads from `window.BAKED_DATA` instead of fetching. This is a deliberate duplication: the standalone template is intentionally decoupled so it can be sent as a self-contained artifact.

## Files changed

| File | Change |
|---|---|
| `frontend/components/futures/CotDashboard.tsx` | Replace current export button handler with `generateStandaloneHtml()` call |
| `frontend/lib/cot/standaloneTemplate.ts` | New file — contains the full JSX component as a template string |
