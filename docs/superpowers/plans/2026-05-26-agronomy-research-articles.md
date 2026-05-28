# Agronomy Research Articles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Agronomy sub-tab to the Research page with 4 collapsible trader-focused articles and data visualisations, all static/hardcoded content.

**Architecture:** New `AgronomyArticles.tsx` holds all content and chart components; `ResearchView.tsx` gets a 4-line diff. Visuals are inline SVG (seasonal/Gantt timelines) or Recharts (bar/area charts). No backend changes, no data fetching.

**Tech Stack:** React 18, TypeScript, Recharts 3.8 (`from "recharts"`), Tailwind CSS, inline SVG

---

## File Map

| Action | Path |
|--------|------|
| Create | `frontend/components/research/AgronomyArticles.tsx` |
| Modify | `frontend/components/research/ResearchView.tsx` (4 lines) |

---

### Task 1: Create AgronomyArticles.tsx — shell + AgronomyCard

**Files:**
- Create: `frontend/components/research/AgronomyArticles.tsx`

- [ ] **Step 1: Create the file with the AgronomyCard wrapper and typography helpers**

```tsx
"use client";
import { useState } from "react";

// ── Typography helpers (mirror ResearchView.tsx pattern) ──────────────────────
function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-amber-400 mt-5 mb-2">{children}</h4>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-300 leading-relaxed mb-2">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs text-slate-300 leading-relaxed">
      <span className="text-amber-500/70">•</span><span>{children}</span>
    </li>
  );
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1 py-px rounded bg-slate-800 text-slate-200 text-[11px]">
      {children}
    </code>
  );
}

// ── Expand/collapse article card ──────────────────────────────────────────────
function AgronomyCard({ kicker, title, briefing, children }: {
  kicker: string;
  title: string;
  briefing: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-3xl">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-2">
        {kicker}
      </div>
      <h3 className="text-base font-bold text-slate-100 mb-3">{title}</h3>
      <div className="text-xs text-slate-300 leading-relaxed mb-3">{briefing}</div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-amber-400/80 hover:text-amber-400 transition-colors flex items-center gap-1"
      >
        {open ? "▲ Less detail" : "▼ Read more"}
      </button>
      {open && <div className="mt-4 space-y-5">{children}</div>}
    </div>
  );
}

export default function AgronomyArticles() {
  return (
    <div className="space-y-4">
      {/* Articles added in Tasks 3–6 */}
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles — open `frontend/components/research/AgronomyArticles.tsx` in the IDE and confirm no red underlines**

---

### Task 2: Wire ResearchView.tsx

**Files:**
- Modify: `frontend/components/research/ResearchView.tsx`

- [ ] **Step 1: Add `"agronomy"` to the `Cat` type (line 6)**

Old:
```tsx
type Cat = "cot" | "weather" | "contracts";
```

New:
```tsx
type Cat = "cot" | "weather" | "contracts" | "agronomy";
```

- [ ] **Step 2: Append Agronomy to the `CATS` array (after the `contracts` entry)**

Old:
```tsx
const CATS: { id: Cat; label: string }[] = [
  { id: "cot",       label: "COT & positioning" },
  { id: "weather",   label: "Weather" },
  { id: "contracts", label: "Contract rules" },
];
```

New:
```tsx
const CATS: { id: Cat; label: string }[] = [
  { id: "cot",       label: "COT & positioning" },
  { id: "weather",   label: "Weather" },
  { id: "contracts", label: "Contract rules" },
  { id: "agronomy",  label: "Agronomy" },
];
```

- [ ] **Step 3: Add the import at the top of the file (after the existing imports)**

```tsx
import AgronomyArticles from "./AgronomyArticles";
```

- [ ] **Step 4: Add the render condition inside the `ResearchView` return, after the `contracts` block**

Old (last render block):
```tsx
      {cat === "contracts" && <ContractRules />}
    </>
  );
```

New:
```tsx
      {cat === "contracts" && <ContractRules />}
      {cat === "agronomy"  && <AgronomyArticles />}
    </>
  );
