"use client";
import { Paper, H2, P, Code, Fml, Highlight } from "./prose";

export default function FarmerMethodology() {
  return (
    <Paper
      tone="orange"
      updated="2026-07-14"
      kicker="Farmer economics · Methodology"
      title="Farmer economics — cost of production, break-even & crop stress"
      subtitle="What it costs to grow a bag, the margin, and the agronomic-stress models that move yield"
    >
      <P>
        This is the farm-gate view: the cash cost of producing coffee, the grower&rsquo;s margin against spot, and the
        water-stress models that lead yield by a season. The <strong>frost</strong> surface-temperature model is
        documented separately under <strong>Weather</strong>; this paper covers cost, break-even and the{" "}
        <strong>drought</strong> side.
      </P>

      <H2>1 · Cost of production — the CONAB build-up</H2>
      <P>
        Brazil&rsquo;s cost comes from CONAB&rsquo;s <em>Custos de Produção</em> spreadsheets, parsed per coffee type
        (Arabica from the Sul de Minas sheet, Conilon from Espírito Santo) into five weighted components and an inputs
        sub-breakdown, converted to USD at the live BRL rate:
      </P>
      <Fml>{`components = { Inputs, Labour, Mechanisation, Land rent, Admin }   (BRL/bag)
total_usd  = total_brl / BRL_USD          (defaults to 5.0 if FX fetch fails)
share_i    = component_brl_i / Σ component_brl
YoY        = (total − prev_total) / prev_total × 100   (real only once two scrapes exist)`}</Fml>
      <P className="text-[11px] text-slate-500">
        Live values run ≈ <Code>$218/bag</Code> Arabica, <Code>$127/bag</Code> Conilon. The inputs sub-breakdown is
        currently unfed (the input rows aren&rsquo;t matching the latest sheet layout) — a known data gap.
      </P>

      <H2>2 · Break-even & farmer margin</H2>
      <P>
        Margin is spot minus cost, per bag, with the robusta spot converted from the futures $/MT:
      </P>
      <Fml>{`margin = spot − total_cost          (red when negative — below break-even)
arabica spot = KC front-contract last
robusta spot = RC $/MT × 0.06       (60 kg / 1000 → $/bag)`}</Fml>
      <P className="text-[11px] text-slate-500">
        The break-even line is implemented but currently unfed when the futures spot fields are null at export time —
        the method is live, the data wiring is intermittent.
      </P>

      <H2>3 · Sectioned cost-of-production (per-MT, FOB build-up)</H2>
      <P>
        Origins with full cost structure (e.g. Vietnam) use a richer per-MT model: numbered farm-gate sections plus
        post-farm-gate &ldquo;Farm-gate → FOB&rdquo; sections, a $/MT↔$/ha toggle, and a per-line{" "}
        <strong>family-vs-hired labour split</strong>. The load-bearing concepts are the <strong>FOB build-up</strong>
        (a separate FOB total on top of farm-gate cost) and a <strong>cash-basis</strong> figure that excludes family
        labour — the grower&rsquo;s true out-of-pocket cost:
      </P>
      <Fml>{`section_share = section_usd_per_ton / total × 100
cash_basis    = total_usd_per_ton  −  family_labour      (out-of-pocket)
margin        = spot − total      (per MT)`}</Fml>

      <H2>4 · Drought model — RWC + evaporative demand + rain relief</H2>
      <P>
        A genuine per-day, per-region agronomic model over the 14-day forecast (distinct from frost). It starts from
        root-zone soil moisture, converts to plant-available water, adds evaporative demand and subtracts rain relief,
        then applies crop-aware modifiers:
      </P>
      <Fml>{`root-zone SM = 0.10·(0–9cm) + 0.25·(9–27cm) + 0.65·(27–81cm)
RWC          = (SM − PWP) / AWC × 100        PWP 0.15, AWC 0.20
base score   ← RWC band:  ≥80→0 · ≥60→0.5 · ≥40→1.0 · ≥20→2.0 · <20→3.0
+ ET₀ demand: +0.5 if >7 mm/d, +0.25 if >5
− rain relief = min(1.5, effective_rain / 5)
raw = max(0, base + et0 − relief)

modifiers:  ×1.2 Aug–Oct (flowering), ×1.1 Jan–Feb · +0.5 if ≥10/14 days >1.0 (persistence)
            Robusta/Espírito Santo floor 1.5 when VPD > 1.5 kPa
class:  H ≥2.5 · M ≥1.5 · L ≥0.5`}</Fml>
      <Highlight>
        The phenology multiplier is the key idea: the same water deficit matters far more during{" "}
        <strong>flowering (Aug–Oct)</strong> than in dormancy, so the score is amplified in that window. The model is
        hand-tuned for Brazilian Oxisol/Latosol soils — read the class, not the decimal.
      </Highlight>

      <H2>5 · Cumulative Stress Index (CSI-30 / CSI-60)</H2>
      <P>
        A backward-looking companion to the forward drought score — accumulated water deficit over the past 30 and 60
        days:
      </P>
      <Fml>{`daily_deficit = max(0, ET₀ − effective_rain)
CSI-30 = Σ deficit (last 30 days)   ·   CSI-60 = Σ (last 60 days)
level (per 30-day window): <20 – · 20–40 L · 40–60 M · >60 H`}</Fml>

      <H2>6 · Fertilizer implied prices (Comex build-up)</H2>
      <P>
        Rather than rely only on World-Bank list prices, the model derives FOB fertilizer prices from Brazil&rsquo;s
        actual import value and volume by NCM code, which captures what growers really pay landed:
      </P>
      <Fml>{`implied_price = FOB_value(month) × 1000 / volume_kt      [USD/MT]   (months < 0.5 kt skipped)`}</Fml>
      <P className="text-[11px] text-slate-500">
        Comex-derived implied prices are preferred over the World-Bank series; per-bag cost impact uses static nutrient
        weights (urea, MAP, KCl) on top.
      </P>

      <H2>7 · Selling pace & the supply balance sheet</H2>
      <P>
        Two more farm-side reads. The <strong>commercialisation pace</strong> tracks the % of crop committed to market
        with month-over-month and five-year-average gap colouring, plus a dual-crop block (current-crop inventory vs
        new-crop advance sales). And a farmer-economics <strong>balance sheet</strong> averages three production sources
        into a net-stocks identity:
      </P>
      <Fml>{`production = avg(USDA, CONAB, CECAFE)
net_stocks = production − exports(ICO) − consumption        (deficit/surplus by sign)`}</Fml>

      <H2>Where it lives</H2>
      <P>
        Cost &amp; margin export logic: <Code>backend/scraper/exporters/supply.py</Code> +
        <Code>sources/conab_supply.py</Code>; drought / CSI / VPD in <Code>sources/farmer_economics.py</Code> →
        <Code>farmer_economics.json</Code>. Frontend panels: <Code>components/supply/farmer-economics/*</Code>
        (<Code>ProductionCostPanel</Code>, <Code>BalanceSheetPanel</Code>, <Code>FarmerSellingPanel</Code>), on the
        Supply → Farmer Economics tab.
      </P>
    </Paper>
  );
}
