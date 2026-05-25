#!/usr/bin/env node
/**
 * backtest-intraweek.mjs — score the intraweek positioning model against
 * realized COT-to-COT changes, and sweep its tuning knobs.
 *
 * Run with:  node --import tsx scripts/backtest-intraweek.mjs
 *
 * Data: data/contract_prices_archive.json — the permanent ~5-year daily
 * per-contract OI+price archive (2021→present), NOT the 30-day public
 * oi_history.json the live dashboard serves. Each date carries price@N-1 and
 * oi@N-2 biz days (a ~1-day internal lag we accept as backtest noise).
 *
 * Methodology:
 *   1. Read cot.json (weekly truth) + the archive (daily OI/price).
 *   2. For each consecutive COT pair (W → W+1) whose span is covered by daily
 *      data, run estimateIntraweekFlow() over the [W … W+1] window using W's
 *      positions.
 *   3. Compare predicted category deltas to the realized COT-to-COT change:
 *        MM net, MM long, MM short, producers (PMPU short), roasters (PMPU long).
 *   4. Report per-category sign-accuracy + MAE vs. two baselines:
 *        - "zero":  predict no change          (MAE = mean |actual|)
 *        - "∝OI":   old model, MM net × (OI ratio − 1)   [MM net only]
 *   5. Sweep mmShareMult × refPct, then fit the best per-market mmShareMult.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, "..", "..");
const DATA       = resolve(__dirname, "..", "public", "data");

const { estimateIntraweekFlow, DEFAULT_PARAMS, NY_PARAMS, LDN_PARAMS } = await import("../lib/cot/intraweekModel.ts");

const n = (x) => (typeof x === "number" ? x : 0);
const posOf = (raw) => ({
  pmpuLong: n(raw?.pmpu_long), pmpuShort: n(raw?.pmpu_short), pmpuSpread: 0,
  swapLong: n(raw?.swap_long), swapShort: n(raw?.swap_short), swapSpread: 0,
  mmLong:   n(raw?.mm_long),   mmShort:   n(raw?.mm_short),   mmSpread: 0,
  otherLong:n(raw?.other_long),otherShort:n(raw?.other_short),otherSpread: 0,
  nonRepLong:n(raw?.nr_long),  nonRepShort:n(raw?.nr_short),  nonRepSpread: 0,
});
const totOI = (day) => day.contracts.reduce((s, c) => s + n(c.oi), 0);

const cot     = JSON.parse(await readFile(resolve(DATA, "cot.json"), "utf8"));
const archive = JSON.parse(await readFile(resolve(REPO_ROOT, "data", "contract_prices_archive.json"), "utf8"));

// Archive {date:{symbol:{oi,price}}} → ascending OiDay[] (front-first contract
// order is preserved from the archive). Drop days without a real OI snapshot.
const toDays = (mkt) =>
  Object.entries(archive[mkt])
    .map(([date, cons]) => ({
      date,
      contracts: Object.entries(cons).map(([symbol, v]) => ({ symbol, oi: n(v.oi), last_price: n(v.price) })),
    }))
    .filter((d) => totOI(d) > 1000)
    .sort((a, b) => a.date.localeCompare(b.date));

const MARKETS = [
  { name: "Arabica / NY",  side: "ny",  days: toDays("arabica"), params: NY_PARAMS },
  { name: "Robusta / LDN", side: "ldn", days: toDays("robusta"), params: LDN_PARAMS },
];

/** Scorable intervals for one market: {pos, win(asc), actual{}, oiRatio, mmNetW}. */
function intervals(side, daysAsc) {
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

const fmt = (x) => (x / 1000).toFixed(2) + "k";
const objMAEof = (acc, nrows) => (acc.mmNet.ae + acc.producer.ae + acc.roaster.ae) / (3 * (nrows || 1));

// ── per-market report at default params ───────────────────────────────────────
const byMarket = {};
let combined = [];
for (const m of MARKETS) {
  const rows = intervals(m.side, m.days);
  byMarket[m.name] = rows;
  combined = combined.concat(rows);
  const span = rows.length ? `${rows[0].from} → ${rows[rows.length - 1].to}` : "—";
  console.log(`\n=== ${m.name} — ${rows.length} scorable interval(s)  (${span}) ===`);
  if (!rows.length) continue;
  const { acc, prop } = score(rows, DEFAULT_PARAMS);
  console.log("  category    signHit    modelMAE    zeroMAE     skill");
  for (const c of CATS) {
    const s = acc[c.key];
    const skill = s.zae ? (1 - s.ae / s.zae) : 0;
    const hit = s.dirN ? `${s.hit}/${s.dirN} (${Math.round((100 * s.hit) / s.dirN)}%)` : "n/a";
    console.log(`  ${c.label.padEnd(10)}  ${hit.padStart(11)}  ${fmt(s.ae / s.n).padStart(8)}   ${fmt(s.zae / s.n).padStart(8)}   ${(skill * 100).toFixed(0).padStart(5)}%`);
  }
  console.log(`  MM net ∝OI baseline MAE: ${fmt(prop.mae)} (vs zero ${fmt(prop.zmae)})`);
}

// ── parameter sweep (combined across markets) ─────────────────────────────────
console.log(`\n=== Parameter sweep (combined, ${combined.length} intervals) — ranked by MM-net+producer+roaster MAE ===`);
const grid = [];
for (const mmShareMult of [0.25, 0.5, 0.75, 1, 1.5, 2, 3])
  for (const refPct of [0.5, 1, 2]) {
    const { acc } = score(combined, { ...DEFAULT_PARAMS, mmShareMult, refPct });
    grid.push({ mmShareMult, refPct, objMAE: objMAEof(acc, combined.length),
      dirHit: acc.mmNet.hit + acc.producer.hit + acc.roaster.hit,
      dirN:   acc.mmNet.dirN + acc.producer.dirN + acc.roaster.dirN });
  }
grid.sort((a, b) => a.objMAE - b.objMAE);
console.log("  mmShareMult  refPct   objMAE     dirHit");
for (const g of grid.slice(0, 8))
  console.log(`  ${String(g.mmShareMult).padStart(9)}  ${String(g.refPct).padStart(5)}   ${fmt(g.objMAE).padStart(7)}   ${g.dirHit}/${g.dirN}`);

// ── per-market mmShareMult curve + argmin (refPct fixed at default) ───────────
console.log(`\n=== Per-market mmShareMult sensitivity (refPct=${DEFAULT_PARAMS.refPct}) — objMAE + direction ===`);
const REF_MULTS = [0.25, 0.5, 1, 1.5, 2];
for (const m of MARKETS) {
  const rows = byMarket[m.name];
  if (!rows.length) continue;
  const cells = REF_MULTS.map((mult) => {
    const { acc } = score(rows, { ...DEFAULT_PARAMS, mmShareMult: mult });
    return `${mult}:${fmt(objMAEof(acc, rows.length))}`;
  });
  // dir hit-rate is mult-invariant (sign of a positive-scaled prediction) — show once
  const { acc } = score(rows, DEFAULT_PARAMS);
  const dh = acc.mmNet.hit + acc.producer.hit + acc.roaster.hit;
  const dn = acc.mmNet.dirN + acc.producer.dirN + acc.roaster.dirN;
  let best = null;
  for (let mult = 0.1; mult <= 2.5001; mult += 0.05) {
    const o = objMAEof(score(rows, { ...DEFAULT_PARAMS, mmShareMult: mult }).acc, rows.length);
    if (!best || o < best.o) best = { mult: +mult.toFixed(2), o };
  }
  console.log(`  ${m.name.padEnd(14)} MAE@mult ${cells.join("  ")}  | argmin≈${best.mult}  | dir ${dh}/${dn}`);
}

// ── industry directional confidence by signal magnitude (terciles) ────────────
// Industry calls are only ~base-rate when the signal is weak, but ~82-86% when
// strong. These cuts feed NY_PARAMS / LDN_PARAMS confLow/confHigh.
console.log(`\n=== Industry directional accuracy by |signal| tercile ===`);
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))] ?? 0; };
for (const m of MARKETS) {
  const rows = byMarket[m.name];
  if (!rows.length) continue;
  const samples = [];
  for (const r of rows) {
    const f = estimateIntraweekFlow(r.win, r.pos, m.params);
    for (const [pred, act] of [[f.producerLotsDelta, r.actual.producer], [f.roasterLotsDelta, r.actual.roaster]]) {
      if (Math.abs(act) < SIGN_FLOOR || pred === 0) continue;
      samples.push({ mag: Math.abs(pred), hit: Math.sign(pred) === Math.sign(act) });
    }
  }
  const lo = pctl(samples.map(s => s.mag), 0.33), hi = pctl(samples.map(s => s.mag), 0.67);
  const hr = (f) => { const a = samples.filter(f); return a.length ? Math.round((100 * a.filter(s => s.hit).length) / a.length) : 0; };
  console.log(`  ${m.name.padEnd(14)} cuts low<${Math.round(lo)} high>${Math.round(hi)} lots  |  hit: low ${hr(s => s.mag < lo)}%  mid ${hr(s => s.mag >= lo && s.mag <= hi)}%  high ${hr(s => s.mag > hi)}%  (n=${samples.length})`);
}

console.log(`\nDefault params: ${JSON.stringify(DEFAULT_PARAMS)}`);