```

- [ ] **Step 5: Run the dev server and verify the Agronomy tab appears**

```
cd frontend && npm run dev
```

Open `http://localhost:3000` → Research tab → click "Agronomy". Expected: tab button appears in the nav bar, clicking it shows an empty `<div className="space-y-4">`.

---

### Task 3: Article 1 — "When does rain become a supply shock?" + Crop Cycle Timeline

**Files:**
- Modify: `frontend/components/research/AgronomyArticles.tsx`

- [ ] **Step 1: Add the `CropCycleTimeline` SVG component before the `AgronomyArticles` export**

```tsx
// ── Article 1 visual ──────────────────────────────────────────────────────────
function CropCycleTimeline() {
  // 600 viewBox units wide; each of 12 months = 50 units
  const mx = (m: number) => m * 50; // x-start for month m (0 = Jan)
  const BAR_Y = 8, BAR_H = 26;

  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Robusta seasonal cycle · Central Highlands Vietnam
      </p>
      <svg viewBox="0 0 600 105" className="w-full rounded overflow-hidden">
        <rect width="600" height="105" fill="#0f172a" />

        {/* Phase bands */}
        {/* Jan–Feb: Dry/Dormancy */}
        <rect x={mx(0)} y={BAR_Y} width={100} height={BAR_H} fill="#1e3a5f" rx={2} />
        {/* Feb–Mar: Blossoming (overlaid) */}
        <rect x={mx(1)} y={BAR_Y} width={100} height={BAR_H} fill="#166534" rx={2} />
        {/* Apr–Sep: Fruit Development */}
        <rect x={mx(3)} y={BAR_Y} width={300} height={BAR_H} fill="#14532d" rx={2} />
        {/* Oct–Dec: Harvest */}
        <rect x={mx(9)} y={BAR_Y} width={150} height={BAR_H} fill="#78350f" rx={2} />
        {/* Nov–Dec: Danger overlay */}
        <rect x={mx(10)} y={BAR_Y} width={100} height={BAR_H} fill="#991b1b" opacity={0.6} rx={2} />
        {/* Jan: Carry-over danger overlay */}
        <rect x={mx(0)} y={BAR_Y} width={50}  height={BAR_H} fill="#991b1b" opacity={0.45} rx={2} />

        {/* Irrigation trigger marker at Feb (x = 50) */}
        <line x1={mx(1)} y1={BAR_Y - 2} x2={mx(1)} y2={BAR_Y + BAR_H + 4} stroke="#93c5fd" strokeWidth={1.5} />
        <circle cx={mx(1)} cy={BAR_Y - 4} r={3} fill="#93c5fd" />

        {/* Month labels */}
        {["J","F","M","A","M","J","J","A","S","O","N","D"].map((lbl, i) => (
          <text key={i} x={mx(i) + 25} y={50} textAnchor="middle" fontSize={9} fill="#64748b">
            {lbl}
          </text>
        ))}

        {/* Band labels */}
        <text x={25}       y={24} textAnchor="middle" fontSize={7}   fill="#bfdbfe" fontWeight="600">Dry</text>
        <text x={mx(1)+50} y={18} textAnchor="middle" fontSize={7}   fill="#bbf7d0" fontWeight="600">Blossoming</text>
        <text x={mx(6)}    y={24} textAnchor="middle" fontSize={7}   fill="#bbf7d0" fontWeight="600">Fruit Development</text>
        <text x={mx(9)+50} y={18} textAnchor="middle" fontSize={7}   fill="#fde68a" fontWeight="600">Harvest</text>
        <text x={mx(10)+50}y={27} textAnchor="middle" fontSize={6.5} fill="#fca5a5">⚠ Rain risk</text>

        {/* Below-axis annotations */}
        <text x={25}    y={63} textAnchor="middle" fontSize={8} fill="#fca5a5">⚠ Rain</text>
        <text x={25}    y={73} textAnchor="middle" fontSize={8} fill="#fca5a5">risk</text>
        <text x={mx(1)} y={63} textAnchor="middle" fontSize={8} fill="#93c5fd">💧 Irrig.</text>
        <text x={mx(1)} y={73} textAnchor="middle" fontSize={8} fill="#93c5fd">trigger</text>

        {/* Legend */}
        <rect x={10}  y={88} width={8} height={6} fill="#78350f" opacity={0.9} rx={1} />
        <text x={21}  y={94} fontSize={7.5} fill="#94a3b8">Harvest</text>
        <rect x={75}  y={88} width={8} height={6} fill="#14532d" opacity={0.9} rx={1} />
        <text x={86}  y={94} fontSize={7.5} fill="#94a3b8">Fruit dev.</text>
        <rect x={148} y={88} width={8} height={6} fill="#1e3a5f" opacity={0.9} rx={1} />
        <text x={159} y={94} fontSize={7.5} fill="#94a3b8">Dry / Dormancy</text>
        <rect x={270} y={88} width={8} height={6} fill="#991b1b" opacity={0.7} rx={1} />
        <text x={281} y={94} fontSize={7.5} fill="#fca5a5">Anomalous rain risk</text>
        <circle cx={390} cy={91} r={3} fill="#93c5fd" />
        <text x={396} y={94} fontSize={7.5} fill="#93c5fd">Irrigation trigger</text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Add the `Article1` component**

```tsx
function Article1() {
  return (
    <AgronomyCard
      kicker="Agronomy · Supply Risk"
      title="When does rain become a supply shock?"
      briefing={
        <span>
          The mandatory 2–3 month dry period following harvest is a physiological
          requirement for floral dormancy — not a weather preference. Anomalous
          rainfall during November–January disrupts bud development, causing
          asynchronous blossoming and cascading harvest complications that persist
          for the entire subsequent season. The Central Highlands floods of
          November 2025 are the most recent example.
        </span>
      }
    >
      <H>The physiology of floral induction</H>
      <P>
        Coffee flowers will not bloom unless a period of water deficit breaks
        bud dormancy. For Robusta, this requires 2–3 months of dry conditions
        after harvest. When rainfall interrupts this window — even briefly — a
        cascade follows:
      </P>
      <ul className="space-y-1 mb-2">
        <LI>
          Buds at different developmental stages respond unevenly to the water
          stimulus, triggering staggered blooms across the plantation.
        </LI>
        <LI>
          Asynchronous blossoming means cherries ripen on wildly different
          schedules — multiple expensive harvest passes, degraded cup quality.
        </LI>
        <LI>
          A year-round food source for the Coffee Berry Borer{" "}
          (<em>Hypothenemus hampei</em>) drives population explosions in the
          following season.
        </LI>
      </ul>

      <H>Irrigation trigger rule</H>
      <P>
        The first irrigation must be delayed until{" "}
        <strong>75–80% of buds have developed to the outermost branch nodes</strong>.
        Premature watering — even by a week — causes heterogeneous blooming.
        Waiting past the threshold induces mass floral abortion as soil moisture
        drops below the permanent wilting point (~27% in basaltic soils).
      </P>

      <H>Key physiological thresholds</H>
      <div className="overflow-x-auto mt-2">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-6">Parameter</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-6">Robusta</th>
              <th className="text-left text-slate-400 font-medium pb-1.5">Arabica</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            <tr>
              <td className="py-1.5 pr-6">Optimal temp range</td>
              <td className="py-1.5 pr-6">24–26°C</td>
              <td className="py-1.5">15–24°C</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Stomatal shutdown</td>
              <td className="py-1.5 pr-6">&gt;30°C</td>
              <td className="py-1.5">&gt;30°C</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Annual rainfall required</td>
              <td className="py-1.5 pr-6">1,200–1,800 mm</td>
              <td className="py-1.5">1,200–1,500 mm</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Optimal humidity</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>70–85%</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Rust outbreak threshold</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>Sustained humidity &gt;85%</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Mandatory dry period</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>2–3 months post-harvest (Nov–Feb)</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-6">Water per irrigation cycle</td>
              <td className="py-1.5 pr-6 text-slate-400" colSpan={2}>400–600 litres / tree</td>
            </tr>
          </tbody>
        </table>
      </div>

      <CropCycleTimeline />
    </AgronomyCard>
  );
}
```

- [ ] **Step 3: Add `<Article1 />` inside the `AgronomyArticles` return**

Replace the empty return with:
```tsx
export default function AgronomyArticles() {
  return (
    <div className="space-y-4">
      <Article1 />
    </div>
  );
}
```

- [ ] **Step 4: Visual check — open Research → Agronomy. Verify Article 1 card shows with briefing text and "▼ Read more" button. Click to expand — confirm threshold table and SVG timeline render without layout break.**

---

### Task 4: Article 2 — "Which clones ship when, and how much?" + charts

**Files:**
- Modify: `frontend/components/research/AgronomyArticles.tsx`

- [ ] **Step 1: Add Recharts import at the top of the file (after the existing React import)**

```tsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
```

- [ ] **Step 2: Add clone yield data constant and `CloneYieldChart` component**

```tsx
// ── Article 2 data + visuals ──────────────────────────────────────────────────
const CLONE_YIELDS = [
  { clone: "TR4",  t: 7.3,  late: false },
  { clone: "TR9",  t: 6.7,  late: false },
  { clone: "TR11", t: 6.6,  late: false },
  { clone: "TR13", t: 5.5,  late: false },
  { clone: "TR14", t: 5.4,  late: true  },
  { clone: "TR15", t: 5.2,  late: true  },
  { clone: "TRS1", t: 5.25, late: false },
];

