#!/usr/bin/env node
/**
 * backtest-intraweek.mjs — score the intraweek positioning model against
 * realized COT-to-COT changes, and sweep its tuning knobs.
 *
 * Run with:  node --import tsx scripts/backtest-intraweek.mjs
 *
 * Methodology:
 *   1. Read cot.json (weekly truth) + oi_history.json (daily per-contract OI/price).
 *   2. For each consecutive COT pair (W → W+1) whose span is covered by daily OI,
 *      run estimateIntraweekFlow() over the [W … W+1] window using W's positions.
 *   3. Compare the predicted category deltas to the realized COT-to-COT change:
 *        MM net, MM long, MM short, producers (PMPU short), roasters (PMPU long).
 *   4. Report per-category sign-accuracy + MAE vs. two baselines:
 *        - "zero":  predict no change          (MAE = mean |actual|)
 *        - "∝OI":   old model, MM net × (OI ratio − 1)   [MM net only]
 *   5. Sweep mmShareMult × refPct and print the grid ranked by combined MAE.
 *
 * NOTE: oi_history.json is a short rolling window (~30 days), so only a handful
 * of COT weeks are scorable today. The harness is built to stay valid as the
 * daily history accumulates — re-run it whenever oi_history grows.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "..", "public", "data");

const { estimateIntraweekFlow, DEFAULT_PARAMS } = await import("../lib/cot/intraweekModel.ts");

const n = (x) => (typeof x === "number" ? x : 0);
const posOf = (raw) => ({
  pmpuLong: n(raw?.pmpu_long), pmpuShort: n(raw?.pmpu_short), pmpuSpread: 0,
  swapLong: n(raw?.swap_long), swapShort: n(raw?.swap_short), swapSpread: 0,
  mmLong:   n(raw?.mm_long),   mmShort:   n(raw?.mm_short),   mmSpread: 0,
  otherLong:n(raw?.other_long),otherShort:n(raw?.other_short),otherSpread: 0,
  nonRepLong:n(raw?.nr_long),  nonRepShort:n(raw?.nr_short),  nonRepSpread: 0,
});
const totOI = (day) => day.contracts.reduce((s, c) => s + n(c.oi), 0);

const cot = JSON.parse(await readFile(resolve(DATA, "cot.json"), "utf8"));
const oi  = JSON.parse(await readFile(resolve(DATA, "oi_history.json"), "utf8"));

const MARKETS = [
  { name: "Arabica / NY",  side: "ny",  oiKey: "arabica" },
  { name: "Robusta / LDN", side: "ldn", oiKey: "robusta" },
];

/** Build the list of scorable intervals: {posW, window(asc), actual{}}. */
function intervals(side, oiKey) {
  const daysAsc = [...oi[oiKey]].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 0; i < cot.length - 1; i++) {
    const W = cot[i], Wn = cot[i + 1];
    if (!W[side] || !Wn[side]) continue;
    const win = daysAsc.filter((d) => d.date >= W.date && d.date <= Wn.date);
    if (win.length < 2 || win[0].date > W.date || win[win.length - 1].date < Wn.date) continue;
    const pW = posOf(W[side]), pWn = posOf(Wn[side]);
    out.push({
      from: W.date, to: Wn.date, win, pos: pW,
      oiRatio: totOI(win[0]) ? totOI(win[win.length - 1]) / totOI(win[0]) : 1,
      mmNetW: pW.mmLong - pW.mmShort,
      actual: {
        mmNet:     (pWn.mmLong - pWn.mmShort) - (pW.mmLong - pW.mmShort),
        mmLong:     pWn.mmLong  - pW.mmLong,
        mmShort:    pWn.mmShort - pW.mmShort,
        producer:   pWn.pmpuShort - pW.pmpuShort,
        roaster:    pWn.pmpuLong  - pW.pmpuLong,
      },
    });
  }
  return out;
}

const CATS = [
  { key: "mmNet",    label: "MM net",    pred: (f) => f.mmLongDelta - f.mmShortDelta },
  { key: "mmLong",   label: "MM long",   pred: (f) => f.mmLongDelta },
  { key: "mmShort",  label: "MM short",  pred: (f) => f.mmShortDelta },
  { key: "producer", label: "Producers", pred: (f) => f.producerLotsDelta },
  { key: "roaster",  label: "Roasters",  pred: (f) => f.roasterLotsDelta },
];
const SIGN_FLOOR = 200; // ignore near-flat weeks when scoring direction

