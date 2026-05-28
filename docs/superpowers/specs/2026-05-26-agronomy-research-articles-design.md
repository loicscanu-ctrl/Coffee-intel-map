# Agronomy Research Articles Design

## Goal

Add an **Agronomy** sub-tab to the Research page containing 4 collapsible articles derived from the IPHM research document. Each article is framed around a trader-relevant market question, with a 2–3 sentence briefing visible by default and a full deep-dive expandable on click. Each deep-dive includes at least one data visualisation (SVG or Recharts, dark-themed).

---

## Architecture

**Modified file:**
- `frontend/components/research/ResearchView.tsx` — add `"agronomy"` to `Cat` type, add to `CATS` array, import and render `AgronomyArticles`

**New file:**
- `frontend/components/research/AgronomyArticles.tsx` — contains all 4 article components, chart helpers, and the `AgronomyCard` expand/collapse wrapper. Kept in its own file to avoid bloating ResearchView.tsx.

No new data files, backend changes, or API calls. All content and chart data is static/hardcoded.

---

## AgronomyCard Component

Each article wraps in an `AgronomyCard` with local `useState` expand/collapse:

```tsx
function AgronomyCard({
  kicker, title, briefing, children
}: {
  kicker: string;
  title: string;
  briefing: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-3xl">
      <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-2">{kicker}</div>
      <h3 className="text-base font-bold text-slate-100 mb-3">{title}</h3>
      <div className="text-xs text-slate-300 leading-relaxed mb-3">{briefing}</div>
      <button onClick={() => setOpen(o => !o)}
        className="text-[11px] text-amber-400/80 hover:text-amber-400 transition-colors flex items-center gap-1">
        {open ? "▲ Less detail" : "▼ Read more"}
      </button>
      {open && <div className="mt-4 space-y-5">{children}</div>}
    </div>
  );
}
```

Typography helpers (H, P, LI, Code) are re-used from ResearchView.tsx — defined locally in AgronomyArticles.tsx to keep the file self-contained (no cross-file import of private helpers).

---

## The 4 Articles

### Article 1 — "When does rain become a supply shock?"

**Kicker:** Agronomy · Supply Risk  
**Briefing (always visible):** The mandatory 2–3 month dry period after harvest is a physiological requirement for floral dormancy — not a weather preference. Anomalous rainfall during November–January disrupts bud development, causing asynchronous blossoming and cascading harvest complications. The Nov 2025 Central Highlands floods are the most recent concrete example.

**Expanded content:**
- Physiological thresholds table: Robusta optimal 24–26°C, Arabica 15–24°C, >30°C → stomatal shutdown; annual rainfall 1,200–1,800 mm; humidity >85% → rust outbreak risk
- The 75–80% bud-development irrigation trigger rule: premature watering causes staggered bloom across the plantation, heterogeneous cherry maturation, raised harvest labour cost and Cup Quality degradation
- Consequence chain: asynchronous bloom → year-round CBB food source → population explosion

**Visual: Crop Cycle Timeline (SVG)**  
A horizontal 12-month band (Jan → Dec) with labelled coloured zones:
- Amber: Harvest window (Oct–Dec)
- Slate-blue: Mandatory dry / dormancy (Nov–Feb) — "floral bud development requires drought"
- Red hatched overlay: Anomalous rain danger window (Nov–Jan overlap)
- Blue dot marker: Irrigation trigger → blossoming (Feb–Mar)
- Green band: Fruit set & development (Apr–Sep)

Implementation: pure SVG with `<rect>` bands, `<text>` labels, no Recharts dependency.

---

### Article 2 — "Which clones ship when, and how much?"

**Kicker:** Agronomy · Varieties  
**Briefing (always visible):** Vietnam's late-ripening clones (TR14, TR15) were engineered to mature in January–February, 6–8 weeks after normal clones. This compresses the late-season supply window and eliminates one dry-season irrigation cycle — a structural shift in seasonal delivery patterns worth knowing on the screen.

**Expanded content:**
- Full clone table: TR4 (7.3 t/ha, rust-resistant), TR9 (6.7 t/ha, 22.5–29.6 g/100 beans), TR11 (6.6 t/ha), TR13 (4.5–6.5 t/ha, nematode-sensitive), TR14/TR15 (5.1–5.6 t/ha, late cycle), TRS1 (hybrid seed 4.5–6 t/ha)
- Arabica TN series: 3.0–3.5 t/ha, 10–20% above legacy Catimor, near-total rust resistance
- Genetic origin: Congo Basin ER group with introgression from Guinean, Atlantic coast, and East Central African populations

**Visuals:**

