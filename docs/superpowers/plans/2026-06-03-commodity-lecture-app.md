# Commodity Trading Lecture App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-protected, university lecture support web app with 3 module tabs, guided section reader, quizzes, and live calculators — deployed to Vercel.

**Architecture:** Next.js 14 App Router with TypeScript and Tailwind. Auth via middleware + cookie (single shared class password in env var). All content hardcoded in `src/content/` TypeScript files — no CMS, no DB. Interactive tools are client-side React components.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, react-markdown, @tailwindcss/typography, Jest, React Testing Library, Vercel.

**Target repo:** https://github.com/loicscanu-ctrl/Commodity-trading-lecture

---

## File Map

```
# Root
middleware.ts
jest.config.ts
jest.setup.ts

# Types
src/types/content.ts

# Content
src/content/index.ts
src/content/module-1/index.ts
src/content/module-1/00-introduction.ts
src/content/module-1/01-panorama.ts
src/content/module-1/02-keyconcept.ts
src/content/module-1/03-market-structure.ts
src/content/module-1/04-supply-demand.ts
src/content/module-1/05-case-study-adayinlife.ts
src/content/module-2/index.ts
src/content/module-2/01-differential.ts
src/content/module-2/02-knowyourexposure.ts
src/content/module-2/03-hedgingstrategies.ts
src/content/module-2/04-shipping.ts
src/content/module-2/05-FOBtoCIFtrades.ts
src/content/module-3/index.ts
src/content/module-3/01-options.ts
src/content/module-3/02-esg-eudr.ts
src/content/module-3/03-advancedsupply-demand.ts
src/content/module-3/04-cherry-to-terminal.ts

# Auth helpers
src/lib/auth.ts

# Tools + Visuals registries
src/tools/index.ts
src/visuals/index.ts

# App shell
src/app/globals.css
src/app/layout.tsx
src/app/page.tsx
src/app/login/page.tsx
src/app/login/actions.ts

# Module routes
src/app/module/[id]/page.tsx
src/app/module/[id]/section/[sectionId]/page.tsx
src/app/module/[id]/quiz/[quizId]/page.tsx
src/app/module/[id]/quiz/[quizId]/QuizRunner.tsx
src/app/module/[id]/tool/[toolId]/page.tsx

# Components
src/components/ModuleTabs.tsx
src/components/TopicCard.tsx
src/components/Breadcrumb.tsx
src/components/ProgressBar.tsx
src/components/SectionReader.tsx
src/components/QuizQuestion.tsx
src/components/QuizSummary.tsx
src/components/tools/HedgingCalculator.tsx
src/components/tools/BasisCalculator.tsx

# Tests
src/__tests__/lib/auth.test.ts
src/__tests__/components/TopicCard.test.tsx
src/__tests__/components/SectionReader.test.tsx
src/__tests__/components/QuizQuestion.test.tsx
src/__tests__/components/tools/HedgingCalculator.test.tsx

# Docs
README.md
```

---

## Task 1: Wipe repo and scaffold Next.js project

**Files:** All — wipe then create

- [ ] **Step 1: Clone the repo locally (if not already done)**

```bash
git clone https://github.com/loicscanu-ctrl/Commodity-trading-lecture.git
cd Commodity-trading-lecture
```

- [ ] **Step 2: Remove all existing files except .git**

```bash
find . -not -path './.git/*' -not -name '.git' -delete 2>/dev/null || true
# On Windows PowerShell:
# Get-ChildItem -Exclude .git | Remove-Item -Recurse -Force
```

- [ ] **Step 3: Scaffold Next.js 14 into the repo root**

```bash
npx create-next-app@14 . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-git
```

When prompted interactively, accept all defaults.

- [ ] **Step 4: Install additional dependencies**

```bash
npm install react-markdown
npm install --save-dev @tailwindcss/typography jest @testing-library/react @testing-library/jest-dom @testing-library/user-event jest-environment-jsdom @types/jest
```

- [ ] **Step 5: Configure Tailwind typography plugin**

Open `tailwind.config.ts` and add the plugin:

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
```

- [ ] **Step 6: Create jest.config.ts**

```ts
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

export default createJestConfig(config)
```

- [ ] **Step 7: Create jest.setup.ts**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 8: Add test script to package.json**

In `package.json`, ensure scripts includes:

```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 9: Verify build passes**

```bash
npm run build
```

Expected: `Route (app)` output with no errors. A few TypeScript warnings about missing pages are fine at this stage.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 14 app with Tailwind, TypeScript, Jest"
```

---

## Task 2: TypeScript content types

**Files:**
- Create: `src/types/content.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/types/content.ts
export type Topic = {
  id: string
  title: string
  type: 'lecture' | 'case-study' | 'tool' | 'quiz' | 'simulation'
  estimatedMinutes: number
  v2?: boolean        // true = "Coming Soon", card disabled
  sections?: Section[]
  quiz?: Quiz
  tool?: ToolConfig
}

// Routing rule (used by TopicCard):
//   lecture | case-study → /module/[id]/section/[topic.id]
//   quiz                 → /module/[id]/quiz/[topic.id]
//   tool                 → /module/[id]/tool/[topic.id]
//   simulation           → disabled (v2)

export type Section = {
  id: string
  title: string
  body: string        // markdown string
  visual?: string     // key into src/visuals/index.ts registry
}

export type Quiz = {
  questions: Question[]
}

export type Question = {
  id: string
  question: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  explanation?: string
}

export type ToolConfig = {
  componentKey: string  // key into src/tools/index.ts registry
}