function score(allRows, params) {
  // allRows: [{ win, pos, actual, ... }]
  const acc = {};
  for (const c of CATS) acc[c.key] = { ae: 0, zae: 0, hit: 0, n: 0, dirN: 0 };
  let propAE = 0, propZae = 0, propN = 0;
  for (const r of allRows) {
    const f = estimateIntraweekFlow(r.win, r.pos, params);
    for (const c of CATS) {
      const p = c.pred(f), a = r.actual[c.key];
      acc[c.key].ae += Math.abs(p - a);
      acc[c.key].zae += Math.abs(a);
      acc[c.key].n += 1;
      if (Math.abs(a) >= SIGN_FLOOR) { acc[c.key].dirN += 1; if (Math.sign(p) === Math.sign(a)) acc[c.key].hit += 1; }
    }
    // ∝OI baseline (MM net only)
    const propPred = r.mmNetW * (r.oiRatio - 1);
    propAE += Math.abs(propPred - r.actual.mmNet);
    propZae += Math.abs(r.actual.mmNet);
    propN += 1;
  }
  return { acc, prop: { mae: propAE / (propN || 1), zmae: propZae / (propN || 1) } };
}

// ── per-market report at default params ───────────────────────────────────────
const fmt = (x) => (x / 1000).toFixed(2) + "k";
let combined = [];
for (const m of MARKETS) {
  const rows = intervals(m.side, m.oiKey);
  combined = combined.concat(rows);
  console.log(`\n=== ${m.name} — ${rows.length} scorable interval(s) ===`);
  console.log("  " + rows.map((r) => `${r.from.slice(5)}→${r.to.slice(5)}`).join("  "));
  if (!rows.length) continue;
  const { acc, prop } = score(rows, DEFAULT_PARAMS);
  console.log("  category    signHit   modelMAE    zeroMAE     skill");
  for (const c of CATS) {
    const s = acc[c.key];
    const skill = s.zae ? (1 - s.ae / s.zae) : 0;
    const hit = s.dirN ? `${s.hit}/${s.dirN}` : "  n/a";
    console.log(`  ${c.label.padEnd(10)}  ${hit.padStart(6)}   ${fmt(s.ae / s.n).padStart(8)}   ${fmt(s.zae / s.n).padStart(8)}   ${(skill * 100).toFixed(0).padStart(5)}%`);
  }
  console.log(`  MM net ∝OI baseline MAE: ${fmt(prop.mae)} (vs zero ${fmt(prop.zmae)})`);
}

// ── parameter sweep (combined across markets) ─────────────────────────────────
console.log(`\n=== Parameter sweep (combined, ${combined.length} intervals) — ranked by MM-net+producer+roaster MAE ===`);
const grid = [];
for (const mmShareMult of [0.5, 0.75, 1, 1.5, 2, 3])
  for (const refPct of [0.5, 1, 2]) {
    const params = { ...DEFAULT_PARAMS, mmShareMult, refPct };
    const { acc } = score(combined, params);
    const objMAE = (acc.mmNet.ae + acc.producer.ae + acc.roaster.ae) / (3 * (combined.length || 1));
    const dirHit = (acc.mmNet.hit + acc.producer.hit + acc.roaster.hit);
    const dirN   = (acc.mmNet.dirN + acc.producer.dirN + acc.roaster.dirN);
    grid.push({ mmShareMult, refPct, objMAE, dirHit, dirN });
  }
grid.sort((a, b) => a.objMAE - b.objMAE);
console.log("  mmShareMult  refPct   objMAE     dirHit");
for (const g of grid)
  console.log(`  ${String(g.mmShareMult).padStart(9)}  ${String(g.refPct).padStart(5)}   ${fmt(g.objMAE).padStart(7)}   ${g.dirHit}/${g.dirN}`);

console.log(`\nDefault params: ${JSON.stringify(DEFAULT_PARAMS)}`);
