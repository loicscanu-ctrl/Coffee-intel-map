#!/usr/bin/env node
/**
 * backtest-magnitude-weights.mjs — compare composite-score distributions
 * before and after the PR-#6 magnitude weighting.
 *
 * Methodology:
 *   1. Read frontend/public/data/cot.json (full COT history)
 *   2. For each week with ≥2 rows of prior history:
 *        - Run evaluateSignals(rows[0..i])
 *        - Compute composite NY/LDN under TWO schemes:
 *            (a) "pre-#6": category weight only (small=medium=large all = 1×)
 *            (b) "post-#6": category weight × magnitude weight (current code)
 *   3. Bucket the resulting scores by scoreZone and print a histogram.
 *
 * Decision aid: if zones shift materially (e.g. weeks that were "Bullish"
 * pre-#6 are now "Neutral" post-#6), the scoreZone boundaries need to move.
 * If zones look comparable, current ±5/±2 boundaries are fine.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, "..", "..");

const { transformApiData } = await import("../lib/cot/transformApiData.ts");
const { evaluateSignals }  = await import("../lib/cot/signalEngine.ts");

// ── Composite recomputation ──────────────────────────────────────────────────
// Pre-#6: category weight only.
// Post-#6: category × magnitude. (Matches the current `computeCompositeScores`.)

const CATEGORY_WEIGHTS = {
  CP: 1.0, CR: 1.0, ML: 1.0, MS: 1.0,
  CI: 0.5, MI: 0.5, MPI: 0.5, MRI: 0.5,
  TC: 0.25, OB: 0.25, CS: 0.25, SP: 0.25,
};
const MAGNITUDE_WEIGHTS = { small: 0.5, medium: 1.0, large: 1.5 };

function composite(signals, useMagnitude) {
  let scoreNY = 0, scoreLDN = 0;
  for (const s of signals) {
    const cw = CATEGORY_WEIGHTS[s.category] ?? 1.0;
    const mw = useMagnitude ? (MAGNITUDE_WEIGHTS[s.magnitude] ?? 1.0) : 1.0;
    const w = s.score * cw * mw;
    if (s.market === "NY") scoreNY += w;
    else                   scoreLDN += w;
  }
  return {
    scoreNY:  Math.max(-10, Math.min(10, Math.round(scoreNY))),
    scoreLDN: Math.max(-10, Math.min(10, Math.round(scoreLDN))),
  };
}

function zone(s) {
  if (s <= -5) return "Strongly Bearish";
  if (s <  -2) return "Bearish";
  if (s <=  2) return "Neutral";
  if (s <   5) return "Bullish";
  return "Strongly Bullish";
}

const ZONES = ["Strongly Bearish", "Bearish", "Neutral", "Bullish", "Strongly Bullish"];

function histogram(label, scores) {
  const counts = Object.fromEntries(ZONES.map(z => [z, 0]));
  const buckets = Array.from({length: 21}, (_, i) => i - 10); // -10..10
  const bucketCounts = Object.fromEntries(buckets.map(b => [b, 0]));
  for (const s of scores) {
    counts[zone(s)] += 1;
    bucketCounts[s] = (bucketCounts[s] || 0) + 1;
  }
  const total = scores.length;
  const max = Math.max(...Object.values(bucketCounts));
  const barWidth = 40;

  console.log(`\n=== ${label}  (n=${total}) ===`);
  console.log("\nZone distribution:");
  for (const z of ZONES) {
    const n = counts[z];
    const pct = total ? ((n / total) * 100).toFixed(1) : "0.0";
    const bar = "█".repeat(Math.round((n / total) * 30));
    console.log(`  ${z.padEnd(18)} ${String(n).padStart(4)} (${pct.padStart(4)}%)  ${bar}`);
  }
  console.log("\nScore histogram (rounded, [-10..10]):");
  for (const b of buckets) {
    const n = bucketCounts[b] || 0;
    if (n === 0) continue;
    const bar = "▌".repeat(Math.round((n / max) * barWidth));
    console.log(`  ${String(b).padStart(3)}: ${String(n).padStart(4)} ${bar}`);
  }

  const mean = scores.reduce((a, b) => a + b, 0) / total;
  const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / total);
  console.log(`\n  mean=${mean.toFixed(2)}  std=${std.toFixed(2)}  min=${Math.min(...scores)}  max=${Math.max(...scores)}`);
}

// ── Run ──────────────────────────────────────────────────────────────────────

const raw       = JSON.parse(await readFile(resolve(REPO_ROOT, "frontend/public/data/cot.json"), "utf8"));
const processed = transformApiData(raw);

if (processed.length < 60) {
  console.error(`[backtest] only ${processed.length} rows after transform; need ≥60 for meaningful percentiles.`);
  process.exit(1);
}

// Walk from week 60 onwards so 52-week percentiles are valid.
const pre  = { NY: [], LDN: [] };
const post = { NY: [], LDN: [] };
const transitions = []; // weeks where pre and post zones disagree

for (let i = 60; i < processed.length; i++) {
  const slice   = processed.slice(0, i + 1);
  const signals = evaluateSignals(slice);
  const sPre    = composite(signals, false);
  const sPost   = composite(signals, true);
  pre.NY.push(sPre.scoreNY);   pre.LDN.push(sPre.scoreLDN);
  post.NY.push(sPost.scoreNY); post.LDN.push(sPost.scoreLDN);

  if (zone(sPre.scoreNY)  !== zone(sPost.scoreNY) ||
      zone(sPre.scoreLDN) !== zone(sPost.scoreLDN)) {
    transitions.push({
      date: slice[slice.length - 1].date,
      NY:   { pre: sPre.scoreNY,  post: sPost.scoreNY,  preZone: zone(sPre.scoreNY),  postZone: zone(sPost.scoreNY) },
      LDN:  { pre: sPre.scoreLDN, post: sPost.scoreLDN, preZone: zone(sPre.scoreLDN), postZone: zone(sPost.scoreLDN) },
    });
  }
}

console.log("# Magnitude-weighting back-test");
console.log(`Weeks evaluated: ${pre.NY.length} (from week 60 onwards of ${processed.length}-row history)`);
console.log(`Date range: ${processed[60].date} → ${processed[processed.length - 1].date}`);

histogram("NY — pre-#6 (no magnitude weights)",  pre.NY);
histogram("NY — post-#6 (with magnitude weights)", post.NY);
histogram("LDN — pre-#6 (no magnitude weights)", pre.LDN);
histogram("LDN — post-#6 (with magnitude weights)", post.LDN);

// Cross-tab of zone transitions
console.log("\n\n=== Zone shifts (weeks where pre and post disagree) ===");
console.log(`Total disagreement weeks: ${transitions.length} / ${pre.NY.length} (${((transitions.length / pre.NY.length) * 100).toFixed(1)}%)`);
if (transitions.length > 0 && transitions.length <= 20) {
  console.log("\nDate         NY: pre → post                       LDN: pre → post");
  for (const t of transitions) {
    console.log(`${t.date}  ${String(t.NY.pre).padStart(3)} ${t.NY.preZone.padEnd(18)} → ${String(t.NY.post).padStart(3)} ${t.NY.postZone.padEnd(18)}  ${String(t.LDN.pre).padStart(3)} ${t.LDN.preZone.padEnd(18)} → ${String(t.LDN.post).padStart(3)} ${t.LDN.postZone}`);
  }
} else if (transitions.length > 20) {
  console.log("\n(Showing first 10 + last 10 transitions)");
  const sample = [...transitions.slice(0, 10), { date: "...", NY: { pre: "", preZone: "...", post: "", postZone: "..." }, LDN: { pre: "", preZone: "...", post: "", postZone: "..." } }, ...transitions.slice(-10)];
  for (const t of sample) {
    console.log(`${String(t.date).padEnd(11)}  ${String(t.NY.pre).padStart(3)} ${String(t.NY.preZone).padEnd(18)} → ${String(t.NY.post).padStart(3)} ${String(t.NY.postZone).padEnd(18)}  ${String(t.LDN.pre).padStart(3)} ${String(t.LDN.preZone).padEnd(18)} → ${String(t.LDN.post).padStart(3)} ${t.LDN.postZone}`);
  }
}

// Per-zone transition direction (are we losing strongly-bearish weeks? gaining neutrals?)
const shifts = {};
for (const t of transitions) {
  for (const mkt of ["NY", "LDN"]) {
    if (t[mkt].preZone !== t[mkt].postZone) {
      const key = `${t[mkt].preZone} → ${t[mkt].postZone}`;
      shifts[key] = (shifts[key] || 0) + 1;
    }
  }
}
console.log("\n=== Transition direction counts ===");
for (const [k, v] of Object.entries(shifts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(45)} ${v}`);
}