export type Module = {
  id: number
  title: string
  level: string
  topics: Topic[]
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/content.ts
git commit -m "feat: add content TypeScript types"
```

---

## Task 3: Auth — middleware, helper, login page

**Files:**
- Create: `src/lib/auth.ts`
- Create: `middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/login/actions.ts`
- Create: `src/__tests__/lib/auth.test.ts`

- [ ] **Step 1: Write failing test for auth helper**

```ts
// src/__tests__/lib/auth.test.ts
import { isAuthenticated } from '@/lib/auth'

test('returns true when session cookie is "valid"', () => {
  expect(isAuthenticated('valid')).toBe(true)
})

test('returns false when session cookie is undefined', () => {
  expect(isAuthenticated(undefined)).toBe(false)
})

test('returns false when session cookie has wrong value', () => {
  expect(isAuthenticated('wrong-value')).toBe(false)
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- --testPathPattern=auth
```

Expected: FAIL — `Cannot find module '@/lib/auth'`

- [ ] **Step 3: Create auth helper**

```ts
// src/lib/auth.ts
export function isAuthenticated(sessionCookie: string | undefined): boolean {
  return sessionCookie === 'valid'
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- --testPathPattern=auth
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Create middleware**

```ts
// middleware.ts (repo root, next to package.json)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isAuthenticated } from '@/lib/auth'

export function middleware(request: NextRequest) {
  const session = request.cookies.get('session')?.value
  const isLoginPage = request.nextUrl.pathname === '/login'

  if (!isAuthenticated(session) && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isAuthenticated(session) && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 6: Create login Server Action**

```ts
// src/app/login/actions.ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function authenticate(formData: FormData) {
  const password = formData.get('password') as string

  if (password !== process.env.CLASS_PASSWORD) {
    redirect('/login?error=1')
  }

  cookies().set('session', 'valid', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })

  redirect('/')
}
```

- [ ] **Step 7: Create login page**

```tsx
// src/app/login/page.tsx
import { authenticate } from './actions'

type Props = { searchParams: { error?: string } }

export default function LoginPage({ searchParams }: Props) {
  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-slate-800 border border-slate-700 p-8 rounded-xl w-full max-w-sm">
        <h1 className="text-2xl font-bold text-amber-400 mb-1">Commodity Trading</h1>
        <p className="text-slate-400 text-sm mb-6">Enter your class password to continue.</p>
        <form action={authenticate} className="flex flex-col gap-4">
          <input
            type="password"
            name="password"
            placeholder="Class password"
            required
            autoFocus
            className="w-full bg-slate-700 text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-slate-500"
          />
          {searchParams.error && (
            <p className="text-red-400 text-sm">Incorrect password. Try again.</p>
          )}
          <button
            type="submit"
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold py-3 rounded-lg transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 8: Add CLASS_PASSWORD to local .env.local for development**

Create `.env.local` at repo root (this file must NOT be committed):

```
CLASS_PASSWORD=lecture2024
```

Verify `.gitignore` contains `.env.local` (create-next-app adds it by default).

- [ ] **Step 9: Start dev server and verify login flow manually**

```bash
npm run dev
```

Open http://localhost:3000 — should redirect to `/login`.
Enter `lecture2024` — should redirect to `/` (which currently shows Next.js default).
Open http://localhost:3000/login while authenticated — should redirect to `/`.

- [ ] **Step 10: Commit**

```bash
git add middleware.ts src/lib/auth.ts src/app/login/ src/__tests__/lib/auth.test.ts
git commit -m "feat: auth middleware + login page with class password"
```

---

## Task 4: Root layout, global styles, root redirect

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update globals.css**

```css
/* src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  color-scheme: dark;
}

body {
  @apply bg-slate-900 text-white;
}
```

- [ ] **Step 2: Update root layout**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Commodity Trading Lecture',
  description: 'Interactive lecture support for commodity trading masterclass',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

- [ ] **Step 3: Root page redirects to module 1**

```tsx
// src/app/page.tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/module/1')
}
```

- [ ] **Step 4: Verify redirect works**

With dev server running (`npm run dev`), visit http://localhost:3000.
After login, should redirect to http://localhost:3000/module/1 (currently shows 404 — that's expected).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/app/page.tsx
git commit -m "feat: root layout with dark theme, redirect to module 1"
```

---

## Task 5: Content registries and module index structure

**Files:**
- Create: `src/visuals/index.ts`
- Create: `src/tools/index.ts`
- Create: `src/content/index.ts`
- Create: `src/content/module-1/index.ts` (stub)
- Create: `src/content/module-2/index.ts` (stub)
- Create: `src/content/module-3/index.ts` (stub)

- [ ] **Step 1: Create visuals registry (empty for now)**

```ts
// src/visuals/index.ts
import type { ComponentType } from 'react'

// Register visual components here as they are created.
// Key matches Section.visual field in content files.
export const visualRegistry: Record<string, ComponentType> = {}
```

- [ ] **Step 2: Create tools registry (empty for now)**

```ts
// src/tools/index.ts
import type { ComponentType } from 'react'

// Populated in Task 13 when calculator components are built.
export const toolRegistry: Record<string, ComponentType> = {}
```

- [ ] **Step 3: Create module-1 index stub**

```ts
// src/content/module-1/index.ts
import type { Topic } from '@/types/content'

// Topics imported here in Task 6.
export const topics: Topic[] = []
```

- [ ] **Step 4: Create module-2 index stub**

```ts
// src/content/module-2/index.ts
import type { Topic } from '@/types/content'

export const topics: Topic[] = []
```

- [ ] **Step 5: Create module-3 index stub**

```ts
// src/content/module-3/index.ts
import type { Topic } from '@/types/content'

export const topics: Topic[] = []
```

- [ ] **Step 6: Create content aggregator**

```ts
// src/content/index.ts
import { topics as module1Topics } from './module-1'
import { topics as module2Topics } from './module-2'
import { topics as module3Topics } from './module-3'
import type { Module } from '@/types/content'

export const modules: Module[] = [
  {
    id: 1,
    title: 'Panorama & Vocabulary',
    level: 'Licence / M1',
    topics: module1Topics,
  },
  {
    id: 2,
    title: 'Operational Mechanics & Hedging',
    level: 'M1 / M2',
    topics: module2Topics,
  },
  {
    id: 3,
    title: 'Strategies, ESG & Data',
    level: 'M2 Spécialisé',
    topics: module3Topics,
  },
]
```

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/visuals/ src/tools/ src/content/
git commit -m "feat: content registry structure and module index stubs"
```

---

## Task 6: Module 1 content files

**Files:** `src/content/module-1/` — all topic files + update index.ts

- [ ] **Step 1: Create 00-introduction.ts**

```ts
// src/content/module-1/00-introduction.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '00-introduction',
  title: 'Welcome & Why Commodity Trading',
  type: 'lecture',
  estimatedMinutes: 10,
  sections: [
    {
      id: 'hook',
      title: 'Why Commodity Trading?',
      body: `Every product you consume — the coffee in your cup, the fuel in your car, the metal in your phone — passed through a commodity market.\n\nCommodity trading is the invisible infrastructure of the global economy. Yet it remains one of the least understood industries in finance.\n\nThis course gives you the vocabulary, mechanics, and strategic frameworks used by traders, exporters, and risk managers in physical commodity markets.`,
    },
    {
      id: 'structure',
      title: 'Course Structure',
      body: `**Module 1 — Panorama & Vocabulary** *(Licence / M1)*\nCommodity types, trader archetypes, key instruments (futures, swaps, EFP), and market structure.\n\n**Module 2 — Operational Mechanics & Hedging** *(M1 / M2)*\nHow trades are executed: basis management, hedging strategies, incoterms, risk taxonomy, and shipping.\n\n**Module 3 — Strategies, ESG & Data** *(M2 Spécialisé)*\nOptions in physical markets, EUDR regulation, supply/demand modeling, and data-driven trading.`,
    },
    {
      id: 'who-are-traders',
      title: 'Who Are Commodity Traders?',
      body: `Commodity traders connect **producers** (farmers, miners, oil fields) with **consumers** (factories, refineries, food processors). They add value by:\n\n- **Transforming place:** buying in Vietnam, selling in Rotterdam\n- **Transforming time:** buying now, selling in 3 months\n- **Transforming form:** buying raw beans, processing to green coffee\n- **Managing risk:** using financial instruments to lock in prices\n\nThe major trading houses — Vitol, Trafigura, Glencore, Louis Dreyfus, Cargill, Bunge — handle hundreds of billions in physical commodities annually.`,
    },
  ],
}

export default topic
```

- [ ] **Step 2: Create 01-panorama.ts**

```ts
// src/content/module-1/01-panorama.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '01-panorama',
  title: 'Hard vs Soft Commodities & Trader Types',
  type: 'lecture',
  estimatedMinutes: 25,
  sections: [
    {
      id: 'classification',
      title: 'Classification of Commodities',
      body: `Commodities are divided into two broad families:\n\n**Hard Commodities** — extracted from the earth:\n- Energy: crude oil (Brent, WTI), natural gas, coal\n- Metals: copper, aluminium, gold, iron ore\n\n**Soft Commodities** — grown or raised:\n- Agricultural grains: wheat, corn, soybeans\n- Tropicals: coffee (Arabica, Robusta), cocoa, sugar, cotton\n- Livestock: cattle, hogs\n\nThe distinction matters because hard and soft commodities follow very different supply/demand dynamics, seasonality, and storage constraints.`,
    },
    {
      id: 'trader-types',
      title: 'Types of Traders (ABCD & Beyond)',
      body: `**The ABCD Trading Houses** — pure commodity merchants:\n- **A**rcher Daniels Midland (ADM)\n- **B**unge\n- **C**argill\n- **D**reyfus (Louis Dreyfus)\n\nThey buy from producers, transport, store, process and sell globally. They take price risk as part of their business model.\n\n**Industrial Traders** — companies that trade to supply their own operations:\n- Nestlé, Jacobs Douwe Egberts (coffee)\n- BP, Shell (energy)\n- Rio Tinto, Glencore (metals)\n\n**Financial Traders** — hedge funds, prop desks trading commodity derivatives for profit without taking physical delivery.\n\n**Importateurs / Exportateurs** — regional specialists who bridge local producers with international markets.`,
    },
    {
      id: 'with-without-contract',
      title: 'With or Without a Contract',
      body: `Physical commodity trading can be executed:\n\n**With a contract** (EFP/EFS basis trades):\nA physical price is set as: **Futures price + Differential**\nExample: Arabica sold at ICE March + 35¢/lb\n\n**Without a contract** (outright/flat price):\nBuyer and seller agree on an all-in price upfront. No reference to exchange. Less common for large volumes.\n\nThe **differential** captures origin premiums/discounts, quality, logistics, timing, and supply/demand specifics that the generic futures price does not reflect.`,
    },
  ],
  quiz: {
    questions: [
      {
        id: 'q1',
        question: 'Which of the following is classified as a "Soft" commodity?',
        options: ['Crude oil (Brent)', 'Arabica coffee', 'Copper', 'Natural gas'],
        correctIndex: 1,
        explanation: 'Arabica coffee is a tropical agricultural commodity — a Soft. The others are Hard commodities (energy and metals).',
      },
      {
        id: 'q2',
        question: 'What does "ABCD" refer to in commodity trading?',
        options: [
          'A regulatory framework for commodity markets',
          'The four main commodity exchanges (CBOT, LME, ICE, CME)',
          'The four dominant agricultural trading houses (ADM, Bunge, Cargill, Dreyfus)',
          'A risk classification system (A = low risk, D = high risk)',
        ],
        correctIndex: 2,
        explanation: 'ABCD refers to Archer Daniels Midland, Bunge, Cargill, and Louis Dreyfus — the four largest agricultural commodity trading houses.',
      },
      {
        id: 'q3',
        question: 'What is the "differential" in a physical commodity trade?',
        options: [
          'The fee paid to the exchange for futures clearing',
          'The spread between bid and ask prices on the exchange',
          'The premium or discount added to the futures price to arrive at the physical price',
          'The difference between Arabica and Robusta coffee prices',
        ],
        correctIndex: 2,
        explanation: 'Physical price = Futures price + Differential. The differential captures origin, quality, logistics, and timing factors not reflected in the generic futures contract.',
      },
    ],
  },
}

export default topic
```

- [ ] **Step 3: Create 02-keyconcept.ts**

```ts
// src/content/module-1/02-keyconcept.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '02-keyconcept',
  title: 'Key Instruments: Futures, Swaps, EFP/EFS',
  type: 'lecture',
  estimatedMinutes: 30,
  sections: [
    {
      id: 'futures',
      title: 'Futures Contracts',
      body: `A **futures contract** is a standardized, exchange-traded agreement to buy or sell a specific commodity at a predetermined price on a future date.\n\nKey characteristics:\n- **Standardized:** lot size, quality, delivery location defined by the exchange\n- **Marked to market daily:** gains/losses settled each day (variation margin)\n- **Clearinghouse guarantee:** no counterparty credit risk\n\n**Arabica Coffee (ICE-US):** 37,500 lbs per lot, quoted in cents/lb\n**Robusta Coffee (ICE-EU):** 10 metric tonnes per lot, quoted in $/MT\n**Brent Crude (ICE):** 1,000 barrels per lot, quoted in $/barrel\n**WTI Crude (CME/NYMEX):** 1,000 barrels per lot\n\nMost futures contracts are **never delivered** — they are offset before expiry by an opposing trade.`,
    },
    {
      id: 'swaps',
      title: 'Swaps',
      body: `A **swap** is an OTC (over-the-counter) agreement between two parties to exchange cash flows based on a commodity price.\n\nCommon use: a producer wants to lock in a selling price without using exchange futures.\n- Producer receives fixed price from bank\n- Producer pays floating (market price) to bank\n- Net: producer's price is fixed, regardless of where market moves\n\nSwaps are more flexible than futures (custom size, tenor, settlement) but carry **counterparty credit risk** since they are bilateral agreements.`,
    },
    {
      id: 'efp-efs',
      title: 'EFP and EFS',
      body: `**EFP (Exchange of Futures for Physical):** A privately negotiated transaction where a futures position is exchanged for a physical (cash) commodity position.\n\nExample: A coffee exporter has sold 100 lots of Robusta futures to hedge. When they execute the physical sale to a roaster, they do an EFP — the futures position moves to the buyer, and the physical transaction is confirmed.\n\n**EFS (Exchange of Futures for Swaps):** Same concept, but the futures position is exchanged for a swap position.\n\nKey point: EFPs/EFS allow the link between the exchange and physical markets — they are how "basis trading" is executed in practice.`,
    },
    {
      id: 'differential',
      title: 'The Differential',
      body: `**Physical price = Futures price + Differential**\n\nThe differential is expressed as a premium (+) or discount (−) to the nearby futures contract.\n\nFactors that affect the differential:\n- **Origin quality:** high-quality Yirgacheffe Arabica trades at a premium vs generic Brazil\n- **Logistics:** proximity to port, bagging quality\n- **Timing:** nearby supply tightness vs forward surplus\n- **Certifiability:** whether the physical coffee can be tendered against the exchange contract\n\nTrading the differential (basis trading) is where much of the commercial edge in physical trading lies.`,
    },
  ],
  quiz: {
    questions: [
      {
        id: 'q1',
        question: 'How many metric tonnes does one ICE-EU Robusta Coffee futures lot represent?',
        options: ['5 MT', '10 MT', '20 MT', '37.5 MT'],
        correctIndex: 1,
        explanation: 'One ICE-EU Robusta lot = 10 metric tonnes, quoted in $/MT. ICE-US Arabica is quoted in ¢/lb with 37,500 lb per lot.',
      },
      {
        id: 'q2',
        question: 'What is the main advantage of a swap over a futures contract for a commodity producer?',
        options: [
          'No margin calls',
          'Exchange-guaranteed clearing eliminates credit risk',
          'Flexibility in size, tenor, and settlement terms',
          'Lower transaction costs',
        ],
        correctIndex: 2,
        explanation: 'Swaps are OTC and can be customized in size, duration, and settlement — but unlike futures, they carry counterparty credit risk since there is no clearinghouse.',
      },
    ],
  },
}