function CloneYieldChart() {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Yield potential by clone (t/ha · green beans)
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={CLONE_YIELDS} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="clone"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 9]}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            unit=" t"
          />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            formatter={(v: number) => [`${v} t/ha`, "Yield"]}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Bar dataKey="t" radius={[3, 3, 0, 0]}>
            {CLONE_YIELDS.map((entry, i) => (
              <Cell key={i} fill={entry.late ? "#3b82f6" : "#f59e0b"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-1">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <div className="w-3 h-3 rounded-sm bg-amber-500" /> Normal harvest
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <div className="w-3 h-3 rounded-sm bg-blue-500" /> Late harvest (Jan–Feb)
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `HarvestGantt` SVG component**

```tsx
function HarvestGantt() {
  // 6-month window: Oct, Nov, Dec, Jan, Feb, Mar
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const MW = 76; // month width in viewBox units
  const PAD = 20;

  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Harvest windows by clone group
      </p>
      <svg viewBox={`0 0 ${PAD * 2 + MW * 6} 88`} className="w-full rounded overflow-hidden">
        <rect width={PAD * 2 + MW * 6} height="88" fill="#0f172a" />

        {/* Month column headers */}
        {months.map((m, i) => (
          <text
            key={i}
            x={PAD + i * MW + MW / 2}
            y={16}
            textAnchor="middle"
            fontSize={9}
            fill="#64748b"
          >
            {m}
          </text>
        ))}

        {/* Normal clones: Oct–Dec = months 0–2 = x PAD, width 3*MW */}
        <rect x={PAD} y={22} width={MW * 3} height={22} fill="#b45309" opacity={0.85} rx={3} />
        <text x={PAD + MW * 1.5} y={37} textAnchor="middle" fontSize={9} fill="#fde68a" fontWeight="600">
          Normal  ·  TR4  TR9  TR11
        </text>

        {/* Late clones: Jan–Feb = months 3–4 = x PAD + 3*MW, width 2*MW */}
        <rect x={PAD + MW * 3} y={48} width={MW * 2} height={22} fill="#1d4ed8" opacity={0.85} rx={3} />
        <text x={PAD + MW * 3 + MW} y={63} textAnchor="middle" fontSize={9} fill="#bfdbfe" fontWeight="600">
          Late  ·  TR14  TR15
        </text>

        {/* Shift annotation */}
        <line
          x1={PAD + MW * 3 - 4}
          y1={33}
          x2={PAD + MW * 3 + 4}
          y2={50}
          stroke="#64748b"
          strokeWidth={1}
          strokeDasharray="3,2"
        />
        <text x={PAD + MW * 4.2} y={82} textAnchor="middle" fontSize={8} fill="#94a3b8">
          ▶ 6–8 week supply delay
        </text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Add `Article2` component**

```tsx
function Article2() {
  return (
    <AgronomyCard
      kicker="Agronomy · Varieties"
      title="Which clones ship when, and how much?"
      briefing={
        <span>
          Vietnam&rsquo;s late-ripening clones TR14 and TR15 were engineered to
          mature 6–8 weeks after standard varieties, shifting delivery into
          January–February and compressing the seasonal supply window. This delay
          also eliminates one dry-season irrigation cycle, reducing water
          consumption. Traders modelling peak Vietnamese Robusta shipments should
          weight this phenological split.
        </span>
      }
    >
      <H>Elite Robusta clone profiles</H>
      <div className="overflow-x-auto mt-1">
        <table className="text-[11px] text-slate-300 w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Clone</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Cycle</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Yield (t/ha)</th>
              <th className="text-left text-slate-400 font-medium pb-1.5 pr-4">Bean (g/100)</th>
              <th className="text-left text-slate-400 font-medium pb-1.5">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {[
              ["TR4",  "Normal",  "7.3",     "18.4",      "Best yield; absolute rust resistance; drooping branches"],
              ["TR9",  "Normal",  "6.7",     "22.5–29.6", "Exceptional bean size; wide spreading canopy"],
              ["TR11", "Normal",  "6.6",     "18.3",      "High cup quality; stable multi-year production"],
              ["TR13", "Normal",  "4.5–6.5", "—",         "⚠ Sensitive to nematodes (P. coffeae) and Fusarium wilt"],
              ["TR14", "Late ★",  "5.1–5.6", "19.1–24.9", "Harvest Jan–Feb; eliminates one irrigation cycle"],
              ["TR15", "Late ★",  "5.1–5.2", "19.1–24.9", "Exceptional drought tolerance under extreme stress"],
              ["TRS1", "Normal",  "4.5–6.0", "—",         "Multi-parent hybrid seed; resolves grafting bottleneck"],
            ].map(([id, cycle, yld, bean, notes]) => (
              <tr key={id}>
                <td className="py-1.5 pr-4 font-semibold text-slate-200">{id}</td>
                <td className={`py-1.5 pr-4 ${cycle.includes("Late") ? "text-blue-400 font-semibold" : ""}`}>
                  {cycle}
                </td>
                <td className="py-1.5 pr-4">{yld}</td>
                <td className="py-1.5 pr-4">{bean}</td>
                <td className="py-1.5 text-slate-400">{notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
        ★ Late-ripening clones push harvest to January–February, saving one
        irrigation cycle worth ~407 million m³ of water annually at regional scale.
      </p>

      <H>Arabica TN series (altitude &gt;1,000 m)</H>
      <P>
        TN1, TN2, TN6, TN7, TN9 — elite F1 hybrids yielding 3.0–3.5 t/ha,
        10–20% above legacy Catimor. Near-total rust resistance. TN1 requires
        drip irrigation and balanced chemigation; THA1 (seed-propagated purebred)
        achieves &gt;3.0 t/ha with simpler management.
      </P>

      <H>Genetic origin</H>
      <P>
        Genomic analysis (261 genome-wide SNPs) places Vietnamese Robusta
        primarily in the Congo Basin <Code>ER group</Code>, with introgression
        from Guinean <Code>D</Code>, Atlantic coast <Code>A</Code>, and East
        Central African <Code>OB</Code> populations — each contributing alleles
        for specific drought tolerance and rust resistance.
      </P>

      <HarvestGantt />
      <CloneYieldChart />
    </AgronomyCard>
  );
}
```

- [ ] **Step 5: Add `<Article2 />` to the `AgronomyArticles` return**

```tsx
export default function AgronomyArticles() {
  return (
    <div className="space-y-4">
      <Article1 />
      <Article2 />
    </div>
  );
}
```

- [ ] **Step 6: Visual check — expand Article 2. Verify clone table renders, HarvestGantt shows two colour-coded bars, CloneYieldChart shows amber/blue bars with correct labels.**

---

### Task 5: Article 3 — "What does a kilo of Robusta actually cost to grow?" + charts

**Files:**
- Modify: `frontend/components/research/AgronomyArticles.tsx`

- [ ] **Step 1: Add nutrient data constant and `NutrientExtractionChart` component**

```tsx
// ── Article 3 data + visuals ──────────────────────────────────────────────────
const NUTRIENTS = [
  { name: "K  (Potassium)",  kg: 46.9 },
  { name: "N  (Nitrogen)",   kg: 34.2 },
  { name: "Ca (Calcium)",    kg: 4.3  },
  { name: "P  (Phosphorus)", kg: 6.1  },
  { name: "Mg (Magnesium)",  kg: 4.1  },
];

const NUTRIENT_COLORS: Record<string, string> = {
  "K  (Potassium)":  "#f59e0b",
  "N  (Nitrogen)":   "#60a5fa",
  "Ca (Calcium)":    "#a78bfa",
  "P  (Phosphorus)": "#f472b6",
  "Mg (Magnesium)":  "#34d399",
};

function NutrientExtractionChart() {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        Nutrients permanently extracted per tonne of green beans
      </p>
      <ResponsiveContainer width="100%" height={185}>
        <BarChart
          data={NUTRIENTS}
          layout="vertical"
          margin={{ top: 4, right: 50, left: 110, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 55]}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            unit=" kg"
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={105}
          />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            formatter={(v: number) => [`${v} kg / tonne`, "Extraction"]}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Bar dataKey="kg" radius={[0, 3, 3, 0]}>
            {NUTRIENTS.map((n) => (
              <Cell key={n.name} fill={NUTRIENT_COLORS[n.name]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Add `PhenologicalTimeline` SVG component**

```tsx
function PhenologicalTimeline() {
  const events = [
    { label: "Dry S2",  dose: "500 kg/ha", x: 60,  color: "#f59e0b", note: "Floral induction" },
    { label: "May",     dose: "400 kg/ha", x: 200, color: "#60a5fa", note: "Fruit set" },
    { label: "July",    dose: "200 kg/ha", x: 340, color: "#34d399", note: "Bean expansion" },
    { label: "Sep",     dose: "500 kg/ha", x: 480, color: "#f59e0b", note: "Maturation" },
  ];

  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
        NPK application windows — mature coffee (total 1,600 kg/ha/year · 3 t/ha baseline)
      </p>
      <svg viewBox="0 0 560 88" className="w-full rounded overflow-hidden">
        <rect width="560" height="88" fill="#0f172a" />
        {/* Timeline bar */}
        <rect x={40} y={38} width={480} height={3} fill="#334155" rx={2} />
        <text x={40}  y={53} textAnchor="middle" fontSize={8} fill="#64748b">Jan</text>
        <text x={520} y={53} textAnchor="middle" fontSize={8} fill="#64748b">Dec</text>

        {events.map((e) => (
          <g key={e.label}>
            <line x1={e.x} y1={14} x2={e.x} y2={39} stroke={e.color} strokeWidth={1.5} />
            <circle cx={e.x} cy={39} r={4} fill={e.color} />
            <text x={e.x} y={11}  textAnchor="middle" fontSize={9}   fill={e.color} fontWeight="600">{e.dose}</text>
            <text x={e.x} y={55}  textAnchor="middle" fontSize={7.5} fill="#94a3b8">{e.label}</text>
            <text x={e.x} y={66}  textAnchor="middle" fontSize={7}   fill="#64748b">{e.note}</text>
          </g>
        ))}

        <text x={280} y={82} textAnchor="middle" fontSize={7.5} fill="#64748b">
          +150 kg urea · +100 kg phosphate · +120–130 kg KCl per extra tonne above baseline
        </text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Add `Article3` component**

```tsx
function Article3() {
  return (
    <AgronomyCard
      kicker="Agronomy · Production Costs"
      title="What does a kilo of Robusta actually cost to grow?"
      briefing={
        <span>
          Producing one tonne of green Robusta beans permanently extracts 34.2 kg
          of nitrogen and 46.9 kg of potassium from the soil. Annual baseline
          fertiliser application is 1,600 kg NPK/ha across four phenological
          windows. Organised cooperatives capture up to 95% of FOB export value;
          isolated smallholders lose a significant share to intermediary brokers
          — a structural factor in farmer price responsiveness.
        </span>
      }
    >
      <H>Nutrient extraction per tonne of green beans</H>
      <P>
        These quantities are permanently removed from the soil with each harvest —
        fertiliser replaces them or productivity declines. Potassium dominates
        because it drives sugar transport into the developing bean; nitrogen is
        consumed building vegetative structure; phosphorus powers root and floral
        ATP synthesis.
      </P>
      <NutrientExtractionChart />

      <H>Ion antagonisms (over-application risks)</H>
      <ul className="space-y-1 mb-2">
        <LI>Excess <strong>P</strong> locks up zinc → disrupts enzyme function</LI>
        <LI>Excess <strong>K</strong> induces Mg deficiency → interveinal chlorosis, leaf blight (K–Mg antagonism)</LI>
        <LI>High <strong>K</strong> restricts boron uptake → terminal necrosis in young tissues (K–B antagonism)</LI>
      </ul>

      <H>Annual NPK schedule — mature bearing coffee</H>
      <PhenologicalTimeline />

      <H>Cooperative FOB capture mechanics</H>
      <P>
        Isolated smallholders face broker extraction that can reduce net margin
        by 30–50%. Organised cooperative groups aggregate purchasing power (bulk
        input discounts) and negotiate direct FOB contracts with processors and
        international roasters, bypassing intermediary structures. In
        well-organised regions, FOB price capture reaches{" "}
        <strong>95% of total export value</strong>. This explains why farmers in
        cooperative zones respond more elastically to price signals — they see
        a larger share of the upside.
      </P>

      <H>Water costs</H>
      <P>
        Basin irrigation requires <strong>400–600 litres / tree / cycle</strong>,
        spaced 25–30 days apart through the dry season. Late-ripening clones TR14
        and TR15 eliminate one complete cycle, saving ~120–150 litres per tree
        per year. Drip irrigation combined with macadamia intercropping reduces
        total plantation water demand by up to 36%.
      </P>
    </AgronomyCard>
  );
}
```

- [ ] **Step 4: Add `<Article3 />` to the `AgronomyArticles` return**

```tsx
export default function AgronomyArticles() {
  return (
    <div className="space-y-4">
      <Article1 />
      <Article2 />
      <Article3 />
    </div>
  );
}
```

- [ ] **Step 5: Visual check — expand Article 3. Verify horizontal bar chart renders with K dominating, phenological timeline shows 4 drop-lines with doses.**

---

### Task 6: Article 4 — "How fragile is Vietnamese supply long-term?" + area chart

**Files:**
- Modify: `frontend/components/research/AgronomyArticles.tsx`

- [ ] **Step 1: Add additional Recharts imports for AreaChart (add to the existing import line)**

Update the recharts import (from Task 4) to:
```tsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, ReferenceLine,
} from "recharts";
```

- [ ] **Step 2: Add `ViableAreaChart` component**

```tsx
// ── Article 4 visuals ─────────────────────────────────────────────────────────
const AREA_PROJECTION = [
  { year: 2025, pct: 100 },
  { year: 2030, pct: 93  },
  { year: 2035, pct: 84  },
  { year: 2040, pct: 73  },
  { year: 2045, pct: 62  },
  { year: 2050, pct: 50  },
];

function ViableAreaChart() {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
        CIAT projection · viable Robusta growing area · Vietnam
      </p>
      <p className="text-[10px] text-slate-600 mb-2">
        100% = ~720,000 ha today. Driven by temperature rise + rainfall shift.
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart
          data={AREA_PROJECTION}
          margin={{ top: 8, right: 32, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="redFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="year"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 105]}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            unit="%"
          />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            formatter={(v: number) => [`${v}%`, "Viable area"]}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <ReferenceLine
            y={50}
            stroke="#ef4444"
            strokeDasharray="4 3"
            strokeOpacity={0.55}
            label={{ value: "–50%", position: "right", fill: "#ef4444", fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="pct"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#redFade)"
            dot={{ fill: "#ef4444", r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Add `Article4` component**

```tsx
function Article4() {
  return (
    <AgronomyCard
      kicker="Agronomy · Long-term Risk"
      title="How fragile is Vietnamese supply long-term?"
      briefing={
        <span>
          Intensive monoculture has driven soil pH below 4.0 across large areas
          of the Central Highlands. At that threshold, phosphorus binds to iron
          and aluminium oxides and becomes unavailable regardless of application
          volume — a silent productivity trap. CIAT projects up to 50% of
          Vietnam&rsquo;s viable Robusta growing area eliminated by 2050 as
          temperatures rise and precipitation patterns shift.
        </span>
      }
    >
      <H>Soil pH degradation</H>
      <P>
        Decades of ammonium sulphate application — physiologically acidic — have
        pushed pH below 4.0 in many plots. Phosphorus becomes insoluble at this
        level (bound to Fe/Al oxides), making it unavailable to roots regardless
        of how much is applied. Remediation requires lime amendments and a halt
        to acidifying inputs. On sloping land, contour planting and permanent
        ground cover (5–10 cm leguminous species) are required to stop the
        topsoil erosion that accelerates this process.
      </P>

      <H>Nematode thresholds</H>
      <P>
        Parasitic nematodes — primarily <em>Pratylenchus coffeae</em>,{" "}
        <em>Meloidogyne</em> spp., and <em>Radopholus</em> spp. — penetrate the
        root cortex, cause cellular necrosis, and create lesions that allow
        Fusarium wilt to enter. Global yield losses attributed to nematode
        parasitism are estimated at ~15%.
      </P>
      <ul className="space-y-1 mb-2">
        <LI>
          <strong>Replanting prohibited</strong> if soil samples show &gt;100
          individuals / 100 g soil, or &gt;150 / 5 g root tissue.
        </LI>
        <LI>
          Mandatory crop rotation for ≥1 year required before replanting,
          to starve the nematode population.
        </LI>
        <LI>
          TR13 clone has documented sensitivity — avoid on historically
          nematode-affected plots.
        </LI>
      </ul>

      <H>Intercropping as structural hedge</H>
      <P>
        Agroforestry is not only ecological — it is financial resilience. When
        global Robusta prices drop below the cost of production, intercrop
        revenue prevents farm abandonment and maintains supply-side capacity:
      </P>
      <ul className="space-y-1 mb-2">
        <LI>
          <strong>Macadamia</strong> (194 trees/ha at 10.5 × 4.9 m): deep taproot
          avoids coffee feeder root competition; documented +10% yield boost
          under rainfed conditions, +60% under combined drip irrigation.
        </LI>
        <LI>
          <strong>Durian</strong> (69–123 trees/ha): revenue can double total farm
          income. Critically, this is why farmers stay in production during
          multi-year Robusta bear markets rather than uprooting.
        </LI>
        <LI>
          <strong>Black Pepper</strong> on Cassia supports: efficient vertical
          space use; staggered harvests distribute peak labour across the year.
        </LI>
      </ul>

      <H>CIAT long-term area projection</H>
      <ViableAreaChart />
      <P>
        The projection combines rising mean temperatures (reducing altitude
        suitability) and shifting monsoon patterns (disrupting phenological
        cycles). It assumes current planting mix — a transition to late-ripening,
        drought-tolerant clones (TR14, TR15) and agroforestry intercropping
        mitigates but does not eliminate the projected loss.
      </P>
    </AgronomyCard>
  );
}
```

- [ ] **Step 4: Update `AgronomyArticles` return to include all 4 articles**

```tsx
export default function AgronomyArticles() {
  return (
    <div className="space-y-4">
      <Article1 />
      <Article2 />
      <Article3 />
      <Article4 />
    </div>
  );
}
```

- [ ] **Step 5: Final visual check — expand all 4 articles in sequence. Verify:**
  - Article 1: threshold table + SVG crop timeline renders
  - Article 2: clone table + harvest Gantt + yield bar chart render
  - Article 3: horizontal nutrient bar chart + phenological timeline SVG render
  - Article 4: nematode/intercrop content + red declining area chart renders
  - All collapse cleanly when "▲ Less detail" is clicked
  - No white backgrounds, no layout overflow on a standard laptop viewport
