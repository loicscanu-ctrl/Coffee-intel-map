# Commodity Trading Lecture App — Design Spec
**Date:** 2026-06-03  
**Target repo:** https://github.com/loicscanu-ctrl/Commodity-trading-lecture  
**Deployment:** Vercel  
**Audience:** University students (Licence / M1 / M2 Spécialisé)

---

## Overview

Interactive lecture support web app for a commodity trading masterclass at Université Paris-Panthéon-Assas. Replaces static slides. Combines guided lecture sections, vocabulary quizzes, live trading calculators, and (in v2) role-play simulations. 8–12 hours of content across 3 modules.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Deployment | Vercel (free tier, static generation) |
| Database | None |
| External APIs | None |

---

## Authentication

- Next.js middleware protects all routes except `/login`
- `/login`: student enters shared class password → sets `session=valid` cookie → redirects to `/`
- Password stored as Vercel environment variable: `CLASS_PASSWORD`
- No user accounts, no session DB, cookie expires end of session
- Single password per class cohort (can rotate per semester via env var)

---

## Route Structure

```
/                          → redirect to /module/1
/login                     → password entry page
/module/[id]               → module dashboard (tabs 1, 2, 3)
/module/[id]/section/[sectionId]   → guided section reader
/module/[id]/quiz/[quizId]         → quiz / flashcard set
/module/[id]/tool/[toolId]         → calculator tool
```

---

## Content Structure

All content is hardcoded TypeScript — no CMS, no database. To update content: edit file, push to GitHub, Vercel redeploys in ~30s.

```
src/content/
  module-1/
    index.ts              ← ordered topic list for module 1
    00-introduction.ts
    01-panorama.ts
    02-keyconcept.ts
    03-market-structure.ts
    04-supply-demand.ts
    05-case-study-adayinlife.ts   ← v2 placeholder
  module-2/
    index.ts
    01-differential.ts
    02-knowyourexposure.ts
    03-hedgingstrategies.ts
    04-shipping.ts
    05-FOBtoCIFtrades.ts          ← v2 placeholder
  module-3/
    index.ts
    01-options.ts
    02-esg-eudr.ts
    03-advancedsupply-demand.ts
    04-cherry-to-terminal.ts      ← v2 placeholder
```

### Content Types

Each topic file exports one typed object:

```ts
type Topic = {
  id: string
  title: string
  type: 'lecture' | 'case-study' | 'tool' | 'quiz' | 'simulation'
  estimatedMinutes: number
  v2?: boolean        // true = "Coming Soon" badge, card not clickable
  sections?: Section[] // present on lecture / case-study types
  quiz?: Quiz          // optional quiz attached to any lecture
  tool?: ToolConfig    // present on tool type; key maps to component registry
}

// Navigation rule: module dashboard card click routes based on type:
//   lecture / case-study  → /module/[id]/section/[topic.id]
//   quiz                  → /module/[id]/quiz/[topic.id]
//   tool                  → /module/[id]/tool/[topic.id]
//   simulation            → disabled (v2)

type Section = {
  id: string
  title: string
  body: string        // markdown string, rendered via a lightweight markdown renderer
  visual?: string     // key into src/visuals/index.ts registry (React component)
}

type Quiz = {
  questions: {
    id: string
    question: string
    options: [string, string, string, string]
    correctIndex: 0 | 1 | 2 | 3
    explanation?: string
  }[]
}

type ToolConfig = {
  componentKey: string  // key into src/tools/index.ts registry (React component)
}
```

The `index.ts` per module re-exports topics in display order. Adding a topic = new file + one line in `index.ts`.

---

## Module Content Plan

### Module 1 — Panorama & Vocabulary (Licence / M1)
| File | Title | Type |
|---|---|---|
| 00-introduction | Welcome & Why Commodity Trading | Lecture |
| 01-panorama | Hard vs Soft Commodities, Trader Types (ABCD) | Lecture |
| 02-keyconcept | Futures, Swaps, EFP/EFS, Differential | Lecture + Quiz |
| 03-market-structure | Contango / Backwardation | Lecture |
| 04-supply-demand | Reading S&D: Production, Export, Demand | Lecture |
| 05-case-study-adayinlife | A Day in the Life of a Trader in Asia | Case Study (v2) |

### Module 2 — Operational Mechanics & Hedging (M1 / M2)
| File | Title | Type |
|---|---|---|
| 01-differential | The Basis / Differential: arbitrages of origin, quality, logistics | Lecture |
| 02-knowyourexposure | Understanding & Measuring Exposure | Lecture + Tool |
| 03-hedgingstrategies | Hedging Principles & Strategies, Incoterms, Risks | Lecture + Quiz |
| 04-shipping | Shipping: vessel types, chartering, incoterms FOB/CIF | Lecture |
| 05-FOBtoCIFtrades | FOB to CIF Trade Simulation | Simulation (v2) |

### Module 3 — Strategies, ESG & Data (M2 Spécialisé)
| File | Title | Type |
|---|---|---|
| 01-options | Options: physical options, strategies, margin calls | Lecture + Tool |
| 02-esg-eudr | ESG & EUDR: deforestation regulation impact on coffee chains | Lecture |
| 03-advancedsupply-demand | Advanced S&D Modeling: building a model | Lecture + Tool |
| 04-cherry-to-terminal | From Cherry to Terminal: group simulation | Simulation (v2) |

---

## UI Components

### Module Dashboard (`/module/[id]`)
- 3 tabs at top — Module 1, 2, 3 — active tab highlighted amber
- Grid of topic cards: title, type badge (color-coded), estimated time
- v2 topics show "Coming Soon" badge, card not clickable
- Dark theme throughout

### Section Reader (`/module/[id]/section/[sectionId]`)
- Breadcrumb: Module 1 › Panorama
- Progress bar across all sections in topic
- One section at a time: title + body + optional visual
- "Continue →" advances; last section returns to module dashboard
- Left/right arrow key navigation

### Quiz (`/module/[id]/quiz/[quizId]`)
- MCQ, one question at a time, 4 options
- Immediate feedback: green (correct) / red (wrong + show correct answer)
- Score summary at end, retry option

### Calculator Tools (`/module/[id]/tool/[toolId]`)
- Each tool is its own React component
- v1 tools: Hedging Exposure Calculator, Basis/Differential Calculator
- Reactive: no submit button, output updates on every input change

### Global
- Dark theme (slate-900 background, amber accent)
- Desktop-first (projected in classroom), mobile-responsive
- Language: English
- Font: system-ui or Inter

---

## V1 vs V2 Scope

### V1 (build now)
- Full app scaffold (auth, routing, module dashboard, section reader)
- All Module 1 content (sections + quiz)
- Module 2: lectures + hedging exposure calculator + basis calculator
- Module 3: options lecture + ESG lecture
- v2 placeholders shown as "Coming Soon" cards

### V2 (later)
- A Day in the Life — interactive timeline simulation (Module 1)
- FOB to CIF Trade Simulation (Module 2)
- Cherry to Terminal group role-play (Module 3)
- Advanced S&D model tool (Module 3)

---

## Deployment

1. Push to `main` branch on GitHub
2. Vercel auto-deploys on push
3. Set `CLASS_PASSWORD` in Vercel project environment variables
4. Share URL + password with students at start of each session