export default topic
```

- [ ] **Step 4: Create 03-market-structure.ts**

```ts
// src/content/module-1/03-market-structure.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '03-market-structure',
  title: 'Market Structure: Contango & Backwardation',
  type: 'lecture',
  estimatedMinutes: 25,
  sections: [
    {
      id: 'term-structure',
      title: 'The Futures Term Structure',
      body: `The **term structure** (or forward curve) shows the price of a commodity at different future delivery dates.\n\nTwo fundamental shapes:\n\n**Contango:** Future price > Spot price\n- "Normal" for storable commodities\n- Reflects cost of carry: storage + insurance + financing\n- Signals adequate nearby supply\n\n**Backwardation:** Future price < Spot price\n- Spot commands a premium\n- Signals tight nearby supply or strong immediate demand\n- Common during supply disruptions or harvest seasons`,
    },
    {
      id: 'contango',
      title: 'Contango in Detail',
      body: `In contango, a nearby buyer can:\n1. Buy spot\n2. Store the commodity\n3. Sell forward at a higher price\n4. Earn the spread (minus costs)\n\nIf the forward premium exceeds cost of carry, this **cash-and-carry arbitrage** is profitable and traders exploit it until the premium collapses to fair value.\n\n**Cost of carry** = Storage cost + Insurance + Financing cost (interest)\n\nContango is why oil in tanks, grain in silos, and coffee in warehouses are all "financed" by the forward curve.`,
    },
    {
      id: 'backwardation',
      title: 'Backwardation in Detail',
      body: `In backwardation, spot prices are higher than forward prices.\n\nCauses:\n- Supply shortage: bad harvest, port strikes, logistics disruption\n- Seasonal demand peaks\n- Inventory drawdown (low warehouse stocks)\n\n**Squeeze risk:** An extreme form of backwardation where a dominant player controls nearby physical supply, forcing short hedgers to pay very high prices to close positions. The **Robusta coffee market** has seen recurring squeezes — a case study in Module 1 (v2).`,
    },
    {
      id: 'back-middle-front',
      title: 'Back, Middle & Front Office',
      body: `In a commodity trading house:\n\n**Front Office** — traders, originators, sales\n- Execute trades, manage positions, engage with counterparties\n- P&L responsible\n\n**Middle Office** — risk management, compliance\n- Monitor trader positions vs limits\n- Mark-to-market, exposure reporting\n- Ensure regulatory compliance\n\n**Back Office** — operations, settlements, accounting\n- Confirm trades, arrange logistics, process invoices\n- Coordinate shipping documents, warehouse receipts\n- Settle financial transactions\n\nAll three must communicate seamlessly — a breakdown between front and back is how operational losses happen.`,
    },
  ],
}

export default topic
```

- [ ] **Step 5: Create 04-supply-demand.ts**

```ts
// src/content/module-1/04-supply-demand.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '04-supply-demand',
  title: 'Reading Supply & Demand',
  type: 'lecture',
  estimatedMinutes: 30,
  sections: [
    {
      id: 'supply-side',
      title: 'The Supply Side',
      body: `**What is supply?**\n\nIn commodity S&D models, "supply" is not simply production. The full picture:\n\n- **Production:** What is grown / extracted in a given crop year\n- **Beginning stocks:** Carryover inventory from the previous year\n- **Imports:** How much enters the market from external sources\n\n**Total supply = Production + Beginning stocks + Imports**\n\nKey insight: A bad harvest doesn't necessarily cause a price spike if stocks are abundant. The S&D model exists to contextualize production data.`,
    },
    {
      id: 'demand-side',
      title: 'The Demand Side',
      body: `**What is demand?**\n\nDemand in commodity markets is driven by:\n\n- **Consumption:** End-use by processors, manufacturers, households\n- **Exports:** Physical flow out of the producing country\n- **Ending stocks:** Inventory held at year-end (the residual)\n\n**Total demand = Consumption + Exports + Ending stocks**\n\nCritical question: What really drives demand for coffee?\n- Population growth in consuming countries\n- Per-capita income growth (Engel's law — coffee is a "luxury" in low-income markets)\n- Changing consumption patterns (capsule culture, specialty coffee boom)\n- Substitution (tea, other beverages)`,
    },
    {
      id: 'balance',
      title: 'The Balance: Stocks-to-Use Ratio',
      body: `The single most important S&D indicator is the **stocks-to-use ratio (STU)**:\n\n**STU = Ending stocks ÷ Annual consumption × 100%**\n\nA high STU signals comfortable supply — prices tend to be low.\nA low STU signals tight supply — prices tend to be elevated.\n\nExample thresholds (coffee, approximate):\n- STU > 25%: ample supply, weak price pressure\n- STU 15–25%: balanced market\n- STU < 15%: tightening — watch for backwardation and price spikes\n\nThe STU is published by: USDA (grains, oilseeds), ICO (coffee), ISO (cocoa/sugar), IEA (oil).`,
    },
    {
      id: 'sources',
      title: 'Where to Find S&D Data',
      body: `Key data sources:\n\n**Coffee:**\n- ICO (International Coffee Organization) — monthly trade stats\n- USDA GAIN reports — origin-by-origin crop estimates\n- Volcafé, ED&F Man, Rabobank — private trade house estimates\n\n**Energy:**\n- IEA (International Energy Agency) — monthly oil market report\n- EIA (US Energy Information Administration) — weekly inventory data\n\n**Grains/Oilseeds:**\n- USDA WASDE (World Agricultural Supply and Demand Estimates) — released monthly, market-moving event\n\nTraders build their own models by aggregating these sources and applying their own adjustments.`,
    },
  ],
}

export default topic
```

- [ ] **Step 6: Create 05-case-study-adayinlife.ts (v2 placeholder)**

```ts
// src/content/module-1/05-case-study-adayinlife.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '05-case-study-adayinlife',
  title: 'A Day in the Life of a Trader in Asia',
  type: 'case-study',
  estimatedMinutes: 45,
  v2: true,
  sections: [],
}

export default topic
```

- [ ] **Step 7: Update module-1/index.ts with all imports**

```ts
// src/content/module-1/index.ts
import intro from './00-introduction'
import panorama from './01-panorama'
import keyconcept from './02-keyconcept'
import marketStructure from './03-market-structure'
import supplyDemand from './04-supply-demand'
import dayInLife from './05-case-study-adayinlife'
import type { Topic } from '@/types/content'

export const topics: Topic[] = [
  intro,
  panorama,
  keyconcept,
  marketStructure,
  supplyDemand,
  dayInLife,
]
```

- [ ] **Step 8: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/content/module-1/
git commit -m "feat: Module 1 content — panorama, key concepts, market structure, S&D"
```

---

## Task 7: Module 2 content files

**Files:** `src/content/module-2/` — all topic files + update index.ts

- [ ] **Step 1: Create 01-differential.ts**

```ts
// src/content/module-2/01-differential.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '01-differential',
  title: 'The Differential & Basis Management',
  type: 'lecture',
  estimatedMinutes: 30,
  sections: [
    {
      id: 'what-is-differential',
      title: 'What is the Differential?',
      body: `The **differential** (also called the basis in grain markets) is the premium or discount at which physical coffee trades relative to the futures price.\n\n**Physical price = Futures price ± Differential**\n\nA coffee from Colombia might trade at ICE March + 35¢/lb.\nA lower-grade Vietnam Robusta might trade at LIFFE March − $30/MT.\n\nThe differential is the market's way of pricing everything the futures contract ignores: origin, quality, harvest timing, local logistics, certifiability.`,
    },
    {
      id: 'arbitrage-types',
      title: 'Three Types of Arbitrage',
      body: `**Origin arbitrage:** Buying in a cheaper origin and selling in a market where demand is higher. Example: buying Vietnam Robusta for European instant coffee manufacturers when the differential is attractive vs Brazilian Conillon.\n\n**Quality arbitrage:** Blending lower-grade lots with higher-grade to create a certifiable grade that trades near the exchange price, while the input cost was lower than the full premium.\n\n**Logistic arbitrage:** Routing physical cargo through an alternative port or routing to exploit a freight differential. Example: redirecting a shipment from Rotterdam to Hamburg when Hamburg warehouse receipts trade at a better basis.`,
    },
    {
      id: 'basis-risk',
      title: 'Basis Risk',
      body: `A trader who hedges price risk with futures eliminates **flat price risk** but retains **basis risk** — the risk that the differential moves adversely.\n\nExample:\n- Trader buys physical Robusta at LIFFE + $10/MT\n- Sells LIFFE futures at the same time (hedge)\n- Flat price risk: eliminated\n- Basis risk: if the differential widens to − $20/MT when the trader needs to sell, they lose $30/MT on the basis\n\nBasis risk is the core commercial risk that separates skilled physical traders from pure financial speculators.`,
    },
  ],
}