*Harvest Window Gantt (SVG):* Two horizontal bars on a month axis — "Normal clones (TR4/TR9/TR11): Oct–Dec" vs "Late-ripening (TR14/TR15): Jan–Feb". Annotated with "6–8 week supply delay".

*Yield comparison BarChart (Recharts):* `BarChart` with clone on x-axis, yield (t/ha) on y-axis, amber fill, dark grid. Data: TR4=7.3, TR9=6.7, TR11=6.6, TR13=5.5, TR14=5.4, TR15=5.2, TRS1=5.25. Secondary annotation for TR9: "up to 29.6 g/100 beans".

---

### Article 3 — "What does a kilo of Robusta actually cost to grow?"

**Kicker:** Agronomy · Production Costs  
**Briefing (always visible):** Producing 1 tonne of green beans permanently extracts 34.2 kg N, 46.9 kg K, and 6.1 kg P from the soil. Baseline annual fertiliser application is 1,600 kg NPK/ha. Cooperatives capture up to 95% of FOB export value; isolated smallholders face broker extraction that can halve net margin.

**Expanded content:**
- Nutrient extraction per tonne of green beans: N 34.2 kg, K 46.9 kg, P 6.1 kg, Mg 4.1 kg, Ca 4.3 kg
- Yield-scaling formula: per extra tonne above 3 t/ha baseline → +150 kg urea, +100 kg phosphate, +120–130 kg KCl
- Phenological application schedule (4 windows): Dry season S2 (500 kg NPK), May (400 kg), July (200 kg), September (500 kg)
- Water demand: 400–600 litres/tree/irrigation cycle; 25–30 day interval
- Ion antagonisms: excess P → Zn lockout; excess K → Mg deficiency (interveinal chlorosis); K-B antagonism → terminal necrosis in young tissue

**Visuals:**

*Nutrient Extraction BarChart (Recharts):* Horizontal `BarChart` showing N/K/P/Mg/Ca extraction per tonne green beans. K (46.9) dominates — immediately legible. Amber bars, slate background.

*Phenological Application Timeline (SVG):* Year axis with 4 vertical drop-lines at Dry S2 / May / July / September, each labelled with kg/ha dose. Shows the dose asymmetry (500–400–200–500).

---

### Article 4 — "How fragile is Vietnamese supply long-term?"

**Kicker:** Agronomy · Long-term Risk  
**Briefing (always visible):** Intensive monoculture has driven soil pH below 4.0 across large areas of the Central Highlands — at that level, phosphorus binds to iron oxides and becomes unavailable regardless of application volume. CIAT projects up to 50% of Vietnam's viable Robusta growing area eliminated by 2050 due to rising temperatures and shifting precipitation.

**Expanded content:**
- Nematode thresholds: replanting prohibited if >100 individuals/100 g soil, or >150/5 g root tissue; mandatory 1-year rotation to starve population
- pH remediation: lime amendment required; ammonium sulphate application has been the primary acidification driver
- Macadamia intercropping: documented +10% yield boost under rainfed conditions, up to +60% under combined drip irrigation; shared irrigation system compatibility
- Durian intercropping: revenues can double total farm income — critical for understanding why farmers hold positions during sustained price crashes rather than exiting
- CIAT long-term projection: 50% viable area loss by 2050 (temperature + precipitation stress)

**Visual: Viable Area Projection (Recharts AreaChart):**  
Conceptual projection line from 2025 (100%) to 2050 (50%), with shaded uncertainty band (60–40% at 2050). Static data array. Annotated with "CIAT projection". Slate/amber colour scheme, no live data dependency.

---

## ResearchView.tsx Changes

```tsx
// Type
type Cat = "cot" | "weather" | "contracts" | "agronomy";

// CATS array — append
{ id: "agronomy", label: "Agronomy" }

// Import at top
import AgronomyArticles from "./AgronomyArticles";

// Render
{cat === "agronomy" && <AgronomyArticles />}
```

---

## Visual Style Constraints

All visuals follow existing app conventions:
- Background: `bg-slate-900` / `bg-slate-800`
- Primary accent: amber (`#f59e0b` / `text-amber-400`)
- Body text: `text-slate-300`
- Chart grid: `stroke="#334155"` (slate-700)
- Chart font size: 11px
- Recharts `ResponsiveContainer` wraps all charts, `width="100%"`, height 220px for bars, 180px for area

---

## Testing Approach

- Visual inspection: open Research → Agronomy tab, verify 4 cards render in collapsed state
- Click each "Read more": verify expanded content + chart appears without layout break
- Collapse again: verify content hides cleanly
- Check dark-mode rendering: no white backgrounds visible
- No automated tests required (pure UI / static content)