export default topic
```

- [ ] **Step 2: Create 02-knowyourexposure.ts**

```ts
// src/content/module-2/02-knowyourexposure.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '02-knowyourexposure',
  title: 'Understanding & Measuring Exposure',
  type: 'lecture',
  estimatedMinutes: 35,
  sections: [
    {
      id: 'what-is-exposure',
      title: 'What is Exposure?',
      body: `**Exposure** is the quantity of a commodity whose price you have not yet locked in.\n\nIf you own 1,000 MT of Robusta coffee with no futures hedge:\n- You have 1,000 MT of **long exposure**\n- Every $1/MT move in Robusta = $1,000 in P&L impact\n\nIf you have sold forward to a roaster but haven't bought the physical yet:\n- You have 1,000 MT of **short exposure**\n\nMeasuring exposure accurately across origins, maturities, and instruments is the prerequisite for hedging.`,
    },
    {
      id: 'types-of-risk',
      title: 'Six Types of Risk in Commodity Trading',
      body: `**6a. Counterparty risk:** The risk that your buyer or seller fails to perform. Mitigated by: credit lines, letters of credit (LC), trade credit insurance.\n\n**6b. Logistic risk:** Delays, vessel problems, port congestion, strikes. Mitigated by: logistics clauses in contracts, robust charter party terms.\n\n**6c. Quality risk:** The commodity delivered does not meet contract specifications. Mitigated by: pre-shipment inspection, quality clauses, arbitration mechanisms.\n\n**6d. Geographic risk:** Country-specific risks — export bans, FX controls, political instability. Mitigated by: diversified sourcing, political risk insurance.\n\n**6e. Political risk:** Sanctions, regulatory changes, nationalization. Mitigated by: OECD country coverage, geopolitical monitoring.\n\n**6f. Price / Differential risk:** Market price moves adversely. Mitigated by: futures hedging, options.`,
    },
    {
      id: 'hedge-ratio',
      title: 'The Hedge Ratio',
      body: `The **hedge ratio** is the proportion of your physical exposure you choose to hedge with futures.\n\n**Hedge ratio = Lots hedged × Lot size ÷ Physical volume**\n\n- 100% hedge: perfect flat-price protection, but you retain full basis risk and opportunity cost if prices move favorably\n- 50% hedge: partial protection, some speculative exposure retained\n- 0%: fully speculative — not acceptable for commercial traders with real physical commitments\n\nCommercial traders typically target 70–100% hedge ratios on committed volumes. The exact ratio depends on contract terms, price views, and risk appetite approved by management.`,
    },
  ],
  tool: {
    componentKey: 'hedging-calculator',
  },
}

export default topic
```

- [ ] **Step 3: Create 03-hedgingstrategies.ts**

```ts
// src/content/module-2/03-hedgingstrategies.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '03-hedgingstrategies',
  title: 'Hedging Principles & Risk Strategies',
  type: 'lecture',
  estimatedMinutes: 40,
  sections: [
    {
      id: 'hedging-principle',
      title: 'Why Commercial Hedging Opposes the Speculator',
      body: `A commercial trader hedges by taking the **opposite position in futures** to their physical position.\n\n- Physical long (owns coffee) → sell futures (short hedge)\n- Physical short (sold coffee not yet bought) → buy futures (long hedge)\n\nThe commercial hedger's futures position is always the opposite of the speculator's preferred direction. This is why speculators provide liquidity that commercials need — they are natural counterparties.\n\n**The speculator profits when prices move in one direction. The commercial hedger profits from the basis, not the direction.**`,
    },
    {
      id: 'incoterms',
      title: 'Incoterms & Logistics Risk Transfer',
      body: `**Incoterms** (International Commercial Terms) define where responsibility for goods, insurance, and freight transfers from seller to buyer.\n\nKey terms for commodity trading:\n\n**FOB (Free on Board):** Seller's responsibility ends when goods are loaded on the vessel at the export port. Buyer arranges and pays freight/insurance.\n\n**CIF (Cost, Insurance, Freight):** Seller pays freight and insurance to the destination port. Risk transfers when goods cross the ship's rail at origin.\n\n**CFR (Cost and Freight):** Like CIF but without insurance — buyer arranges their own.\n\n**DAP (Delivered at Place):** Seller delivers to a named destination, duty unpaid.\n\nChoosing the right Incoterm affects your logistics exposure, insurance responsibilities, and pricing competitiveness.`,
    },
    {
      id: 'robusta-vs-arabica',
      title: 'Robusta vs Arabica: Contract Specifics',
      body: `Physical coffee trades involve two very different contracts with important implications:\n\n**ICE-EU Robusta (London):**\n- 10 MT per lot\n- Delivery: approved warehouses in Europe (Rotterdam, Hamburg, Antwerp, Le Havre, Barcelona)\n- Grade: Grade 1, Free of Defects (FOD)\n- No tenderable parity between origins\n\n**ICE-US Arabica (New York):**\n- 37,500 lbs per lot (~17 MT)\n- Delivery: approved certified warehouses in licensed countries\n- Grade: washed Arabica, specific screen sizes\n- Country differentials apply on tender (e.g., Colombia at par, Ethiopia at a premium)\n\n**Mastering these specifications is a competitive advantage** — knowing which origins are certifiable, when delivery economics are favorable, and how tenders constrain prices (tenderable parity).`,
    },
    {
      id: 'tenderable-parity',
      title: 'Tenderable Parity: Theoretical Price Limits',
      body: `**Tenderable parity** is the all-in cost of delivering physical coffee against an exchange contract.\n\nFormula: **Parity = Origin cost + Freight + Handling + Warehouse fees − Exchange price**\n\nWhen this calculation is negative: it is cheaper to tender physical coffee against the exchange than to sell it in the cash market → sellers will tender → exchange price cannot rise too far above tenderable parity.\n\nWhen positive: physical is more expensive to deliver than the exchange pays → no one tenders → price can remain elevated.\n\nUnderstanding tenderable parity gives you a **fundamental anchor** for where physical prices must converge with futures over time.`,
    },
  ],
  quiz: {
    questions: [
      {
        id: 'q1',
        question: 'A trader owns 500 MT of physical Arabica coffee. To hedge, they should:',
        options: [
          'Buy Arabica futures (go long)',
          'Sell Arabica futures (go short)',
          'Buy Robusta futures (cross-hedge)',
          'Do nothing — hedging increases risk',
        ],
        correctIndex: 1,
        explanation: 'A physical long position (own the coffee) is hedged by selling futures (short hedge). The futures gain offsets any physical price decline.',
      },
      {
        id: 'q2',
        question: 'Under FOB terms, when does the buyer become responsible for the cargo?',
        options: [
          'When the contract is signed',
          'When the goods are loaded onto the vessel at origin',
          'When the vessel arrives at destination port',
          'When the buyer takes delivery at their warehouse',
        ],
        correctIndex: 1,
        explanation: 'FOB = Free on Board. Risk and responsibility transfer from seller to buyer when goods cross the ship\'s rail at the origin port.',
      },
    ],
  },
}

export default topic
```

- [ ] **Step 4: Create 04-shipping.ts**

```ts
// src/content/module-2/04-shipping.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '04-shipping',
  title: 'Shipping: Vessels, Chartering & Acceptability',
  type: 'lecture',
  estimatedMinutes: 35,
  sections: [
    {
      id: 'vessel-types',
      title: 'Classification of Vessels',
      body: `Commodity traders use different vessel types depending on the cargo:\n\n**Bulk carriers:** Open holds, designed for dry bulk cargo (grain, coal, iron ore). Not suitable for bagged coffee without liners.\n\n**Container ships:** Standardized TEU containers. Most coffee (bagged, green) moves in 20ft containers. Allows precise lot tracking and blending at origin.\n\n**Tankers:** For liquid bulk (crude oil, vegetable oils, chemicals). Clean vs dirty tankers (clean = no prior crude oil cargo).\n\n**Ro-Ro (Roll-on/Roll-off):** For vehicles and machinery. Rare in coffee/energy.`,
    },
    {
      id: 'chartering',
      title: 'Vessel Chartering',
      body: `**Types of charter party:**\n\n**Voyage charter (spot):** Shipowner provides vessel + crew for a single voyage between named ports. Shipowner bears fuel costs. Charterer pays freight per MT or per day.\n\n**Time charter:** Charterer hires the vessel for a period (months/years). Charterer directs the vessel's employment, pays fuel. Shipowner provides crew.\n\n**Bareboat charter:** Charterer takes full operational control including crew. Long-term, rare for commodity traders.\n\n**Key charter party terms:**\n- Laytime: allowed loading/discharge time\n- Demurrage: penalty for exceeding laytime (per day rate)\n- Despatch: reward for finishing faster than laytime (half demurrage rate)\n- Force majeure: events beyond control that suspend laytime`,
    },
    {
      id: 'vessel-acceptability',
      title: 'Vessel Acceptability',
      body: `Not every vessel can load coffee. Contracts specify acceptability criteria:\n\n**For coffee (bagged, green):**\n- Must be "clean, dry, free from odors, fit for the carriage of coffee"\n- Previous cargo restrictions: no fish meal, chemicals, fertilizers, or other odorous/contaminating cargoes\n- Age limits: many buyers reject vessels over 20–25 years old\n- P&I Club insurance required (Protection & Indemnity)\n\n**Inspection:**\n- Pre-loading inspection by an independent surveyor (SGS, Bureau Veritas, Intertek)\n- Surveyor checks hold cleanliness and condition before loading begins\n\nFailing vessel acceptability = force majeure or contract dispute. Knowing these rules is essential for logistics execution.`,
    },
  ],
}

export default topic
```

- [ ] **Step 5: Create 05-FOBtoCIFtrades.ts (v2 placeholder)**

```ts
// src/content/module-2/05-FOBtoCIFtrades.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '05-FOBtoCIFtrades',
  title: 'FOB to CIF Trade Simulation',
  type: 'simulation',
  estimatedMinutes: 60,
  v2: true,
  sections: [],
}

export default topic
```

- [ ] **Step 6: Update module-2/index.ts**

```ts
// src/content/module-2/index.ts
import differential from './01-differential'
import knowExposure from './02-knowyourexposure'
import hedging from './03-hedgingstrategies'
import shipping from './04-shipping'
import fobToCif from './05-FOBtoCIFtrades'
import type { Topic } from '@/types/content'

export const topics: Topic[] = [
  differential,
  knowExposure,
  hedging,
  shipping,
  fobToCif,
]
```

- [ ] **Step 7: Verify TypeScript and commit**

```bash
npx tsc --noEmit
git add src/content/module-2/
git commit -m "feat: Module 2 content — differential, exposure, hedging, shipping"
```

---

## Task 8: Module 3 content files

**Files:** `src/content/module-3/` — all topic files + update index.ts

- [ ] **Step 1: Create 01-options.ts**

```ts
// src/content/module-3/01-options.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '01-options',
  title: 'Options in Commodity Markets',
  type: 'lecture',
  estimatedMinutes: 40,
  sections: [
    {
      id: 'options-basics',
      title: 'Options: The Right Without the Obligation',
      body: `An **option** gives the buyer the right — but not the obligation — to buy or sell a futures contract at a specified price (strike) before or at expiry.\n\n**Call option:** Right to buy → used by buyers to cap their cost\n**Put option:** Right to sell → used by sellers to set a price floor\n\n**Premium:** The option buyer pays an upfront premium to the seller. This is the maximum loss for the buyer; the seller's risk is theoretically unlimited (on calls).\n\nOptions are priced by: intrinsic value + time value. Key Greeks: Delta (sensitivity to price), Theta (time decay), Vega (sensitivity to volatility).`,
    },
    {
      id: 'physical-options',
      title: 'Physical Options: Storage & Processing',
      body: `In physical commodity markets, "optionality" exists in infrastructure itself:\n\n**Storage option:** Having a warehouse gives you the option to wait for better prices rather than selling now. You exercise this option when: expected future price > current price + storage cost.\n\n**Refinery option:** Having a refinery gives you the option to process crude into products (gasoline, diesel) or not. You exercise when the "crack spread" (product price − crude cost) covers processing costs.\n\n**Blending option:** Owning multiple coffee origins gives you the option to blend to certifiable grade when the exchange price makes tendering economic.\n\nPhysical options are not traded on exchanges but are core to how integrated commodity companies create value.`,
    },
    {
      id: 'strategies',
      title: 'Common Option Strategies',
      body: `**Protective put (producer hedge):** Producer buys put options to set a price floor while retaining upside if prices rise. Cost = option premium.\n\n**Cap (consumer hedge):** Buyer purchases call options to cap their purchase price. Retains benefit if prices fall.\n\n**Collar:** Producer buys puts AND sells calls. Net premium is low or zero (zero-cost collar). Sets a price floor and ceiling. Most common in commercial hedging programs.\n\n**Straddle/Strangle:** Buy both call and put. Profits if prices move significantly in either direction. Used by traders expecting high volatility around a known event (WASDE release, harvest report).`,
    },
  ],
  tool: {
    componentKey: 'basis-calculator',
  },
}

export default topic
```

- [ ] **Step 2: Create 02-esg-eudr.ts**

```ts
// src/content/module-3/02-esg-eudr.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '02-esg-eudr',
  title: 'ESG & EUDR: The Regulatory Revolution',
  type: 'lecture',
  estimatedMinutes: 35,
  sections: [
    {
      id: 'what-is-eudr',
      title: 'What is the EUDR?',
      body: `The **EU Deforestation Regulation (EUDR)** — Regulation (EU) 2023/1115 — came into force in June 2023. It requires that seven key commodities (coffee, cocoa, cattle, soy, palm oil, wood, rubber) and derived products placed on the EU market must:\n\n1. Not have been produced on land deforested after December 31, 2020\n2. Be traceable to the plot of land where they were produced (geolocation data)\n3. Be covered by a **due diligence statement** filed by the operator before import\n\nNon-compliance: fines up to 4% of EU turnover, market access ban, seizure of goods.`,
    },
    {
      id: 'impact-on-coffee',
      title: 'Impact on Coffee Supply Chains',
      body: `Coffee is one of the most exposed commodities. Key challenges:\n\n**Traceability to farm level:** Traditional coffee supply chains aggregate beans from thousands of smallholders. Mapping each to GPS coordinates with deforestation risk assessment is operationally complex and costly.\n\n**Producing country readiness:** Vietnam (largest Robusta producer) and Brazil (largest Arabica) have varying levels of national monitoring system infrastructure recognized by the EU.\n\n**Price impact:** EUDR-compliant coffee commands a premium in the EU market. Non-compliant origins face discount or exclusion. This is reshaping differentials for Vietnamese, Indonesian, and Brazilian origins.\n\n**Opportunity:** Traders who built traceability infrastructure early gain competitive advantage — their supply is certifiable when others cannot ship.`,
    },
    {
      id: 'beyond-eudr',
      title: 'Beyond EUDR: The Broader ESG Agenda',
      body: `EUDR is one piece of a broader regulatory shift:\n\n**Corporate Sustainability Due Diligence Directive (CSDDD):** Requires large EU companies to identify, prevent, and address adverse human rights and environmental impacts in their supply chains.\n\n**Carbon border adjustment mechanism (CBAM):** Applies carbon pricing to imports of carbon-intensive goods (initially steel, cement, fertilizers — coffee not yet in scope).\n\n**Science-Based Targets (SBTs):** Many major roasters (Nestlé, JDE, Lavazza) have committed to net-zero supply chains, pushing ESG requirements upstream to traders and producers.\n\n**Trader response:** ESG is no longer reputational — it affects market access, financing costs (green bonds, sustainability-linked loans), and counterparty selection.`,
    },
  ],
}

export default topic
```

- [ ] **Step 3: Create 03-advancedsupply-demand.ts**

```ts
// src/content/module-3/03-advancedsupply-demand.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '03-advancedsupply-demand',
  title: 'Advanced S&D Modeling',
  type: 'lecture',
  estimatedMinutes: 45,
  sections: [
    {
      id: 'building-a-model',
      title: 'Building an S&D Model',
      body: `A commodity S&D model is a structured forecast of supply and demand variables to estimate the ending stocks balance and derive a price view.\n\n**Standard structure (annual, crop year basis):**\n\n| Supply | Demand |\n|--------|--------|\n| Opening stocks | Consumption |\n| Production | Exports |\n| Imports | Ending stocks |\n| **Total supply** | **Total demand** |\n\nBalance = Total supply − Total demand = Ending stocks (must equal)\n\nThe model's value lies not in the number — it's in the **scenario analysis**: what if Brazil production is down 5%? What if Chinese demand grows faster than expected?`,
    },
    {
      id: 'trader-2',
      title: 'Trader 2.0: Data & Technology',
      body: `The next generation of commodity traders uses data to anticipate S&D shifts before they appear in official reports:\n\n**Satellite imagery:** Crop condition monitoring (NDVI index), deforestation detection, inventory levels at ports/silos from space.\n\n**AIS (Automatic Identification System):** Real-time vessel tracking — count ships loading at origin ports to infer export flow before official customs data.\n\n**Weather modeling:** ENSO (El Niño/La Niña) cycle prediction 6–12 months forward to anticipate drought or flood conditions in key origins.\n\n**Alternative data:** Social media crop reports from local farmers, drone imagery, IoT sensors in warehouses.\n\nData gives an edge in three areas: anticipating supply disruptions, measuring demand inflections, and identifying operational risks (counterparty stress, logistics bottlenecks).`,
    },
    {
      id: 'operational-risk',
      title: 'Operational Risk in the Data Age',
      body: `Beyond price risk, Trader 2.0 uses data to manage:\n\n**Counterparty risk:** Credit default models using public financials + payment behavior + trade exposure.\n\n**Non-execution risk:** Probability that a supplier fails to deliver. Indicators: past performance, local liquidity stress, currency moves at origin.\n\n**Logistics risk:** Congestion signals at ports (AIS dwell times), labor disputes, customs processing times.\n\nThe challenge: **data quality and interpretation**. Bad data acted on confidently is worse than no data. The trader's role evolves from pure relationship-based deal making to data-informed commercial judgment.`,
    },
  ],
}

export default topic
```

- [ ] **Step 4: Create 04-cherry-to-terminal.ts (v2 placeholder)**

```ts
// src/content/module-3/04-cherry-to-terminal.ts
import type { Topic } from '@/types/content'

const topic: Topic = {
  id: '04-cherry-to-terminal',
  title: 'From Cherry to Terminal: Group Simulation',
  type: 'simulation',
  estimatedMinutes: 90,
  v2: true,
  sections: [],
}

export default topic
```

- [ ] **Step 5: Update module-3/index.ts**

```ts
// src/content/module-3/index.ts
import options from './01-options'
import esgEudr from './02-esg-eudr'
import advancedSD from './03-advancedsupply-demand'
import cherryToTerminal from './04-cherry-to-terminal'
import type { Topic } from '@/types/content'

export const topics: Topic[] = [
  options,
  esgEudr,
  advancedSD,
  cherryToTerminal,
]
```

- [ ] **Step 6: Verify TypeScript and commit**

```bash
npx tsc --noEmit
git add src/content/module-3/
git commit -m "feat: Module 3 content — options, ESG/EUDR, advanced S&D"
```

---

## Task 9: Module dashboard UI

**Files:**
- Create: `src/components/ModuleTabs.tsx`
- Create: `src/components/TopicCard.tsx`
- Create: `src/app/module/[id]/page.tsx`
- Create: `src/__tests__/components/TopicCard.test.tsx`

- [ ] **Step 1: Write failing TopicCard tests**

```tsx
// src/__tests__/components/TopicCard.test.tsx
import { render, screen } from '@testing-library/react'
import TopicCard from '@/components/TopicCard'
import type { Topic } from '@/types/content'

const lectureTopic: Topic = {
  id: 'test-lecture',
  title: 'Test Lecture Topic',
  type: 'lecture',
  estimatedMinutes: 20,
  sections: [],
}

const v2Topic: Topic = {
  id: 'test-v2',
  title: 'Coming Feature',
  type: 'simulation',
  estimatedMinutes: 60,
  v2: true,
}

test('renders topic title', () => {
  render(<TopicCard topic={lectureTopic} moduleId={1} />)
  expect(screen.getByText('Test Lecture Topic')).toBeInTheDocument()
})

test('renders type badge', () => {
  render(<TopicCard topic={lectureTopic} moduleId={1} />)
  expect(screen.getByText('Lecture')).toBeInTheDocument()
})

test('links to section reader for lecture type', () => {
  render(<TopicCard topic={lectureTopic} moduleId={1} />)
  expect(screen.getByRole('link')).toHaveAttribute('href', '/module/1/section/test-lecture')
})

test('renders Coming Soon badge for v2 topics', () => {
  render(<TopicCard topic={v2Topic} moduleId={1} />)
  expect(screen.getByText('Coming Soon')).toBeInTheDocument()
})

test('v2 topics do not render as links', () => {
  render(<TopicCard topic={v2Topic} moduleId={1} />)
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- --testPathPattern=TopicCard
```

Expected: FAIL — `Cannot find module '@/components/TopicCard'`

- [ ] **Step 3: Create TopicCard component**

```tsx
// src/components/TopicCard.tsx
import Link from 'next/link'
import type { Topic } from '@/types/content'

const TYPE_BADGE: Record<Topic['type'], { label: string; className: string }> = {
  lecture:      { label: 'Lecture',     className: 'bg-blue-900 text-blue-300' },
  'case-study': { label: 'Case Study',  className: 'bg-purple-900 text-purple-300' },
  quiz:         { label: 'Quiz',        className: 'bg-green-900 text-green-300' },
  tool:         { label: 'Tool',        className: 'bg-orange-900 text-orange-300' },
  simulation:   { label: 'Simulation',  className: 'bg-rose-900 text-rose-300' },
}

function getHref(topic: Topic, moduleId: number): string {
  if (topic.type === 'quiz') return `/module/${moduleId}/quiz/${topic.id}`
  if (topic.type === 'tool') return `/module/${moduleId}/tool/${topic.id}`
  return `/module/${moduleId}/section/${topic.id}`
}

type Props = { topic: Topic; moduleId: number }

export default function TopicCard({ topic, moduleId }: Props) {
  const badge = TYPE_BADGE[topic.type]

  if (topic.v2) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 opacity-50 cursor-not-allowed select-none">
        <div className="flex items-start justify-between mb-3">
          <span className={`text-xs font-medium px-2 py-1 rounded ${badge.className}`}>
            {badge.label}
          </span>
          <span className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded">Coming Soon</span>
        </div>
        <h3 className="text-white font-semibold text-sm leading-snug">{topic.title}</h3>
        <p className="text-slate-500 text-xs mt-2">{topic.estimatedMinutes} min</p>
      </div>
    )
  }

  return (
    <Link href={getHref(topic, moduleId)}>
      <div className="bg-slate-800 border border-slate-700 hover:border-amber-500 rounded-xl p-5 transition-colors cursor-pointer h-full">
        <div className="flex items-start justify-between mb-3">
          <span className={`text-xs font-medium px-2 py-1 rounded ${badge.className}`}>
            {badge.label}
          </span>
          <span className="text-slate-500 text-xs">{topic.estimatedMinutes} min</span>
        </div>
        <h3 className="text-white font-semibold text-sm leading-snug">{topic.title}</h3>
      </div>
    </Link>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- --testPathPattern=TopicCard
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Create ModuleTabs component**

```tsx
// src/components/ModuleTabs.tsx
import Link from 'next/link'
import { modules } from '@/content'

type Props = { activeId: number }

export default function ModuleTabs({ activeId }: Props) {
  return (
    <nav className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-6 flex overflow-x-auto">
        {modules.map(mod => (
          <Link
            key={mod.id}
            href={`/module/${mod.id}`}
            className={`px-5 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              mod.id === activeId
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
            }`}
          >
            <span className="hidden md:inline">Module {mod.id} — </span>
            <span>{mod.title}</span>
            <span className="hidden lg:inline text-xs ml-2 opacity-60">({mod.level})</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
```

- [ ] **Step 6: Create module dashboard page**

```tsx
// src/app/module/[id]/page.tsx
import { notFound } from 'next/navigation'
import { modules } from '@/content'
import ModuleTabs from '@/components/ModuleTabs'
import TopicCard from '@/components/TopicCard'

type Props = { params: { id: string } }

export default function ModulePage({ params }: Props) {
  const moduleId = parseInt(params.id)
  if (isNaN(moduleId) || moduleId < 1 || moduleId > 3) notFound()

  const mod = modules[moduleId - 1]

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-lg font-bold text-white">Commodity Trading Lecture</h1>
        </div>
      </header>
      <ModuleTabs activeId={moduleId} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white">{mod.title}</h2>
          <p className="text-slate-400 text-sm mt-1">{mod.level}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mod.topics.map(topic => (
            <TopicCard key={topic.id} topic={topic} moduleId={moduleId} />
          ))}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 7: Verify in browser**

```bash
npm run dev
```

Visit http://localhost:3000/module/1 — should show module dashboard with topic cards, amber active tab, Coming Soon badge on v2 topics.

- [ ] **Step 8: Commit**

```bash
git add src/components/ModuleTabs.tsx src/components/TopicCard.tsx src/app/module/ src/__tests__/components/TopicCard.test.tsx
git commit -m "feat: module dashboard with tabs and topic cards"
```

---

## Task 10: Section reader

**Files:**
- Create: `src/components/Breadcrumb.tsx`
- Create: `src/components/ProgressBar.tsx`
- Create: `src/components/SectionReader.tsx`
- Create: `src/app/module/[id]/section/[sectionId]/page.tsx`
- Create: `src/__tests__/components/SectionReader.test.tsx`

- [ ] **Step 1: Write failing SectionReader tests**

```tsx
// src/__tests__/components/SectionReader.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import SectionReader from '@/components/SectionReader'
import type { Section } from '@/types/content'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const sections: Section[] = [
  { id: 's1', title: 'Section One', body: 'Body of section one' },
  { id: 's2', title: 'Section Two', body: 'Body of section two' },
  { id: 's3', title: 'Section Three', body: 'Body of section three' },
]

test('renders first section title and body', () => {
  render(<SectionReader sections={sections} moduleId={1} topicTitle="Test" />)
  expect(screen.getByText('Section One')).toBeInTheDocument()
  expect(screen.getByText(/Body of section one/)).toBeInTheDocument()
})

test('Back button is disabled on first section', () => {
  render(<SectionReader sections={sections} moduleId={1} topicTitle="Test" />)
  expect(screen.getByRole('button', { name: /Back/ })).toBeDisabled()
})

test('Continue advances to next section', () => {
  render(<SectionReader sections={sections} moduleId={1} topicTitle="Test" />)
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
  expect(screen.getByText('Section Two')).toBeInTheDocument()
})

test('last section shows "Back to Module" button', () => {
  render(<SectionReader sections={sections} moduleId={1} topicTitle="Test" initialIndex={2} />)
  expect(screen.getByRole('button', { name: /Back to Module/ })).toBeInTheDocument()
})

test('ArrowRight key advances section', () => {
  render(<SectionReader sections={sections} moduleId={1} topicTitle="Test" />)
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(screen.getByText('Section Two')).toBeInTheDocument()
})

test('ArrowLeft key goes to previous section', () => {
  render(<SectionReader sections={sections} moduleId={1} topicTitle="Test" initialIndex={1} />)
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  expect(screen.getByText('Section One')).toBeInTheDocument()
})

test('shows section counter', () => {
  render(<SectionReader sections={sections} moduleId={1} topicTitle="Test" />)
  expect(screen.getByText('1 / 3')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run — verify they fail**

```bash
npm test -- --testPathPattern=SectionReader
```

Expected: FAIL — `Cannot find module '@/components/SectionReader'`

- [ ] **Step 3: Create Breadcrumb**

```tsx
// src/components/Breadcrumb.tsx
import Link from 'next/link'

type Props = { moduleId: number; topicTitle: string }

export default function Breadcrumb({ moduleId, topicTitle }: Props) {
  return (
    <nav className="bg-slate-800 border-b border-slate-700 px-6 py-3">
      <div className="max-w-3xl mx-auto flex items-center gap-2 text-sm text-slate-400">
        <Link href={`/module/${moduleId}`} className="hover:text-amber-400 transition-colors">
          Module {moduleId}
        </Link>
        <span>›</span>
        <span className="text-slate-200 truncate">{topicTitle}</span>
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Create ProgressBar**

```tsx
// src/components/ProgressBar.tsx
type Props = { current: number; total: number }

export default function ProgressBar({ current, total }: Props) {
  const pct = total === 0 ? 0 : (current / total) * 100
  return (
    <div className="h-1 bg-slate-700 w-full">
      <div
        className="h-full bg-amber-500 transition-all duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Create SectionReader**

```tsx
// src/components/SectionReader.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import type { Section } from '@/types/content'
import Breadcrumb from './Breadcrumb'
import ProgressBar from './ProgressBar'

type Props = {
  sections: Section[]
  moduleId: number
  topicTitle: string
  initialIndex?: number
}

export default function SectionReader({ sections, moduleId, topicTitle, initialIndex = 0 }: Props) {
  const [current, setCurrent] = useState(initialIndex)
  const router = useRouter()
  const section = sections[current]
  const isLast = current === sections.length - 1
  const isFirst = current === 0

  const goNext = useCallback(() => {
    if (isLast) {
      router.push(`/module/${moduleId}`)
    } else {
      setCurrent(i => i + 1)
    }
  }, [isLast, moduleId, router])

  const goPrev = useCallback(() => {
    if (!isFirst) setCurrent(i => i - 1)
  }, [isFirst])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev])

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Breadcrumb moduleId={moduleId} topicTitle={topicTitle} />
      <ProgressBar current={current + 1} total={sections.length} />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-bold text-amber-400 mb-6">{section.title}</h2>
        <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed">
          <ReactMarkdown>{section.body}</ReactMarkdown>
        </div>
        <div className="flex justify-between items-center mt-12 pt-6 border-t border-slate-800">
          <button
            onClick={goPrev}
            disabled={isFirst}
            className="px-6 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Back
          </button>
          <span className="text-slate-500 text-sm">{current + 1} / {sections.length}</span>
          <button
            onClick={goNext}
            className="px-6 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition-colors"
          >
            {isLast ? 'Back to Module' : 'Continue →'}
          </button>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
npm test -- --testPathPattern=SectionReader
```

Expected: PASS — 7 tests passing.

- [ ] **Step 7: Create section page**

```tsx
// src/app/module/[id]/section/[sectionId]/page.tsx
import { notFound } from 'next/navigation'
import { modules } from '@/content'
import SectionReader from '@/components/SectionReader'

type Props = { params: { id: string; sectionId: string } }

export default function SectionPage({ params }: Props) {
  const moduleId = parseInt(params.id)
  const mod = modules[moduleId - 1]
  if (!mod) notFound()

  const topic = mod.topics.find(t => t.id === params.sectionId)
  if (!topic || !topic.sections || topic.sections.length === 0) notFound()

  return (
    <SectionReader
      sections={topic.sections}
      moduleId={moduleId}
      topicTitle={topic.title}
    />
  )
}
```

- [ ] **Step 8: Verify in browser**

Visit http://localhost:3000/module/1/section/00-introduction — should show section reader with amber title, markdown body, progress bar, breadcrumb, and Continue/Back buttons.

- [ ] **Step 9: Commit**

```bash
git add src/components/Breadcrumb.tsx src/components/ProgressBar.tsx src/components/SectionReader.tsx src/app/module/[id]/section/ src/__tests__/components/SectionReader.test.tsx
git commit -m "feat: section reader with keyboard navigation and markdown rendering"
```

---

## Task 11: Quiz UI

**Files:**
- Create: `src/components/QuizQuestion.tsx`
- Create: `src/components/QuizSummary.tsx`
- Create: `src/app/module/[id]/quiz/[quizId]/QuizRunner.tsx`
- Create: `src/app/module/[id]/quiz/[quizId]/page.tsx`
- Create: `src/__tests__/components/QuizQuestion.test.tsx`

- [ ] **Step 1: Write failing QuizQuestion tests**

```tsx
// src/__tests__/components/QuizQuestion.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import QuizQuestion from '@/components/QuizQuestion'
import type { Question } from '@/types/content'

const question: Question = {
  id: 'q1',
  question: 'What is 2 + 2?',
  options: ['3', '4', '5', '6'],
  correctIndex: 1,
  explanation: 'Basic arithmetic: 2 + 2 = 4.',
}

const onAnswer = jest.fn()

beforeEach(() => onAnswer.mockClear())

test('renders question and all 4 options', () => {
  render(<QuizQuestion question={question} questionNumber={1} total={5} onAnswer={onAnswer} />)
  expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument()
  expect(screen.getByText(/3/)).toBeInTheDocument()
  expect(screen.getByText(/4/)).toBeInTheDocument()
  expect(screen.getByText(/5/)).toBeInTheDocument()
  expect(screen.getByText(/6/)).toBeInTheDocument()
})

test('calls onAnswer(true) when correct option clicked', async () => {
  jest.useFakeTimers()
  render(<QuizQuestion question={question} questionNumber={1} total={5} onAnswer={onAnswer} />)
  fireEvent.click(screen.getAllByRole('button')[1]) // index 1 = "4" = correct
  jest.runAllTimers()
  expect(onAnswer).toHaveBeenCalledWith(true)
  jest.useRealTimers()
})

test('calls onAnswer(false) when wrong option clicked', async () => {
  jest.useFakeTimers()
  render(<QuizQuestion question={question} questionNumber={1} total={5} onAnswer={onAnswer} />)
  fireEvent.click(screen.getAllByRole('button')[0]) // index 0 = "3" = wrong
  jest.runAllTimers()
  expect(onAnswer).toHaveBeenCalledWith(false)
  jest.useRealTimers()
})

test('shows explanation after answering', () => {
  render(<QuizQuestion question={question} questionNumber={1} total={5} onAnswer={onAnswer} />)
  fireEvent.click(screen.getAllByRole('button')[1])
  expect(screen.getByText('Basic arithmetic: 2 + 2 = 4.')).toBeInTheDocument()
})

test('disables all buttons after answering', () => {
  render(<QuizQuestion question={question} questionNumber={1} total={5} onAnswer={onAnswer} />)
  fireEvent.click(screen.getAllByRole('button')[0])
  screen.getAllByRole('button').forEach(btn => {
    expect(btn).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run — verify they fail**

```bash
npm test -- --testPathPattern=QuizQuestion
```

Expected: FAIL — `Cannot find module '@/components/QuizQuestion'`

- [ ] **Step 3: Create QuizQuestion component**

```tsx
// src/components/QuizQuestion.tsx
'use client'

import { useState } from 'react'
import type { Question } from '@/types/content'

type Props = {
  question: Question
  questionNumber: number
  total: number
  onAnswer: (correct: boolean) => void
}

export default function QuizQuestion({ question, questionNumber, total, onAnswer }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const answered = selected !== null

  function handleSelect(index: number) {
    if (answered) return
    setSelected(index)
    setTimeout(() => onAnswer(index === question.correctIndex), 800)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <p className="text-slate-500 text-sm mb-4">Question {questionNumber} / {total}</p>
      <h2 className="text-xl font-semibold text-white mb-8 leading-snug">{question.question}</h2>
      <div className="flex flex-col gap-3">
        {question.options.map((option, i) => {
          let cls = 'bg-slate-800 border-slate-700 text-slate-200 hover:border-amber-500 hover:bg-slate-750'
          if (answered) {
            if (i === question.correctIndex) cls = 'bg-green-900 border-green-600 text-green-100'
            else if (i === selected) cls = 'bg-red-900 border-red-700 text-red-100'
            else cls = 'bg-slate-800 border-slate-700 text-slate-500'
          }
          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={answered}
              className={`border rounded-lg px-5 py-4 text-left transition-colors ${cls} disabled:cursor-default`}
            >
              <span className="font-medium mr-3 text-sm">{['A', 'B', 'C', 'D'][i]}.</span>
              {option}
            </button>
          )
        })}
      </div>
      {answered && question.explanation && (
        <p className="mt-6 text-slate-400 text-sm border-l-2 border-amber-500 pl-4 leading-relaxed">
          {question.explanation}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- --testPathPattern=QuizQuestion
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Create QuizSummary**

```tsx
// src/components/QuizSummary.tsx
import Link from 'next/link'

type Props = { score: number; total: number; moduleId: number }

export default function QuizSummary({ score, total, moduleId }: Props) {
  const pct = Math.round((score / total) * 100)
  const message = pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Good effort!' : 'Keep reviewing.'

  return (
    <div className="max-w-md mx-auto px-6 py-20 text-center">
      <div className="text-6xl font-bold text-amber-400 mb-2">{pct}%</div>
      <p className="text-slate-300 mb-1">{score} / {total} correct</p>
      <p className="text-slate-500 text-sm mb-10">{message}</p>
      <Link
        href={`/module/${moduleId}`}
        className="block px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg transition-colors"
      >
        Back to Module
      </Link>
    </div>
  )
}
```

- [ ] **Step 6: Create QuizRunner (client state manager)**

```tsx
// src/app/module/[id]/quiz/[quizId]/QuizRunner.tsx
'use client'

import { useState } from 'react'
import QuizQuestion from '@/components/QuizQuestion'
import QuizSummary from '@/components/QuizSummary'
import Breadcrumb from '@/components/Breadcrumb'
import ProgressBar from '@/components/ProgressBar'
import type { Question } from '@/types/content'

type Props = {
  questions: Question[]
  moduleId: number
  topicTitle: string
}

export default function QuizRunner({ questions, moduleId, topicTitle }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)

  function handleAnswer(correct: boolean) {
    if (correct) setScore(s => s + 1)
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(i => i + 1)
    } else {
      setDone(true)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <QuizSummary score={score} total={questions.length} moduleId={moduleId} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Breadcrumb moduleId={moduleId} topicTitle={topicTitle} />
      <ProgressBar current={currentIndex + 1} total={questions.length} />
      <QuizQuestion
        question={questions[currentIndex]}
        questionNumber={currentIndex + 1}
        total={questions.length}
        onAnswer={handleAnswer}
      />
    </div>
  )
}
```

- [ ] **Step 7: Create quiz page**

```tsx
// src/app/module/[id]/quiz/[quizId]/page.tsx
import { notFound } from 'next/navigation'
import { modules } from '@/content'
import QuizRunner from './QuizRunner'

type Props = { params: { id: string; quizId: string } }

export default function QuizPage({ params }: Props) {
  const moduleId = parseInt(params.id)
  const mod = modules[moduleId - 1]
  if (!mod) notFound()

  const topic = mod.topics.find(t => t.id === params.quizId)
  if (!topic || !topic.quiz || topic.quiz.questions.length === 0) notFound()

  return (
    <QuizRunner
      questions={topic.quiz.questions}
      moduleId={moduleId}
      topicTitle={topic.title}
    />
  )
}
```

- [ ] **Step 8: Verify in browser**

Visit http://localhost:3000/module/1/quiz/01-panorama — should show first quiz question with 4 options. Select one — immediate green/red feedback. After last question, summary screen with score and Back to Module link.

- [ ] **Step 9: Commit**

```bash
git add src/components/QuizQuestion.tsx src/components/QuizSummary.tsx "src/app/module/[id]/quiz/" src/__tests__/components/QuizQuestion.test.tsx
git commit -m "feat: quiz with MCQ, immediate feedback, and score summary"
```

---

## Task 12: Calculator tools

**Files:**
- Create: `src/components/tools/HedgingCalculator.tsx`
- Create: `src/components/tools/BasisCalculator.tsx`
- Modify: `src/tools/index.ts`
- Create: `src/app/module/[id]/tool/[toolId]/page.tsx`
- Create: `src/__tests__/components/tools/HedgingCalculator.test.tsx`

- [ ] **Step 1: Write failing HedgingCalculator tests**

```tsx
// src/__tests__/components/tools/HedgingCalculator.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import HedgingCalculator from '@/components/tools/HedgingCalculator'

test('renders all four input fields', () => {
  render(<HedgingCalculator />)
  expect(screen.getByLabelText(/Position/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/Lot size/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/Price/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/Hedge ratio/i)).toBeInTheDocument()
})

test('default values produce correct covered amount', () => {
  render(<HedgingCalculator />)
  // 100 lots × 10 MT × $2,450/MT × 80% = $1,960,000
  expect(screen.getByText(/1,960,000/)).toBeInTheDocument()
})

test('changing lots updates output reactively', () => {
  render(<HedgingCalculator />)
  fireEvent.change(screen.getByLabelText(/Position/i), { target: { value: '50' } })
  // 50 × 10 × 2450 × 80% = $980,000
  expect(screen.getByText(/980,000/)).toBeInTheDocument()
})

test('changing hedge ratio to 100% shows full exposure as covered', () => {
  render(<HedgingCalculator />)
  fireEvent.change(screen.getByLabelText(/Hedge ratio/i), { target: { value: '100' } })
  // 100 × 10 × 2450 × 100% = $2,450,000 covered, $0 uncovered
  expect(screen.getByText(/2,450,000/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run — verify they fail**

```bash
npm test -- --testPathPattern=HedgingCalculator
```

Expected: FAIL — `Cannot find module '@/components/tools/HedgingCalculator'`

- [ ] **Step 3: Create HedgingCalculator**

```tsx
// src/components/tools/HedgingCalculator.tsx
'use client'

import { useState } from 'react'

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-slate-400 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full bg-slate-700 text-white px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
      />
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`font-semibold ${color ?? 'text-white'}`}>{value}</span>
    </div>
  )
}

export default function HedgingCalculator() {
  const [lots, setLots] = useState(100)
  const [lotSizeMT, setLotSizeMT] = useState(10)
  const [pricePerMT, setPricePerMT] = useState(2450)
  const [hedgeRatio, setHedgeRatio] = useState(80)

  const totalMT = lots * lotSizeMT
  const totalUSD = totalMT * pricePerMT
  const coveredUSD = totalUSD * (hedgeRatio / 100)
  const uncoveredUSD = totalUSD - coveredUSD

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-bold text-amber-400 mb-6">Hedging Exposure Calculator</h2>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Field label="Position (lots)" value={lots} onChange={setLots} min={1} />
        <Field label="Lot size (MT)" value={lotSizeMT} onChange={setLotSizeMT} min={1} />
        <Field label="Price ($/MT)" value={pricePerMT} onChange={setPricePerMT} min={0} />
        <Field label="Hedge ratio (%)" value={hedgeRatio} onChange={setHedgeRatio} min={0} max={100} />
      </div>
      <div className="bg-slate-800 rounded-xl p-6 space-y-3">
        <Row label="Total exposure (MT)" value={`${totalMT.toLocaleString()} MT`} />
        <Row label="Total exposure (USD)" value={fmtUSD(totalUSD)} />
        <div className="border-t border-slate-700 pt-3 space-y-3">
          <Row label="Covered" value={fmtUSD(coveredUSD)} color="text-green-400" />
          <Row label="Uncovered" value={fmtUSD(uncoveredUSD)} color="text-red-400" />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- --testPathPattern=HedgingCalculator
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Create BasisCalculator**

```tsx
// src/components/tools/BasisCalculator.tsx
'use client'

import { useState } from 'react'

export default function BasisCalculator() {
  const [futuresPrice, setFuturesPrice] = useState(2500)
  const [differential, setDifferential] = useState(35)
  const [fxRate, setFxRate] = useState(1)

  const physicalUSD = futuresPrice + differential
  const physicalLocal = physicalUSD * fxRate
  const diffColor = differential >= 0 ? 'text-green-400' : 'text-red-400'

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-bold text-amber-400 mb-6">Basis / Differential Calculator</h2>
      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { label: 'Futures price ($/MT)', value: futuresPrice, set: setFuturesPrice, step: 1 },
          { label: 'Differential (±$/MT)', value: differential, set: setDifferential, step: 1 },
          { label: 'FX rate (USD → local)', value: fxRate, set: setFxRate, step: 0.01 },
        ].map(({ label, value, set, step }) => {
          const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
          return (
            <div key={label}>
              <label htmlFor={id} className="block text-xs text-slate-400 mb-1">{label}</label>
              <input
                id={id}
                type="number"
                value={value}
                step={step}
                onChange={e => set(Number(e.target.value))}
                className="w-full bg-slate-700 text-white px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          )
        })}
      </div>
      <div className="bg-slate-800 rounded-xl p-6 space-y-3">
        <div className="flex justify-between">
          <span className="text-slate-400 text-sm">Futures price</span>
          <span className="text-white font-semibold">${futuresPrice.toLocaleString()}/MT</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400 text-sm">Differential</span>
          <span className={`font-semibold ${diffColor}`}>
            {differential >= 0 ? '+' : ''}${differential}/MT
          </span>
        </div>
        <div className="border-t border-slate-700 pt-3 flex justify-between">
          <span className="text-slate-400 text-sm">Physical price (USD)</span>
          <span className="text-amber-400 font-bold text-lg">${physicalUSD.toLocaleString()}/MT</span>
        </div>
        {fxRate !== 1 && (
          <div className="flex justify-between">
            <span className="text-slate-400 text-sm">Physical price (local)</span>
            <span className="text-white font-semibold">{physicalLocal.toLocaleString('en-US', { maximumFractionDigits: 2 })}/MT</span>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Register tools in src/tools/index.ts**

```ts
// src/tools/index.ts
import type { ComponentType } from 'react'
import HedgingCalculator from '@/components/tools/HedgingCalculator'
import BasisCalculator from '@/components/tools/BasisCalculator'

export const toolRegistry: Record<string, ComponentType> = {
  'hedging-calculator': HedgingCalculator,
  'basis-calculator': BasisCalculator,
}
```

- [ ] **Step 7: Create tool page**

```tsx
// src/app/module/[id]/tool/[toolId]/page.tsx
import { notFound } from 'next/navigation'
import { modules } from '@/content'
import { toolRegistry } from '@/tools'
import Breadcrumb from '@/components/Breadcrumb'

type Props = { params: { id: string; toolId: string } }

export default function ToolPage({ params }: Props) {
  const moduleId = parseInt(params.id)
  const mod = modules[moduleId - 1]
  if (!mod) notFound()

  const topic = mod.topics.find(t => t.id === params.toolId)
  if (!topic || !topic.tool) notFound()

  const Tool = toolRegistry[topic.tool.componentKey]
  if (!Tool) notFound()

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Breadcrumb moduleId={moduleId} topicTitle={topic.title} />
      <Tool />
    </div>
  )
}
```

- [ ] **Step 8: Verify in browser**

Visit http://localhost:3000/module/2/tool/02-knowyourexposure — hedging calculator with live reactive output.
Visit http://localhost:3000/module/3/tool/01-options — basis/differential calculator.

- [ ] **Step 9: Commit**

```bash
git add src/components/tools/ src/tools/index.ts "src/app/module/[id]/tool/" src/__tests__/components/tools/
git commit -m "feat: hedging and basis calculator tools with reactive output"
```

---

## Task 13: README + Vercel deployment

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run full test suite — all tests must pass**

```bash
npm test
```

Expected: all tests pass. Fix any failures before continuing.

- [ ] **Step 2: Run production build — must succeed**

```bash
npm run build
```

Expected: clean build, no TypeScript or build errors.

- [ ] **Step 3: Replace README.md with English version**

```markdown
# Commodity Trading Lecture

Interactive lecture support web app for a commodity trading masterclass. Built for university students (Licence / M1 / M2 Spécialisé).

## Features

- 3 module tabs (Panorama, Operational Mechanics, Strategies & ESG)
- Guided section reader with keyboard navigation
- MCQ quizzes with immediate feedback
- Live calculators: hedging exposure, basis/differential
- Password-protected (single shared class password)
- Dark theme, desktop-first, Vercel-deployed

## Modules

| Module | Level | Topics |
|--------|-------|--------|
| 1 — Panorama & Vocabulary | Licence / M1 | Commodity types, trader archetypes, futures/swaps/EFP, market structure, S&D |
| 2 — Operational Mechanics & Hedging | M1 / M2 | Differential, exposure, hedging strategies, incoterms, shipping |
| 3 — Strategies, ESG & Data | M2 Spécialisé | Options, EUDR regulation, advanced S&D, data trading |

## Tech Stack

Next.js 14 App Router · TypeScript · Tailwind CSS · Vercel

## Local Development

```bash
# Install dependencies
npm install

# Create .env.local
echo "CLASS_PASSWORD=your-password-here" > .env.local

# Start dev server
npm run dev
```

Open http://localhost:3000, enter your class password.

## Adding / Updating Content

Content files are in `src/content/`. Each module has its own folder.

To add a new topic to Module 1:
1. Create `src/content/module-1/06-new-topic.ts`
2. Add it to `src/content/module-1/index.ts`
3. Push — Vercel redeploys in ~30 seconds

## Deployment

1. Push repo to GitHub
2. Connect to [Vercel](https://vercel.com)
3. Add environment variable: `CLASS_PASSWORD` = your chosen password
4. Deploy — done

## Running Tests

```bash
npm test
```
```

- [ ] **Step 4: Connect repo to Vercel**

Go to https://vercel.com → New Project → Import from GitHub → select `loicscanu-ctrl/Commodity-trading-lecture`.

In project settings, before deploying:
- Go to **Settings → Environment Variables**
- Add: `CLASS_PASSWORD` = (your chosen class password)

Click **Deploy**.

- [ ] **Step 5: Verify live deployment**

Visit the Vercel URL. Should redirect to `/login`. Enter class password. Should show Module 1 dashboard with all topic cards.

Test all routes:
- `/module/2` — Module 2 dashboard
- `/module/1/section/00-introduction` — section reader
- `/module/1/quiz/01-panorama` — quiz
- `/module/2/tool/02-knowyourexposure` — hedging calculator

- [ ] **Step 6: Final commit**

```bash
git add README.md
git commit -m "docs: English README with setup and content authoring guide"
git push origin main
```

---

## Self-Review

**Spec coverage check:**
- ✅ Module Dashboard (3 tabs, topic grid, Coming Soon badges) → Task 9
- ✅ Section reader (guided sections, progress, keyboard nav, markdown) → Task 10
- ✅ Quiz (MCQ, immediate feedback, score) → Task 11
- ✅ Calculators (hedging exposure, basis) → Task 12
- ✅ Auth (middleware, single password, cookie) → Task 3
- ✅ Content structure (multi-file per module, typed) → Tasks 6-8
- ✅ English README → Task 13
- ✅ Vercel deployment → Task 13
- ✅ v2 placeholders (Coming Soon) → Tasks 6-8 content files
- ✅ Dark theme → Task 4

**Type consistency check:**
- `Topic.tool.componentKey` defined in `src/types/content.ts:ToolConfig` → used in `toolRegistry` key lookup in `src/tools/index.ts` ✅
- `Topic.quiz.questions` typed as `Question[]` → `QuizRunner` receives `Question[]` ✅
- `Topic.sections` typed as `Section[]` → `SectionReader` receives `Section[]` ✅
- `modules[moduleId - 1]` — moduleId validated as 1-3 before array access ✅
- `isAuthenticated()` in `middleware.ts` matches signature in `src/lib/auth.ts` ✅
